import * as vscode from "vscode";
import * as buffers from "./buffers";
import Storage from "./storage";
import { currentlyReplaying } from "./replay";

function insertStartingPoint(buffers: buffers.Buffer[], bufferPosition: number, textEditor: vscode.TextEditor) {
  const content = textEditor.document.getText();
  const selections = textEditor.selections;
  const language = textEditor.document.languageId;

  buffers.push({
    position: bufferPosition,
    content,
    language,
    selections
  });
}

function insertStop(buffers: buffers.Buffer[], bufferPosition: number, name: string | null) {
  buffers.push({
    stop: {
      name: name || null
    },
    changes: undefined,
    selections: undefined,
    position: bufferPosition
  });
}

function saveRecording(bufferList: buffers.Buffer[], storage: Storage | null) {
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

let recordingHooks: vscode.Disposable | null = null;
export function currentlyRecording(): boolean {
  return recordingHooks !== null;
}
function disposeRecordingHooks() {
  if (recordingHooks) {
    recordingHooks.dispose();
    recordingHooks = null;
  }
}

/*
export function stopRecordingMacro() {
  if (currentlyRecording()) {
    // TODO ask if user wants to save current recording
    disposeRecordingHooks();
  } else {
    vscode.window.showInformationMessage("Not currently recording");
  }
}
*/

function registerCommands() {
  const insertStopCommand = vscode.commands.registerCommand(
    "jevakallio.vscode-hacker-typer.insertStop",
    () => {
      insertStop(bufferList, bufferPosition++, null);
    });

  const insertNamedStopCommand = vscode.commands.registerCommand(
    "jevakallio.vscode-hacker-typer.insertNamedStop",
    () => {
      vscode.window.showInputBox({
        prompt: "What do you want to call your stop point?",
        placeHolder: "Type a name or ENTER for unnamed stop point"
      })
        .then(name => {
          insertStop(bufferList, bufferPosition++, name || null);
        });
    });

  const saveMacroCommand = vscode.commands.registerCommand(
    "jevakallio.vscode-hacker-typer.saveMacro",
    () => {
      saveRecording(bufferList, storage);
    });

  return [insertStopCommand, insertNamedStopCommand, saveMacroCommand];
}

let storage: Storage | null = null;
let bufferList: buffers.Buffer[] = [];
let bufferPosition = 0;

export function recordMacro(context: vscode.ExtensionContext) {
  storage = Storage.getInstance(context);
  if (currentlyRecording()) {
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
  } else {
    startRecording(true);
  }
}

function startRecording(isNewRecording: boolean) {
  if (isNewRecording) {
    bufferList = [];
    bufferPosition = 0;
  }

  let currentOpenEditor = vscode.window.activeTextEditor;
  if (currentOpenEditor) {
    // start watching the currently open doc
    // TODO if not new recording, check if doc has changed
    let currentActiveDoc = currentOpenEditor.document;
    let currentChanges: vscode.TextDocumentContentChangeEvent[] = [];

    function registerEventHandlers() {
      const onDidChangeTextDocumentHandler = vscode.workspace.onDidChangeTextDocument(
        (event: vscode.TextDocumentChangeEvent) => {
          if (event.document === currentActiveDoc) {
            // @TODO: Gets called while playing -- need to stop recording once over
            if (currentlyReplaying()) {
              return;
            }

            // store changes, selection change will commit
            currentChanges = event.contentChanges;
            console.log('Watched doc changed');
          } else {
            console.log('Non-watched doc changed');
          }
        });

      const onDidChangeTextEditorSelectionHandler = vscode.window.onDidChangeTextEditorSelection(
        (event: vscode.TextEditorSelectionChangeEvent) => {
          // @TODO: Gets called while playing -- need to stop recording once over
          if (currentlyReplaying()) {
            return;
          }

          // Only allow recording from one active editor at a time
          // Breaks when you leave but that's fine for now.
          if (event.textEditor !== currentOpenEditor) {
            // TODO ask if user wants to save current recording
            return;
          }

          const changes = currentChanges;
          const selections = event.selections || [];
          currentChanges = [];

          bufferList.push({
            changes,
            selections,
            position: bufferPosition++
          });
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

    if (currentlyRecording() === false) {
      const commands: vscode.Disposable[] = registerCommands();
      const eventHandlers: vscode.Disposable[] = registerEventHandlers();

      disposeRecordingHooks();
      recordingHooks = vscode.Disposable.from(
        ...commands, ...eventHandlers
      );
    }

    if (isNewRecording) {
      insertStartingPoint(bufferList, bufferPosition++, currentOpenEditor);
    }

    vscode.window.showInformationMessage("Hacker Typer is now recording!");
  }
}
