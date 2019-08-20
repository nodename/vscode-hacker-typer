import * as vscode from "vscode";
import * as buffers from "./buffers";
import * as sound from "./sound";
import Storage from "./storage";
import * as Queue from "promise-queue";
import { applyContentChanges, replaceAllContent } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";

let stateService: Interpreter<TyperContext>;

const stopPointBreakChar = `\n`; // ENTER
const replayConcurrency = 1;
const replayQueueMaxSize = Number.MAX_SAFE_INTEGER;
const replayQueue = new Queue(replayConcurrency, replayQueueMaxSize);

let reachedEndOfBuffers = false;
let currentBuffer: buffers.Buffer | undefined;
let currentBufferList: buffers.Buffer[] = [];
let currentBufferPosition: number | undefined = 0;

let typeCommand: vscode.Disposable;
let backspaceCommand: vscode.Disposable;

function advance() {
  if (currentBufferPosition !== undefined) {
    currentBufferPosition++;
    currentBuffer = currentBufferList[currentBufferPosition];
  }
}

function retreat() {
  // move buffer one step backwards
  if (currentBufferPosition && currentBufferPosition > 0) {
    reachedEndOfBuffers = false;
    currentBufferPosition--;
    currentBuffer = currentBufferList[currentBufferPosition];
  }
}

export function registerPlayingCommands() {
  typeCommand = vscode.commands.registerCommand("type", onType);
  backspaceCommand = vscode.commands.registerCommand(
    "jevakallio.vscode-hacker-typer.backspace", onBackspace);
}

function disposePlayingCommands() {
  typeCommand.dispose();
  backspaceCommand.dispose();
}

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext>) {
  stateService = service;
  const storage = Storage.getInstance(context);
  storage.userChooseMacro((macro) => {
    currentBufferList = macro.buffers;
    currentBuffer = currentBufferList[0];
    currentBufferPosition = 0;
    if (!currentBuffer) {
      vscode.window.showErrorMessage("No active recording");
      return;
    }

    const textEditor = vscode.window.activeTextEditor;
    if (buffers.isStartingPoint(currentBuffer)) {
      setStartingPoint(currentBuffer, textEditor);
    }

    vscode.window.showInformationMessage(
      `Now playing ${currentBufferList.length} buffers from ${macro.name}!`
    );
  });
}

async function setStartingPoint(
  startingPoint: buffers.StartingPoint,
  textEditor: vscode.TextEditor | undefined) {
  let editor = textEditor;
  // if no open text editor, open one
  if (!editor) {
    vscode.window.showInformationMessage("opening new window");
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
  advance();
}

export function disable() {
  disposePlayingCommands();
  currentBuffer = undefined;
  reachedEndOfBuffers = false;
}

function onType({ text }: { text: string }) {
  function queueText(text: string) {
    replayQueue.add(
      () =>
        new Promise((resolve, reject) => {
          try {
            advanceBuffer(resolve, text);
          } catch (e) {
            console.log(e);
            reject(e);
          }
        })
    );
  }

  console.log("onType");
  if (reachedEndOfBuffers) {
    if (text === stopPointBreakChar) {
      stateService.send('DONE_PLAYING');
    } else {
      // have tried to replay beyond the terminating stopPointBreakChar:
      sound.playSound();
      vscode.window.showErrorMessage("Hit ENTER to exit playback");
    }
  } else {
    queueText(text);
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
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  if (!currentBuffer) {
    vscode.window.showErrorMessage("No buffer to advance");
    return;
  }

  if (buffers.isStopPoint(currentBuffer)) {
    if (userInput === stopPointBreakChar) {
      advance();
    }

    return done();
  }

  const { changeInfo, selections } = <buffers.Frame>currentBuffer;
  const { changes } = changeInfo;

  const updateSelectionAndAdvanceToNextBuffer = () => {
    if (selections.length) {
      updateSelections(selections, editor);
    }

    advance();

    // Ran out of buffers? Disable type capture.
    if (!currentBuffer) {
      vscode.window.showInformationMessage("Done!");
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
