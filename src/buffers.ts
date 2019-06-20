import * as vscode from "vscode";

type WithPosition = {
  position: number;
};

export type StartingPoint = WithPosition & {
  content: string;
  language: string;
  selections: vscode.Selection[];
};

export type StopPoint = WithPosition & {
  stop: {
    name: string | null;
  };
};

export type Frame = WithPosition & {
  changes: vscode.TextDocumentContentChangeEvent[];
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
