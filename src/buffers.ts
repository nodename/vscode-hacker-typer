"use strict";

import * as vscode from "vscode";
import { CLOSED } from "js-csp";
import { Edit, toEdit, kindOf } from "./edit";

export type SavePoint = {
  content: string;
  language: string;
  selections: vscode.Selection[];
};

export type StopPoint = {
  stop: {
    name: string | null;
  };
};

export function createStopPoint(name: string | null) {
  return {
    stop: { name: name || null },
    selections: undefined
  };
}

export function createEndingStopPoint() {
  return createStopPoint('END_OF_MACRO');
}

export type ChangeInfo = {
  changes: vscode.TextDocumentContentChangeEvent[]
};

export type Frame = {
  changeInfo: ChangeInfo;
  selections: vscode.Selection[];
};

export type Buffer = SavePoint | StopPoint | Frame;

export const emptyChangeInfo = {
  changes: []
};

export type BufferType = 'SavePoint' | 'StopPoint' | 'EndingStopPoint' | 'Frame' | 'Closed';

export function typeOf(buffer: Buffer | null): BufferType {
  if (buffer === CLOSED) {
    return 'Closed';
  } else if (isSavePoint(buffer)) {
    return 'SavePoint';
  } else if (isStopPoint(buffer)) {
    return isEndingStopPoint(buffer) ? 'EndingStopPoint' : 'StopPoint';
  } else {
    return 'Frame';
  }
}

export function isSavePoint(buffer: Buffer): buffer is SavePoint {
  return (
    buffer &&
    (<SavePoint>buffer).content !== undefined &&
    (<SavePoint>buffer).content !== null
  );
}

export function isStopPoint(buffer: Buffer): buffer is StopPoint {
  return (
    buffer &&
    (<StopPoint>buffer).stop !== undefined &&
    (<StopPoint>buffer).stop !== null
  );
}

export function isEndingStopPoint(buffer: Buffer) {
  return (
    isStopPoint(buffer) &&
    buffer.stop.name === 'END_OF_MACRO'
  );
}

export function isFrame(buffer: Buffer): buffer is Frame {
  return (
    buffer &&
    !isSavePoint(buffer) &&
    !isStopPoint(buffer)
  );
}

export function describeChanges(changeInfo: ChangeInfo): string {
  return changeInfo.changes.map(describeChange).join("\n");
}

export function describeChange(changeEvent: vscode.TextDocumentContentChangeEvent): string {
  return `replace text from ${changeEvent.range.start.line}, ${changeEvent.range.start.character} to ` +
    `${changeEvent.range.end.line}, ${changeEvent.range.end.character} ` +
    `with "${changeEvent.text}"`;
}

export function describeSelections(selections: vscode.Selection[]): string {
  return selections.map(selection => describeSelection(selection, undefined)).join("\n");
}

export function describeSelection(selection: vscode.Selection, selectedText: string | undefined = undefined): string {
  return `selection:
     start: ${selection.start.line}, ${selection.start.character},
     end: ${selection.end.line}, ${selection.end.character},
     anchor: ${selection.anchor.line}, ${selection.anchor.character}
     active: ${selection.active.line}, ${selection.active.character}`;
}

function reverseChangeEvent(
  changeEvent: vscode.TextDocumentContentChangeEvent,
  document: vscode.TextDocument): vscode.TextDocumentContentChangeEvent {
  const newStart = changeEvent.range.start;
  const newRangeOffset = changeEvent.rangeOffset;

  const textLines = changeEvent.text.split("\n");
  const nls = textLines.length - 1;
  const lastLine = textLines[textLines.length - 1];

  const newEndLine = changeEvent.range.start.line + nls;
  const newEndChar = changeEvent.range.start.character + lastLine.length;
  const newEnd = new vscode.Position(newEndLine, newEndChar);

  const newRange = new vscode.Range(newStart, newEnd);
  let newText = document.getText(newRange);
  const newRangeLength = newText.length;

  const edit: Edit = toEdit(changeEvent);
  if (kindOf(edit) === "Insert") {
    newText = "";
  }

  return {
    range: newRange,
    rangeOffset: newRangeOffset,
    rangeLength: newRangeLength,
    text: newText
  };
}

function reverseChangeInfo(
  changeInfo: ChangeInfo,
  document: vscode.TextDocument): ChangeInfo {
  const newChanges = changeInfo.changes.map(e => reverseChangeEvent(e, document));
  return {
    changes: newChanges
  };
}

export function reverseFrame(
  frame: Frame,
  previousFrameOrSavePoint: Frame | SavePoint,
  document: vscode.TextDocument): Frame {
  return {
    changeInfo: reverseChangeInfo(frame.changeInfo, document),
    selections: previousFrameOrSavePoint.selections
  };
}