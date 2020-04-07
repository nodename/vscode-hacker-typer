"use strict";

import * as vscode from "vscode";
import Storage from "./storage";
import showError from "./showError";
import { stateService } from "./extension";
import * as statusBar from "./statusBar";

let record: vscode.Disposable;
let play: vscode.Disposable;
let deleet: vscode.Disposable;
let exprt: vscode.Disposable;
let imprt: vscode.Disposable;

export function registerIdleCommands(context: vscode.ExtensionContext) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId must match the command field in package.json
    let recordMacroCommandId = "nodename.vscode-hacker-typer-fork.recordMacro";
    record = vscode.commands.registerCommand(recordMacroCommandId, () => { stateService.send('RECORD'); });

    let playCommandId = "nodename.vscode-hacker-typer-fork.playMacro";
    play = vscode.commands.registerCommand(playCommandId, () => { stateService.send('PLAY'); });

    let deleteMacroCommandId = "nodename.vscode-hacker-typer-fork.deleteMacro";
    deleet = vscode.commands.registerCommand(deleteMacroCommandId, () => {
        const storage = Storage.getInstance(context);
        const items = storage.list();
        vscode.window.showQuickPick(items.map(item => item.name)).then(picked => {
            if (!picked) {
                return;
            }
            storage.delete(picked);
            statusBar.show(`Deleted "${picked}"`);
        });
    });

    let exportMacroCommandId = "nodename.vscode-hacker-typer-fork.exportMacro";
    exprt = vscode.commands.registerCommand(exportMacroCommandId, () => {
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
                if (location === undefined) {
                    return;
                }
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
    });

    let importMacroCommandId = "nodename.vscode-hacker-typer-fork.importMacro";
    imprt = vscode.commands.registerCommand(importMacroCommandId, () => {
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
    });

    // These will automatically be disposed when the extension is deactivated:
    context.subscriptions.push(record, play, deleet, exprt, imprt);
}

export function disposeIdleCommands(context: vscode.ExtensionContext) {
    for (const command of [record, play, deleet, exprt, imprt]) {
      command.dispose();
    }
}