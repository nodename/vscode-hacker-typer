"use strict";

import * as vscode from "vscode";

export async function applyContentChanges(
    changes: vscode.TextDocumentContentChangeEvent[],
    editBuilder: vscode.TextEditorEdit) {
    for (const change of changes) {
        await applyContentChange(change, editBuilder);
    }
}

async function applyContentChange(
    change: vscode.TextDocumentContentChangeEvent,
    editBuilder: vscode.TextEditorEdit) {
    // console.log(`change: text: ${change.text}`);
    // console.log(`start: ${change.range.start}`);
    // console.log(`rangeLength: ${change.rangeLength}`);

    if (change.text === "") {
        editBuilder.delete(change.range);
    } else if (change.rangeLength === 0) {
        editBuilder.insert(change.range.start, change.text);
    } else {
        editBuilder.replace(change.range, change.text);
    }
}

export async function replaceAllContent(editor: vscode.TextEditor, newContent: string) {
    await editor.edit(edit => {
        // update initial file content
        const l = editor.document.lineCount;
        const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(
                l,
                Math.max(
                    0,
                    editor.document.lineAt(Math.max(0, l - 1)).text.length - 1
                )
            )
        );

        edit.delete(range);
        edit.insert(new vscode.Position(0, 0), newContent);
    });
}