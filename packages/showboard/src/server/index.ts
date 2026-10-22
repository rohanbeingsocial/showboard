import { dirname, join } from "node:path";
import type { FormatOptions } from "../spec/format.js";
import { openDatabase, type Database, type DatabaseInput } from "./db.js";
import { openFiles } from "./files.js";
import { callTool, createHandler, type HttpOptions, type ToolCallResult } from "./http.js";
import { Hub } from "./hub.js";
import { RecipeStore, type Recipe } from "./recipes.js";
import { BoardStore, DatasetStore } from "./store.js";
import { createTools, type SourceDef, type ToolDef } from "./tools.js";

export interface ShowboardOptions {
  /** A Postgres URL, a SQLite file path, `{ pool }` with your own pg Pool, or a custom Database. */
  db?: DatabaseInput;
  /** Excel (.xlsx, .xlsm) and CSV files, or folders of them, to read instead of a database. */
  files?: string[];
  /** Rows your app computes itself, offered to Claude by name (use_source). */
  sources?: SourceDef[];
  /** Folder to keep boards in across restarts. In memory only when omitted. */
  boardsDir?: string;
  /** Boards your app knows people ask for, ready to draw in one call (see Recipe). */
  recipes?: Recipe[];
  /** Folder for the recipes Claude saves. Default: "recipes" next to boardsDir; in memory without either. */
  recipesDir?: string;
  /** Default 5000 rows per query. */
  maxRows?: number;
  /** Default 5000 ms per query (Postgres). */
  timeoutMs?: number;
  /** How long a tool waits for the browser; default 8000 ms. */
  replyTimeoutMs?: number;
  /** Told to Claude when no browser is open, e.g. "Ask the user to open http://127.0.0.1:4710." */
  openHint?: string;
  /**
   * How the board page prints numbers, e.g. { locale: "en-IN", currency: "INR" } (your own app
   * sets it on ShowboardProvider). From spreadsheets, the currency is read off amounts like ₹1,200.
   */
  format?: FormatOptions;
}

/** Where a currency is mostly used, so digits group the local way (₹1,23,456). */
const LOCALES: Record<string, string> = { INR: "en-IN", GBP: "en-GB" };

export interface Showboard {
  tools: ToolDef[];
  /** Runs a tool by name; the result is JSON text for Claude. */
  callTool(name: string, input: unknown): Promise<ToolCallResult>;
  /** A fetch-style handler for the browser and the MCP bridge. Mount it at `basePath`. */
  handler(options?: HttpOptions): (req: Request) => Promise<Response>;
  db: Database | null;
  close(): Promise<void>;
}

export async function createShowboard(options: ShowboardOptions = {}): Promise<Showboard> {
  if (options.db && options.files?.length) throw new Error("Pass either db or files, not both.");
  const db = options.files?.length ? await openFiles(options.files) : options.db ? await openDatabase(options.db) : null;
  const hub = new Hub();
  const boards = new BoardStore(options.boardsDir);
  const recipesDir = options.recipesDir ?? (options.boardsDir ? join(dirname(options.boardsDir), "recipes") : undefined);
  const tools = createTools({
    db,
    sources: options.sources ?? [],
    datasets: new DatasetStore(),
    boards,
    recipes: new RecipeStore(options.recipes, recipesDir),
    hub,
    limits: { maxRows: options.maxRows ?? 5000, timeoutMs: options.timeoutMs ?? 5000 },
    replyTimeoutMs: options.replyTimeoutMs ?? 8000,
    openHint: options.openHint,
    format() {
      const currency = options.format?.currency ?? db?.currency?.();
      const locale = options.format?.locale ?? (currency ? LOCALES[currency] : undefined);
      return currency || locale ? { ...(locale ? { locale } : {}), ...(currency ? { currency } : {}) } : undefined;
    },
  });
  return {
    tools,
    db,
    callTool: (name, input) => callTool(tools, name, input),
    handler: (httpOptions) => createHandler({ hub, boards, tools }, httpOptions),
    close: async () => db?.close(),
  };
}

export { openDatabase, cleanSql } from "./db.js";
export type { Database, DatabaseInput, PgPoolLike, QueryLimits, QueryResult, TableInfo } from "./db.js";
export { openFiles } from "./files.js";
export type { FilesOptions } from "./files.js";
export type { HttpOptions, ToolCallResult } from "./http.js";
export type { Item, DataPart, NotePart, RowPart, SectionPart, View } from "./items.js";
export type { Params, ParamValue } from "./params.js";
export type { Recipe } from "./recipes.js";
export type { SourceDef, ToolDef } from "./tools.js";
export { serve, toNodeListener } from "./node.js";

/** Told to Claude by the MCP server: when to reach for these tools, and in what order. */
export const INSTRUCTIONS = [
  "Showboard draws answers on the user's own app screen instead of only in text. When the user asks to see, show or compare data, take the shortest path:",
  "a recipe when one fits (one call); otherwise draw, which fetches each part with SQL and lays out the board in one call (describe_data first if you have not seen the tables). If the board is worth repeating, give draw params and save_as so it becomes a recipe.",
  "When the conversation is already long (after research, many tool results) and a board-builder agent is available, hand it new kinds of boards with a short brief (what to show, which names, the period, any note) and keep the research and checking yourself: it works on a cheaper model, and its schema reading and SQL stay out of your context. In a short conversation, draw yourself.",
  "show_board is the long form, for layouts draw cannot express. get_screen tells you what the user is looking at and which app actions ui_act can run.",
  "Numbers on a board always come from the data, never from you.",
].join(" ");

/** The Claude Code agent file `showboard init` writes: new kinds of boards built by a cheaper model in its own small context. */
export function builderAgent(server = "showboard", model = "sonnet"): string {
  const t = (name: string) => `mcp__${server}__${name}`;
  return `---
name: board-builder
description: Draws a board on the user's screen that no recipe covers, then saves it as a recipe so the next one is a single call. Give it a short brief - what to show, which names or items, the period, and any note to put on the board. It returns the board id and a line per part.
model: ${model}
tools: ${["describe_data", "recipe", "draw", "query_data", "use_source", "list_boards"].map(t).join(", ")}
---

You draw boards on the user's screen with the ${server} tools. The agent that called you does the research and the advice; you only build the board, quickly and cheaply.

1. If a recipe fits the brief (${t("recipe")} lists them), call it and stop.
2. Otherwise call ${t("describe_data")} once, then ${t("draw")} with every part in one call. Let the database do the maths in SQL (sums, averages, percentages as fractions, rebasing to 100) and keep results small: aggregate, filter, limit. Use ${t("query_data")} first only when unsure what a table holds.
3. Put values someone might change (names, dates, periods, limits) in params as :name placeholders, and add save_as with a general name and a one-line about ("compare_prices", not "itc_vs_hdfc").
4. If the brief has a note, add it as a note item unchanged. Never type figures you did not read.
5. If draw reports problems, fix those parts and call it again with the same id.
6. Reply in at most five lines: the board id, what each part shows, and anything odd in the data (gaps, very few rows, values that look wrong).
`;
}
