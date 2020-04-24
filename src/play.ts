"use strict";

import * as vscode from "vscode";
import { Buffer, StartingPoint, isStartingPoint, isFrame, isStopPoint } from "./buffers";
import Storage from "./storage";
import { go, chan, put, putAsync, Channel, CLOSED, operations, timeout, alts } from "js-csp";
import { replaceAllContent, revealSelections, applyFrame } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext } from "./TyperContext";
import * as statusBar from "./statusBar";


// Data Flow: Playing a macro ////////////////////////////////////////////////////////////////////////
//
//     In manual mode, the onType command gets keystrokes and puts commands on the inputChannel.
//
//     The runInput function consumes commands from the inputChannel
//     and forwards them to the commandChannel. It also handles the endOfInput state,
//     which is a virtual stop point leading out of the extension's play state.
//
//     The playChannel is created from the macro's buffers.
//
//     The runPlay function consumes the playChannel and the commandChannel
//     and applies buffers as edits to the document as directed by the commandChannel commands.
//
//     In autoPlay mode, the onType command puts commands on the autoPlayControlChannel.
//     The autoPlay function consumes these commands and outputs input commands on the inputChannel.
//
///////////////////////////////////////////////////////////////////////////////////////////////////////


let stateService: Interpreter<TyperContext>;

const stopPointBreakoutChar = `\n`; // ENTER
const startAutoPlayChar = '`';
const pauseAutoPlayChar = '`';

const inputBufferSize = 40;
let inputChannel: Channel;

let commandChannel: Channel;
const breakoutCommand = "breakout";
const nextCommand = "next";
const endOfInputCommand = "end";

let typeCommand: vscode.Disposable;
let toggleSilenceCommand: vscode.Disposable;
let cancelPlayingCommand: vscode.Disposable;

const autoPlayInterval = 60;
let autoPlayControlChannel: Channel;

export function registerPlayingCommands() {
  setManualKeyboardMode();
  toggleSilenceCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.toggleSilence", toggleSilence);
  cancelPlayingCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.cancelPlaying", cancelPlaying);
}

export function disposePlayingCommands() {
  typeCommand.dispose();
  cancelPlayingCommand.dispose();
  toggleSilenceCommand.dispose();
}

function setManualKeyboardMode() {
  typeCommand = registerTypeCommand();
}

function registerTypeCommand() {
  // "type" is a built-in command, so we don't configure a keyboard shortcut.
  // We install the  handler:

  // keyboard is used to simulate typing the macro,
  // to break out of stop points,
  // and to start autoplay
  const onType = ({ text: userInput }: { text: string }) => {
    switch (userInput) {
      case stopPointBreakoutChar:
        putAsync(inputChannel, breakoutCommand);
        break;
      case startAutoPlayChar:
        startAutoPlay();
        break;
      default:
        putAsync(inputChannel, nextCommand);
        break;
    }
  };

  if (typeCommand) {
    typeCommand.dispose();
  }

  return vscode.commands.registerCommand("type", onType);
}

function setAutoKeyboardMode() {
  typeCommand = registerAutoTypeCommand();
}

function registerAutoTypeCommand() {
  // keyboard is used only for autoPlay commands
  const onType = ({ text: userInput }: { text: string }) => {
    switch (userInput) {
      case stopPointBreakoutChar:
        resumeAutoPlay();
        break;
      case pauseAutoPlayChar:
        pauseAutoPlay();
        break;
      default:
        break;
    }
  };

  if (typeCommand) {
    typeCommand.dispose();
  }

  return vscode.commands.registerCommand("type", onType);
}

const enum AutoPlayState {
  Play,
  Pause,
  Resume,
  Stop,
  None
}

function runAutoPlay(autoPlayControlChannel: Channel, inputChannel: Channel) {
  go(function* () {
    let state: AutoPlayState = AutoPlayState.None;
    while (true) {
      let result = yield alts([autoPlayControlChannel, timeout(autoPlayInterval)], { priority: true });
      if (result.channel === autoPlayControlChannel) {
        state = result.value;
      } else { // timeout expired, time to do the action for my current state:
        switch (state) {
          case AutoPlayState.Play:
            yield put(inputChannel, nextCommand);
            break;
          case AutoPlayState.Pause:
            // do nothing
            break;
          case AutoPlayState.Resume:
            yield put(inputChannel, breakoutCommand);
            state = AutoPlayState.Play;
            break;
          case AutoPlayState.Stop:
            return; // no more autoplay until we re-enter play state
            break;
          default:
            break;
        }
      }
    }
  });
}

function startAutoPlay() {
  setAutoKeyboardMode();
  putAsync(autoPlayControlChannel, AutoPlayState.Play);
}

export function pauseAutoPlay() {
  putAsync(autoPlayControlChannel, AutoPlayState.Pause);
  setManualKeyboardMode();
}

export function resumeAutoPlay() {
  setAutoKeyboardMode();
  putAsync(autoPlayControlChannel, AutoPlayState.Resume);
}

// Do this when leaving the play state
export function stopAutoPlay() {
  putAsync(autoPlayControlChannel, AutoPlayState.Stop);
  setManualKeyboardMode();
}

// forwards inputChannel commands to commandChannel
// and handles the virtual stop point at end of input
function runInput(inputChannel: Channel, commandChannel: Channel) {
  go(function* () {
    while (true) {
      let command = yield inputChannel;
      switch (command) {
        case nextCommand:
        case breakoutCommand:
          yield put(commandChannel, command);
          break;
        case endOfInputCommand:
          while (true) {
            command = yield inputChannel;
            switch (command) {
              case breakoutCommand:
                commandChannel.close();
                statusBar.show("Done playing");
                stateService.send('DONE_PLAYING'); // This takes us out of the play state, back to the idle state
                return;
                break;
              default:
                // have tried to play beyond the terminating stop point:
                stateService.send('REACHED_END');
                break;
            }
          }
        default:
          // error
          break;
      }
    }
  });
}

async function setStartingPoint(
  startingPoint: StartingPoint,
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

function runPlay(
  commandChannel: Channel,
  playChannel: Channel,
  textEditor: vscode.TextEditor) {
  // Events indicating that an edit has completed:
  const editChannel = chan(1);

  go(function* () {
    let playBuffer: Buffer = yield playChannel;
    if (isStartingPoint(playBuffer)) {
      setStartingPoint(<StartingPoint>playBuffer, textEditor);
      playBuffer = yield playChannel;
    } else {
      // error
    }

    let controlCommand = yield commandChannel;

    while (controlCommand !== CLOSED) {
      if (isFrame(playBuffer)) {
        if (textEditor) {
          applyFrame(playBuffer, textEditor, editChannel);
          yield editChannel; // wait until the edit is done!
          playBuffer = yield playChannel;
        } else {
          // textEditor is undefined
        }
      } else if (isStopPoint(playBuffer)) {
        if (controlCommand === breakoutCommand) {
          stateService.send('RESUME_PLAY');
          playBuffer = yield playChannel;
        } else {
          stateService.send('PLAY_PAUSED'); // We can reach here more than once; that's OK
          // make no update to the document
          // do not get next playBuffer
        }
      }

      if (playBuffer === CLOSED) {
        // Don't disable control capture right away; we'll handle that in doInputChannel
        // when the user tries to keep typing.
        yield put(inputChannel, endOfInputCommand);
      }
      controlCommand = yield commandChannel;
    }
    // commandChannel closed:
    console.log("Command channel closed");
    return;
  });
}

function cancelPlaying() {
  statusBar.show("Cancelled playing");
  stateService.send('DONE_PLAYING');
}

function toggleSilence() {
  stateService.send('TOGGLE_SILENCE');
}

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext>) {
  stateService = service;
  const storage = Storage.getInstance(context);
  storage.userChooseMacro((macro) => {
    let textEditor = vscode.window.activeTextEditor;
    if (!textEditor) {
      // error
    }
    if (!macro) {
      cancelPlaying();
      return;
    }

    // Commands provided by the onType command or by autoPlay:
    inputChannel = chan(inputBufferSize);

    // Commands provided to runPlay:
    commandChannel = chan(1);

    autoPlayControlChannel = chan(1);

    // Buffers from the macro, to be applied in sequence to the document:
    const playChannel = operations.fromColl(macro.buffers);

    // goroutines:
    runAutoPlay(autoPlayControlChannel, inputChannel);
    runInput(inputChannel, commandChannel);
    runPlay(commandChannel, playChannel, <vscode.TextEditor>textEditor);

    statusBar.show(`${macro.name}`);
  });

}
