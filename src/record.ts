import * as vscode from "vscode";
import * as Diff from "diff";
import * as buffers from "./buffers";
import Storage from "./storage";
import { replaceAllContent } from "./edit";

let documentContent = "";

function insertStartingPoint(buffers: buffers.Buffer[], textEditor: vscode.TextEditor) {
  documentContent = textEditor.document.getText();
  const language = textEditor.document.languageId;
  const selections = textEditor.selections;

  console.log(`initial content: "${documentContent}"`);

  buffers.push({ content: documentContent, language, selections });
}

function insertStop(buffers: buffers.Buffer[], name: string | null) {
  buffers.push({
    stop: {
      name: name || null
    },
    selections: undefined
  });
}

function undoLast(buffers: buffers.Buffer[]) {
  const lastBuffer = <buffers.Frame>(buffers[buffers.length - 1]);
  const undo = lastBuffer.changeInfo.undo;

  if (undo) {
    documentContent = Diff.applyPatch(documentContent, undo);

    const textEditor = vscode.window.activeTextEditor;
    if (textEditor) {
      replaceAllContent(textEditor, documentContent);
    }
    buffers.pop();
  }
}

function saveRecording(bufferList: buffers.Buffer[], storage: Storage | null) {
  if (bufferList.length < 2) {
    vscode.window.showInformationMessage(
      "Cannot save macro with no content."
    );
    return;
  }
  if (storage) {
    vscode.window.showInputBox({
      prompt: "Give this thing a name",
      placeHolder: "cool-macro"
    })
      .then(name => {
        if (name) {
          return storage.save({
            name,
            description: "",
            buffers: bufferList
          })
            .then(macro => {
              vscode.window.showInformationMessage(
                `Saved ${macro.buffers.length} buffers under "${macro.name}".`
              );
            });
        }
      });
  } else {
    vscode.window.showInformationMessage("ERROR: cannot save macro!");
  }
}

export function disposeRecordingHooks() {
  console.log("disposeRecordingHooks");
  if (recordingHooks) {
    recordingHooks.dispose();
    recordingHooks = null;
  }
}

let recordingHooks: vscode.Disposable | null = null;

function registerRecordingCommands() {
  const insertStopCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.insertStop",
    () => {
      insertStop(bufferList, null);
    }
  );

  const undoCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.undo",
    () => {
      undoLast(bufferList);
    }
  );

  const saveMacroCommand = vscode.commands.registerCommand(
    "nodename.vscode-hacker-typer-fork.saveMacro",
    () => {
      saveRecording(bufferList, storage);
    }
  );

  return [insertStopCommand, undoCommand, saveMacroCommand];
}

export function registerRecordingHooks() {
  console.log("registerRecordingHooks");
  const commands: vscode.Disposable[] = registerRecordingCommands();
  const eventHandlers: vscode.Disposable[] = registerRecordingEventHandlers();

  recordingHooks = vscode.Disposable.from(
    ...commands, ...eventHandlers
  );
}

let storage: Storage | null = null;
let bufferList: buffers.Buffer[] = [];

export function start(context: vscode.ExtensionContext) {
  console.log("record.start");
  storage = Storage.getInstance(context);
  if (bufferList.length !== 0) {
    resume();
  } else {
    startRecording(true);
  }
}

function resume() {
  const CONTINUE = "Continue current recording";
  const NEW = "New recording from active editor";
  vscode.window.showQuickPick([CONTINUE, NEW], { canPickMany: false })
    .then(
      selection => {
        if (!selection) {
          return;
        }
        switch (selection) {
          case NEW:
            const SAVE = "Save current recording";
            const DISCARD = "Discard current recording";
            vscode.window.showQuickPick([SAVE, DISCARD], { canPickMany: false })
              .then(
                selection => {
                  if (!selection) {
                    return;
                  }
                  switch (selection) {
                    case SAVE:
                      saveRecording(bufferList, storage);
                      break;
                    case DISCARD:
                      break;
                    default:
                      break;
                  }
                  startRecording(true);
                }
              )
            break;
          case CONTINUE:
            startRecording(false);
            break;
          default:
            break;
        }
      });
}

let currentActiveDoc: vscode.TextDocument;
let currentOpenEditor: vscode.TextEditor | undefined;
let currentChangeInfo: buffers.ChangeInfo;

function registerRecordingEventHandlers() {
  const onDidChangeTextDocumentHandler = vscode.workspace.onDidChangeTextDocument(
    (event: vscode.TextDocumentChangeEvent) => {
      if (event.document === currentActiveDoc) {
        const newContent = currentActiveDoc.getText();
        const diff = Diff.createPatch("", documentContent, newContent);
        const undo = Diff.createPatch("", newContent, documentContent);

        documentContent = newContent;

        // store changes, selection change will commit
        currentChangeInfo = {
          changes: event.contentChanges,
          diff: diff,
          undo: undo
        };
      } else {
        console.log('Non-watched doc changed');
      }
    });

  const onDidChangeTextEditorSelectionHandler = vscode.window.onDidChangeTextEditorSelection(
    (event: vscode.TextEditorSelectionChangeEvent) => {
      // Only allow recording from one active editor at a time
      // Breaks when you leave but that's fine for now.
      if (event.textEditor !== currentOpenEditor) {
        // TODO ask if user wants to save current recording
        return;
      }

      const changeInfo = currentChangeInfo;
      currentChangeInfo = { changes: [], diff: "", undo: "" };

      const selections = event.selections || [];

      const selection = selections[0];
      const selectedText = currentActiveDoc.getText(selection);

      console.log("");
      console.log(buffers.describeChange(changeInfo));
      console.log(buffers.describeSelection(selection, selectedText));

      bufferList.push({ changeInfo: changeInfo, selections: selections });
    });

  const onDidCloseTextDocumentHandler = vscode.workspace.onDidCloseTextDocument(
    (closedDoc: vscode.TextDocument) => {
      if (closedDoc === currentActiveDoc) {
        console.log('Watched doc was closed');
      } else {
        console.log('Non-watched doc closed');
      }
    });

  const onDidChangeActiveTextEditorHandler = vscode.window.onDidChangeActiveTextEditor(
    (newEditor: vscode.TextEditor | undefined) => {
      // ask if user wants to save current recording and stop recording
    });

  return [onDidChangeTextDocumentHandler,
    onDidChangeTextEditorSelectionHandler,
    onDidCloseTextDocumentHandler,
    onDidChangeActiveTextEditorHandler];
}


function startRecording(isNewRecording: boolean) {
  if (isNewRecording) {
    bufferList = [];
  }

  currentOpenEditor = vscode.window.activeTextEditor;
  if (!currentOpenEditor) {
    return;
  }

  // start watching the currently open doc
  // TODO if not new recording, check if doc has changed
  currentActiveDoc = currentOpenEditor.document;

  if (isNewRecording) {
    insertStartingPoint(bufferList, currentOpenEditor);
  }

  vscode.window.showInformationMessage("Hacker Typer is now recording!");
}
