import * as vscode from "vscode";
import { Buffer, StartingPoint, isStartingPoint, isFrame, isStopPoint } from "./buffers";
import Storage from "./storage";
import { go, chan, putAsync, Channel, CLOSED, operations } from "js-csp";
import { applyContentChanges, replaceAllContent } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";
import * as statusBar from "./statusBar";

let stateService: Interpreter<TyperContext>;

const stopPointBreakoutChar = `\n`; // ENTER

const chanBuffer = 100;
// User keystrokes provided by the onType command:
let inputChannel: Channel;

// Buffers from the macro, to be applied to the document in sequence:
let playChannel: Channel;

// "Events" indicating that an edit has completed:
let editChannel: Channel;

let typeCommand: vscode.Disposable;
let cancelPlayingCommand: vscode.Disposable;

export function registerPlayingCommands() {
  registerTypeCommand();
  cancelPlayingCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.cancelPlaying", cancelPlaying);
}

function registerTypeCommand() {
  // "type" is a built-in command, so we don't configure a keyboard shortcut.
  // We install the onType handler:
  if (typeCommand) {
    typeCommand.dispose();
  }

  const onType = ({ text: userInput }: { text: string }) => {
    putAsync(inputChannel, userInput);
  };

  typeCommand = vscode.commands.registerCommand("type", onType);
}

function registerEndTypeCommand() {
  if (typeCommand) {
    typeCommand.dispose();
  }
  typeCommand = vscode.commands.registerCommand("type", endType);
}

function cancelPlaying() {
  statusBar.show("Cancelled playing");
  stateService.send('DONE_PLAYING');
}

export function disable() {
  disposePlayingCommands();
}

function disposePlayingCommands() {
  typeCommand.dispose();
  cancelPlayingCommand.dispose();
}

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext>) {
  stateService = service;
  const storage = Storage.getInstance(context);
  storage.userChooseMacro((macro) => {
    let textEditor = vscode.window.activeTextEditor;
    if (!textEditor) {
      // error
    }
    
    inputChannel = chan(chanBuffer);
    playChannel = operations.fromColl(macro.buffers);
    editChannel = chan(1);

    go(function* () {
      let playBuffer: Buffer = yield playChannel;
      if (isStartingPoint(playBuffer)) {
        setStartingPoint(<StartingPoint>playBuffer, textEditor);
        playBuffer = yield playChannel;
      } else {
        // error
      }

      let userInput = yield inputChannel;

      while (userInput !== CLOSED) {
        console.log(`got ${userInput}`);

        if (isFrame(playBuffer)) {
          if (textEditor) {
            const frame = playBuffer;
            const { changeInfo, selections } = frame;
            const { changes } = changeInfo;

            textEditor.edit(function (editBuilder: vscode.TextEditorEdit): void {
              applyContentChanges(changes, editBuilder);
            }).then(() => {
              if (selections.length) {
                revealSelections(selections, <vscode.TextEditor>textEditor);
              }
              putAsync(editChannel, "done");
            });
            yield editChannel; // wait until the edit is done!
            playBuffer = yield playChannel;
          } else {
            // textEditor is undefined
          }
        } else if (isStopPoint(playBuffer)) {
          const gotBreakoutChar = userInput === stopPointBreakoutChar;
          if (gotBreakoutChar) {
            stateService.send('RESUME_PLAY');
            playBuffer = yield playChannel;
          } else {
            stateService.send('PLAY_PAUSED'); // We can reach here more than once; that's OK
            // make no update to the document
            // do not get next playBuffer
          }
        }

        if (playBuffer === CLOSED) {
          // Don't disable typing capture right away; we'll handle that in endType
          // when the user tries to keep typing.
          registerEndTypeCommand();
        }
        userInput = yield inputChannel;
      }
      console.log("Input channel closed"); // This should not happen
    });

    statusBar.show(`${macro.name}`);
  });

}

async function setStartingPoint(
  startingPoint: StartingPoint,
  textEditor: vscode.TextEditor | undefined) {
  console.log("setStartingPoint");
  let editor = textEditor;
  // if no open text editor, open one
  if (!editor) {
    statusBar.show("Opening new window");
    const document = await vscode.workspace.openTextDocument({
      language: startingPoint.language,
      content: startingPoint.content
    });

    editor = await vscode.window.showTextDocument(document);
  } 
  await replaceAllContent(editor, startingPoint.content);

  if (editor) {
    revealSelections(startingPoint.selections, editor);

    // language should always be defined, guard statement here
    // to support old recorded frames before language bit was added
    if (startingPoint.language) {
      // @TODO set editor language once the API becomes available:
      // https://github.com/Microsoft/vscode/issues/1800
    }
  }
}

function endType({ text: userInput }: { text: string }) {
  // We have reached the implicit stop point at the end of the macro
  if (userInput === stopPointBreakoutChar) {
    statusBar.show("Done playing");
    stateService.send('DONE_PLAYING'); // This takes us out of the play state, back to the idle state
  } else {
    // have tried to play beyond the terminating stop point:
    stateService.send('REACHED_END');
  }
}

function revealSelections(
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
