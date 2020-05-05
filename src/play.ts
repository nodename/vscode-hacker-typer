"use strict";

import * as vscode from "vscode";
import { Buffer, SavePoint, isSavePoint, isFrame, isStopPoint } from "./buffers";
import Storage from "./storage";
import { go, chan, put, putAsync, Channel, CLOSED, operations, timeout, alts } from "js-csp";
import { replaceAllContent, revealSelections, applyFrame } from "./edit";
import { Interpreter } from "xstate";
import { TyperContext, TyperSchema, TyperEvent } from "./states";
import * as statusBar from "./statusBar";


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
const startAutoPlayChar = '`';
const pauseAutoPlayChar = '`';

let commandChannel: Channel;
const breakoutCommand = "breakout";
const nextCommand = "next";
//const endOfInputCommand = "end";

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

function setAutoKeyboardMode() {
  typeCommand = registerAutoTypeCommand();
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
        putAsync(commandChannel, breakoutCommand);
        break;
      case startAutoPlayChar:
        startAutoPlay();
        break;
      default:
        putAsync(commandChannel, nextCommand);
        break;
    }
  };

  if (typeCommand) {
    typeCommand.dispose();
  }

  return vscode.commands.registerCommand("type", onType);
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

// This should go in the statechart:
const enum AutoPlayState {
  Play,
  Pause,
  Resume,
  Stop,
  None
}

let autoPlaying = false;
function runAutoPlay(autoPlayControlChannel: Channel, commandChannel: Channel) {
  go(function* () {
    let state: AutoPlayState = AutoPlayState.None;
    while (true) {
      let result = yield alts([autoPlayControlChannel, timeout(autoPlayInterval)], { priority: true });
      if (result.channel === autoPlayControlChannel) {
        state = result.value;
        if (state === AutoPlayState.Play) {
          autoPlaying = true;
        }
      } else { // timeout expired, time to do the action for my current state:
        switch (state) {
          case AutoPlayState.Play:
            yield put(commandChannel, nextCommand);
            break;
          case AutoPlayState.Pause:
            // do nothing
            break;
          case AutoPlayState.Resume:
            yield put(commandChannel, breakoutCommand);
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
  if (autoPlaying) {
    putAsync(autoPlayControlChannel, AutoPlayState.Pause);
    setManualKeyboardMode();
  }
}

export function resumeAutoPlay() {
  if (autoPlaying) {
    setAutoKeyboardMode();
    putAsync(autoPlayControlChannel, AutoPlayState.Resume);
  }
}

// Do this when leaving the play state
export function stopAutoPlay() {
  putAsync(autoPlayControlChannel, AutoPlayState.Stop);
  setManualKeyboardMode();
}

async function applySavePoint(
  savePoint: SavePoint,
  textEditor: vscode.TextEditor | undefined) {
  let editor = textEditor;
  // if no open text editor, open one
  if (!editor) {
    statusBar.show("Opening new window");
    const document = await vscode.workspace.openTextDocument({
      language: savePoint.language,
      content: savePoint.content
    });

    editor = await vscode.window.showTextDocument(document);
  }
  await replaceAllContent(editor, savePoint.content);

  if (editor) {
    revealSelections(savePoint.selections, editor);

    // language should always be defined, guard statement here
    // to support old recorded frames before language bit was added
    if (savePoint.language) {
      // @TODO set editor language once the API becomes available:
      // https://github.com/Microsoft/vscode/issues/1800
    }
  }
}

function runPlay(
  commandChannel: Channel,
  buffers: Buffer[],
  textEditor: vscode.TextEditor) {
  // Events indicating that an edit has completed:
  const editChannel = chan(1);

  // Is there a save point at the end of the buffers?
  const lastBuffer = buffers[buffers.length - 1];
  if (isSavePoint(lastBuffer)) {
    // drop it; we don't use it in playback:
    buffers = buffers.slice(0, buffers.length - 1); // butLast
  }

  let atEndingStopPoint = () => false;
  const stopPoints = buffers.filter(b => isStopPoint(b)).length;
  let stopPointsPassed = 0;
  
  // Is there a stop point at the end of the buffers (ignoring trailing save point(s))?
  let index = buffers.length - 1;
  while (isSavePoint(buffers[index])) {
    --index;
  }
  if (isStopPoint(buffers[index])) {
    atEndingStopPoint = () => stopPointsPassed === stopPoints - 1;
  }
  
  let playChannel: Channel;
  // If the first buffer is a save point, apply it immediately,
  // before any commands arrive:
  const firstBuffer = buffers[0];
  if (isSavePoint(firstBuffer)) {
    applySavePoint(<SavePoint>firstBuffer, textEditor);
    playChannel = operations.fromColl(buffers.slice(1));
  } else {
    playChannel = operations.fromColl(buffers);
  }

  go(function* () {
    let playBuffer: Buffer = yield playChannel;
    let command = yield commandChannel;

    while (command !== CLOSED) {
      if (isFrame(playBuffer)) {
        if (textEditor) {
          applyFrame(playBuffer, textEditor, editChannel);
          yield editChannel; // wait until the edit is done!
          playBuffer = yield playChannel;
        } else {
          // textEditor is undefined
        }
      } else if (isStopPoint(playBuffer)) {
        if (command === breakoutCommand) {
          stopPointsPassed++;
          stateService.send('RESUME_PLAY');
          playBuffer = yield playChannel;
        } else {
          if (atEndingStopPoint()) {
            stateService.send('PLAY_PAUSED_AT_END');
            playBuffer = yield playChannel; // that should be CLOSED
          } else {
            stateService.send('PLAY_PAUSED'); // We can reach here more than once while at a single stop point; that's OK
            // make no update to the document
            // do not get next playBuffer
          }
        }
      } else if (isSavePoint(playBuffer)) {
        // just in case there's a save point anywhere but at the start or end of the buffers.
        // Maybe there'll be a use for them in future.
        // just skip it; the plan is that the save point at the end
        // will be used to skip actually playing the buffers if desired,
        // in order to quickly reach the end state
        playBuffer = yield playChannel;
      } else if (playBuffer === CLOSED) {
        commandChannel.close();
      }
      command = yield commandChannel;
    }
    // commandChannel closed:
    console.log("Command channel closed");
    statusBar.show("Done playing");
    stateService.send('DONE_PLAYING'); // This takes us out of the play state, back to the idle state
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

    // Commands provided by the onType command or by autoPlay:
    commandChannel = chan(1);

    autoPlayControlChannel = chan(1);

    // goroutines:
    runAutoPlay(autoPlayControlChannel, commandChannel);
    runPlay(commandChannel, macro.buffers, <vscode.TextEditor>textEditor);

    statusBar.show(`${macro.name}`);
  });

}
