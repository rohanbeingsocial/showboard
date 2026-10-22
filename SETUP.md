# Set up Showboard: steps for a coding agent

You are a coding agent, setting up Showboard in the user's project. Showboard gives you MCP tools that draw boards (charts, tables, headline numbers, notes) from the user's data, read-only, on a web page or in a terminal pane. Do every step yourself. Ask the user only where a step says to.

**How to run Showboard.** `showboard` below means one of these:

- **From npm**, the usual way: `npx -y showboard`.
- **From a checkout of this repository**, only to try unreleased changes: `node <checkout>/packages/showboard/dist/cli/main.js`. Get one with `git clone https://github.com/rohanbeingsocial/showboard`, then run `npm install` and `npm run build` in it.

`showboard guide` prints these steps with the right command filled in. `showboard --help` lists every command and option.

## 1. Check the machine

Run `node --version`. It must be **22.13 or later**: Showboard reads spreadsheets and SQLite files with Node's built-in `node:sqlite`. If it is older, stop and tell the user to install a current Node.js.

## 2. Pick the path

Look at the project before asking anything. Take the first row that fits.

| The project has | Path |
| --- | --- |
| A web app with a **React 19** front end that the user wants boards inside, next to their own pages | **C. Their app** |
| A database: a SQLite file, or a Postgres URL in `.env` or the app's config | **B. A database** |
| Spreadsheets: `.xlsx`, `.xlsm`, `.csv`, `.tsv` | **A. Spreadsheets** |

Ask only when the choice matters to the user. For example, an app plus "I just want answers about my data": B is quicker and changes none of their code, so recommend B unless they want boards inside the app. With React 18 or older, C is out: use B and tell the user why.

Every path ends with `showboard init`, which writes the MCP server entry into each coding agent's settings in this folder. With no `--agent`, it sets up Claude Code plus any agent the folder already has settings for. To name agents, pass `--agent claude,codex,opencode,bharatcode,gemini,cursor,vscode`, or `all`. OpenCode and BharatCode (a fork of OpenCode) read the same `opencode.json`, so one entry serves both. The user-wide `antigravity` and `windsurf` are written only when named.

### A. Spreadsheets

```bash
showboard init <files or folders>        # e.g. showboard init data    or    showboard init "Sales 2026.xlsx" targets.csv
```

`init` takes the files as arguments and writes each into the entry as `--file`. Each sheet becomes a table you can query and join. Title rows, blank rows, "Total" rows, numbers typed as text and text dates are handled. The files are only read, and they reload when saved.

Amounts print in the currency the files are written in (₹1,200 → rupees), and `doctor` reports the currency it found. If it found none, or the wrong one, rerun `init` with `--currency INR --locale en-IN` (any ISO code).

### B. A database

```bash
showboard init --db ./data/app.sqlite               # SQLite: the file's path
showboard init --db postgres://localhost/shop       # Postgres, a local database with no password in the URL
```

- **SQLite:** give the file's path. Prisma's `file:./dev.db` is relative to the `prisma/` folder, so pass `prisma/dev.db`.
- **Postgres with a password:** keep it out of the settings files, which are often committed. Run `showboard init` with no `--db`, and have the user set `SHOWBOARD_DB` to the URL in the environment the agent starts from.
- Showboard runs every query read-only. Suggest a read-only database role anyway.

### C. Their app

Three parts:
- the app's server mounts Showboard's handler;
- a page renders the boards;
- the agents' settings point at the app.

**1. Install** in the app: `npm install showboard zod` (Postgres support comes with it). Showboard needs React 19 and zod 4; if npm reports a conflict with the app's React or zod, stop and tell the user. To use a checkout instead, run `npm pack` in `<checkout>/packages/showboard`. It writes `showboard-<version>.tgz` there (the checkout's git ignores it). Then, in the app, run `npm install <checkout>/packages/showboard/showboard-<version>.tgz zod`.

**2. Server.** Create one Showboard when the server starts and mount its handler at a path. The data comes from:
- `db`: the app's database URL, or a SQLite file;
- `files`: spreadsheets;
- `sources`: rows the app computes. See [docs/reference.md](docs/reference.md#sources).

`boardsDir` keeps boards across restarts.

**Next.js (App Router).** No `next.config` change is needed. Put `lib/showboard.ts` at the project root, next to `app/` (in `src/lib/` if the app keeps its code in `src/`).

```ts
// lib/showboard.ts
import { createShowboard } from "showboard/server";

// One Showboard for the life of the server. Next.js reloads modules in development, and a second
// copy would hold boards the browser's stream never sees.
const shared = globalThis as typeof globalThis & { showboard?: Promise<(req: Request) => Promise<Response>> };

export function showboardHandler(): Promise<(req: Request) => Promise<Response>> {
  shared.showboard ??= createShowboard({
    db: process.env.DATABASE_URL,          // a Postgres URL or a SQLite file path
    boardsDir: ".showboard/boards",
  }).then((showboard) => showboard.handler({ basePath: "/api/showboard" }));
  return shared.showboard;
}
```

```ts
// app/api/showboard/[...path]/route.ts
import { showboardHandler } from "@/lib/showboard"; // without "@/*" in tsconfig.json's paths: "../../../../lib/showboard"

async function handle(req: Request): Promise<Response> {
  return (await showboardHandler())(req);
}

export { handle as GET, handle as POST, handle as OPTIONS };
```

**Express.** Mount Showboard before any body parser, because it reads the request body itself.

```js
import express from "express";
import { createShowboard, toNodeListener } from "showboard/server";

const showboard = await createShowboard({ db: process.env.DATABASE_URL, boardsDir: ".showboard/boards" });
const app = express();
app.use("/showboard", toNodeListener(showboard.handler({ basePath: "/showboard" })));
app.use(express.json());
```

**Hono** (on Node, with `@hono/node-server`):

```js
import { createShowboard } from "showboard/server";

const showboard = await createShowboard({ db: process.env.DATABASE_URL, boardsDir: ".showboard/boards" });
const handle = showboard.handler({ basePath: "/showboard" });
app.all("/showboard/*", (c) => handle(c.req.raw));
```

**node:http:**

```js
import { createServer } from "node:http";
import { createShowboard, toNodeListener } from "showboard/server";

const showboard = await createShowboard({ db: process.env.DATABASE_URL, boardsDir: ".showboard/boards" });
const showboardListener = toNodeListener(showboard.handler({ basePath: "/showboard" }));
createServer((req, res) => {
  if (req.url?.startsWith("/showboard/")) return void showboardListener(req, res);
  // …the app's own routes
});
```

**Any other Node server:** if it hands you a fetch `Request`, pass it to the handler and return its `Response`, as in Hono. If it hands you Node's `req` and `res`, use `toNodeListener`, as in Express. `basePath` must be the path you mount at. The handler answers only `localhost` and `127.0.0.1`, and refuses requests from other websites; it is for the user's own machine.

**3. Page.** Put `ShowboardProvider` above the pages that use Showboard, and `<Board />` where boards should appear. In Next.js this is a client component:

```tsx
"use client";

import { Board, BoardList, ShowboardProvider } from "showboard/react";
import "showboard/styles.css";

export default function BoardPage() {
  return (
    <ShowboardProvider url="/api/showboard">
      <Board />          {/* the board drawn last */}
      <BoardList />      {/* saved boards; optional */}
    </ShowboardProvider>
  );
}
```

- Link the page from the app's navigation, so the user can find it.
- `url` is where the handler is mounted.
- When the front end runs on its own dev server (Vite on :5173, the API on :3000), use the API's full URL: `url="http://localhost:3000/showboard"`. Any localhost origin is allowed.
- To let the agent see and act on every page, put the provider in the app's root component instead, and pass `onBoard={() => navigate("/board")}` so a new board opens its page.
- For the dark palette, pass `className="sb-dark"` to `<Board />`.
- The app's own actions (`useShowboardAction`), screen state (`useShowboardState`) and components can follow later. See [docs/reference.md](docs/reference.md#browser).

**4. Agent settings**, pointing at where the app mounts Showboard. `init` only writes settings, so the app can be down; `doctor` needs it running.

```bash
showboard init --url http://localhost:3000/api/showboard
```

## 3. Check

```bash
showboard doctor            # add --json to read the report in code
```

`doctor` checks each agent's settings and starts each Showboard entry the way that agent will. It then makes the agent's first calls over MCP: the handshake, the tool list, and `describe_data`, which lists the tables. Every failure prints a `Fix:` line. Do what it says and run `doctor` again until it passes; it exits 1 while anything is left to fix. In path C the app must be running.

`doctor` can't check two things:
- The user still has to approve or trust the server in the agent (step 4).
- New tools load only when the agent starts, so you cannot call them in this session.

## 4. Tell the user

Pass on what `doctor` prints under **Next**:
1. **Restart the agent in this folder.** Claude Code asks to approve the `showboard` server; Codex and Gemini CLI read project settings only in a folder the user trusts; BharatCode needs the user signed in (`bharatcode auth login`).
2. **Where boards appear:**
   - Paths A and B: at http://localhost:4710 (or the `--port` given), or in a terminal beside the agent with `showboard pane`.
   - Path C: on the page with `<Board />`.
3. **Something to ask**, e.g. *"What's in my data? Draw me a board of it."*

Don't say it works inside the agent until the user has restarted it and a board has appeared.

## Things to get right

- **Add `.showboard/` to `.gitignore`**, in every path, and create the file if there is none. Saved boards and the recipes you save live there, and boards hold query results.
- **Settings that start a checkout name a path on this machine** (`.mcp.json` and the rest). Don't commit them for a team; entries written from an npm install (`npx -y showboard …`) are safe to share.
- **One port per project.** Paths A and B serve on 4710. If another project already uses it, `doctor` says so: rerun `init` with `--port 4711` (or any free port) for every agent.
- **Rerunning `init`** replaces Showboard's own entry and keeps the other servers in each settings file. A settings file with comments is left alone, and `init` prints the entry to add by hand.
- **The board-builder agent.** For Claude Code, `init` also writes `.claude/agents/board-builder.md`. It builds new kinds of boards on Sonnet, a cheaper model, in a small context of its own (`--agent-model` on `init`, or `model:` in the file, changes it). Keep it.

## When something fails

| What you see | What to do |
| --- | --- |
| The agent lists no `showboard` tools | Restart the agent in this folder; approve or trust the server; run `doctor` |
| `doctor`: "Port 4710 is taken" | Rerun `init` with `--port <free port>` for every agent |
| `doctor`: "the entry starts …main.js, which does not exist" | The checkout moved or isn't built: build it, or rerun `init` from where it is |
| `doctor`: "nothing answers at …/health" (path C) | The handler isn't mounted at that URL, or `basePath` differs from the mount path |
| The page stays on "Connecting to Showboard…" | The provider's `url` doesn't reach the handler: open `<url>/health` in the browser, which should show `{"ok":true,…}` |
| `draw` answers `shown: false` | No page or pane is open. The board is saved and appears when one opens |
| Amounts print in the wrong currency | `--currency` and `--locale` on `init` (paths A and B); `format` on `ShowboardProvider` (path C) |
