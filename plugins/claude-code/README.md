# Showboard for Claude Code

One install gives Claude Code Showboard's tools and a pane to show them in. Ask about your spreadsheets or your database, and Claude answers with a board: headline numbers, charts, tables and notes, every figure from a read-only query. The board appears in a pane beside the chat, drawn as text, and on Showboard's page in your browser.

- **Brings its own Showboard**: point it at a folder of spreadsheets, one spreadsheet, a SQLite file or a Postgres database, and every Claude Code session can draw from it. Nothing else to run.
- **Opens by itself** when a board arrives and the terminal has room for a side pane; `/board` opens it anywhere.
- **Older / Newer** walks the saved boards; **Sources** shows the query under each part; **Open in browser** opens the board page. Buttons on a board run your app's actions, as they do in the browser.
- **Keeps a project's own setup**: in a folder where you ran `showboard init`, that folder's Showboard serves and the plugin's steps aside.

Other agents (Codex, OpenCode, Gemini CLI, …) get the same view from `showboard pane`, run in a terminal split beside them.

## Install

You need Node.js 22.13 or later. At the prompt of a Claude Code terminal session:

```text
/plugin install showboard --marketplace rohanbeingsocial/showboard
```

Answer `y` to add the marketplace and press Enter for the user scope. Then set where your data is:

- **Data**: the full path of a folder of spreadsheets (.xlsx, .xlsm, .csv, .tsv), one spreadsheet, or a SQLite file, such as `C:\Users\you\Documents\reports` or `/Users/you/reports`.
- **Database URL**: a Postgres URL instead, such as `postgres://reader:secret@localhost:5432/shop`. It is kept in your system's credential store, not in a settings file. Give it a user that can only read.
- **Showboard URL**: leave it empty, unless an app of yours mounts Showboard, such as `http://127.0.0.1:3000/api/showboard`.

To change them later, run `/plugin`, open Showboard on the **Installed** tab and choose **Configure options**. Then ask Claude a question about your data, such as *"Show me revenue by month."* Boards also appear at http://localhost:4711.

From a shell, `claude plugin install showboard --marketplace rohanbeingsocial/showboard` installs it too. In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `rohanbeingsocial/showboard`, then **Add plugin**.

**One project only?** Leave Data empty and run `npx showboard init <files>` (or `--db <url>`) in that project's folder instead; see the [quick start](https://github.com/rohanbeingsocial/showboard#quick-start). The pane follows that project's Showboard.

## What it reads, sends and runs

**It runs one program**: Showboard's MCP server, `npx -y showboard@0.4.0 mcp --plugin claude-code --port 4711`, which Claude Code starts with each session. The version is pinned, so an update to the plugin is the only way a different version runs. On first start, `npx` downloads that package from the npm registry; after that it runs from npm's cache.

The server:

- **Reads** the data you set, and only reads it: Postgres queries run in a `READ ONLY` transaction with a time and row limit, and SQLite files and spreadsheets are opened read-only. It also reads this folder's `.mcp.json`, to step aside when the folder starts its own Showboard.
- **Writes** the boards and recipes Claude saves, into the plugin's data folder (`~/.claude/plugins/data/showboard-showboard/`).
- **Serves** its tools and the board page on `http://127.0.0.1:4711`, on your computer only. It answers only `localhost` and `127.0.0.1`, and refuses tool calls from other websites open in your browser.
- **Contacts** your Postgres server, when you set a Database URL, and no other host. It has no telemetry.

The pane talks to one server: the one in its Showboard URL setting; else the one this folder's `.mcp.json` starts (its `--url` or `--port`); else the plugin's own at `http://127.0.0.1:4711`, or a `showboard serve` at `http://127.0.0.1:4710`.

- **Fetches**, from that server: `GET /health?pane=claude-code` every 2 seconds (which board is on screen), `GET /boards` and `GET /boards/<id>` (the boards it draws), and `POST /tools/describe_data` with the body `{}` (how numbers print).
- **Sends** data only when you press an action button on a board: `POST /tools/ui_act` with that button's action name and input, both taken from the board, so your app runs the action. Nothing from your conversation, your files or `.mcp.json` is sent.
- **Reads** this folder's `.mcp.json`, for Showboard's address alone.
- **Runs** nothing itself. **Open in browser** is a link to Showboard's page.

Its hooks:

- `session.start` adds `/board`, finds Showboard's address and starts the 2-second check.
- `command.run` answers `/board` and nothing else: it opens the pane and catches up.
- `tool.call` sees each tool call but reads only the tool's name. It passes every call on unchanged; after a call to Showboard's `draw`, `recipe` or `show_board` returns, it refreshes the pane. It sends nothing about the calls it sees, and if it fails, the call goes on as if it were not there.
- `ui.render` draws the pane.

### Privacy

Showboard collects nothing about you and sends nothing to its makers or anyone else. Your data stays on your computer: Claude reads the query results it asks for, as with any tool, and the boards are saved in the plugin's data folder. The pane keeps the board on screen in the session's memory, and its only requests are the ones above, to a Showboard on your computer unless you point it elsewhere.

## Developing it

```bash
node build.mjs                 # bundles ../../packages/showboard/src/text into hooks/board-text.js
claude plugin validate .
claude plugin test .
claude --plugin-dir .          # a session with the plugin loaded
```

`hooks/board-text.js` is generated; change the renderer in `packages/showboard/src/text` and build again. `.mcp.json` pins the Showboard release the plugin starts: bump it with each npm release.
