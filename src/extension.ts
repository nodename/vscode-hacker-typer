"use strict";

import * as vscode from "vscode";
import * as recording from "./record";
import * as play from "./play";
import * as sound from "./sound";
import { interpret, Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";
import { typerMachine } from "./states";
import * as statusBar from "./statusBar";
import * as idle from "./idle";

export let stateService: Interpreter<TyperContext>;

type FnType = (context: vscode.ExtensionContext) => void;
type FnDict = Record<string, FnType>;
// This FnDict maps state-machine actions to their implementations.
// the context is passed as an argument to each implementation function.
const actionImplementations: FnDict = {
  enableIdling: idle.registerIdleCommands,
  disableIdling: idle.disposeIdleCommands,
  enableRecording: recording.registerRecordingHooks,
  startRecording: startRecording,
  disableRecording: recording.disposeRecordingHooks,
  enablePlaying: play.registerPlayingCommands,
  startPlaying: startPlaying,
  playStopSound: sound.playStopSound,
  playEndSound: sound.playEndSound,
  disablePlaying: play.disable
};

// this method is called when your extension is activated
// your extension is activated the first time one of its commands is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Extension "vscode-hacker-typer-fork" active');

  statusBar.init();
  
  stateService = interpret<TyperContext>(typerMachine, {
    execute: false // I'm going to handle the execution
    // because I don't want to specify concrete action implementations in the statechart itself.
    // The implementations in turn know nothing about the state machine other than
    // the events they send to it.
  });
  stateService.onTransition(state => {
    function valueName(state: any) {
      if (state.value instanceof Object) {
        // This works for non-parallel machine with one-level deep submachine
        let key = Object.keys(state.value)[0];
        return `${key}: ${state.value[key]}`;
      } else {
        return state.value;
      }
    }

    const stateName = valueName(state);
    console.log(`Transition to ${stateName} state`);
    statusBar.setAppState(stateName);
    state.actions.forEach(action => {
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

// this function is called when your extension is deactivated
export function deactivate() {
  statusBar.dispose();
}
