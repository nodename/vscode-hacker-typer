"use strict";

import * as vscode from "vscode";
import Storage from "./storage";
import * as recording from "./record";
import * as replay from "./replay";
import { interpret, Interpreter } from "xstate";
import { TyperContext } from "./stateTypes";
import { typerMachine } from "./states";

let context: vscode.ExtensionContext;

let stateService: Interpreter<TyperContext>;

type FnType = (context: vscode.ExtensionContext) => void;
type FnDict = Record<string, FnType>;
// This FnDict maps state-machine actions to their implementations.
// the context is passed as an argument to each implementation function.
const actionImplementations: FnDict = {
  registerTopLevelCommands: registerTopLevelCommands,
  enableRecording: recording.registerRecordingHooks,
  startRecording: recording.start,
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
  console.log(
    'Congratulations, your extension "vscode-hacker-typer-fork" is now active!'
  );

  context = aContext;

  stateService = interpret<TyperContext>(typerMachine, {
    execute: false // I'm going to handle the execution
    // because I don't want to specify concrete action implementations in the statechart itself.
    // The implementations in turn know nothing about the state machine other than
    // the events they send to it.
  });
  stateService.onTransition(state => {
    console.log(`Transition to ${state.value} state`);
    state.actions.forEach(action => {
      actionImplementations[action.type](context);
    });
  });
  stateService.start();
}

function startPlaying(context: vscode.ExtensionContext) {
  replay.start(context, stateService);
}

// These commands are available whenever the extension is active:
function registerTopLevelCommands(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  let record = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.recordMacro",
    () => { stateService.send('RECORD'); }
  );

  let play = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.playMacro",
    () => { stateService.send('PLAY'); }
  );

  let delte = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.deleteMacro",
    () => {
      const storage = Storage.getInstance(context);
      const items = storage.list();
      vscode.window.showQuickPick(items.map(item => item.name)).then(picked => {
        if (!picked) {
          return;
        }

        storage.delete(picked);
        vscode.window.showInformationMessage(`Deleted "${picked}"`);
      });
    }
  );

  let exprt = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.exportMacro",
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
              vscode.window.showErrorMessage(`Error exporting ${picked}`);
              console.log(err);
              return;
            }
            vscode.window.showInformationMessage(`Exported "${picked}"`);
          });
        });

      });
    }
  );

  let imprt = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.importMacro",
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
              vscode.window.showErrorMessage(`Error importing ${uri.fsPath}`);
              console.log(err);
              return;
            }

            vscode.window.showInformationMessage(`Imported "${uri.fsPath}"`);
          });
        }
      });
    }
  );

  // These will automatically be disposed when the extension is deactivated:
  context.subscriptions.push(record, play, delte, exprt, imprt);
}

// this method is called when your extension is deactivated
export function deactivate() { }
