import * as vscode from "vscode";

let myStatusBarItem: vscode.StatusBarItem;

export function init() {
  myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
}

export function show(text: string) {
  myStatusBarItem.text = text;
  myStatusBarItem.color = "white";
  myStatusBarItem.show();
}