"use strict";

import * as vscode from "vscode";
import Storage from "./storage";
import * as recording from "./record";
import * as replay from "./play";
import { interpret, Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";
import { typerMachine } from "./states";
import * as statusBar from "./statusBar";
import showError from "./showError";

let context: vscode.ExtensionContext;

let stateService: Interpreter<TyperContext>;

type FnType = (context: vscode.ExtensionContext) => void;
type FnDict = Record<string, FnType>;
// This FnDict maps state-machine actions to their implementations.
// the context is passed as an argument to each implementation function.
const actionImplementations: FnDict = {
  registerTopLevelCommands: registerTopLevelCommands,
  enableRecording: recording.registerRecordingHooks,
  startRecording: startRecording,
  disableRecording: recording.disposeRecordingHooks,
  enablePlaying: replay.registerPlayingCommands,
  startPlaying: startPlaying,
  disablePlaying: replay.disable
};

// this method is called when your extension is activated
// your extension is activated the first time one of its commands is executed
export function activate(aContext: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Extension "vscode-hacker-typer-fork" active');

  statusBar.init();
  
  context = aContext;

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
        console.log(`value: ${JSON.stringify(state.value)}`);
        let key = Object.keys(state.value)[0];
        console.log(`${key}, ${state.value[key]}`);
        return state.value[key];
      } else {
        return state.value;
      }
    }

    const stateName = valueName(state);
    console.log(`Transition to ${stateName} state:
    ${JSON.stringify(state)}
    `);
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
  replay.start(context, stateService);
}

// These commands are available whenever the extension is active:
function registerTopLevelCommands(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId must match the command field in package.json

  let recordMacroCommandId = "nodename.vscode-hacker-typer-fork.recordMacro";
  let record = vscode.commands.registerCommand(
    recordMacroCommandId,
    () => { stateService.send('RECORD'); }
  );

  let playCommandId = "nodename.vscode-hacker-typer-fork.playMacro";
  let play = vscode.commands.registerCommand(
    playCommandId,
    () => { stateService.send('PLAY'); }
  );

  let deleteMacroCommandId = "nodename.vscode-hacker-typer-fork.deleteMacro";
  let delte = vscode.commands.registerCommand(
    deleteMacroCommandId,
    () => {
      const storage = Storage.getInstance(context);
      const items = storage.list();
      vscode.window.showQuickPick(items.map(item => item.name)).then(picked => {
        if (!picked) {
          return;
        }

        storage.delete(picked);
        statusBar.show(`Deleted "${picked}"`);
      });
    }
  );

  let exportMacroCommandId = "nodename.vscode-hacker-typer-fork.exportMacro";
  let exprt = vscode.commands.registerCommand(
    exportMacroCommandId,
    () => {
      const storage = Storage.getInstance(context);
      const items = storage.list();
      vscode.window.showQuickPick(items.map(item => item.name)).then(picked => {
        if (!picked) {
          return;
        }

        const options: vscode.SaveDialogOptions = {
          saveLabel: 'Export',
          filters: {
            JSON: ['json']
          }
        };

        vscode.window.showSaveDialog(options).then((location: vscode.Uri | undefined) => {
          if (location === undefined) { return; }

          storage.exprt(picked, location, (err) => {
            if (err) {
              showError(`Error exporting ${picked}`);
              console.log(err);
              return;
            }
            statusBar.show(`Exported "${picked}"`);
          });
        });

      });
    }
  );

  let importMacroCommandId = "nodename.vscode-hacker-typer-fork.importMacro";
  let imprt = vscode.commands.registerCommand(
    importMacroCommandId,
    () => {
      const storage = Storage.getInstance(context);

      const options: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: 'Import',
        filters: {
          JSON: ['json']
        }
      };

      vscode.window.showOpenDialog(options).then((files: vscode.Uri[] | undefined) => {
        if (files === undefined) {
          return;
        }

        for (var file in files) {
          const uri = vscode.Uri.parse(file);
          storage.imprt(uri, (err) => {
            if (err) {
              showError(`Error importing ${uri.fsPath}`);
              console.log(err);
              return;
            }

            statusBar.show(`Imported "${uri.fsPath}"`);
          });
        }
      });
    }
  );

  // These will automatically be disposed when the extension is deactivated:
  context.subscriptions.push(record, play, delte, exprt, imprt);
}

// this method is called when your extension is deactivated
export function deactivate() {
  statusBar.dispose();
}
