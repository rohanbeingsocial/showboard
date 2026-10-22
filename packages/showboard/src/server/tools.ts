import { randomBytes } from "node:crypto";
import { z } from "zod";
import { BUILT_IN, describeComponents } from "../spec/catalog.js";
import type { FormatOptions } from "../spec/format.js";
import type { Board, Dataset } from "../spec/types.js";
import { checkBoard } from "../spec/validate.js";
import { buildSpec, planView, type Resolved } from "./auto.js";
import type { Database, QueryLimits } from "./db.js";
import type { Hub } from "./hub.js";
import { dataParts, itemShape, nameShape, type DataPart, type Item } from "./items.js";
import { bindParams, fillTitle, type Params } from "./params.js";
import { describeRecipe, paramValueShape, recipeParams, recipeProblem, type RecipeStore } from "./recipes.js";
import type { BoardStore, DatasetStore } from "./store.js";

// The tools Claude gets. Descriptions are written for Claude: what the tool is for, what
// it returns, and the rules (numbers come from the database, never from Claude).

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodObject;
  run(input: never): Promise<unknown>;
}

/** Rows the host app computes itself (an API call, an engine), offered to Claude by name. */
export interface SourceDef<I extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input?: I;
  run(input: z.infer<I>): Promise<Record<string, unknown>[]> | Record<string, unknown>[];
}

export interface ToolContext {
  db: Database | null;
  sources: SourceDef[];
  datasets: DatasetStore;
  boards: BoardStore;
  recipes: RecipeStore;
  hub: Hub;
  limits: QueryLimits;
  /** How long to wait for the browser to confirm a board or finish an action. */
  replyTimeoutMs: number;
  /** Added when no browser is open, e.g. "Ask the user to open http://127.0.0.1:4710." */
  openHint?: string;
  /** How the board page prints numbers, when known; describe_data passes it on. */
  format?(): FormatOptions | undefined;
}

const datasetName = nameShape;
const NO_BROWSER = "No browser has the app open, so nothing is on screen yet.";
/** Rows a result may have and still come back whole from draw. */
const SMALL_RESULT = 12;

const tool = <S extends z.ZodObject>(def: { name: string; description: string; input: S; run(input: z.infer<S>): Promise<unknown> }): ToolDef => def as unknown as ToolDef;

/** "Price, rebased to 100" → "price_rebased_to_100": a dataset name from a title. */
const slug = (text: string) => {
  const s = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34).replace(/_+$/, "");
  return /^[a-z]/.test(s) ? s : s ? `d_${s}` : "data";
};

export function createTools(ctx: ToolContext): ToolDef[] {
  const { db, sources, datasets, boards, recipes, hub, limits } = ctx;
  const tools: ToolDef[] = [];
  const noBrowser = ctx.openHint ? `${NO_BROWSER} ${ctx.openHint}` : NO_BROWSER;

  const keep = (name: string, origin: string, columns: Dataset["columns"], rows: Dataset["rows"], truncated: boolean, previewRows: number) => {
    datasets.set({ name, columns, rows, truncated, origin, at: new Date().toISOString() });
    return {
      dataset: name,
      columns: columns.map((c) => `${c.name} (${c.type})`),
      rows: rows.length,
      ...(truncated ? { truncated: `Only the first ${rows.length} rows were kept; aggregate or filter in SQL.` } : {}),
      preview: rows.slice(0, previewRows),
    };
  };

  async function runSource(source: string, input: unknown) {
    const def = sources.find((s) => s.name === source);
    if (!def) throw new Error(`No source "${source}". Sources: ${sources.map((s) => s.name).join(", ") || "none"}.`);
    const parsed = (def.input ?? z.object({})).safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Bad input for ${source}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const all = await def.run(parsed.data);
    const truncated = all.length > limits.maxRows;
    const rows = truncated ? all.slice(0, limits.maxRows) : all;
    const columns = Object.keys(rows[0] ?? {}).map((col) => ({ name: col, type: typeof rows.find((r) => r[col] != null)?.[col] === "number" ? "number" : "text" }));
    return { columns, rows, truncated, origin: `${source}(${JSON.stringify(parsed.data)})` };
  }

  /** One part's rows: an existing dataset, an app source, or SQL with its :name values bound. */
  async function fetchPart(part: DataPart, params: Params, name: string): Promise<Dataset> {
    if (part.dataset) {
      const existing = datasets.get(part.dataset);
      if (!existing) throw new Error(`No dataset "${part.dataset}" (have: ${datasets.list().map((d) => d.name).join(", ") || "none"}).`);
      return existing;
    }
    let dataset: Dataset;
    const at = new Date().toISOString();
    if (part.source) {
      const out = await runSource(part.source, part.input);
      dataset = { name, columns: out.columns, rows: out.rows, truncated: out.truncated, origin: out.origin, at };
    } else {
      if (!db) throw new Error("There is no database here; use a source.");
      const sql = part.sql!.trim();
      const bound = bindParams(sql, params, db.kind);
      const result = await db.query(bound.sql, limits, bound.values);
      const values = bound.used.map((key) => `:${key} = ${JSON.stringify(params[key])}`).join(", ");
      dataset = { name, columns: result.columns, rows: result.rows, truncated: result.truncated, origin: values ? `${sql}\n-- ${values}` : sql, at };
    }
    datasets.set(dataset);
    return dataset;
  }

  /** Fetches every part's rows at once, picks the charts, lays out the board and shows it. */
  async function drawBoard(args: { title: string; items: Item[]; params: Params; id?: string; previewRows?: number; saveAs?: { name: string; about: string } }) {
    const { items, params } = args;
    const fill = (text: string) => fillTitle(text, params);
    const parts = dataParts(items);
    const label = (part: DataPart, i: number) => (part.title ? `"${fill(part.title)}"` : `part ${i + 1}`);

    if (args.saveAs) {
      const problem = recipeProblem(items) ?? (recipes.isBuiltIn(args.saveAs.name) ? `"${args.saveAs.name}" is one of the app's recipes; save under another name.` : null);
      if (problem) return { error: `Nothing was drawn. ${problem}` };
    }

    const taken = new Set(parts.flatMap((p) => (p.dataset ? [p.dataset] : [])));
    const names = parts.map((part) => {
      if (part.dataset) return part.dataset;
      const base = slug(fill(part.title ?? args.title));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
      taken.add(name);
      return name;
    });

    const resolved = new Map<DataPart, Resolved>();
    const problems: string[] = [];
    await Promise.all(
      parts.map(async (part, i) => {
        try {
          const from = [part.sql, part.dataset, part.source].filter((v) => v !== undefined).length;
          if (from > 1) throw new Error("give one of sql, dataset or source, not several.");
          if (!from) {
            if (!part.component) throw new Error("give it sql, a dataset or a source (or a component with its props).");
            resolved.set(part, {});
            return;
          }
          const dataset = await fetchPart(part, params, names[i]!);
          const plan = part.component ? undefined : planView(dataset, part);
          resolved.set(part, { dataset: plan?.dataset ?? dataset, plan });
        } catch (err) {
          problems.push(`${label(part, i)}: ${(err as Error).message}`);
        }
      }),
    );
    if (problems.length) return { error: "Nothing was drawn. Fix these and call again.", problems };

    // Two parts can draw one dataset differently (one wide by series); each keeps its own rows.
    const drawn: Record<string, Dataset> = {};
    for (const part of parts) {
      const r = resolved.get(part)!;
      if (!r.dataset) continue;
      if (drawn[r.dataset.name] && drawn[r.dataset.name] !== r.dataset) {
        let name = r.dataset.name;
        for (let n = 2; drawn[name]; n++) name = `${r.dataset.name.slice(0, 36)}_${n}`;
        r.dataset = { ...r.dataset, name };
        if (r.plan) r.plan = { ...r.plan, dataset: r.dataset };
      }
      drawn[r.dataset.name] = r.dataset;
    }

    const spec = buildSpec(items, resolved, fill);
    const check = checkBoard(spec, { datasets: Object.fromEntries(Object.entries(drawn).map(([n, d]) => [n, d.columns.map((c) => c.name)])), customComponents: customComponents(hub) });
    if (check.problems.length || !check.spec) return { error: "Nothing was drawn. Fix these and call again.", problems: check.problems };

    let saved: string | undefined;
    if (args.saveAs) {
      const example = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, { example: value }]));
      recipes.save({ name: args.saveAs.name, about: args.saveAs.about, title: args.title, ...(Object.keys(example).length ? { params: example } : {}), items, at: new Date().toISOString() });
      saved = `Saved as recipe ${args.saveAs.name}: next time it is one recipe call.`;
    }

    const board: Board = { id: args.id ?? `b_${randomBytes(4).toString("hex")}`, title: fill(args.title), spec: check.spec, datasets: drawn, at: new Date().toISOString() };
    boards.save(board);
    const shown = await present(board);
    return {
      ...shown,
      parts: parts.map((part, i) => {
        const { dataset, plan } = resolved.get(part)!;
        if (!dataset) return { part: label(part, i), drawn: part.component };
        return {
          part: label(part, i),
          drawn: plan?.show ?? part.component,
          dataset: dataset.name,
          rows: dataset.rows.length,
          ...(dataset.truncated ? { truncated: `Only the first ${dataset.rows.length} rows were kept; aggregate or filter in SQL.` } : {}),
          ...(plan?.notes.length ? { notes: plan.notes } : {}),
          // Small results come back whole, so a top-10 can be read without another query.
          ...(args.previewRows === undefined && dataset.rows.length <= SMALL_RESULT
            ? { rows_read: dataset.rows }
            : { first: dataset.rows.slice(0, args.previewRows ?? 3), ...(args.previewRows !== 0 && dataset.rows.length > (args.previewRows ?? 3) ? { last: dataset.rows.at(-1) } : {}) }),
        };
      }),
      ...(saved ? { recipe: saved } : {}),
    };
  }

  const paramsShape = z.record(nameShape, paramValueShape);

  tools.push(
    tool({
      name: "describe_data",
      description:
        "List what you can read: the database tables and columns query_data can use (with estimated row counts), and the app's named data sources for use_source. Call it before writing SQL against tables you have not seen.",
      input: z.object({}),
      async run() {
        const tables = db ? await db.describe() : [];
        const notes = db?.notes?.() ?? [];
        const format = ctx.format?.();
        return {
          // The currency format prints in this currency, so a board of rupees shows ₹.
          ...(format ? { format } : {}),
          database: db
            ? {
                kind: db.kind,
                tables: tables.map((t) => ({
                  table: t.table,
                  ...(t.source ? { from: t.source } : {}),
                  rows: t.rows,
                  // A spreadsheet column shows its heading as written: net_sales real ← "Net Sales (₹)".
                  columns: t.columns.map((c) => `${c.name} ${c.type}${c.label ? ` ← "${c.label}"` : ""}`),
                  ...(t.notes?.length ? { notes: t.notes } : {}),
                })),
                ...(notes.length ? { notes } : {}),
              }
            : null,
          sources: sources.map((s) => ({ name: s.name, description: s.description, input: s.input ? z.toJSONSchema(s.input) : {} })),
          datasets: datasets.list().map((d) => ({ name: d.name, rows: d.rows.length, columns: d.columns.map((c) => c.name) })),
          recipes: recipes.list().map(describeRecipe),
        };
      },
    }),
    tool({
      name: "recipe",
      // Read each time the tools are listed, so recipes saved since show up.
      get description() {
        const list = recipes.list();
        return [
          "Draw a ready-made board in one call: name a recipe and its values (lists as arrays). Use one whenever it fits the question; draw makes new kinds of boards. note puts your text at the top (quote only figures you have read); title replaces the recipe's.",
          list.length ? `Recipes:\n${list.map((r) => `- ${describeRecipe(r)}`).join("\n")}` : "No recipes yet: draw with save_as adds one.",
        ].join("\n");
      },
      input: z.object({
        name: nameShape,
        params: paramsShape.optional(),
        note: z.string().max(6000).optional(),
        title: z.string().max(160).optional(),
        id: z.string().max(40).optional().describe("Replace this board instead of adding one"),
      }),
      async run({ name, params, note, title, id }) {
        const recipe = recipes.get(name);
        if (!recipe) return { error: `No recipe "${name}". Recipes: ${recipes.list().map((r) => r.name).join(", ") || "none yet"}.` };
        let values: Params;
        try {
          values = recipeParams(recipe, params ?? {});
        } catch (err) {
          return { error: (err as Error).message };
        }
        return drawBoard({ title: title ?? recipe.title, items: note ? [{ note }, ...recipe.items] : recipe.items, params: values, id });
      },
    }),
    tool({
      name: "draw",
      description: [
        "Draw a board on the user's screen in one call. items, in reading order:",
        "- a part: sql (one read-only SELECT), dataset or source, with an optional title. The chart is picked from its rows: dates with numbers → line, labels with numbers → bars, one row → headline numbers, else a table; rows like (date, name, value) get a line per name. Choose yourself with show, x, y, series and formats, or draw it with any component and props (its dataset is filled in).",
        "- {note, title?, tone?}: your text. Quote only figures you have read.",
        "- {row: [parts]} side by side; {section, subtitle?, items} a titled group.",
        "The database computes every number: aggregate, rebase and round in SQL. Put values the user may change in params (:name in the SQL) and add save_as to keep the board as a recipe, so the same board for other values is one recipe call. Returns the rows of each part (the first and last of long ones) to check.",
        "Components:",
        describeComponents(BUILT_IN),
        "The app can add its own components; get_screen lists them.",
      ].join("\n"),
      input: z.object({
        title: z.string().min(1).max(160).describe("May use {param} to show a value"),
        items: z.array(itemShape).min(1).max(12),
        params: paramsShape.optional().describe("Values for :name placeholders in the SQL; lists as arrays"),
        save_as: z.object({ name: nameShape, about: z.string().min(1).max(400) }).optional().describe("Keep as a recipe; params become its inputs"),
        id: z.string().max(40).optional().describe("Replace this board instead of adding one"),
        preview_rows: z.number().int().min(0).max(50).optional().describe("Rows of each part returned to you (default: all of a small result, else the first 3 and the last)"),
      }),
      async run({ title, items, params, save_as, id, preview_rows }) {
        return drawBoard({ title, items, params: params ?? {}, id, previewRows: preview_rows, saveAs: save_as });
      },
    }),
  );

  if (db) {
    tools.push(
      tool({
        name: "query_data",
        description: `Run one read-only SQL SELECT against the app's ${db.kind === "postgres" ? "Postgres" : "SQLite"} database and keep the rows as a dataset named \`name\` that boards can draw. The database computes every number: aggregate, sort and round in SQL, not in your head. Returns the columns, the row count and the first rows. At most ${limits.maxRows} rows${db.kind === "postgres" ? ` and ${limits.timeoutMs / 1000} s` : ""} per query. Reusing a name replaces that dataset.`,
        input: z.object({
          name: datasetName.describe("Dataset name boards will use, e.g. top_products"),
          sql: z.string().min(1).max(20_000),
          preview_rows: z.number().int().min(0).max(100).optional().describe("Rows to return to you (default 15)"),
        }),
        async run({ name, sql, preview_rows }) {
          const result = await db.query(sql, limits);
          return keep(name, sql.trim(), result.columns, result.rows, result.truncated, preview_rows ?? 15);
        },
      }),
    );
  }

  if (sources.length) {
    tools.push(
      tool({
        name: "use_source",
        description: `Get rows from one of the app's own data sources and keep them as a dataset named \`name\`. Sources: ${sources.map((s) => s.name).join(", ")} (describe_data shows their inputs).`,
        input: z.object({
          name: datasetName,
          source: z.string(),
          input: z.record(z.string(), z.unknown()).optional(),
          preview_rows: z.number().int().min(0).max(100).optional(),
        }),
        async run({ name, source, input, preview_rows }) {
          let out;
          try {
            out = await runSource(source, input);
          } catch (err) {
            return { error: (err as Error).message };
          }
          return keep(name, out.origin, out.columns, out.rows, out.truncated, preview_rows ?? 15);
        },
      }),
    );
  }

  tools.push(
    tool({
      name: "show_board",
      description: [
        "The long form of draw: a json-render spec you wire yourself, for what draw cannot say. Pass only id to reopen a saved board.",
        '{ "root": "<key>", "elements": { "<key>": { "type": "<Component>", "props": {…}, "children": ["<key>", …] } } }, with the components listed under draw.',
        "Every number comes from a dataset (query_data or use_source): components take a dataset name and column names, and any other prop can read a cell with { \"$state\": \"/data/<dataset>/<row>/<column>\" }. Do not type figures into props. In a Note, only quote figures you read from a dataset.",
        "Pass id (from an earlier board) to change that board in place.",
      ].join("\n"),
      input: z.object({
        title: z.string().max(160).optional(),
        spec: z.unknown().optional(),
        id: z.string().max(40).optional(),
      }),
      async run({ title, spec, id }) {
        if (spec === undefined) {
          const saved = id ? boards.get(id) : undefined;
          if (!saved) return { error: id ? `No board ${id}. list_boards shows the saved ones.` : "Pass a spec (and a title) to draw a board, or the id of a saved one." };
          return present(saved);
        }
        if (!title) return { error: "A new board needs a title." };
        const check = checkBoard(spec, { datasets: datasets.columns(), customComponents: customComponents(hub) });
        if (check.problems.length || !check.spec) return { error: "The board was not shown. Fix these and call show_board again.", problems: check.problems };
        const board: Board = {
          id: id ?? `b_${randomBytes(4).toString("hex")}`,
          title,
          spec: check.spec,
          datasets: Object.fromEntries(check.datasetsUsed.map((name) => [name, datasets.get(name)!])),
          at: new Date().toISOString(),
        };
        boards.save(board);
        return present(board);
      },
    }),
  );

  async function present(board: Board) {
    hub.show(board);
    const reply = await hub.request((request) => ({ type: "board", board, request }), ctx.replyTimeoutMs, true);
    if (!reply && !hub.connected && hub.watching) {
      // A pane draws charts as text; the browser draws them in full.
      return { board: board.id, shown: true, where: "pane", note: `Shown as text in the user's Showboard pane.${ctx.openHint ? ` For the full board: ${ctx.openHint}` : ""}` };
    }
    if (!reply) return { board: board.id, shown: false, note: hub.connected ? "The browser did not confirm the board in time." : `${noBrowser} The board is saved and appears when the app opens.` };
    if (!reply.ok) return { board: board.id, shown: false, error: reply.error };
    const problems = (reply.result as { problems?: string[] } | undefined)?.problems;
    return { board: board.id, shown: true, ...(problems?.length ? { problems } : {}) };
  }

  tools.push(
    tool({
      name: "list_boards",
      description: "List saved boards, newest first. show_board with an id reopens one.",
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      async run({ limit }) {
        return { boards: boards.list().slice(0, limit ?? 20) };
      },
    }),
    tool({
      name: "get_screen",
      description:
        "What the user's browser shows now: the page and app state the app publishes, the actions you can run with ui_act (with their inputs), any components the app adds for boards, and the board on screen. Call it before ui_act, and to see what the user is looking at.",
      input: z.object({}),
      async run() {
        const active = hub.active();
        if (!active?.report) return { connected: false, note: noBrowser };
        const { url, title, state, actions, components, boardId } = active.report;
        return {
          connected: true,
          tabs: hub.connected,
          url,
          title,
          state,
          actions,
          components,
          board: boardId ? (boards.list().find((b) => b.id === boardId) ?? { id: boardId }) : null,
        };
      },
    }),
    tool({
      name: "ui_act",
      description: "Run one of the app's actions in the user's browser: open a page, set a filter, select something. get_screen lists the actions and their inputs. Returns what the action returned.",
      input: z.object({ action: z.string().max(80), input: z.record(z.string(), z.unknown()).optional() }),
      async run({ action, input }) {
        const reply = await hub.request((request) => ({ type: "act", request, action, input: input ?? {} }), ctx.replyTimeoutMs);
        if (!reply) return { error: hub.connected ? `The browser did not finish "${action}" in time.` : noBrowser };
        return reply.ok ? { done: true, result: reply.result ?? null } : { error: reply.error };
      },
    }),
  );
  return tools;
}

function customComponents(hub: Hub): string[] {
  return hub.active()?.report?.components.map((c) => c.name) ?? [];
}
