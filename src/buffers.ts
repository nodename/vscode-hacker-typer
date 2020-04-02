import * as vscode from "vscode";

export type StartingPoint = {
  content: string;
  language: string;
  selections: vscode.Selection[];
};

export type StopPoint = {
  stop: {
    name: string | null;
  };
};

export type ChangeInfo = {
  changes: vscode.TextDocumentContentChangeEvent[],
  diff: string,
  undo: string
};

export type Frame = {
  changeInfo: ChangeInfo;
  selections: vscode.Selection[];
};

export type Buffer = StartingPoint | StopPoint | Frame;

export function isStartingPoint(buffer: Buffer): buffer is StartingPoint {
  return (
    (<StartingPoint>buffer).content !== undefined &&
    (<StartingPoint>buffer).content !== null
  );
}

export function isStopPoint(buffer: Buffer): buffer is StopPoint {
  return (
    (<StopPoint>buffer).stop !== undefined && (<StopPoint>buffer).stop !== null
  );
}

export function isFrame(buffer: Buffer): buffer is Frame {
  return !isStartingPoint(buffer) && !isStopPoint(buffer);
}

export function describeChange(changeInfo: ChangeInfo): string {
  const change = changeInfo.changes[0];
  return `replace text from ${change.range.start.line}, ${change.range.start.character} to ` +
    `${change.range.end.line}, ${change.range.end.character} ` +
    `with "${change.text}"`;
}

export function describeSelection(selection: vscode.Selection, selectedText: string): string {
  return `selection: start: ${selection.start.line}, ${selection.start.character}, ` +
    `end: ${selection.end.line}, ${selection.end.character}, ` +
    `anchor: ${selection.anchor.line}, ${selection.anchor.character} ` +
    `active: ${selection.active.line}, ${selection.active.character} ` +
    `contents: "${selectedText}"`;
}
