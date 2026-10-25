# Setup and agent compatibility

[Documentation](README.md) · [Product overview](../README.md)

[Quick start](#quick-start) · [Beside your terminal](#beside-your-terminal) · [Works with your agent](#works-with-your-agent)

## Quick start

You need Node.js 22.13 or later and a coding agent. The demo uses Claude Code. Showboard is on npm as [`showboard`](https://www.npmjs.com/package/showboard).

### Claude Code: install the plugin

At the prompt of a Claude Code terminal session:

```text
/plugin install showboard --marketplace rohanbeingsocial/showboard
```

When it asks, set **Data** to a folder of spreadsheets, one spreadsheet or a SQLite file (or **Database URL** to a Postgres URL), then ask Claude about your data. Boards appear in a pane beside the chat and at http://localhost:4711, in every project. A project where you ran `showboard init` keeps its own. See [plugins/claude-code](../plugins/claude-code).

### Claude desktop app: install the extension

Download `showboard-<version>.mcpb` from the [latest release](https://github.com/rohanbeingsocial/showboard/releases/latest) and install it in **Settings**, **Extensions**, **Advanced settings**, **Install Extension…**. Pick your spreadsheet folder (or give a database) when it asks, and boards open at http://localhost:4712. No Node.js needed: the app brings its own. See [plugins/claude-desktop](../plugins/claude-desktop).

### Let your agent set it up

In your project, ask your coding agent:

> *Set up Showboard in this project: run `npx showboard guide` and follow it.*

The guide ([SETUP.md](../SETUP.md)) has the agent pick the path that fits the project: spreadsheets, a database, or your own app (with server code for Next.js, Express, Hono and `node:http`). The agent then checks its own work with `showboard doctor`, which starts Showboard the way each agent will and says how to fix anything that fails.

### Try the demo

A small furniture shop's admin app, with its orders in SQLite:

```bash
git clone https://github.com/rohanbeingsocial/showboard.git
cd showboard
npm install
npm run demo        # builds, seeds the shop's database and serves http://localhost:4710
```

Open http://localhost:4710, then start Claude Code in the demo's folder from a second terminal:

```bash
cd examples/sales-demo
claude              # the .mcp.json here connects Claude Code to the demo
```

Approve the folder's `showboard` server when Claude Code asks, then try:

- *"Show me my best seller of 2026, and how it compares with last year."*
- *"Top 5 products of 2025."* This one is a recipe the demo ships, so the board takes a single tool call.
- *"Open the Aero Standing Desk's orders from October."* Claude runs the shop's own Orders filter.

### Your spreadsheets

```bash
cd my-reports          # a folder of .xlsx, .xlsm, .csv or .tsv files
npx showboard init .   # Claude Code; --agent codex,cursor,gemini… for others
claude                 # then open http://localhost:4710, or run: npx showboard pane
```

Each sheet becomes a table the agent can query and join. Loading copes with the usual mess: title rows above the header, blank rows, "Total" rows (skipped, so sums do not double count), `N/A` in number columns, `₹1,23,456` and `$1,234.50` typed as text, Excel dates, and `15-Mar-2026` or `25/04/2026` text dates. Amounts print in the files' own currency, ₹ in lakh and crore for rupee sheets. Your files are only read, and they reload when you save them. To try it on sample files: `cd examples/spreadsheets`, run `claude` and open http://localhost:4720.

### A database, no app

```bash
npx showboard init --db ./shop.sqlite   # a SQLite file or a Postgres URL
claude                                  # boards appear at http://localhost:4710
```

A Postgres URL with a password is better kept out of the settings files: leave `--db` out, and set `SHOWBOARD_DB` in your environment before you start your agent.

### Your own app

Mount Showboard in your Node server and React pages: see [Put boards in your own app](integration.md#put-boards-in-your-own-app).

## Beside your terminal

<p align="center">
  <img src="../docs/images/pane.png" alt="showboard pane in a terminal: a board titled Revenue by channel, 2025, with headline revenue and orders, a braille line chart per sales channel, block bars by category, a stacked share bar, a table of top products and a note" width="640" />
</p>

No browser needed: `showboard pane` draws each board as text in a terminal split beside your agent, and follows each new board as the agent draws it.

```bash
npx showboard pane                                         # Showboard on port 4710
npx showboard pane --url http://localhost:3000/showboard   # one your app mounts
```

Lines become braille, bars become blocks, shares become one stacked bar with a legend, and tables, notes and headline numbers print as they are, every figure read from the board's data. Keys: <kbd>←</kbd> <kbd>→</kbd> older and newer boards, <kbd>s</kbd> sources, <kbd>1</kbd>–<kbd>9</kbd> the board's buttons (they run in your app), <kbd>o</kbd> the browser, <kbd>q</kbd> quit. `--once` prints the board and exits.

In Claude Code, the same view sits beside the chat: the [plugin](../plugins/claude-code) brings it along with a Showboard of its own. It opens by itself when a board arrives and the terminal has room, and `/board` opens it anywhere. Install it at the prompt of a Claude Code terminal session:

```text
/plugin install showboard --marketplace rohanbeingsocial/showboard
```

## Works with your agent

Showboard is an MCP server, so any coding agent that speaks MCP can use it. `showboard init --agent <names>` writes the settings for each one you name (comma separated, or `all`); with no `--agent`, it sets up Claude Code plus any agent the folder already has settings for.

| Agent | `init` writes | Notes |
| --- | --- | --- |
| Claude Code | `.mcp.json` | Approve the server when Claude Code first asks. Also gets the `board-builder` agent. |
| Codex | `.codex/config.toml` | Codex reads it only in a trusted project. |
| OpenCode | `opencode.json` | `opencode mcp list` shows it connected. |
| BharatCode | `opencode.json` | A fork of OpenCode, so it reads the same entry. Sign in with `bharatcode auth login`; `bharatcode mcp list` shows it connected. |
| Gemini CLI | `.gemini/settings.json` | Trust the folder when Gemini CLI asks; `gemini mcp list` shows it connected. |
| Cursor | `.cursor/mcp.json` | Names the project folder with `--root`, since Cursor starts servers elsewhere. |
| VS Code | `.vscode/mcp.json` | Uses `${workspaceFolder}`; start it under MCP Servers, then use agent mode. |
| Antigravity | `~/.gemini/config/mcp_config.json` | User-wide, so the entry names the project folder. Named only on purpose: not part of `all`. |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | User-wide, like Antigravity. |

Boards have been drawn end to end in Claude Code. For the other agents, the settings `init` writes have been checked to load and connect, and the server answers their MCP requests; a live session in each is still to come.

