<div align="center">

<img src="https://raw.githubusercontent.com/rohanbeingsocial/showboard/main/assets/showboard-banner-dark.png" alt="Showboard" width="880" />

### Ask in your terminal. Get a dashboard on your screen.

</div>

Showboard is an **MCP server** that lets **Claude Code**, Codex, Cursor, Gemini CLI and other coding agents answer questions about your **SQL database**, or a folder of **Excel and CSV files**, with charts, tables and headline numbers: in your browser, inside your own app, or beside your terminal.

The agent writes a few read-only SQL queries and a short layout. Showboard runs the queries, picks a chart for each result, lays out the board and puts it on your screen. Every number comes from a query, one click away under its chart.

<img src="https://raw.githubusercontent.com/rohanbeingsocial/showboard/main/docs/images/hero.gif" alt="Claude Code in a terminal beside Showboard's page in a browser: asked for the best seller of 2026, Claude calls Showboard's draw tool and a board of headline numbers, a line chart and bar charts appears" width="100%" />

## Let your agent set it up

In your project, ask your coding agent:

> *Set up Showboard in this project: run `npx showboard guide` and follow it.*

The guide is written for the agent. It has the agent pick the path that fits the project (spreadsheets, a database, or your own app), run the commands, and check its own work with `npx showboard doctor`. `doctor` starts Showboard the way each agent will and says how to fix anything that fails.

## Or by hand

You need Node.js 22.13 or later.

**A folder of spreadsheets, or a database:**

```bash
npx showboard init ./reports                 # .xlsx, .xlsm, .csv, .tsv files or folders of them
npx showboard init --db ./shop.sqlite        # or a Postgres URL (or set SHOWBOARD_DB)
npx showboard doctor                         # checks the setup
```

Restart your agent in that folder, then open http://localhost:4710, or run `npx showboard pane` in a terminal beside the agent. `init` writes the settings for Claude Code, plus any agent the folder already has settings for. To name others, pass `--agent codex,opencode,bharatcode,gemini,cursor,vscode` (or `all`).

**Inside your own app** (React 19):

```bash
npm install showboard zod
```

```ts
// server: mount the handler. Next.js, Express, Hono and node:http are in the guide.
import { createShowboard } from "showboard/server";

const showboard = await createShowboard({ db: process.env.DATABASE_URL, boardsDir: ".showboard/boards" });
const handle = showboard.handler({ basePath: "/showboard" });   // (req: Request) => Promise<Response>
```

```tsx
// page: where boards appear
import { Board, ShowboardProvider } from "showboard/react";
import "showboard/styles.css";

<ShowboardProvider url="/showboard">
  <Board />
</ShowboardProvider>;
```

Then point the agents at it: `npx showboard init --url http://localhost:3000/showboard`.

## Commands

| Command | What it does |
| --- | --- |
| `showboard guide` | Setup steps for a coding agent |
| `showboard init` | Adds Showboard to each agent's settings in this folder |
| `showboard doctor` | Checks the setup the way each agent will meet it, with fixes |
| `showboard mcp` | The MCP server the agent starts |
| `showboard serve` | Showboard's own board page, on its own |
| `showboard pane` | The boards as text, in a terminal beside the agent |

## Safe by design

- Postgres queries run in a `READ ONLY` transaction, with a time and row limit. SQLite files are opened read-only, and spreadsheets are only read.
- Only `SELECT` is accepted.
- In your app, the agent can run only the actions you register, each checked against its input schema.
- The handler answers only `localhost`, and refuses requests from other websites.

## More

- [README](https://github.com/rohanbeingsocial/showboard#readme): the benchmark, how it works, and examples.
- [SETUP.md](https://github.com/rohanbeingsocial/showboard/blob/main/SETUP.md): the agent's setup guide.
- [Reference](https://github.com/rohanbeingsocial/showboard/blob/main/docs/reference.md): every option, tool, command and route.

MIT licensed. Built with help from AI coding agents, mostly Claude Code.
