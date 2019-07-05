import * as vscode from "vscode";

export function applyContentChanges(
    changes: vscode.TextDocumentContentChangeEvent[],
    edit: vscode.TextEditorEdit) {
    changes.forEach(change => applyContentChange(change, edit));
}

function applyContentChange(
    change: vscode.TextDocumentContentChangeEvent,
    edit: vscode.TextEditorEdit) {
    console.log(`change: text: ${change.text}`);
    console.log(`start: ${change.range.start}`);
    console.log(`rangeLength: ${change.rangeLength}`);

    if (change.text === "") {
        edit.delete(change.range);
    } else if (change.rangeLength === 0) {
        edit.insert(change.range.start, change.text);
    } else {
        edit.replace(change.range, change.text);
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