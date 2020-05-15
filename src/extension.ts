"use strict";

import * as vscode from "vscode";
import * as idle from "./idle";
import * as recording from "./record";
import * as play from "./play";
import * as sound from "./sound";
import { interpret, Interpreter } from "xstate";
import { TyperContext, TyperSchema, TyperEvent, typerMachine } from "./states";
import * as statusBar from "./statusBar";

export let stateService: Interpreter<TyperContext, TyperSchema, TyperEvent>;

type FnType = (context: vscode.ExtensionContext) => void;
type FnDict = Record<string, FnType>;
// This FnDict maps state-machine actions to their implementations.
// the extension context is passed as an argument to each implementation function.
const actionImplementations: FnDict = {
  enableIdling: idle.registerIdleCommands,
  disableIdling: idle.disposeIdleCommands,
  enableRecording: recording.registerRecordingHooks,
  startRecording: startRecording,
  showRecording: () => statusBar.show('Recording'),
  showSaving: () => statusBar.show('Saving'),
  saveRecording: recording.saveRecording,
  showRecordingNotSaved: () => statusBar.show('Recording not saved'),
  continueOrEndRecording: recording.continueOrEndRecording,
  showDoneRecording: () => statusBar.show('Done recording'),
  showCancelledRecording: () => statusBar.show('Recording cancelled'),
  showCDiscardedRecording: () => statusBar.show('Recording discarded'),
  resumeRecording: recording.resumeRecording,
  disableRecording: recording.disposeRecordingHooks,
  enablePlaying: play.registerPlayingCommands,
  startPlaying: startPlaying,
  playPauseSound: sound.playPauseSound,
  playEndSound: sound.playEndSound,
  startAutoPlay: play.startAutoPlay,
  pauseAutoPlay: play.pauseAutoPlay,
  resumeAutoPlay: play.resumeAutoPlay,
  quitAutoPlay: play.quitAutoPlay,
  toggleSilence: sound.toggleSilence,
  disablePlaying: play.disposePlayingCommands
};

// this method is called when the extension is activated;
// the extension is activated the first time one of its commands is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when the extension is activated
  console.log('Extension "vscode-hacker-typer-fork" active');

  statusBar.init();
  
  stateService = interpret<TyperContext, TyperSchema, TyperEvent>(typerMachine, {
    execute: false // I'm going to handle the execution
    // because I don't want to specify concrete action implementations in the statechart itself.
    // The implementations in turn know nothing about the state machine other than
    // the events they send to it.
  });

  stateService.onTransition(state => {
    function valueName(value: any) {
      if (value instanceof Object) {
        let txt = '';
        let first = true;
        for (let prop in value) {
          txt += `${first ? '' : ', '}`;
          txt += valueName(value[prop]);
          first = false;
        }
        return txt;
      } else {
        return value;
      }
    }

    const stateName = valueName(state.value);
    console.log(`Transition to ${stateName} state`);
    statusBar.setAppState(stateName);
    state.actions.forEach(action => {
      console.log(`${action.type}`);
      actionImplementations[action.type](context);
    });
  });
  stateService.start();
  statusBar.setAppState("Idle");
}

function startRecording(context: vscode.ExtensionContext) {
  recording.start(context, stateService);
}

function startPlaying(context: vscode.ExtensionContext) {
  play.start(context, stateService);
}

// this function is called when the extension is deactivated
export function deactivate() {
  statusBar.dispose();
}
