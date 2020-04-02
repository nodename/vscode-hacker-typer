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
// cannot be imported as nested modules

let stateService: Interpreter<TyperContext>;

const stopPointBreakoutChar = `\n`; // ENTER
const replayConcurrency = 1;
const replayQueueMaxSize = Number.MAX_SAFE_INTEGER;
const replayQueue = new Queue(replayConcurrency, replayQueueMaxSize);

let reachedEndOfBuffers = false;
let currentBufferList: buffers.Buffer[] = [];
let currentBufferPosition: number;

function getCurrentBuffer(): buffers.Buffer {
  return currentBufferList[currentBufferPosition];
}

let typeCommand: vscode.Disposable;
let backspaceCommand: vscode.Disposable;
let cancelPlayingCommand: vscode.Disposable;

type AdvanceError = { reason: string };
type AdvanceResult = Result<string, AdvanceError>;

function advance(): AdvanceResult {
  const maxBufferPosition = currentBufferList.length - 1;
  if (currentBufferPosition < maxBufferPosition) {
    currentBufferPosition++;
    return Result.ok<string, AdvanceError>("");
  } else {
    return Result.err<string, AdvanceError>({ reason: 'at end of buffer list' });
  }
}

// If the result is an Err, returns the unwrapped error object.
// If the result is not an Err, returns undefined.
function getError(result: AdvanceResult): AdvanceError | undefined {
  // Using TypeScript's "type narrowing" capabilities:
  // if you check which variant you are accessing,
  // TypeScript will "narrow" the type to that variant
  // and allow you to access the value directly if it is available.
  if (result.isErr()) {
    const s = JSON.stringify(result);
    const t = typeof result;
    // @ts-ignore
    return Result.Err.unwrapErr(result);
  } else {
    return undefined;
  }
}

function retreat() {
  // move buffer one step backwards
  if (currentBufferPosition && currentBufferPosition > 0) {
    reachedEndOfBuffers = false;
    currentBufferPosition--;
  }
}

export function registerPlayingCommands() {
  typeCommand = vscode.commands.registerCommand("type", onType);
  backspaceCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.backspace", onBackspace);
  cancelPlayingCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.cancelPlaying", cancelPlaying);
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
  const advanceError = getError(result);
  if (advanceError) {
    showError(advanceError.reason);
    cancelPlaying();
  }
}

export function disable() {
  disposePlayingCommands();
  reachedEndOfBuffers = false;
}

//callback: (...args: any[]) => any
function onType({ text: userInput }: { text: string }) {

  function queueText(userInput: string) {
    replayQueue.add(
      () =>
        new Promise((resolve, reject) => {
          try {
            advanceBuffer(resolve, userInput);
          } catch (e) {
            console.log(e);
            reject(e);
          }
        })
    );
  }

  console.log(`onType: currentBufferPosition = ${currentBufferPosition},
    currentBuffer = ${JSON.stringify(getCurrentBuffer())},
    userInput = ${userInput}`);


  if (buffers.isStopPoint(getCurrentBuffer())) {
    if (reachedEndOfBuffers) {
      if (userInput === stopPointBreakoutChar) {
        stateService.send('DONE_PLAYING');
      } else {
        // have tried to play beyond the terminating stop point:
        sound.playSound();
      }
    } else {
      if (userInput === stopPointBreakoutChar) {
        console.log("got breakout char");
        queueText(userInput);
      } else {
        // play sound?
        console.log("did not get breakout char");
      }
    }
  } else {
    queueText(userInput);
  }
}

function onBackspace() {
  retreat();

  // actually execute backspace action
  vscode.commands.executeCommand("deleteLeft");
}

function updateSelections(
  selections: vscode.Selection[],
  editor: vscode.TextEditor
) {
  editor.selections = selections;

  // move scroll focus if needed
  const { start, end } = editor.selections[0];
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}

function advanceBuffer(done: () => void, userInput: string) {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    showError("No active editor");
    return;
  }

  if (!getCurrentBuffer()) {
    showError("No buffer to advance");
    return;
  }

  if (buffers.isStopPoint(getCurrentBuffer())) {
    if (userInput === stopPointBreakoutChar) {
      const result = advance();
      const advanceError = getError(result);
      if (advanceError) {
        showError(advanceError.reason);
        reachedEndOfBuffers = true;
      }
    }

    return done();
  }

  const { changeInfo, selections } = <buffers.Frame>getCurrentBuffer();
  const { changes } = changeInfo;

  const updateSelectionAndAdvanceToNextBuffer = () => {
    if (selections.length) {
      updateSelections(selections, editor);
    }

    const result = advance();
    const advanceError = getError(result);
    if (advanceError) {
      showError(advanceError.reason);
      statusBar.show("Finished playing");
      // disable typing capture
      reachedEndOfBuffers = true;
    }

    done();
  };

  if (changes && changes.length > 0) {
    editor
      .edit(edit => applyContentChanges(changes, edit))
      .then(updateSelectionAndAdvanceToNextBuffer);
  } else {
    updateSelectionAndAdvanceToNextBuffer();
  }
}
