# Showboard for the Claude desktop app

A one-click extension (`.mcpb`) for the Claude desktop app. Ask about your spreadsheets or your database, and Claude answers with a board: headline numbers, charts, tables and notes, every figure from a read-only query. Boards open in your browser at http://localhost:4712.

## Install

1. Download `showboard-<version>.mcpb` from the [latest release](https://github.com/rohanbeingsocial/showboard/releases/latest).
2. In the Claude desktop app, open **Settings**, **Extensions**, **Advanced settings**, and under **Extension Developer** click **Install Extension…** and pick the file. (Opening the file with the app may also work.) Follow the prompts.
3. Set where your data is:
   - **Spreadsheet folder**: a folder of `.xlsx`, `.xlsm`, `.csv` or `.tsv` files. Each sheet becomes a table Claude can query.
   - **Database**: or a Postgres URL, such as `postgres://reader:secret@localhost:5432/shop`, or the full path of a SQLite file. It is used instead of the folder, and kept in your system's credential store. Give it a user that can only read.
4. Ask Claude a question about your data, such as *"Show me revenue by month."* Open http://localhost:4712 to see the board; Claude says so when no browser has it open.

To change the folder or database later: **Settings**, **Extensions**, then click Showboard.

The desktop app runs the extension on the Node.js it ships with, so you don't need to install Node.js. If you set the app to use your own Node.js instead, it must be 22.13 or later.

Claude Code has a plugin instead, with a pane beside the chat: see [plugins/claude-code](../claude-code).

## What it reads, writes and contacts

The extension is Showboard's MCP server, `showboard mcp --plugin claude-desktop --port 4712`, with everything it needs inside the `.mcpb` file. The desktop app starts it.

- **Reads** the folder or database you set, and only reads it: Postgres queries run in a `READ ONLY` transaction with a time and row limit, and SQLite files and spreadsheets are opened read-only.
- **Writes** the boards and recipes Claude saves, into `.showboard/claude-desktop/` in your home folder.
- **Serves** the board page and its tools on `http://127.0.0.1:4712`, on your computer only. It answers only `localhost` and `127.0.0.1`, and refuses tool calls from other websites open in your browser.
- **Contacts** your Postgres server, when you set one, and no other host. It has no telemetry.

### Privacy

Showboard collects nothing about you and sends nothing to its makers or anyone else. Your data stays on your computer: Claude reads the query results it asks for, as with any tool, and the boards are saved in your home folder.

## Building it

```bash
node plugins/claude-desktop/build.mjs   # from the repository root
```

It packs `packages/showboard` as this checkout has it, installs its runtime dependencies beside `manifest.json` and the icon, validates the manifest and writes `plugins/claude-desktop/build/showboard-<version>.mcpb`. `manifest.json`'s `version` must match the package's; bump both with each release.
