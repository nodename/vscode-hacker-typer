"use strict";

import * as vscode from "vscode";
import { go, Channel, chan, alts, put, putAsync, CLOSED } from "js-csp";
import {
  Buffer, describeSelections, describeChange, reverseFrame, Frame, isStopPoint, emptyChangeInfo
} from "./buffers";
import Storage from "./storage";
import { Interpreter } from "xstate";
import { TyperContext, TyperSchema, TyperEvent } from "./states";
import * as statusBar from "./statusBar";
import showError from "./showError";
import { applyFrame } from "./edit";

// Messages from our documentChange handler:
let documentChangeChannel: Channel;
// Messages from our selectionChange handler:
let selectionChangeChannel: Channel;
// Undo messages from the Undo command:
let undoChannel: Channel;
// Buffers destined for bufferList:
let bufferChannel: Channel;

function insertStop(name: string | null) {
  putAsync(bufferChannel, {
    stop: { name: name || null },
    selections: undefined
  });
}

// state is 'saved':
export function continueOrEndRecording() {
  const CONTINUE = "Continue current recording";
  const END = "Stop recording";
  vscode.window.showQuickPick([CONTINUE, END], {
    canPickMany: false,
    ignoreFocusOut: true,
    placeHolder: "Please choose Continue or Stop"
  })
    .then(
      selection => {
        switch (selection) {
          case CONTINUE:
            stateService.send('RESUME_RECORDING');
            break;
          case END:
          default: // User hit Escape
            bufferList.length = 0;
            // transition out of record state:
            stateService.send('DONE_RECORDING');
            statusBar.show("Done recording");
            break;
        }
      }
    );
}

function registerRecordingCommands() {
  const insertStopCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.insertStop",
    () => {
      insertStop(null);
      statusBar.show("Inserted STOP");
    }
  );

  const undoCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.undo",
    () => {
      putAsync(undoChannel, "UNDO");
    }
  );

  const saveOrDiscardMacroCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.saveOrDiscardMacro",
    () => {
      documentChangeChannel.close();
      selectionChangeChannel.close();
    }
  );

  const cancelRecordingCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.cancelRecording",
    () => {
      bufferList.length = 0;
      stateService.send('DONE_RECORDING');
      statusBar.show("Recording cancelled");
    }
  );

  return [insertStopCommand, undoCommand, saveOrDiscardMacroCommand, cancelRecordingCommand];
}

let recordingHooks: vscode.Disposable;

export function registerRecordingHooks() {
  console.log("registerRecordingHooks");
  const commands: vscode.Disposable[] = registerRecordingCommands();
  const eventHandlers: vscode.Disposable[] = registerRecordingEventHandlers();

  recordingHooks = vscode.Disposable.from(
    ...commands, ...eventHandlers
  );
}

export function disposeRecordingHooks(context: vscode.ExtensionContext) {
  console.log("disposeRecordingHooks");
  if (recordingHooks) {
    recordingHooks.dispose();
  }
}

let stateService: Interpreter<TyperContext, TyperSchema, TyperEvent>;
let storage: Storage | null = null;
let bufferList: Buffer[] = [];

// on initial entry:
export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext, TyperSchema, TyperEvent>) {
  stateService = service;
  console.log("record.start");
  storage = Storage.getInstance(context);
  if (bufferList.length === 0) {
    startNewRecording();
  } else {
    resumeOrNewRecording();
  }
}

// on initial entry:
async function resumeOrNewRecording() {
  const CONTINUE = "Continue current recording";
  const NEW = "New recording from active editor";
  let selection = await vscode.window.showQuickPick([CONTINUE, NEW], {
    canPickMany: false,
    ignoreFocusOut: true,
    placeHolder: "Please choose Save or Discard"
  });

  if (!selection) {
    return;
  }
  switch (selection) {
    case NEW:
      stateService.send('SAVE_RECORDING');
      startNewRecording();
      break;
    case CONTINUE:
      stateService.send('RESUME_RECORDING');
      break;
    default:
      break;
  }
}

// on bufferChannel closed:
async function saveOrDiscardCurrent() {
  const SAVE = "Save current recording";
  const DISCARD = "Discard current recording";

  while (true) {
    let selection = await vscode.window.showQuickPick([SAVE, DISCARD], {
      canPickMany: false,
      ignoreFocusOut: true,
      placeHolder: "Please choose Save or Discard"
    });

    switch (selection) {
      case SAVE:
        return 'save';
        break;
      case DISCARD:
        return 'discard';
        break;
      default:
        break;
    }
  }
}

let currentActiveDoc: vscode.TextDocument;
let textEditor: vscode.TextEditor | undefined;

function handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
  if (event.document !== currentActiveDoc) {
    console.log('Non-watched doc changed');
  } else {
    console.log(`documentChanges:
    ${event.contentChanges.map(describeChange).join("\n")}`);
    putAsync(documentChangeChannel, {
      // store changes, selection change will commit
      changes: event.contentChanges
    });
  }
}

function handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
  // Only allow recording from one active editor at a time
  // Breaks when you leave but that's fine for now.
  if (event.textEditor !== textEditor) {
    // TODO ask if user wants to save current recording
    return;
  }

  statusBar.show("Recording");
  const selections = event.selections || [];
  console.log("");
  console.log(`handleSelectionChange:
    selections:
        ${describeSelections(selections)}`);
  putAsync(selectionChangeChannel, selections);
}

function registerRecordingEventHandlers() {
  const documentChangeHandler = vscode.workspace.onDidChangeTextDocument(
    handleDocumentChange
  );

  const selectionChangeHandler = vscode.window.onDidChangeTextEditorSelection(
    handleSelectionChange
  );

  const documentClosedHandler = vscode.workspace.onDidCloseTextDocument(
    (closedDoc: vscode.TextDocument) => {
      if (closedDoc === currentActiveDoc) {
        console.log('Watched doc was closed');
      } else {
        console.log('Non-watched doc closed');
      }
    });

  const activeEditorChangedHandler = vscode.window.onDidChangeActiveTextEditor(
    (_newEditor: vscode.TextEditor | undefined) => {
      // ask if user wants to save current recording and stop recording
    });

  return [documentChangeHandler,
    selectionChangeHandler,
    documentClosedHandler,
    activeEditorChangedHandler];
}

function runChanges() {
  // Consumes document-change and selection-change messages
  // Puts frames on the bufferChannel
  go(function* () {
    while (true) {
      let changeInfo;
      let selections;
      let result = yield alts([documentChangeChannel, selectionChangeChannel], { priority: false });
      if (result.channel === documentChangeChannel) {
        changeInfo = result.value;
        // I assume a documentChange is always followed by a selectionChange:
        selections = yield selectionChangeChannel;
        console.log("got both");
      } else {
        // But a selectionChange may arrive with no preceding documentChange
        // if the user made a selection manually:
        changeInfo = emptyChangeInfo;
        selections = result.value;
        console.log("got selection only");
      }
      if (changeInfo === CLOSED || selections === CLOSED) {
        console.log("no more changes"); // check each of the two!
        bufferChannel.close();
        return;
      }
      yield put(bufferChannel,
        { changeInfo: changeInfo, selections: selections });
    }
  });
}

function runBuffers() {
  const editChannel = chan(1);

  // consumes bufferChannel and undoChannel
  // updates the bufferList and (if undo) the document
  go(function* () {
    while (true) {
      let result = yield alts([undoChannel, bufferChannel], { priority: true });
      if (result.channel === undoChannel) {
        console.log("UNDO");
        const lastBuffer = bufferList[bufferList.length - 1];
        if (isStopPoint(lastBuffer)) {
          bufferList.pop();
        } else {
          let frameIndex = bufferList.length - 2;
          let previousFrameOrStartingPoint = bufferList[frameIndex];
          while (isStopPoint(previousFrameOrStartingPoint)) {
            frameIndex -= 1;
            previousFrameOrStartingPoint = bufferList[frameIndex];
          }
          if (previousFrameOrStartingPoint) {
            const undoFrame: Frame = reverseFrame(<Frame>lastBuffer, previousFrameOrStartingPoint, currentActiveDoc);
            if (!textEditor) {
              // error
            } else {
              // apply the undo to the document:
              applyFrame(undoFrame, textEditor, editChannel);
              // wait for applyFrame to finish:
              yield editChannel;
              bufferList.pop();
              // ignore next bufferChannel message; it's generated by the callbacks of our applyFrame:
              yield bufferChannel;
            }
          }
        }
      } else { // result came from bufferChannel
        let buffer = result.value;
        if (buffer === CLOSED) {
          console.log("no more buffers");
          saveOrDiscardCurrent()
            .then(saveOrDiscard => {
              switch (saveOrDiscard) {
                case 'save':
                  stateService.send('SAVE_RECORDING');
                  break;
                case 'discard':
                  bufferList.length = 0;
                  statusBar.show('Discarded recording');
                  stateService.send('DONE_RECORDING');
                  break;
              }
            });
          return;
        } else {
          // It's a buffer:
          bufferList.push(buffer);
        }
      }
    }
  });
}

function initChannels() {
  documentChangeChannel = chan(1);
  selectionChangeChannel = chan(1);
  undoChannel = chan(1);
  bufferChannel = chan(1);
}


// startNewRecording or resumeRecording:
function startRecording(currentOpenEditor: vscode.TextEditor) {
  // start watching the currently open doc
  // TODO if not new recording, check if doc has changed
  currentActiveDoc = currentOpenEditor.document;
  statusBar.show("");

  runChanges();
  runBuffers();
}

function startNewRecording() {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    initChannels();
    insertStartingPoint(textEditor);
    startRecording(textEditor);
  }
}

export function resumeRecording() {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    initChannels();
    startRecording(textEditor);
  }
}

function insertStartingPoint(textEditor: vscode.TextEditor) {
  const initialDocumentContent = textEditor.document.getText();
  const language = textEditor.document.languageId;
  const selections = textEditor.selections;

  //console.log(`initial content: "${initialDocumentContent}"`);

  putAsync(bufferChannel, { content: initialDocumentContent, language: language, selections: selections });
}

export function saveRecording() {
  doSaveRecording()
    .then(success => {
      stateService.send(success ? 'RECORDING_SAVED' : 'RECORDING_NOT_SAVED');
    });
}

async function doSaveRecording() {
  statusBar.show('Saving');
  if (bufferList.length < 2) {
    showError("Cannot save macro with no content.");
    return false;
  }
  if (!storage) {
    showError("Cannot save macro!");
    return false;
  }

  let name = await vscode.window.showInputBox({
    prompt: "Give this thing a name (or hit ESC to discard it)",
    placeHolder: "name",
    ignoreFocusOut: true
  });

  if (name) {
    statusBar.show(name);
    const macro = await storage.save({
      name,
      description: "",
      buffers: bufferList
    });
    statusBar.show(macro.name);
    return true;
  } else { // User hit Escape, name is undefined
    return false;
  }
}