<img src="../assets/showboard-lockup.png" alt="showboard" width="210" />

# How Showboard works

What happens between a question in your terminal and a board on your screen, and where each part lives in the code. The [README](../README.md) covers what Showboard is and how to start; the [reference](reference.md) covers every option, tool and command.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-full-dark.png" />
  <img src="images/architecture-full.png" alt="Showboard's architecture. You ask your coding agent (Claude Code, Codex, Cursor, Gemini CLI) a question. The agent makes a tool call over MCP to Showboard, which runs on your computer and answers only localhost. Inside Showboard, in order: 1, the tools the agent can call (draw, recipe, describe_data and more), which also reach the saved boards; 2, a safety check (one SELECT, read-only, 5 seconds, 5,000 rows); 3, run the queries against your data (a Postgres database, a SQLite file, an Excel and CSV folder or your app's own API), and the rows go back to the agent so it can check; 4, pick a chart from the rows (dates make a line, labels make bars, else a table); 5, save the board and stream it live to Showboard's page, your React app or a terminal pane, where you see it" width="880" />
</picture>

Orange lines are the path of your question. Grey lines are data coming back.

- [One question, start to finish](#one-question-start-to-finish)
- [The parts](#the-parts)
- [How the agent reaches Showboard](#how-the-agent-reaches-showboard)
- [Why it is built this way](#why-it-is-built-this-way)

## One question, start to finish

Say you ask *"Which regions are behind their 2026 targets?"*

1. **You ask your agent**, in the terminal. Claude Code (or Codex, Cursor…) started Showboard when the session began, so it already has Showboard's tools.
2. **The agent looks at your data.** It calls `describe_data` to see the tables, columns, spreadsheets and app sources.
3. **The agent asks Showboard to draw.** One `draw` call: a title and one SQL query per chart. If a saved recipe already fits, it calls `recipe` instead and fills in the values.
4. **Showboard checks and runs each query.** Only a single `SELECT` runs. Postgres runs it in a `READ ONLY` transaction with a 5-second limit; a SQLite file is opened read-only; spreadsheets are loaded into an in-memory copy that refuses writes. At most 5,000 rows come back.
5. **Showboard picks the charts.** Dates with numbers make a line, a few labels with numbers make bars, one row makes headline numbers, anything else makes a table. Rows like (date, name, value) get one line per name. The agent can override any of it. See [How a chart is picked](reference.md#how-a-chart-is-picked).
6. **The board appears, and the agent gets the rows.** Showboard checks the board, saves it and streams it to every open screen. The agent gets the same rows back, so what it tells you matches the chart. *Show sources* opens the SQL under any chart.

## The parts

Paths are under `packages/showboard/src/` unless they say otherwise.

| Part | What it does | Code |
| --- | --- | --- |
| The bridge to your agent | The agent starts `showboard mcp` and speaks MCP to it over stdin and stdout. See [below](#how-the-agent-reaches-showboard). | `cli/mcp.ts`, `cli/plugin.ts`, `cli/main.ts` |
| The tools | What the agent may do: `describe_data`, `draw`, `recipe`, `query_data`, `use_source`, `show_board`, `list_boards`. Inside your own app, also `get_screen` and `ui_act`. | `server/tools.ts`, `server/recipes.ts` |
| The data readers | Postgres (through `pg`) and SQLite (Node's built-in `node:sqlite`), both read-only. Excel and CSV files are loaded into an in-memory SQLite database, which is why plain SQL works on a folder of spreadsheets. | `server/db.ts`, `server/files.ts`, `server/sheets.ts` |
| The chart picker | Turns each query's rows into a chart, a table or headline numbers, and long rows into one line per name. | `server/auto.ts`, `server/items.ts` |
| The board format | A board is a [json-render](https://github.com/vercel-labs/json-render) spec: which components, in what order, reading which datasets. It is checked before it is shown. | `spec/catalog.ts`, `spec/validate.ts`, `spec/format.ts` |
| The board store | Keeps each board with its rows in a folder (up to 200), so it shows the same numbers next week. Datasets live in memory for the session. | `server/store.ts` |
| The hub | The local web server. Browser tabs hold an event stream open and get each board as it is drawn; the Claude Code pane polls every 2 seconds. In your app, the agent's requests go to the tab you looked at last. | `server/hub.ts`, `server/http.ts`, `server/node.ts` |
| The screens | Showboard's own board page, the `Board` component for your React app, and boards drawn as text for a terminal pane. | `viewer/`, `react/`, `text/`, `plugins/claude-code/` |

## How the agent reaches Showboard

Your agent's settings start `showboard mcp`, and the agent talks to it over stdin and stdout. That process then does one of three things:

- **Serves on its own.** It opens your data, serves the board page on a local port and runs the tools itself. This is the usual case: `showboard init` sets it up on port 4710, the Claude Code plugin uses 4711 and the Claude desktop extension 4712.
- **Joins one already running.** If a Showboard already answers on that port, from another session or `showboard serve`, it forwards the tool calls there, so both agents draw on the same page.
- **Forwards to your app.** With `--url`, it forwards to a Showboard your own server mounts with `handler()`. The agent then also gets your app's sources, actions and components.

The server answers only `localhost` and `127.0.0.1`, and refuses requests from other sites' pages, so a website open in your browser cannot call the tools.

## Why it is built this way

- **The numbers can be trusted.** The agent never types a figure into a chart. Charts, tables and headline numbers read query results, and each one can show its SQL. Only notes are the agent's own words.
- **It is cheaper and faster.** The agent sends a short `draw` call instead of writing Python and an HTML page. On the same 5 questions it cost $1.78 against $4.77 and took 7.5 minutes against 24.3. See the [benchmark](../bench/README.md).
- **It cannot change anything.** Queries are read-only, one `SELECT` at a time, with time and row limits. In your app, the agent runs only the actions you register. See [Safety](../README.md#safety).
