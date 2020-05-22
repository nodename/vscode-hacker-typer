"use strict";

import * as vscode from "vscode";
import Storage from "./storage";
import showError from "./showError";
import { TyperStateService } from "./extension";
import * as statusBar from "./statusBar";
import { isSavePoint, SavePoint } from "./buffers";
import { applySavePoint } from "./edit";
import { last } from "./fun";

// These are the commands that are available in the Idle state:
let record: vscode.Disposable;
let play: vscode.Disposable;
let deleet: vscode.Disposable;
let exprt: vscode.Disposable;
let imprt: vscode.Disposable;
let loadFinalState: vscode.Disposable;
let commands: vscode.Disposable[];

function doDelete(context: vscode.ExtensionContext) {
    return () => {
        const storage = Storage.getInstance(context);
        const items = storage.list();
        vscode.window.showQuickPick(items.map(item => item.name), {
            canPickMany: true,
            ignoreFocusOut: true,
        }).then(picked => {
            if (!picked) {
                return;
            }
            picked.forEach(item => storage.delete(item));
            statusBar.show(`Deleted "${picked}"`);
        });
    };
}

function doExport(context: vscode.ExtensionContext) {
    return () => {
        const storage = Storage.getInstance(context);
        const items = storage.list();
        vscode.window.showQuickPick(items.map(item => item.name), {
            canPickMany: false,
            ignoreFocusOut: true,
        }).then(picked => {
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
    };
}

function doImport(context: vscode.ExtensionContext) {
    return () => {
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
            for (const file in files) {
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
    };
}

function doLoadFinalState(context: vscode.ExtensionContext) {
    return () => {
        const storage = Storage.getInstance(context);
        storage.userChooseMacro((macro) => {
            if (macro) {
                const textEditor = vscode.window.activeTextEditor;
                const buffers = macro.buffers;
                const lastBuffer = last(buffers);
                if (isSavePoint(lastBuffer)) {
                    applySavePoint(<SavePoint>lastBuffer, textEditor);
                } else {
                    statusBar.show('No save point at end');
                }
            }
        });
    };
}

export function registerIdleCommands(context: vscode.ExtensionContext, stateService: TyperStateService) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId must match the command field in package.json
    const recordMacroCommandId = "nodename.vscode-hacker-typer-fork.recordMacro";
    record = vscode.commands.registerCommand(recordMacroCommandId, () => { stateService.send('RECORD'); });

    const playCommandId = "nodename.vscode-hacker-typer-fork.playMacro";
    play = vscode.commands.registerCommand(playCommandId, () => { stateService.send('PLAY'); });

    const deleteMacroCommandId = "nodename.vscode-hacker-typer-fork.deleteMacro";
    deleet = vscode.commands.registerCommand(deleteMacroCommandId, doDelete(context));

    const exportMacroCommandId = "nodename.vscode-hacker-typer-fork.exportMacro";
    exprt = vscode.commands.registerCommand(exportMacroCommandId, doExport(context));

    const importMacroCommandId = "nodename.vscode-hacker-typer-fork.importMacro";
    imprt = vscode.commands.registerCommand(importMacroCommandId, doImport(context));

    const loadFinalStateOfMacroCommandId = "nodename.vscode-hacker-typer-fork.loadFinalStateOfMacro";
    loadFinalState = vscode.commands.registerCommand(loadFinalStateOfMacroCommandId, doLoadFinalState(context));

    commands = [record, play, deleet, exprt, imprt, loadFinalState];

    // These will automatically be disposed when the extension is deactivated:
    for (const command of commands) {
        context.subscriptions.push(command);
    }
}

export function disposeIdleCommands() {
    for (const command of commands) {
      command.dispose();
    }
}