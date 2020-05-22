"use strict";

import * as vscode from "vscode";
import { go, Channel, chan, alts, put, putAsync, CLOSED } from "js-csp";
import {
  Buffer, describeChange, reverseFrame, Frame, isStopPoint, emptyChangeInfo,
  SavePoint, ChangeInfo, createStopPoint, createEndingStopPoint, typeOf
} from "./buffers";
import Storage from "./storage";
import * as statusBar from "./statusBar";
import showError from "./showError";
import { applyFrame } from "./edit";
import { last } from "./fun";
import { TyperStateService } from "./extension";

// Messages from our documentChange handler:
let documentChangeChannel: Channel;
// Messages from our selectionChange handler:
let selectionChangeChannel: Channel;
// Undo messages from the Undo command:
let undoChannel: Channel;
// Buffers destined for bufferList:
let bufferChannel: Channel;

function insertStopPoint(name: string | null) {
  putAsync(bufferChannel, createStopPoint(name));
}

function registerRecordingCommands(stateService: TyperStateService) {
  const insertStopCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.insertStop",
    () => {
      insertStopPoint(null);
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
      bufferList = [];
      stateService.send('CANCELLED_RECORDING');
    }
  );

  return [insertStopCommand, undoCommand, saveOrDiscardMacroCommand, cancelRecordingCommand];
}

let documentAndSelectionChangeHandlers: vscode.Disposable[] = [];
let recordingHooks: vscode.Disposable;

export function registerRecordingHooks(context: vscode.ExtensionContext, stateService: TyperStateService) {
  const commands: vscode.Disposable[] = registerRecordingCommands(stateService);
  const eventHandlers: vscode.Disposable[] = registerRecordingEventHandlers();
  registerDocumentAndSelectionChangeHandlers();

  recordingHooks = vscode.Disposable.from(
    ...commands, ...eventHandlers
  );
}

export function disposeRecordingHooks(context: vscode.ExtensionContext) {
  console.log("disposeRecordingHooks");
  if (recordingHooks) {
    recordingHooks.dispose();
  }
  ignoreDocumentAndSelectionChanges();
}

let storage: Storage | null = null;
let bufferList: Buffer[] = [];

// on initial entry:
export function start(context: vscode.ExtensionContext, stateService: TyperStateService) {
  console.log("record.start");
  storage = Storage.getInstance(context);
  if (bufferList.length === 0) {
    startNewRecording(stateService);
  } else {
    resumeOrNewRecording(stateService);
  }
}

async function resumeOrNewRecording(stateService: TyperStateService) {
  const CONTINUE = "Continue current recording";
  const NEW = "New recording from active editor";
  let selection = await vscode.window.showQuickPick([CONTINUE, NEW], {
    canPickMany: false,
    ignoreFocusOut: true,
    placeHolder: "Please choose Continue or New"
  });

  if (!selection) {
    return;
  }
  switch (selection) {
    case NEW:
      stateService.send('SAVE_RECORDING');
      startNewRecording(stateService);
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

function runBuffers(stateService: TyperStateService) {
  const editChannel = chan(1);

  // consumes bufferChannel and undoChannel
  // updates the bufferList and (if undo) the document
  go(function* () {
    while (true) {
      let result = yield alts([undoChannel, bufferChannel], { priority: true });
      if (result.channel === undoChannel) {
          let bufferToUndo = last(bufferList);
          while (typeOf(bufferToUndo) !== 'Frame') {
            bufferList.pop();
            bufferToUndo = last(bufferList);
          }
          if (bufferToUndo) {
            bufferList.pop();
            let previousFrameOrSavePoint = last(bufferList);
            while (typeOf(previousFrameOrSavePoint) !== 'Frame'
              && typeOf(previousFrameOrSavePoint) !== 'SavePoint') {
              bufferList.pop();
              previousFrameOrSavePoint = last(bufferList);
            }
            const undoFrame = reverseFrame(
              (<Frame>bufferToUndo).changeInfo,
              (<Frame | SavePoint>previousFrameOrSavePoint).selections,
              currentActiveDoc);
            if (!textEditor) {
              // error
            } else {
              ignoreDocumentAndSelectionChanges();
              // apply the undo to the document:
              applyFrame(undoFrame, textEditor, editChannel);
              // wait for applyFrame to finish:
              yield editChannel;
              registerDocumentAndSelectionChangeHandlers();
            }
          }
        console.log(bufferList);
      } else { // result came from bufferChannel
        let buffer = result.value;
        if (buffer === CLOSED) {
          saveOrDiscardCurrent()
            .then(saveOrDiscard => {
              switch (saveOrDiscard) {
                case 'save':
                  stateService.send('SAVE_RECORDING');
                  break;
                case 'discard':
                  bufferList = [];
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


function startRecording(currentOpenEditor: vscode.TextEditor, stateService: TyperStateService) {
  // start watching the currently open doc
  // TODO if not new recording, check if doc has changed
  currentActiveDoc = currentOpenEditor.document;

  runChanges();
  runBuffers(stateService);
}

function startNewRecording(stateService: TyperStateService) {
  textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    initChannels();
    insertSavePoint(textEditor);
    startRecording(textEditor, stateService);
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

export function saveRecording(context: vscode.ExtensionContext, stateService: TyperStateService) {
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

  const lastBuffer = last(bufferList);
  if (isStopPoint(lastBuffer)) {
    lastBuffer.stop.name = 'END_OF_MACRO';
  } else {
    const addIt = await addStopPointOrNot();
    if (addIt) {
      bufferList.push(createEndingStopPoint());
    }
  }

  // Add a save point at the end.
  // This is used to quickly reach the end state for further recording:
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
    statusBar.show(`Saved ${macro.name}`);
    return true;
  } else { // User hit Escape, name is undefined
    return false;
  }
}

