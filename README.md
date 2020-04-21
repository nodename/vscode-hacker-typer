# VSCode Hacker Typer

Hacker Typer allows you to record your keystrokes in VSCode, and to play them back either automatically or by typing random keys. Supports typing, editing, selections (including multicursor) and autocompletions.

This version is a fork of [Jani Eväkallio's original extension](https://github.com/jevakallio/vscode-hacker-typer).

😳 **See it live in action: [Writing Code Like a Real Hacker - Reactivate X, London](https://www.youtube.com/watch?v=ulnC-SDBDKE)**

⬇️ **Download the extension from [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=nodename.vscode-hacker-typer-fork)**

## Features

- Record and play **macros**.
- Insert stop points, so you don't accidentally overrun your talking points while "live coding."
- Play macros back either automatically or by typing randomly.

## How to use Hacker Typer

### Status Bar

  If you keep the status bar visible you can see the current state of the extension
(`View -> Appearance -> Show Status Bar`).

### Record a macro

1. Open a file or a new VSCode window.
2. Execute `HackerTyper: Record Macro` command from the command palette (or `Cmd+Shift+T R`).
3. The current content and selections of the active editor will be snapshotted.
4. Start typing code. Every keystroke is recorded into an in-memory buffer, including deletions, selection changes, etc.
5. If you make a mistake you can back up by typing `Cmd+Shift+T U` (the `Undo Last Recorded Buffer` command).
6. You can cancel recording with `HackerTyper: Cancel Recording` (`Cmd+Shift+T C`).
7. When you're ready, execute `HackerTyper: Save or Discard Macro` command from the command palette (or `Cmd+Shift+T S`),
  and choose `Save` or `Discard`.
8. Give your macro a name.
9. You're done! Or if you wish, you can continue recording the macro.

### Play a macro

1. Open a file or a new VSCode window.
2. Execute `HackerTyper: Play Macro` command from the command palette (or `Cmd+Shift+T P`).
3. Choose your previously saved macro.
4. The active workspace will be reset to the contents of the macro's starting point. If there is no active text editor, a new anonymous unsaved file will be opened.
5. Start hammering your keyboard like a mad-person, or hit the '`' (backtick) key to play the macro back automatically.
You can toggle in or out of autoplay mode at any time.
6. WHOA HOW ARE YOU TYPING SO FAST
7. You can cancel play with `HackerTyper: Cancel Playing` (`Cmd+Shift+T X`).
8. Feel free to move around the file, highlight code etc. When you continue play, the next character will be inserted where you did while recording.
9. A low sound ("boop") is played when you reach the end of your macro. You must press `ENTER` to exit playback. 

### Stop points

While in recording mode, execute the `HackerTyper: Insert Stop Point` command from the command palette (or `Cmd+Shift+T I`).

When you hit a stop point in play mode, either manual or autoplay, a high sound ("beep") is played. You must press `ENTER` to break out of the stop point and continue playing. All other keystrokes are ignored until you break out.

You can turn off/on both beeps and boops by typing `Cmd+Shift+T T` (the `HackerTyper: Toggle Silence` command).

## Command summary

### Commands available in the IDLE state

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Record Macro` | Cmd+Shift+T R |
| `HackerTyper: Play Macro`   | Cmd+Shift+T P |
| `HackerTyper: Delete Macro` | Cmd+Shift+T D |
| `HackerTyper: Export Macro` | Cmd+Shift+T E |
| `HackerTyper: Import Macro` | Cmd+Shift+T M |

Export and Import were implemented by [Kael Kirk](https://github.com/Kaelinator). 

### Commands available in the RECORD state

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Insert Stop Point` | Cmd+Shift+T I |
| `HackerTyper: Undo Last Recorded Buffer` | Cmd+Shift+T U |
| `HackerTyper: Save or Discard Macro` | Cmd+Shift+T S |
| `HackerTyper: Cancel Recording` | Cmd+Shift+T C |

NOTE! The only ways to exit the recording state are `Cancel Recording` and `Save or Discard Macro`.

### Commands available in the PLAY state

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Cancel Playing` |  Cmd+Shift+T X |
| `HackerTyper: Toggle Silence` |  Cmd+Shift+T T |
| `toggle autoplay mode` |  ` (backtick) |

## Current limitations

- Only supports single file macros [#11](https://github.com/jevakallio/vscode-hacker-typer/issues/11)
- When starting from existing active editor, the document language is not restored from the macro (see [vscode#1800](https://github.com/Microsoft/vscode/issues/1800))

## License

MIT
