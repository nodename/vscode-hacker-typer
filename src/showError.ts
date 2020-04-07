"use strict";

import * as vscode from "vscode";

export default function showError(text: string) {
    vscode.window.showErrorMessage(`ERROR: ${text}`);
}
