"use strict";

import * as vscode from "vscode";
import { go, Channel, chan, alts, put, putAsync, CLOSED } from "js-csp";
import {
  Buffer, describeChange, reverseFrame, Frame, isStopPoint, emptyChangeInfo,
  SavePoint, ChangeInfo, createStopPoint, createEndingStopPoint, isFrame
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
  putAsync(bufferChannel, createStopPoint(name));
}

// state is 'saved':
export function continueOrEndRecording() {
  // const CONTINUE = "Continue current recording";
  // const END = "Stop recording";
  // vscode.window.showQuickPick([CONTINUE, END], {
  //   canPickMany: false,
  //   ignoreFocusOut: true,
  //   placeHolder: "Please choose Continue or Stop"
  // })
  //   .then(
  //     selection => {
  //       switch (selection) {
  //         case CONTINUE:
  //           stateService.send('RESUME_RECORDING');
  //           break;
  //         case END:
  //         default: // User hit Escape
  bufferList.length = 0;
  // transition out of record state:
  stateService.send('DONE_RECORDING');
  //         break;
  //     }
  //   }
  // );
}

function registerRecordingCommands() {
  const insertStopCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.insertStop",
    () => {
      insertStop(null);
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
      stateService.send('CANCELLED_RECORDING');
    }
  );

  return [insertStopCommand, undoCommand, saveOrDiscardMacroCommand, cancelRecordingCommand];
}

let documentAndSelectionChangeHandlers: vscode.Disposable[] = [];
let recordingHooks: vscode.Disposable;

export function registerRecordingHooks() {
  const commands: vscode.Disposable[] = registerRecordingCommands();
  const eventHandlers: vscode.Disposable[] = registerRecordingEventHandlers();
  registerDocumentAndSelectionChangeHandlers();

  recordingHooks = vscode.Disposable.from(
    ...commands, ...eventHandlers, ...documentAndSelectionChangeHandlers
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

async function addStopPointOrNot() {
  const YES = "Yes";
  const NO = "No";

  while (true) {
    let selection = await vscode.window.showQuickPick([YES, NO], {
      canPickMany: false,
      ignoreFocusOut: true,
      placeHolder: "No Stop Point at End of Macro; Add One?"
    });

    switch (selection) {
      case YES:
        return true;
        break;
      case NO:
        return false;
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

  const selections = event.selections || [];
  // console.log("");
  // console.log(`handleSelectionChange:
  //   selections:
  //       ${describeSelections(selections)}`);
  putAsync(selectionChangeChannel, selections);
}

function ignoreDocumentAndSelectionChanges() {
  for (const handler of documentAndSelectionChangeHandlers) {
    handler.dispose();
  }
  documentAndSelectionChangeHandlers = [];
}

function registerDocumentAndSelectionChangeHandlers() {
  const documentChangeHandler = vscode.workspace.onDidChangeTextDocument(
    handleDocumentChange
  );

  const selectionChangeHandler = vscode.window.onDidChangeTextEditorSelection(
    handleSelectionChange
  );

  documentAndSelectionChangeHandlers = [documentChangeHandler, selectionChangeHandler];
}

function registerRecordingEventHandlers() {
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

  return [documentClosedHandler,
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
      } else { // selection change
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
      for (const frame of makeFrames(changeInfo, selections)) {
        yield put(bufferChannel, frame);
      }
    }
  });
}

const map = (f: any, coll: any[]) => coll.map(f);

// We actually can't expect to play back a Frame with more than one change,
// so let's split it into multiple Frames:
// (maybe we should play it back faster since it's one edit)
function makeFrames(changeInfo: ChangeInfo, selections: vscode.Selection[]): Frame[] {
  if (changeInfo.changes.length > 1) {
    const f = (change: any) => {
      const changeInfo = { changes: [change] };
      return { changeInfo: changeInfo, selections: selections };
    };
    return <Frame[]>map(f, changeInfo.changes);
  } else {
    return [<Frame>{ changeInfo: changeInfo, selections: selections }];
  }
}

function undo(undoneChannel: Channel) {
  const editChannel = chan(1);

  go(function* () {
    ignoreDocumentAndSelectionChanges();
    let bufferIndex = bufferList.length - 1;
    let bufferToUndo = bufferList[bufferIndex];
    if (isFrame(bufferToUndo)) {
      let char = bufferToUndo.changeInfo && bufferToUndo.changeInfo.changes[0].text;
      console.log(char);
    }
    while (isStopPoint(bufferToUndo)) {
      bufferList.pop();
      bufferIndex -= 1;
      bufferToUndo = bufferList[bufferIndex];
      if (isFrame(bufferToUndo)) {
        let char = bufferToUndo.changeInfo && bufferToUndo.changeInfo.changes[0].text;
        console.log(char);
      }
    }
    if (bufferToUndo) {
      bufferList.pop();
      bufferIndex -= 1;
      let previousFrameOrSavePoint = bufferList[bufferIndex];
      while (isStopPoint(previousFrameOrSavePoint)) {
        bufferList.pop();
        bufferIndex -= 1;
        previousFrameOrSavePoint = bufferList[bufferIndex];
      }
      let undoFrame: Frame;
      if (isFrame(bufferToUndo)) {
        undoFrame = reverseFrame(
          (<Frame>bufferToUndo).changeInfo,
          (<Frame | SavePoint>previousFrameOrSavePoint).selections,
          currentActiveDoc);
        if (!textEditor) {
          // error
        } else {
          // apply the undo to the document:
          applyFrame(undoFrame, textEditor, editChannel);
          // wait for applyFrame to finish:
          yield editChannel;
        }
      }
    }
    registerDocumentAndSelectionChangeHandlers();
    yield put(undoneChannel, 'done');
    return;
  });
}

function runBuffers() {
  const undoneChannel = chan(1);

  // consumes bufferChannel and undoChannel
  // updates the bufferList and (if undo) the document
  go(function* () {
    while (true) {
      let result = yield alts([undoChannel, bufferChannel], { priority: true });
      if (result.channel === undoChannel) {
        undo(undoneChannel);
        yield undoneChannel;
        console.log(bufferList);
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
                  stateService.send('DISCARDED_RECORDING');
                  break;
              }
            });
          return;
        } else {
          // It's a buffer:
          if (isStopPoint(buffer)) {
            statusBar.show('Inserted STOP');
          } else {
            statusBar.show('');
          }
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

  runChanges();
  runBuffers();
}

function startNewRecording() {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    initChannels();
    insertSavePoint(textEditor);
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

function insertSavePoint(textEditor: vscode.TextEditor) {
  putAsync(bufferChannel, createSavePoint(textEditor));
}

function createSavePoint(textEditor: vscode.TextEditor): SavePoint {
  const documentContent = textEditor.document.getText();
  const language = textEditor.document.languageId;
  const selections = textEditor.selections;
  return { content: documentContent, language: language, selections: selections };
}

export function saveRecording() {
  doSaveRecording()
    .then(success => {
      stateService.send(success ? 'RECORDING_SAVED' : 'RECORDING_NOT_SAVED');
    });
}

async function doSaveRecording() {
  if (bufferList.length < 2) {
    showError("Cannot save macro with no content.");
    return false;
  }
  if (!storage) {
    showError("Cannot save macro!");
    return false;
  }

  const lastBuffer = bufferList[bufferList.length - 1];
  if (isStopPoint(lastBuffer)) {
    lastBuffer.stop.name = 'END_OF_MACRO';
  } else {
    const addIt = await addStopPointOrNot();
    if (addIt) {
      bufferList.push(createEndingStopPoint());
    }
  }

  // Add a save point at the end:
  const textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    bufferList.push(createSavePoint(textEditor));
  }

  const name = await vscode.window.showInputBox({
    prompt: "Give the macro a name (or hit ESC to discard it)",
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

