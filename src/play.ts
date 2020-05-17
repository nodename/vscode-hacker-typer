"use strict";

import * as vscode from "vscode";
import { Buffer, SavePoint, isSavePoint, typeOf, Frame } from "./buffers";
import Storage from "./storage";
import { go, chan, put, putAsync, Channel, CLOSED, operations, timeout, alts } from "js-csp";
import { applyFrame, applySavePoint } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext, TyperSchema, TyperEvent } from "./states";
import * as statusBar from "./statusBar";
import { rest, last, butLast } from "./fun";


// Data Flow: Playing a macro ////////////////////////////////////////////////////////////////////////
//
//     In manual mode, the onType command gets keystrokes and puts commands on the commandChannel.
//
//     The playChannel is created from the macro's buffers.
//
//     The runPlay function consumes the playChannel and the commandChannel
//     and applies buffers from the playChannel (as edits to the document)
//     as directed by the commandChannel commands.
//
//     In autoPlay mode, the onType command puts autoplay commands on the autoPlayControlChannel.
//     The runAutoPlay function consumes these commands and outputs commands on the commandChannel.
//
///////////////////////////////////////////////////////////////////////////////////////////////////////


let stateService: Interpreter<TyperContext, TyperSchema, TyperEvent>;

const stopPointBreakoutChar = `\n`; // ENTER
const toggleAutoPlayChar = '`';

// Commands provided by the onType command or by autoPlay:
let commandChannel: Channel;
const breakoutCommand = "breakout";
const nextCommand = "next";

let typeCommand: vscode.Disposable;
let toggleSilenceCommand: vscode.Disposable;
let cancelPlayingCommand: vscode.Disposable;

const autoPlayControlChannel: Channel = chan(1);

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

function setAutoKeyboardMode() {
  typeCommand = registerAutoTypeCommand();
}

const keyboardCommands = new Map([
  [stopPointBreakoutChar, () => putAsync(commandChannel, breakoutCommand)],
  [toggleAutoPlayChar, () => stateService.send('TOGGLE_AUTOPLAY')]
]);

function registerTypeCommand() {
  // "type" is a built-in command, so we don't configure a keyboard shortcut.
  // We install the  handler:

  // keyboard is used to simulate typing the macro,
  // to break out of stop points,
  // and to start autoplay

  const onType = ({ text: userInput }: { text: string }) => {
    const f = keyboardCommands.get(userInput);
    if (f) {
      f();
    } else { // any other string: perform the default action
      putAsync(commandChannel, nextCommand);
    }
  };

  if (typeCommand) {
    typeCommand.dispose();
  }

  return vscode.commands.registerCommand("type", onType);
}

function registerAutoTypeCommand() {
  // keyboard is used only to break out of stop points
  // and to pause autoplay

  const onType = ({ text: userInput }: { text: string }) => {
    const f = keyboardCommands.get(userInput);
    if (f) {
      f();
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
  Quit
}

let autoPlayInterval = () => 60;
// const setAutoPlayInterval = (ms: number) => {
//   autoPlayInterval = () => ms;
// };

function runAutoPlay(autoPlayControlChannel: Channel, commandChannel: Channel) {
  go(function* () {
    let state: AutoPlayState = AutoPlayState.Pause;
    while (true) {
      let result = yield alts([autoPlayControlChannel, timeout(autoPlayInterval())], { priority: true });
      if (result.channel === autoPlayControlChannel) {
        state = result.value;
        if (state === AutoPlayState.Quit) {
          return;
        }
      } else { // timeout expired
        if (state === AutoPlayState.Play) {
            yield put(commandChannel, nextCommand);
        }
      }
    }
  });
}

export function startAutoPlay() {
  setAutoKeyboardMode();
  putAsync(autoPlayControlChannel, AutoPlayState.Play);
}

export function pauseAutoPlay() {
  putAsync(autoPlayControlChannel, AutoPlayState.Pause);
  setManualKeyboardMode();
}

export function resumeAutoPlay() {
  setAutoKeyboardMode();
  putAsync(commandChannel, breakoutCommand);
}

// Do this when leaving the play state
export function quitAutoPlay() {
  putAsync(autoPlayControlChannel, AutoPlayState.Quit);
  setManualKeyboardMode();
}

function runPlay(
  commandChannel: Channel,
  buffers: Buffer[],
  textEditor: vscode.TextEditor) {
  // Events indicating that an edit has completed:
  const editChannel = chan(1);

  // Is there a save point at the end of the buffers?
  if (isSavePoint(last(buffers))) {
    // drop it; we don't use it in playback:
    buffers = butLast(buffers);
  }

  let playChannel: Channel;
  // If the first buffer is a save point, apply it immediately,
  // before any commands arrive:
  const firstBuffer = buffers[0];
  if (isSavePoint(firstBuffer)) {
    applySavePoint(<SavePoint>firstBuffer, textEditor);
    playChannel = operations.fromColl(rest(buffers));
  } else {
    playChannel = operations.fromColl(buffers);
  }

  go(function* () {
    let playBuffer: Buffer = yield playChannel;
    let command = yield commandChannel;

    while (command !== CLOSED) {
      switch (typeOf(playBuffer)) {
        case 'Frame':
          applyFrame(<Frame>playBuffer, textEditor, editChannel);
          yield editChannel; // wait until the edit is done
          playBuffer = yield playChannel;
          break;
        case 'StopPoint':
          if (command === breakoutCommand) {
            stateService.send('RESUME_PLAY');
            playBuffer = yield playChannel;
          } else {
            stateService.send('PLAY_PAUSED'); // We can reach here more than once while at a single stop point; that's OK
            // make no update to the document
            // do not get next playBuffer
          }
          break;
        case 'EndingStopPoint':
          if (command === breakoutCommand) {
            commandChannel.close();
            stateService.send('DONE_PLAYING');
            return;
          } else {
            stateService.send('PLAY_PAUSED_AT_END');
          }
          break;
        case 'SavePoint':
          // Just in case there's a save point anywhere other than the start or end of the buffers.
          // Just skip it.
          // Maybe there'll be a use for them in future.
          playBuffer = yield playChannel;
          break;
        case 'Closed':
          commandChannel.close();
          stateService.send('DONE_PLAYING'); // This takes us out of the play state, back to the idle state
          break;
      }
      command = yield commandChannel;
    }
  });
}

function cancelPlaying() {
  stateService.send('CANCELLED_PLAYING');
}

function toggleSilence() {
  stateService.send('TOGGLE_SILENCE');
}

export function start(context: vscode.ExtensionContext, service: Interpreter<TyperContext, TyperSchema, TyperEvent>) {
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

    commandChannel = chan(1);

    // goroutines:
    runAutoPlay(autoPlayControlChannel, commandChannel);
    runPlay(commandChannel, macro.buffers, <vscode.TextEditor>textEditor);

    statusBar.show(`${macro.name}`);
  });

}
