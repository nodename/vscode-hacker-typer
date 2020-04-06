import * as vscode from "vscode";
import * as buffers from "./buffers";
import * as sound from "./sound";
import Storage from "./storage";
import * as Queue from "promise-queue";
import { applyContentChanges, replaceAllContent } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";
import * as statusBar from "./statusBar";
import showError from "./showError";
import { Result } from "true-myth"; //In Node.js, the TypeScript-generated CommonJS package
// cannot be imported as nested modules, so we cannot import "true-myth/result"

let stateService: Interpreter<TyperContext>;

const stopPointBreakoutChar = `\n`; // ENTER
const playConcurrency = 1;
const playQueueMaxSize = Number.MAX_SAFE_INTEGER;
const playQueue = new Queue(playConcurrency, playQueueMaxSize);

let currentBufferList: buffers.Buffer[] = [];
let currentBufferPosition: number;

function getCurrentBuffer(): buffers.Buffer {
  return currentBufferList[currentBufferPosition];
}

let typeCommand: vscode.Disposable;
let backspaceCommand: vscode.Disposable;
let cancelPlayingCommand: vscode.Disposable;

type ReasonObject = { reason: string };
type ReasonResult = Result<string, ReasonObject>;

function advance(): ReasonResult {
  console.log(`ADVANCE: ${currentBufferPosition}`);
  const maxBufferPosition = currentBufferList.length - 1;
  if (currentBufferPosition < maxBufferPosition) {
    currentBufferPosition++;
    return Result.ok<string, ReasonObject>("");
  } else {
    return Result.err<string, ReasonObject>({ reason: 'at end of buffer list' });
  }
}

// If the result is an Err, returns the unwrapped error object.
// If the result is not an Err, returns undefined.
function getReasonError(result: ReasonResult): ReasonObject | undefined {
  // If you check which variant you are accessing,
  // TypeScript will "narrow" the type to that variant
  // and allow you to access the value directly if it is available.
  if (result.isErr()) { // This should narrow to Err type
    // Narrowing is not working here, so:
    // @ts-ignore
    return Result.Err.unwrapErr(result);
  } else {
    return undefined;
  }
}

function retreat(): ReasonResult {
  // move to previous buffer
  if (currentBufferPosition && currentBufferPosition > 0) {
    registerTypeCommand();
    currentBufferPosition--;
    return Result.ok<string, ReasonObject>("");
  } else {
    return Result.err<string, ReasonObject>({ reason: 'at beginning of buffer list' });
  }
}

export function registerPlayingCommands() {
  registerTypeCommand();
  backspaceCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.backspace", onBackspace);
  cancelPlayingCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.cancelPlaying", cancelPlaying);
}

function registerTypeCommand() {
  // "type" is a built-in command, so we don't configure a keyboard shortcut
  // We install the onType handler:
  if (typeCommand) {
    typeCommand.dispose();
  }
  typeCommand = vscode.commands.registerCommand("type", onType);
}

function registerEndTypeCommand() {
  if (typeCommand) {
    typeCommand.dispose();
  }
  typeCommand = vscode.commands.registerCommand("type", onTypeAtEnd);
}

function cancelPlaying() {
  statusBar.show("Cancelled playing");
  stateService.send('DONE_PLAYING');
}

function disposePlayingCommands() {
  typeCommand.dispose();
  backspaceCommand.dispose();
  cancelPlayingCommand.dispose();
}

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext>) {
  stateService = service;
  const storage = Storage.getInstance(context);
  storage.userChooseMacro((macro) => {
    currentBufferList = macro.buffers;
    currentBufferPosition = 0;
    if (!getCurrentBuffer()) {
      showError("No active recording");
      return;
    }

    const textEditor = vscode.window.activeTextEditor;
    if (buffers.isStartingPoint(getCurrentBuffer())) {
      setStartingPoint(<buffers.StartingPoint>getCurrentBuffer(), textEditor);
    }

    statusBar.show(`${macro.name}`);
  });
}

async function setStartingPoint(
  startingPoint: buffers.StartingPoint,
  textEditor: vscode.TextEditor | undefined) {
  let editor = textEditor;
  // if no open text editor, open one
  if (!editor) {
    statusBar.show("Opening new window");
    const document = await vscode.workspace.openTextDocument({
      language: startingPoint.language,
      content: startingPoint.content
    });

    editor = await vscode.window.showTextDocument(document);
  } else {
    const existingEditor = editor;
    replaceAllContent(existingEditor, startingPoint.content);
  }

  if (editor) {
    updateSelections(startingPoint.selections, editor);

    // language should always be defined, guard statement here
    // to support old recorded frames before language bit was added
    if (startingPoint.language) {
      // @TODO set editor language once the API becomes available:
      // https://github.com/Microsoft/vscode/issues/1800
    }
  }

  // move to next frame
  const result = advance();
  const advanceError = getReasonError(result);
  if (advanceError) {
    showError(advanceError.reason);
    cancelPlaying();
  }
}

export function disable() {
  disposePlayingCommands();
}

function onTypeAtEnd({ text: userInput }: { text: string }) {
  console.log("onTypeAtEnd");
  // We have reached the implicit stop point at the end of the macro
  const gotBreakoutChar = userInput === stopPointBreakoutChar;
  if (gotBreakoutChar) {
    statusBar.show("Done playing");
    stateService.send('DONE_PLAYING');
  } else {
    // have tried to play beyond the terminating stop point:
    //sound.playEndSound();
  }
}

//callback: (...args: any[]) => any
function onType({ text: userInput }: { text: string }) {
  console.log("onType");

  function enqueue(userInput: string) {
    playQueue.add(
      () =>
        new Promise((resolve, reject) => {
          const result = advanceBuffer(userInput);
          const err = getReasonError(result);
          if (err) {
            showError(err.reason);
            reject(err);
          } else {
            resolve();
          }
        })
    );
  }

  const currentBuffer = getCurrentBuffer();
  const gotBreakoutChar = userInput === stopPointBreakoutChar;

  if (buffers.isStopPoint(currentBuffer)) {
    if (gotBreakoutChar) {
      stateService.send('RESUME_PLAY');
      enqueue(userInput); // send it on to advanceBuffer()
    } else {
      stateService.send('PLAY_PAUSED'); // We can reach here more than once; that's OK
      const result = sound.playStopSound();
      console.log(`sound result: ${result}`);
      // console.log("did not get breakout char");
    }
  } else { // not at a stop point
    enqueue(userInput); // send it on to advanceBuffer()
  }
}

function onBackspace() {
  retreat();
  // actually execute backspace action:
  vscode.commands.executeCommand("deleteLeft");
}

function updateSelections(
  selections: vscode.Selection[],
  editor: vscode.TextEditor) {
  editor.selections = selections;

  // move scroll focus if needed
  const { start, end } = editor.selections[0];
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}

function advanceBuffer(userInput: string): ReasonResult {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return Result.err<string, ReasonObject>({ reason: "No active editor" });
  }

  const currentBuffer = getCurrentBuffer();
  if (!currentBuffer) {
    return Result.err<string, ReasonObject>({ reason: "No buffer to advance" });
  }

  if (buffers.isFrame(currentBuffer)) {
    let result = Result.ok<string, ReasonObject>("");
    applyFrame(editor, currentBuffer)
      .then(returnValue => result = returnValue);
    const err = getReasonError(result);
    if (err) {
      showError(err.reason);
      // we're gonna advance anyway
    }
  } else {
    // must be a stop point;
    // onType() would not have forwarded it here
    // if userInput was not the breakout char.
    // make no update to the document
  }

  const result = advance();
  const advanceError = getReasonError(result);
  if (advanceError) {
    // do not show the error; it's just an indication that we're done!
    // Don't disable typing capture right away; we'll handle that in onType
    // when the user tries to keep typing. Set 
    registerEndTypeCommand();
  }
  return Result.ok<string, ReasonObject>("");
}

async function applyFrame(
  editor: vscode.TextEditor,
  frame: buffers.Frame) {
  const { changeInfo, selections } = frame;
  const { changes } = changeInfo;

  try {
    if (changes && changes.length > 0) {
      const editSuccess = await editor.edit(editBuilder => applyContentChanges(changes, editBuilder));
      if (editSuccess === false) {
        return Result.err<string, ReasonObject>({ reason: "Edit failed" });
      }
    }
    if (selections.length) {
      updateSelections(selections, editor);
    }
  } catch (error) {
    showError(error.message);
    return Result.err<string, ReasonObject>({ reason: error.message });
  }
  return Result.ok<string, ReasonObject>("");
}
