# Evaluate Showboard

[Documentation](README.md) · [Product overview](../README.md)

[Why Showboard](#why-showboard) · [Benchmark](#benchmark) · [How it works](#how-it-works) · [Features](#features) · [Safety](#safety) · [Limits](#limits) · [FAQ](#faq) · [Roadmap](#roadmap)

## Why Showboard

Ask a coding agent for a chart of your data and watch what it does. It writes Python to read your files and work out the numbers, checks the results over several steps, then writes an HTML page, chart code and all. It gets there, but every answer is a small software project, paid for in tokens and minutes, and the numbers live in code you have to read to trust.

Showboard gives the agent a shorter path. The agent writes a few SQL queries and a short layout. Showboard runs the queries read-only, picks a chart for each result, lays out the board and puts it on your screen.

| | Claude Code on its own | Claude Code + Showboard |
| --- | --- | --- |
| **You get** | Paragraphs, or an HTML file it wrote | A board of charts, tables, headline numbers and notes |
| **You see it** | In the terminal, or in a file you open | In your browser, inside your app, or beside your terminal |
| **The numbers come from** | Python it wrote and ran | Read-only SQL, one click away under every chart |
| **24 answers, measured** | $4.77 and 24.3 minutes | **$1.78 and 7.5 minutes** |

## Benchmark

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../docs/images/benchmark-dark.png" />
    <img src="../docs/images/benchmark-light.png" alt="Bar chart, lower is better. Cost: $4.77 for Claude Code alone against $1.78 with Showboard, 2.7× cheaper. Output tokens: 128,929 against 36,659, 3.5× fewer. Time: 24.3 minutes against 7.5, 3.2× faster" width="880" />
  </picture>
</p>

Five questions about the sample spreadsheets (one with a follow-up), each asked four times over two runs: 24 answers each way, in Claude Code with Opus 5.5 at medium effort. On its own, Claude worked the numbers out in Python, then wrote an HTML page of charts. With Showboard, it wrote SQL and a short layout.

- **2.7× cheaper:** $1.78 against $4.77, at API list price. On Pro and Max plans the same tokens count against your usage limit instead.
- **3.5× fewer output tokens:** 36,659 against 128,929, and 2.3× fewer new input tokens (99,200 against 231,443).
- **3.2× faster:** 7.5 minutes against 24.3.
- **Cheaper on all 24 answers,** by 1.6× to 4.4×, with the same figures both ways.

Most of what an answer costs is steps, because each step re-reads the whole conversation. On its own, Claude writes the analysis as code, checks it over several turns, then writes the page. With Showboard, a board is one call, and a board worth repeating becomes a recipe. In the [demo shop](getting-started.md#try-the-demo), at API list prices, *"Top 5 products of 2025"* was one `recipe` call ($0.26), and *"Each channel's revenue by quarter, 2025 vs 2026"* one `draw` call ($0.37) that saved itself as a recipe.

To be fair to the other side: the pages Claude wrote on its own were more designed, each made to measure, where Showboard's boards are plainer and consistent. This is two runs on one dataset, and other agents have not been measured yet. The questions, every turn's results and how to rerun it on your own files are in [bench/](../bench/README.md).

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/architecture-dark.png" />
  <img src="../docs/images/architecture.png" alt="How a question becomes a board. You ask your agent (Claude Code, Codex, Cursor, Gemini CLI) a question. The agent sends SQL to Showboard over MCP. Showboard, on your computer, runs it read-only against your data (Postgres, SQLite, Excel, CSV) and gets rows back, picks the charts and sends the board live to your screen: a browser, your React app or a terminal pane. The rows also go back to the agent. You see the board, and every chart can show its SQL" width="880" />
</picture>

1. **You ask** your agent a question, like *"Which regions are behind their 2026 targets?"*
2. **The agent calls Showboard** over MCP: a saved recipe if one fits, or `draw` with one SQL query per chart.
3. **Showboard draws the board.** It runs each query read-only, picks a chart from the shape of each result and lays out the board.
4. **The board appears** on your screen and joins the saved boards. The agent gets the rows back, so it can check what it tells you.

The agent never types a figure into a chart: every number comes from a query, and every chart can show its SQL. Think of Showboard as a pen for your agent, with two limits on purpose: in your app it draws only where you give it room, and it acts only through the actions you register, never by clicking around your screen.

For the full picture, with where each part lives in the code, see [How Showboard works](../docs/architecture.md).

## Features

- **Read-only by design.** Postgres queries run in a `READ ONLY` transaction with a time and row limit; SQLite files and spreadsheets are opened read-only.
- **Charts picked from the data.** Dates become lines, labels become bars, a single row becomes headline numbers, anything else a table. The agent can still choose every chart itself.
- **One call per board.** `draw` fetches and lays out a whole board, with notes, side-by-side rows and titled sections, in a single tool call.
- **Recipes.** A board worth repeating becomes a one-call recipe with parameters. Your app ships its own, and the agent saves new ones.
- **Show sources.** Every chart, table and number can show the query behind it.
- **Messy spreadsheets welcome.** Title rows, "Total" rows, `N/A`, amounts typed as text and text dates are all handled.
- **Your app, your components.** Boards can use your own React components and run your app's actions, and the agent can see what is on screen.
- **Any MCP agent.** `showboard init --agent` writes the settings for Claude Code, Codex, OpenCode, BharatCode, Gemini CLI, Cursor, VS Code, Antigravity and Windsurf.
- **A pane beside the terminal.** `showboard pane` for any agent. In Claude Code, one plugin install brings the server and a pane beside the chat.
- **A cheaper model for new boards.** In Claude Code, a `board-builder` agent on Sonnet builds new kinds of board in its own small context.
- **No extra API key.** It runs on the agent you already use.

## Safety

Your agent can read your data. It cannot change it, and in your app it can do only what you let it.

- **Postgres:** each query runs in a `READ ONLY` transaction as a single statement, with a time limit (5 s) and a row limit (5,000).
- **SQLite:** the file is opened read-only, with the same row limit.
- **Spreadsheets:** loaded into an in-memory copy that refuses writes. Your files are only read.
- **SQL:** only `SELECT` (and `WITH … SELECT`, `VALUES`, `TABLE`) is accepted.
- **Actions:** the agent can run only the actions your app registers with `useShowboardAction`, each with an input your schema checks; it cannot click or type anywhere else.
- **HTTP:** the handler answers only `localhost` and `127.0.0.1`, and refuses requests from other sites' pages, so a website open in your browser cannot run the tools.

Use a read-only database role anyway.

## Limits

- **Notes are the agent's own words.** Charts, tables and headline numbers read their values from query results. A note is text the agent writes: it is told to quote only figures it has read, but its conclusions can still be wrong. In testing, Claude once named the wrong product as the units leader, because it had only queried the top 10 by revenue. Tick *Show sources* to check.
- **The pane draws charts as text.** Its braille lines and block bars carry the same figures, at a terminal's resolution; the board page has the full charts.
- **A board is a snapshot.** It keeps the rows it was drawn from, so opening it next week shows the numbers as they were then. Ask again, or run its recipe, for fresh ones.
- **Big results are cut.** A query keeps at most 5,000 rows, and a chart draws at most 6 lines, or 4 bars per label. The agent is told what was left out, so it can aggregate or filter in SQL.

## FAQ

<details>
<summary><b>Does my data leave my computer?</b></summary>

<br />

Showboard itself runs on your computer, answers only `localhost`, and sends nothing anywhere. The rows a query returns go to your agent, and so to the agent's model, like anything else your agent reads.

</details>

<details>
<summary><b>Do I need an API key?</b></summary>

<br />

No. Showboard runs on the coding agent you already use, with the login it already has. Putting Showboard in front of your customers is different: that needs a model API key.

</details>

<details>
<summary><b>Can the agent change my data, or click around my app?</b></summary>

<br />

No. Every query is read-only, and in your app the agent can run only the actions you register, with inputs your schema checks. See [Safety](#safety).

</details>

<details>
<summary><b>Does it work with agents other than Claude Code?</b></summary>

<br />

Yes, with any agent that speaks MCP. `showboard init --agent` writes the settings for Codex, OpenCode, BharatCode, Gemini CLI, Cursor, VS Code, Antigravity and Windsurf. Claude Code is the one tested end to end so far; see [Works with your agent](getting-started.md#works-with-your-agent).

</details>

## Roadmap

- [x] A pane beside the terminal: `showboard pane` for any agent, and a Claude Code mod
- [x] Settings for Codex, OpenCode, BharatCode, Gemini CLI, Cursor, VS Code, Antigravity and Windsurf
- [x] Publish to npm
- [ ] A leaner launch that trims Claude Code's fixed prompt, the biggest share of what a board costs
- [ ] A `board-builder` agent for the agents besides Claude Code that have subagents

