# Showboard pane for Claude Code

A Claude Code mod that keeps Showboard's boards in a pane beside the chat. Each board Claude draws (with `draw`, `recipe` or `show_board`) appears there as text: headline numbers, braille line charts, block bars, share bars, tables and notes, every figure read from the board's own data. Buttons on a board run your app's actions, as they do in the browser.

- **Opens by itself** when a board arrives and the terminal has room for a side pane; `/board` opens it anywhere.
- **Older / Newer** walks the saved boards; **Sources** shows the query under each part; **Open in browser** opens Showboard's page, when the server serves one.
- **Finds Showboard by itself**: the `showboard` server in this folder's `.mcp.json` (its `--url` or `--port`), else `http://127.0.0.1:4710`. Set the URL in `/config` for an app that mounts Showboard elsewhere, such as `http://127.0.0.1:3000/api/showboard`.

Other agents (Codex, OpenCode, Gemini CLI, …) get the same view from `showboard pane`, run in a terminal split beside them.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install showboard --marketplace rohanbeingsocial/showboard
```

Answer `y` to add the marketplace, press Enter for the user scope, and leave the Showboard URL empty unless your app mounts Showboard somewhere else. From a shell, `claude plugin install showboard --marketplace rohanbeingsocial/showboard` does the same. In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `rohanbeingsocial/showboard`, then **Add plugin**.

The pane shows what Showboard draws, so the project needs Showboard too: run `npx showboard init sales.xlsx` (or `--db <postgres-url | file.sqlite>`) in its folder, then ask Claude a question about the data. See the [quick start](https://github.com/rohanbeingsocial/showboard#quick-start).

## What it reads, sends and runs

The pane talks to one server: the Showboard you run. That is `http://127.0.0.1:4710` on your computer, unless this folder's `.mcp.json` starts Showboard with `--url` or `--port`, or you set another URL in `/config`, such as your own app's. It contacts no other host and has no telemetry.

- **Fetches**, from that server: `GET /health?pane=claude-code` every 2 seconds (which board is on screen), `GET /boards` and `GET /boards/<id>` (the boards it draws), and `POST /tools/describe_data` with the body `{}` (how numbers print).
- **Sends** data only when you press an action button on a board: `POST /tools/ui_act` with that button's action name and input, both taken from the board, so your app runs the action. Nothing from your conversation, your files or `.mcp.json` is sent.
- **Reads** this folder's `.mcp.json`, for Showboard's address alone.
- **Runs** no commands, processes or programs. **Open in browser** is a link to Showboard's page.

Its hooks:

- `session.start` adds `/board`, finds Showboard's address and starts the 2-second check.
- `command.run` answers `/board` and nothing else: it opens the pane and catches up.
- `tool.call` sees each tool call but reads only the tool's name. It passes every call on unchanged; after a call to Showboard's `draw`, `recipe` or `show_board` returns, it refreshes the pane. It sends nothing about the calls it sees, and if it fails, the call goes on as if it were not there.
- `ui.render` draws the pane.

### Privacy

The pane collects nothing about you and sends nothing to Showboard's makers or anyone else. It keeps the board on screen in the session's memory, and its only requests are the ones above, to the Showboard URL, which is on your computer unless you point it elsewhere.

## Developing it

```bash
node build.mjs                 # bundles ../../packages/showboard/src/text into hooks/board-text.js
claude plugin validate .
claude plugin test .
claude --plugin-dir .          # a session with the mod loaded
```

`hooks/board-text.js` is generated; change the renderer in `packages/showboard/src/text` and build again.
