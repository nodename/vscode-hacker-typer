# VSCode Hacker Typer

_Great for live coding presentations, impressing your friends, or just trying to look busy at work._

![Promotional video](docs/hackertyper-video.gif)

Hacker Typer allows you to record yourself programming, and to replay the same keystrokes by wildly mashing any key. Supports typing, editing, selections (including multicursor) and autocompletions. Basically, it looks like you have programming superpowers.

😳 **See it live in action: [Writing Code Like a Real Hacker - Reactivate X, London](https://www.youtube.com/watch?v=ulnC-SDBDKE)**

⬇️ **Download the extension from [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jevakallio.vscode-hacker-typer)**



**🗯 "This is Unix, I know this! Asdfkdhsur dueuekdnfh sueekgkvins dicodksbry"** — [@mwarger](https://twitter.com/mwarger)

## Features

- Record and replay **macros**.
- Insert stop points, so you don't accidentally overrun your talking point while live coding.

## How to use Hacker Typer

### Record a macro

1. Open a file or a new VSCode window.
2. Execute `HackerTyper: Record Macro` command (`Cmd+Shift+T R`) from the command palette.
3. The current content and selections of the active editor will be snapshotted.
4. Start typing code. Every keystroke is recorded into an in-memory buffer, including deletions, selection changes, etc.
5. If you make a mistake you can back up by typing `Cmd+Shift+T U` (the `Undo Last Recorded Buffer` command).
6. When you're ready, execute `HackerTyper: Save Macro` command from the command palette.
7. Give your macro a name.
8. You're done!

### Replay a macro

1. Open a file or a new VSCode window.
2. Execute `HackerTyper: Play Macro` command (`Cmd+Shift+T P`) from the command palette.
3. Pick your previously saved macro.
4. The active workspace will be reset to the initial starting point from the beginning of the recording. If there is no active text editor, a new anonymous unsaved file will be opened.
5. Start hammering your keyboard like a mad-person.
6. WHOA HOW ARE YOU TYPING SO FAST
7. `Cmd+Shift+Backspace` (the `Erase Previous Frame` command) will move the buffer backwards. Any other key moves it forward.
8. Feel free to move around the file, highlight code etc. When you continue typing, the next character will be inserted where you did while recording.
9. A sound is played when you reach the end of your macro.

### Stop points

While in recording mode, execute the `HackerTyper: Insert Stop Point` command (`Cmd+Shift+T I`) from the command palette.

When you hit a stop point while in replay mode, you need to press `ENTER` to break out of the stop point. All other keystrokes are ignored until you break out.

NB: A stop point is _AUTOMATICALLY_ added at the end of your recording.

## Command summary

### Top-level commands

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Record Macro` | Cmd+Shift+T R |
| `HackerTyper: Play Macro` | Cmd+Shift+T P |
| `HackerTyper: Delete Macro` | Cmd+Shift+T D | |

### Recording commands

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Insert Stop Point` | Cmd+Shift+T I |
| `HackerTyper: Undo Last Recorded Buffer` | Cmd+Shift+T U |
| `HackerTyper: Save Macro` | Cmd+Shift+T S |

### Replay commands

| Command | Key Binding |
|-----------|:-----------:|
| `HackerTyper: Erase Previous Frame` |  Cmd+Shift+Backspace |

## Current limitations

- Only supports single file macros [#11](https://github.com/jevakallio/vscode-hacker-typer/issues/11)
- When starting from existing active editor, the document language is not restored from the macro (see [vscode#1800](https://github.com/Microsoft/vscode/issues/1800))

## License

MIT
