<img src="../assets/showboard-lockup.png" alt="showboard" width="210" />

# Showboard reference

Every option, prop, tool and command. The [README](../README.md) covers what Showboard is and how to start.

- [Server](#server): `createShowboard`, the handler, sources, recipes
- [Browser](#browser): `ShowboardProvider`, `Board`, hooks, your own components
- [Boards](#boards): items, how a chart is picked, components, number formats, the long form
- [Tools](#tools): what the agent can call
- [Command line](#command-line): `serve`, `mcp`, `init`, `pane`; [Panes](#panes)
- [HTTP routes](#http-routes), [Limits and defaults](#limits-and-defaults), [Styling](#styling)

## Server

```ts
import { createShowboard, serve, toNodeListener } from "showboard/server";
```

### createShowboard(options)

Returns `Promise<Showboard>`. Give it `db` or `files` (not both), or neither when your app offers only `sources`.

| Option | Default | What it does |
|---|---|---|
| `db` | none | A Postgres URL (`postgres://…`, needs the `pg` package), a SQLite file path, `{ pool }` with your own `pg` Pool, or your own [`Database`](#your-own-database) |
| `files` | none | Excel (`.xlsx`, `.xlsm`), `.csv` and `.tsv` files, or folders of them, read as a database |
| `sources` | `[]` | Rows your app computes, offered to the agent by name ([Sources](#sources)) |
| `recipes` | `[]` | Boards your app ships ([Recipes](#recipes)); a bad one fails at start |
| `boardsDir` | in memory | Folder that keeps boards across restarts |
| `recipesDir` | `recipes` next to `boardsDir` | Folder for the recipes the agent saves; in memory without either |
| `maxRows` | `5000` | Rows kept per query |
| `timeoutMs` | `5000` | Time limit per query, in ms (Postgres) |
| `replyTimeoutMs` | `8000` | How long a tool waits for the browser to confirm a board or finish an action |
| `openHint` | none | Told to the agent when no browser has the page open, e.g. `"Ask the user to open http://localhost:3000/board."` |
| `format` | read from the data | `{ locale, currency }` for Showboard's own page. Spreadsheets set the currency from amounts like ₹1,200. Your app sets its format on `ShowboardProvider` |

### The Showboard object

| Member | What it is |
|---|---|
| `handler(options?)` | A fetch-style handler, `(req: Request) => Promise<Response>`, for the browser and the MCP bridge |
| `callTool(name, input)` | Runs a tool directly. Resolves to `{ ok, content }`, where `content` is the JSON text the agent would read |
| `tools` | The tool definitions |
| `db` | The open `Database`, or `null` |
| `close()` | Closes the database, and a Pool that Showboard opened itself (never yours) |

### handler(options)

| Option | Default | What it does |
|---|---|---|
| `basePath` | `""` | The path it is mounted at, e.g. `"/api/showboard"` |
| `isAllowedHost` | `localhost`, `127.0.0.1`, `[::1]` | Host headers it answers. This stops a web page from reaching it through a DNS name pointed at your machine |
| `isAllowedOrigin` | `http(s)://localhost`, `127.0.0.1` or `[::1]`, any port | Origins whose requests it accepts. Requests without an Origin (the MCP bridge) are allowed |
| `viewer` | `false` | Also serve Showboard's own board page at the root |

Widen `isAllowedHost` and `isAllowedOrigin` only behind real authentication. The routes are listed under [HTTP routes](#http-routes).

### serve and toNodeListener

```ts
const server = await serve(showboard.handler({ viewer: true }), { port: 4710 });   // listens on 127.0.0.1
```

`serve(handle, { port, host = "127.0.0.1" })` resolves to the `node:http` server. `toNodeListener(handle)` adapts the handler to `node:http`'s `(req, res)`. Express and Connect take it too (it reads Express's `req.originalUrl`); mount it before any body parser, which would consume the request body.

### Sources

Rows your app computes itself (an engine's output, another API), offered to the agent by name. The agent reads one with `use_source`, or names it in a `draw` part.

```ts
interface SourceDef<I extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;                 // written for the agent: what the rows are
  input?: I;                           // checked before run; describe_data shows it to the agent
  run(input: z.infer<I>): Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
}
```

Rows beyond `maxRows` are cut. A column counts as a number when its first non-empty value is a number.

### Recipes

```ts
interface Recipe {
  name: string;           // lowercase letters, digits and _, starting with a letter; up to 40
  about: string;          // one line for the agent
  title: string;          // may use {param}, e.g. "Top products of {year}"
  params?: Record<string, { about?: string; default?: ParamValue; example?: ParamValue }>;
  items: Item[];          // the same items draw takes (see Boards)
}
type ParamValue = string | number | null | (string | number)[];
```

- SQL takes values as `:name`. Each becomes the database's own placeholder (`$1` for Postgres, `?` for SQLite) and its value is sent separately, never pasted into the SQL. A list fills `IN (:names)` with one placeholder per value. Strings, quoted names, comments and Postgres `::` casts are left alone.
- A parameter without a `default` must be given. `example` shows the agent what to pass.
- A recipe's parts fetch their own rows (`sql` or `source`), never an existing `dataset`.
- The agent saves recipes with `draw`'s `save_as`, as JSON files in `recipesDir`. It cannot overwrite one of your app's recipes.

### Your own database

`db` also takes any object with this shape, for example to route queries through your own data layer:

```ts
interface Database {
  kind: "postgres" | "sqlite";          // sets the placeholder style ($1 or ?)
  describe(): Promise<TableInfo[]>;      // tables and columns, for describe_data
  query(sql: string, limits: QueryLimits, values?: (string | number | null)[]): Promise<QueryResult>;
  notes?(): string[];                    // problems worth telling the agent about
  currency?(): string | undefined;       // the data's currency, when known
  close(): Promise<void>;
}
// QueryLimits:  { maxRows: number; timeoutMs: number }
// QueryResult:  { columns: { name: string; type: string }[]; rows: Record<string, unknown>[]; truncated: boolean }
```

With the built-in Postgres access, `numeric` and `bigint` values arrive as numbers, and dates and timestamps as the text Postgres prints, so a chart never moves a date across time zones. `describe_data` lists every schema except the system ones and TimescaleDB's internals.

### Other exports

- `openDatabase(input)` and `openFiles(paths, { recheckMs })` open the same `Database` that `createShowboard` would.
- `cleanSql(sql)` throws unless the SQL is a single SELECT (or `WITH … SELECT`, `VALUES`, `TABLE`).
- `INSTRUCTIONS` is the text the MCP server gives the agent about when to use which tool. `builderAgent(server?, model?)` returns the Claude Code agent file `init` writes.
- Types: `Database`, `DatabaseInput`, `PgPoolLike`, `QueryLimits`, `QueryResult`, `TableInfo`, `FilesOptions`, `HttpOptions`, `ToolCallResult`, `Item`, `DataPart`, `NotePart`, `RowPart`, `SectionPart`, `View`, `Params`, `ParamValue`, `Recipe`, `SourceDef`, `ToolDef`.

`showboard/spec` holds what the server and the browser share: the component catalog (`BUILT_IN`), the number formats (`FORMATS`, `formatValue`) and the board checks (`checkBoard`).

`showboard/text` draws a board as text for a pane: `boardToText`, `INKS` and the `Block`, `Line` and `Span` types ([Panes](#panes)).

## Browser

```tsx
import { Board, BoardList, ShowboardProvider, useShowboard, useShowboardAction, useShowboardState, formatValue } from "showboard/react";
import "showboard/styles.css";
```

### ShowboardProvider

Connects the page to the handler and holds the board on screen. Put it above everything that uses Showboard.

| Prop | What it does |
|---|---|
| `url` | Where the handler is: `"/showboard"` when your server mounts it, or `"http://127.0.0.1:4710"` for `showboard serve` |
| `components` | Your own components that boards may use, as `Record<string, ShowboardComponent>` |
| `format` | How boards print numbers, e.g. `{ locale: "en-IN", currency: "INR" }`. Currency defaults to USD |
| `onBoard(board)` | Called when a board is shown, by the agent or from the board list. Use it to switch to the page that holds `<Board />` |

Pass `components` and `format` as stable objects (module constants, or `useMemo`): a new object redraws every board.

### Board

Draws a board: the one shown last, unless you pass one. Its header has the title, when it was drawn, and the *Show sources* switch, which puts the query behind each part under it.

| Prop | What it does |
|---|---|
| `board` | A board to draw instead of the latest |
| `empty` | What to show before anything is drawn |
| `className` | Classes on the board. `sb-dark` switches to the dark palette |

### BoardList

The saved boards, newest first. Clicking one shows it. Props: `className`, `limit` (default 30).

### useShowboard()

Returns `{ board, connected, openBoard(id), runAction(name, input), components, format, url }`, plus the functions the hooks below use. `connected` is whether the page's event stream to the server is open.

### useShowboardAction(action)

Lets the agent run something on the page with `ui_act`, for as long as the component is mounted. A board's `ActionButton` runs the same actions.

```ts
interface ShowboardAction<I extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;        // written for the agent: what it does and when to use it
  input?: I;                  // checked before run
  run(input: z.infer<I>): unknown | Promise<unknown>;   // the result goes back to the agent
}
```

The latest `run` is always used, so it can read fresh state. Keep `input` a module constant: a new schema object registers the action again.

### useShowboardState(key, value)

Publishes a JSON value under `key` (the page, the filters, the selection). `get_screen` shows the agent everything published, so it knows what you are looking at.

### ShowboardComponent

```ts
interface ShowboardComponent<P extends z.ZodObject> {
  description: string;        // written for the agent
  props: P;                   // checked before render
  render: ComponentType<{ props: z.infer<P>; datasets: Record<string, Dataset> }>;
}
```

The browser tells the agent about your components (`get_screen`), and checks the props of each one a board uses before it renders. To draw rows from a query, give the component a `dataset` prop: a `draw` part with `component` fills it in, and `render` finds the rows in `datasets[props.dataset].rows`.

### formatValue(value, format?, { locale?, currency? })

Prints a value the way boards do, for use in your own components.

## Boards

### Items

`draw` and recipes take a board as a list of items in reading order (1 to 12). Nesting goes at most section › row › part.

| Item | Shape |
|---|---|
| Data part | `{ title?, sql \| dataset \| source, input?, show?, x?, y?, series?, formats?, component?, props? }` |
| Note | `{ note, title?, tone? }`: the agent's text. Lines starting `- ` are bullets and `**bold**` works. `tone` is `plain`, `info`, `good`, `warn` or `bad` |
| Row | `{ row: [...] }`: 1 to 4 parts or notes, side by side |
| Section | `{ section, subtitle?, items: [...] }`: a titled group of rows, parts and notes |

A data part's fields:

| Field | What it does |
|---|---|
| `title` | The part's title; may use `{param}` |
| `sql` | One read-only SELECT. `:name` takes a value from `params` |
| `dataset` | Draws an existing dataset (from `query_data`, `use_source` or an earlier `draw`) |
| `source`, `input` | Rows from one of the app's sources |
| `show` | `auto` (the default), `line`, `bar`, `pie`, `metrics` or `table` |
| `x` | The column for the x axis or the labels |
| `y` | The measures for a chart or metrics, or the columns in order for a table |
| `series` | The column whose values each get their own line or bar |
| `formats` | A format per column, e.g. `{ "revenue": "currency", "change": "percent" }` |
| `component`, `props` | Draws with any component, built-in or the app's, instead; `dataset` is filled in |

A part takes one of `sql`, `dataset` and `source`. A part with a `component` and none of them is drawn from its props alone, for example your `ProductCard` for one SKU.

`draw` itself takes `title`, `items`, `params` (values for the `:name` placeholders; lists as arrays), `save_as: { name, about }` (keep the board as a recipe whose inputs are the params), `id` (replace that board instead of adding one) and `preview_rows` (0 to 50).

### How a chart is picked

When a part names neither `show` nor `component`, the shape of its rows decides:

1. No rows, or no number column: a table.
2. One row: headline numbers (up to 6).
3. A date column: a line chart.
4. A label column and at most 40 rows: a bar chart.
5. Anything else: a table (its first 12 columns).

Details:

- Dates are text like `2026-03`, `2026-03-01` or a full ISO timestamp.
- Number columns named `year`, `fy`, `quarter`, `qtr`, `month`, `week`, `day`, `period`, `rank` or `id`, or ending in `_year`, `_fy`, `_quarter`, `_month`, `_week` or `_id`, are labels, not values.
- Long rows, where x repeats once per value of another label column (`date, symbol, close`), become one line or bar per value, for 2 to 24 values. A chart shows up to 6 lines, or 4 bars per label, and the agent is told what was left out.
- A line chart shows up to 6 number columns and a bar chart up to 4.
- Bars turn horizontal past 8 rows, or when a label is longer than 14 characters.
- Fractions in columns named `share`, `attainment`, `fraction`, `of_target` or `of_total` print as percents, unless `formats` says otherwise.
- Table headings and metric labels are the column names made readable: `total_revenue` prints as "Total revenue".

### What draw returns

For the [README's example board](../README.md#put-boards-in-your-own-app) (under *More examples*):

```json
{
  "board": "b_57393139",
  "shown": true,
  "parts": [
    { "part": "\"By month\"", "drawn": "line", "dataset": "by_month", "rows": 10,
      "rows_read": [{ "month": "2026-01", "marketplace": 138, "store": 276, "web": 463 }, "…9 more rows"] },
    { "part": "\"Share\"", "drawn": "pie", "dataset": "share", "rows": 3, "rows_read": ["…3 rows"] }
  ],
  "recipe": "Saved as recipe channel_orders: next time it is one recipe call."
}
```

- A result of up to 12 rows comes back whole (`rows_read`). A longer one comes back as its `first` 3 rows (or `preview_rows`) and its `last`.
- `notes` says what a chart left out, and `truncated` that a query hit the row limit.
- If any part fails, nothing is drawn, and the reply lists the `problems` to fix.
- With no browser open, `shown` is `false` and a note says so. The board is saved and appears when the page opens.

### Components

Every board can use these. Your own components join them through `ShowboardProvider`.

| Component | Props | What it draws |
|---|---|---|
| `Grid` | `columns?` (1 to 4, default 2) | Its children side by side in equal columns, wrapping |
| `Section` | `title`, `subtitle?` | A titled group of children, stacked |
| `Metric` | `label`, `dataset`, `field`, `row?`, `format?`, `caption?` | One headline number from a dataset cell (row 0 unless `row` is set) |
| `LineChart` | `dataset`, `x`, `y` (1 to 6 columns), `title?`, `format?` | A line per `y` column |
| `BarChart` | `dataset`, `x`, `y` (1 to 4 columns), `title?`, `format?`, `horizontal?` | A bar per `y` column for each `x` |
| `PieChart` | `dataset`, `label`, `value`, `title?`, `format?` | A donut; past 7 slices the rest are grouped as Other |
| `Table` | `dataset`, `columns?`, `limit?` (default 100, up to 500), `title?` | Rows; `columns` are names or `{ field, label?, format? }` (up to 12) |
| `Note` | `text`, `title?`, `tone?` | The agent's words, with `- ` bullets and `**bold**` |
| `ActionButton` | `label`, `action`, `input?` | A button that runs one of the app's actions |

### Number formats

| Format | Prints |
|---|---|
| `number` (default) | 1,234 or 12.35: decimals only below 100 |
| `integer` | 1,235 |
| `currency` | ₹1,23,456 or $1,234 in the board's currency: decimals only below 100 |
| `percent` | 12.5% from `0.125` (it expects a fraction) |
| `compact` | 1.2K, 3.4M |
| `date` | A date in the board's locale; `2026-03` prints as a month |
| `text` | The value as it is |

### The long form: show_board

For layouts the short form cannot express, the agent writes a [json-render](https://github.com/vercel-labs/json-render) spec over datasets it made first with `query_data` or `use_source`:

```json
{
  "title": "Top products",
  "spec": {
    "root": "main",
    "elements": {
      "main": { "type": "Grid", "props": { "columns": 2 }, "children": ["chart", "side"] },
      "chart": { "type": "BarChart", "props": { "dataset": "top_products", "x": "product", "y": ["revenue"], "format": "currency" } },
      "side": { "type": "Section", "props": { "title": "All paid orders" }, "children": ["total"] },
      "total": { "type": "Metric", "props": { "label": "Revenue", "dataset": "totals", "field": "revenue", "format": "currency" } }
    }
  }
}
```

- Any prop can read one cell instead of a literal: `{ "$state": "/data/<dataset>/<row>/<column>" }`.
- Pass only `id` to reopen a saved board, or `id` with a spec to change that board in place.
- Showboard checks every element, prop and column before the board is shown, and replies with what to fix, for example: `chart: column "name" is not in dataset "top_products" (it has: product, revenue).`

## Tools

| Tool | Input | Returns |
|---|---|---|
| `describe_data` | none | The tables (columns, row counts, and for spreadsheets the sheet each came from and what loading skipped), the app's sources and their inputs, the datasets in memory, the recipes, and the number format when known |
| `recipe` | `name`, `params?`, `note?` (text put at the top), `title?`, `id?` | The same as `draw` |
| `draw` | `title`, `items`, `params?`, `save_as?`, `id?`, `preview_rows?` | The board id, whether it is on screen (`where: "pane"` when only a pane shows it), and each part's rows ([above](#what-draw-returns)) |
| `query_data` | `name`, `sql`, `preview_rows?` (default 15) | The columns, the row count and the first rows. Only with a database |
| `use_source` | `name`, `source`, `input?`, `preview_rows?` | The same, from one of the app's sources. Only when the app has sources |
| `show_board` | `title?`, `spec?`, `id?` | The board id and whether it is on screen |
| `list_boards` | `limit?` (default 20) | The saved boards, newest first |
| `get_screen` | none | The page's URL and title, the state it publishes, its actions and components, and the board on screen |
| `ui_act` | `action`, `input?` | What the action returned |

Boards go to every open tab and every pane. Actions go to the tab the user looked at last, which is also the one `get_screen` describes; a pane never answers one.

## Command line

```text
showboard serve --db <postgres-url | file.sqlite> | <files or folders...>  [--port 4710] [--boards .showboard/boards]
showboard mcp   --db <...> | <files or folders...>  [--port 4710] [--boards .showboard/boards] [--root <folder>]
showboard mcp   --url <http://localhost:3000/showboard>
showboard init  [--db <...> | <files or folders...> | --url <...>]  [--agent <names>] [--port 4710] [--agent-model sonnet]
showboard pane  [--url <http://127.0.0.1:4710>] [--once] [--currency INR --locale en-IN]
```

| Command | What it does |
|---|---|
| `serve` | Serves the tools, the browser bridge and the board page on http://localhost:4710 as a process of its own. `mcp` joins it when it is running |
| `mcp` | The MCP server your agent starts (over stdin and stdout). It also serves the bridge and the board page, or joins a Showboard already serving on that port |
| `mcp --url` | Only forwards to the Showboard your own server mounts |
| `init` | Adds a `showboard` server to each agent's settings in this folder ([below](#init-for-each-agent)), and for Claude Code writes `.claude/agents/board-builder.md` unless one exists |
| `pane` | The board on screen, drawn as text in this terminal, following each new board ([below](#panes)) |

| Option | Default | What it does |
|---|---|---|
| `--db` | `$SHOWBOARD_DB` | A Postgres URL or a SQLite file |
| `<files>`, `--file` | | Spreadsheets, or folders of them (`--file` can repeat) |
| `--url` | | The Showboard your app mounts, for `mcp`, `init` and `pane` |
| `--port` | `4710` | Port for the bridge and the board page, on 127.0.0.1 |
| `--boards` | `.showboard/boards` | Folder for saved boards. The agent's recipes go next to it, in `.showboard/recipes` |
| `--root` | the current folder | The project folder, for agents that start servers somewhere else; relative paths resolve from it |
| `--agent` | Claude Code, plus agents with settings here | Agents for `init`, comma separated: `claude`, `codex`, `opencode`, `gemini`, `cursor`, `vscode`, `antigravity`, `windsurf`, or `all` (every one but the user-wide `antigravity` and `windsurf`) |
| `--currency`, `--locale` | read from the files | How amounts print, e.g. `--currency INR --locale en-IN` |
| `--agent-model` | `sonnet` | Model for the board-builder agent that `init` writes for Claude Code |
| `--once` | | `pane` prints the board on screen and exits |
| `-h`, `--help` | | Prints the usage |

`SHOWBOARD_DB` is read when neither `--db` nor files are given, so a password can stay out of the settings files. Installed from npm, `init` writes each entry as `npx -y showboard …` (`cmd /c npx -y showboard …` on Windows, where most agents cannot start `npx` directly); run from a built checkout of this repository, it writes `node <that checkout>/packages/showboard/dist/cli/main.js …` instead.

### init for each agent

| `--agent` | File | Entry |
|---|---|---|
| `claude` | `.mcp.json` | `mcpServers.showboard`: `command`, `args` |
| `codex` | `.codex/config.toml` | `[mcp_servers.showboard]`: `command`, `args`, `startup_timeout_sec = 60`. Codex reads a project's file only when the project is trusted |
| `opencode` | `opencode.json` (or an existing `opencode.jsonc`) | `mcp.showboard`: `type: "local"`, `command` (one array), `enabled`, `timeout: 30000` |
| `gemini` | `.gemini/settings.json` | `mcpServers.showboard`: `command`, `args`. Gemini CLI starts it only in a trusted folder |
| `cursor` | `.cursor/mcp.json` | `mcpServers.showboard`, with `--root <this folder>` |
| `vscode` | `.vscode/mcp.json` | `servers.showboard`: `type: "stdio"`, with `--root ${workspaceFolder}` |
| `antigravity` | `~/.gemini/config/mcp_config.json` | `mcpServers.showboard`, with `--root <this folder>`. One file for every project |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | The same, for Windsurf |

`init` adds its entry beside the servers already there and replaces an older `showboard` entry. A settings file it cannot read as plain JSON (one with comments) is left alone, and `init` prints the entry to add by hand.

## Panes

A pane only watches: it gets every board shown, from any agent, and is never asked to confirm one or run an action. When no browser tab is open but a pane is, `draw` and `recipe` answer `shown: true` with `where: "pane"`, so the agent knows the board reached the person.

**In a terminal**, `showboard pane` holds `GET /stream?pane=<id>` open and redraws on each board. Keys: <kbd>←</kbd> <kbd>→</kbd> older and newer saved boards, <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd> scroll, <kbd>s</kbd> sources, <kbd>1</kbd>–<kbd>9</kbd> the board's buttons (run through `ui_act` in the browser tab), <kbd>o</kbd> open the board page, <kbd>q</kbd> quit. Numbers print in the format `describe_data` reports, or `--currency` and `--locale`.

**Beside Claude Code's chat**, the mod in [plugins/claude-code](../plugins/claude-code) polls `GET /health?pane=claude-code` every two seconds, and at once after a `draw`, `recipe` or `show_board` call, then fetches the board when `shows` moves. It finds Showboard from the folder's `.mcp.json` (the `showboard` entry's `--url` or `--port`), or from its `url` setting. It installs with `/plugin install showboard --marketplace rohanbeingsocial/showboard`, through the repository's `.claude-plugin/marketplace.json`.

**Your own pane** can use the same drawing: `boardToText(board, { width, format?, sources?, tableRows?, chartRows? })` from `showboard/text` returns blocks of lines, each line a list of runs (`text`, and optionally `ink`, `bold`, `dim`), plus the board's buttons as `{ kind: "action", label, action, input }`. `ink` names a series color (`s1`…`s8`) or a tone (`accent`, `muted`, `good`, `bad`, `warn`, `info`); `INKS` maps them to hex. Every line fits in `width` cells.

| Part | Drawn as |
|---|---|
| `Metric` | Label, value and caption, side by side when the width allows |
| `LineChart` | Braille lines, one color per series, the top, middle and bottom values on the left, the first and last x below, and each line's latest value in the legend |
| `BarChart` | One row per label with a block bar to an eighth of a cell and the value; one row per series under each label. At most 24 labels |
| `PieChart` | One stacked bar of the whole, then each slice's share and amount (beyond 7 slices the rest is Other) |
| `Table` | Aligned columns, numbers to the right; the widest columns narrow first, then columns drop off the end. 12 rows unless `tableRows` |
| `Note` | Paragraphs and bullets, **bold** kept, a colored bar for its tone |
| `ActionButton` | A button block |
| Your components | A line saying the part shows in the app |

## HTTP routes

Every path is under the handler's `basePath`. POST bodies are JSON (`content-type: application/json`).

| Route | What it is |
|---|---|
| `GET /stream?tab=<id>` | The event stream to one browser tab: the board on screen (else the latest) on connect, then boards and actions |
| `GET /stream?pane=<id>` | The same stream to a pane: the board on screen on connect, then every board shown, and nothing to answer |
| `POST /screen` | A tab reports what it shows: its state, actions, components and board |
| `POST /reply` | A tab answers a request: a board shown, or an action's result |
| `GET /boards` | The saved boards (`id`, `title`, `at`), newest first |
| `GET /boards/:id` | One board, with its layout and the rows it was drawn from |
| `GET /tools` | The tools and their input schemas, for the MCP bridge (without `$schema` and `propertyNames`, which some agents' model APIs turn away; calls are still checked against the full schema) |
| `POST /tools/:name` | Runs a tool and returns `{ ok, content }` |
| `GET /health[?pane=<id>]` | `{ ok: true, tabs, panes, board, shows, page }`: open tabs and panes, the board on screen, a count of boards shown, and whether the board page is served. A pane that polls names itself, and counts as open for 10 s |
| `GET /` | Showboard's own board page, when `viewer` is on |

## Limits and defaults

| | Default | Change it with |
|---|---|---|
| Rows kept per query | 5,000 | `maxRows` |
| Time per query | 5 s (Postgres; SQLite has none) | `timeoutMs` |
| Wait for the browser | 8 s | `replyTimeoutMs` |
| Datasets kept in memory | the latest 40 | |
| Boards in the list | the latest 200 | |
| Items per board | 12, and 4 per row | |
| SQL per part | 20,000 characters | |
| Note text | 6,000 characters | |
| Spreadsheet change check | at most once a second, on the next read | `openFiles(paths, { recheckMs })` |
| Port for `serve` and `mcp` | 4710 | `--port` |

## Styling

`showboard/styles.css` styles everything inside `.sb-board`, and the board defines its colours as variables there. To match your app, set them on the board with a selector that outranks `.sb-board`, such as a class you pass to `<Board className="brand" />`:

```css
.sb-board.brand {
  --sb-bg: #ffffff;        /* page behind the cards */
  --sb-card: #ffffff;
  --sb-fg: #16181d;
  --sb-muted: #6b7280;
  --sb-border: #e5e7eb;
  --sb-grid: #eef0f3;      /* chart grid lines and code background */
  --sb-accent: #2563eb;    /* buttons */
  --sb-on-accent: #ffffff;
  --sb-good: #15803d;      /* note tones */
  --sb-warn: #b45309;
  --sb-bad: #b91c1c;
  --sb-info: #1d4ed8;
  --sb-radius: 10px;
  --sb-c1: #2563eb;        /* series colours: --sb-c1 to --sb-c8 */
}
```

The values above are the defaults. `<Board className="sb-dark" />` uses the dark palette, as Showboard's own page does when your system is in dark mode.
