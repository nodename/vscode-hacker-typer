"use strict";

import * as vscode from "vscode";
import { Channel, putAsync } from "js-csp";
import { Frame, SavePoint } from "./buffers";
import * as statusBar from "./statusBar";

const DeleteTag = "Delete";
const InsertTag = "Insert";
const ReplaceTag = "Replace";
const UndefinedTag = "Undefined";

type Delete = {
    tag: string,
    range: vscode.Range
};

type Insert = {
    tag: string,
    start: vscode.Position,
    text: string
};

type Replace = {
    tag: string,
    range: vscode.Range,
    text: string
};

type UndefinedEdit = {
    tag: string
};

export type Edit = Delete | Insert | Replace | UndefinedEdit;

export function kindOf(edit: Edit): string {
    return edit.tag;
}

function reverseDelete(d: Delete, text: string): Insert {
    return {
        tag: InsertTag,
        start: d.range.start,
        text: text
    };
}

function reverseInsert(i: Insert): Delete {
    const textLines = i.text.split("\n");
    const nls = textLines.length - 1;
    const lastTextLine = textLines[nls];

    const newEndLine = i.start.line + nls;
    const newEndChar = i.start.character + lastTextLine.length;
    const newEnd = new vscode.Position(newEndLine, newEndChar);

    return {
        tag: DeleteTag,
        range: new vscode.Range(i.start, newEnd)
    };
}

function reverseReplace(r: Replace, text: string): Replace {
    const textLines = text.split("\n");
    const nls = textLines.length - 1;
    const lastTextLine = textLines[nls];

    const newEndLine = r.range.start.line + nls;
    const newEndChar = lastTextLine.length;
    const newEnd = new vscode.Position(newEndLine, newEndChar);

    return {
        tag: ReplaceTag,
        range: new vscode.Range(r.range.start, newEnd),
        text: text
    };
}

export function reverseEdit(edit: Edit, text: string): Edit {
    switch (edit.tag) {
        case DeleteTag:
            return reverseDelete(<Delete>edit, text);
            break;
        case InsertTag:
            return reverseInsert(<Insert>edit);
            break;
        case ReplaceTag:
            return reverseReplace(<Replace>edit, text);
            break;
    }
    return {
        tag: UndefinedTag
    };
}

function applyEdit(edit: Edit, editBuilder: vscode.TextEditorEdit) {
    switch (edit.tag) {
        case DeleteTag:
            editBuilder.delete((<Delete>edit).range);
            break;
        case InsertTag:
            editBuilder.insert((<Insert>edit).start, (<Insert>edit).text);
            break;
        case ReplaceTag:
            editBuilder.replace((<Replace>edit).range, (<Replace>edit).text);
            break;
    }
}

async function applyChanges(
    changeEvents: vscode.TextDocumentContentChangeEvent[],
    editBuilder: vscode.TextEditorEdit) {
    for (const changeEvent of changeEvents) {
        await applyChange(changeEvent, editBuilder);
    }
}

export function toEdit(change: vscode.TextDocumentContentChangeEvent): Edit {
    if (change.text === "") {
        return {
            tag: DeleteTag,
            range: change.range
        };
    } else if (change.rangeLength === 0) {
        return {
            tag: InsertTag,
            start: change.range.start,
            text: change.text
        };
    } else {
        return {
            tag: ReplaceTag,
            range: change.range,
            text: change.text
        };
    }
}

async function applyChange(
    changeEvent: vscode.TextDocumentContentChangeEvent,
    editBuilder: vscode.TextEditorEdit) {
    // console.log(`applyContentChange:
    // text: ${changeEvent.text}`);
    // console.log(`range: ${changeEvent.range}`);
    // console.log(`rangeLength: ${changeEvent.rangeLength}`);

    const edit: Edit = toEdit(changeEvent);
    applyEdit(edit, editBuilder);
}

export function revealSelections(
    selections: vscode.Selection[],
    editor: vscode.TextEditor) {
    editor.selections = selections;

    // move scroll focus if needed
    if (selections.length) {
        const { start, end } = editor.selections[0];
        editor.revealRange(
            new vscode.Range(start, end),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
    }
}

export function applyFrame(frame: Frame, textEditor: vscode.TextEditor, out: Channel) {
    textEditor.edit(function (editBuilder: vscode.TextEditorEdit): void {
        applyChanges(frame.changeInfo.changes, editBuilder);
    }).then(() => {
        revealSelections(frame.selections, <vscode.TextEditor>textEditor);
        putAsync(out, "done");
    });
}

export async function replaceAllContent(textEditor: vscode.TextEditor, newContent: string) {
    await textEditor.edit(edit => {
        const lineCount = textEditor.document.lineCount;
        const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(
                lineCount,
                Math.max(
                    0,
                    textEditor.document.lineAt(Math.max(0, lineCount - 1)).text.length - 1
                )
            )
        );

        edit.delete(range);
        edit.insert(new vscode.Position(0, 0), newContent);
    });
}

export async function applySavePoint(
    savePoint: SavePoint,
    textEditor: vscode.TextEditor | undefined) {
    let editor = textEditor;
    // if no open text editor, open one:
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