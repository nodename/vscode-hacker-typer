import * as vscode from "vscode";
import * as onChange from "on-change";

let myStatusBarItem: vscode.StatusBarItem;

const appName = "HackerTyper";

const barState = onChange({
  appState: "",
  message: ""
},
  (path, value, previousValue) => {
    display();
  });

export function init() {
  myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
}

export function setAppState(state: string) {
  barState.appState = state;
}

export function show(text: string) {
  barState.message = text;
}

function display() {
  myStatusBarItem.text = `${appName} ${barState.appState}: ${barState.message}`;
  myStatusBarItem.show();
}

export function dispose() {
  myStatusBarItem.dispose();
}