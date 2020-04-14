"use strict";

import * as vscode from "vscode";
import { go, chan, alts, put, putAsync, CLOSED } from "js-csp";
import {
  Buffer, describeSelections, describeChange, reverseFrame, Frame, isStopPoint, emptyChangeInfo
} from "./buffers";
import Storage from "./storage";
import { Interpreter } from "xstate";
import { TyperContext } from "./TyperContext";
import * as statusBar from "./statusBar";
import showError from "./showError";
import { applyFrame } from "./edit";

// Messages from our documentChange handler:
const documentChangeChannel = chan(1);
// Messages from our selectionChangeHandler:
const selectionChangeChannel = chan(1);
const undoChannel = chan(1);
// Buffers destined for bufferList:
const outputChannel = chan(1);

function insertStop(name: string | null) {
  putAsync(outputChannel, {
    stop: { name: name || null },
    selections: undefined
  });
}

function continueOrEndRecording(buffers: Buffer[]) {
  const CONTINUE = "Continue current recording";
  const END = "Stop recording";
  vscode.window.showQuickPick([CONTINUE, END], { canPickMany: false })
    .then(
      selection => {
        switch (selection) {
          case CONTINUE:
            resumeRecording();
            break;
          case END:
            buffers.length = 0;
            stateService.send('DONE_RECORDING');
            statusBar.show("Done recording");
            break;
          default: // User hit Escape
            buffers.length = 0;
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

  const saveMacroCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.saveMacro",
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

  return [insertStopCommand, undoCommand, saveMacroCommand, cancelRecordingCommand];
}

export function registerRecordingHooks() {
  console.log("registerRecordingHooks");
  const commands: vscode.Disposable[] = registerRecordingCommands();
  const eventHandlers: vscode.Disposable[] = registerRecordingEventHandlers();

  recordingHooks = vscode.Disposable.from(
    ...commands, ...eventHandlers
  );
}

let recordingHooks: vscode.Disposable;
export function disposeRecordingHooks(context: vscode.ExtensionContext) {
  console.log("disposeRecordingHooks");
  if (recordingHooks) {
    recordingHooks.dispose();
  }
}

let stateService: Interpreter<TyperContext>;
let storage: Storage | null = null;
let bufferList: Buffer[] = [];

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext>) {
  stateService = service;
  console.log("record.start");
  storage = Storage.getInstance(context);
  if (bufferList.length !== 0) {
    resumeOrNewRecording(bufferList);
  } else {
    startNewRecording();
  }
}

function resumeOrNewRecording(buffers: Buffer[]) {
  const CONTINUE = "Continue current recording";
  const NEW = "New recording from active editor";
  vscode.window.showQuickPick([CONTINUE, NEW], { canPickMany: false })
    .then(
      selection => {
        if (!selection) {
          return;
        }
        switch (selection) {
          case NEW:
            saveOrDiscardCurrent(buffers);
            startNewRecording();
            break;
          case CONTINUE:
            resumeRecording();
            break;
          default:
            break;
        }
      });
}

function saveOrDiscardCurrent(buffers: Buffer[]) {
  const SAVE = "Save current recording";
  const DISCARD = "Discard current recording";
  vscode.window.showQuickPick([SAVE, DISCARD], { canPickMany: false })
    .then(
      selection => {
        switch (selection) {
          case SAVE:
            saveRecording(buffers, storage);
            break;
          case DISCARD:
            buffers.length = 0;
            break;
          default:
            break;
        }
      }
    );
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


function startRecording(currentOpenEditor: vscode.TextEditor) {
  // start watching the currently open doc
  // TODO if not new recording, check if doc has changed
  currentActiveDoc = currentOpenEditor.document;
  statusBar.show("");

  const editChannel = chan(1);

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
        outputChannel.close();
        return;
      }
      yield put(outputChannel,
        { changeInfo: changeInfo, selections: selections });
    }
  });

  go(function* () {
    while (true) {
      let result = yield alts([undoChannel, outputChannel], { priority: true });
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
              // ignore next outputChannel message; it's generated by the callbacks of our undo:
              yield outputChannel;
            }
          }
        }
      } else { // result came from outputChannel
        let buffer = result.value;
        if (buffer === CLOSED) {
          console.log("no more output");
          saveOrDiscardCurrent(bufferList);
          return;
        }
        
        bufferList.push(buffer);
      }
    }
  });
}

function startNewRecording() {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    insertStartingPoint(textEditor);
    startRecording(textEditor);
  }
}

function resumeRecording() {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    startRecording(textEditor);
  }
}

function insertStartingPoint(textEditor: vscode.TextEditor) {
  const initialDocumentContent = textEditor.document.getText();
  const language = textEditor.document.languageId;
  const selections = textEditor.selections;

  //console.log(`initial content: "${initialDocumentContent}"`);

  putAsync(outputChannel, { content: initialDocumentContent, language, selections });
}

function saveRecording(buffers: Buffer[], storage: Storage | null) {
  if (buffers.length < 2) {
    showError("Cannot save macro with no content.");
    return;
  }
  if (!storage) {
    showError("Cannot save macro!");
    return;
  }
  vscode.window.showInputBox({
    prompt: "Give this thing a name",
    placeHolder: "cool-macro"
  })
    .then(name => {
      if (name) {
        return storage.save({
          name,
          description: "",
          buffers: buffers
        })
          .then(macro => {
            statusBar.show(`Saved "${macro.name}"`);
            continueOrEndRecording(buffers);
          });
      } else { // User hit Escape, name is undefined
        continueOrEndRecording(buffers);
      }
    });
}