import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { planView } from "../src/server/auto.js";
import { builderAgent, createShowboard, type Recipe } from "../src/server/index.js";
import { bindParams, fillTitle } from "../src/server/params.js";
import type { Board, Dataset } from "../src/spec/types.js";

const dataset = (rows: Record<string, unknown>[], name = "d"): Dataset => ({
  name,
  columns: Object.keys(rows[0] ?? {}).map((c) => ({ name: c, type: typeof rows[0]![c] === "number" ? "number" : "text" })),
  rows,
  truncated: false,
  origin: "select …",
  at: "2026-10-21T00:00:00Z",
});

describe("bindParams", () => {
  it("turns :names into placeholders and lists into one per value", () => {
    const sql = "select * from p where symbol in (:symbols) and date >= current_date - :days::int";
    expect(bindParams(sql, { symbols: ["ITC", "TCS"], days: 30 }, "postgres")).toEqual({
      sql: "select * from p where symbol in ($1, $2) and date >= current_date - $3::int",
      values: ["ITC", "TCS", 30],
      used: ["symbols", "days"],
    });
    expect(bindParams("select :a, :a", { a: 1 }, "sqlite").sql).toBe("select ?, ?");
  });

  it("leaves strings, quoted names, comments and casts alone", () => {
    const sql = `select ':x', "a:b", x::text -- :y\n/* :z */ from t where n = :n and t = 'it''s :q'`;
    expect(bindParams(sql, { n: 5 }, "postgres")).toEqual({
      sql: `select ':x', "a:b", x::text -- :y\n/* :z */ from t where n = $1 and t = 'it''s :q'`,
      values: [5],
      used: ["n"],
    });
  });

  it("says which value is missing", () => {
    expect(() => bindParams("select :who", {}, "sqlite")).toThrow(":who, which has no value");
    expect(() => bindParams("select 1 where a in (:xs)", { xs: [] }, "sqlite")).toThrow("at least one value");
  });

  it("fills titles", () => {
    expect(fillTitle("{symbols} over {days} days, {other}", { symbols: ["ITC", "TCS"], days: 90 })).toBe("ITC, TCS over 90 days, {other}");
  });
});

describe("planView", () => {
  it("draws dates with numbers as a line", () => {
    const plan = planView(dataset([{ date: "2026-01-01", close: 10 }, { date: "2026-01-02", close: 11 }]));
    expect(plan).toMatchObject({ show: "line", x: "date", y: ["close"] });
  });

  it("turns long rows into one line per series value", () => {
    const rows = ["2026-01-01", "2026-01-02"].flatMap((date, i) => [{ date, symbol: "ITC", close: 100 + i }, { date, symbol: "TCS", close: 200 + i }]);
    const plan = planView(dataset(rows));
    expect(plan.show).toBe("line");
    expect(plan.y).toEqual(["ITC", "TCS"]);
    expect(plan.dataset.rows).toEqual([{ date: "2026-01-01", ITC: 100, TCS: 200 }, { date: "2026-01-02", ITC: 101, TCS: 201 }]);
  });

  it("draws labels with numbers as bars, one row as metrics, and the rest as a table", () => {
    expect(planView(dataset([{ product: "Lamp", revenue: 1 }, { product: "Desk", revenue: 2 }])).show).toBe("bar");
    expect(planView(dataset([{ total: 5, orders: 2 }]))).toMatchObject({ show: "metrics", y: ["total", "orders"] });
    expect(planView(dataset([{ name: "a", city: "b" }])).show).toBe("table");
    // A year is a label, not a measure.
    expect(planView(dataset([{ year: 2025, revenue: 1 }, { year: 2026, revenue: 2 }]))).toMatchObject({ show: "bar", x: "year", y: ["revenue"] });
  });

  it("prints shares as percents and remembers what a wide chart measures", () => {
    const rows = ["2026-01-01", "2026-02-01"].flatMap((date) => [{ date, region: "North", attainment: 0.9 }, { date, region: "South", attainment: 1.1 }]);
    expect(planView(dataset(rows))).toMatchObject({ show: "line", y: ["North", "South"], measure: "attainment", guessed: { attainment: "percent" } });
    // pct columns often hold 12.5 for 12.5%, and a share of 35 is not a fraction: both left alone.
    expect(planView(dataset([{ region: "North", change_pct: 0.5 }, { region: "South", change_pct: 1.5 }])).guessed).toEqual({});
    expect(planView(dataset([{ region: "North", share: 35 }, { region: "South", share: 65 }])).guessed).toEqual({});
  });

  it("follows hints and refuses columns that are not there", () => {
    expect(planView(dataset([{ product: "Lamp", revenue: 1 }]), { show: "pie" })).toMatchObject({ show: "pie", x: "product", y: ["revenue"] });
    expect(() => planView(dataset([{ a: 1 }]), { x: "b" })).toThrow('column "b" is not in the result');
  });
});

describe("draw and recipes", () => {
  let file: string;
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "showboard-draw-"));
    file = join(dir, "shop.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE prices (date TEXT, symbol TEXT, close REAL)");
    const insert = db.prepare("INSERT INTO prices VALUES (?, ?, ?)");
    for (const [i, date] of ["2026-10-01", "2026-10-02", "2026-10-03"].entries()) {
      insert.run(date, "ITC", 400 + i);
      insert.run(date, "TCS", 3000 - 10 * i);
      insert.run(date, "INFY", 1500 + 5 * i);
    }
    db.close();
  });

  const builtIn: Recipe = {
    name: "latest_close",
    about: "Each stock's latest close.",
    title: "Latest closes",
    params: { symbols: { example: ["ITC"] } },
    items: [{ title: "Latest close", sql: "select symbol, close from prices where date = (select max(date) from prices) and symbol in (:symbols) order by symbol" }],
  };

  it("fetches, picks charts and lays out a board in one call", async () => {
    const sb = await createShowboard({ db: file, replyTimeoutMs: 50 });
    const out = JSON.parse((await sb.callTool("draw", {
      title: "ITC and TCS",
      items: [
        { note: "Two stocks.", tone: "info" },
        { row: [{ title: "Close", sql: "select date, symbol, close from prices where symbol in ('ITC', 'TCS') order by date", formats: { close: "currency" } }, { title: "Last", sql: "select max(close) as top from prices" }] },
        { section: "Detail", items: [{ title: "All rows", sql: "select * from prices", show: "table", formats: { close: "currency" } }] },
        { component: "Metric", sql: "select count(*) as n from prices", props: { label: "Rows", field: "n" } },
      ],
    })).content);
    expect(out.shown).toBe(false);
    expect(out.parts.map((p: { drawn: string }) => p.drawn)).toEqual(["line", "metrics", "table", "Metric"]);
    expect(out.parts[0]).toMatchObject({ dataset: "close", rows: 3 });
    expect(out.parts[0].rows_read[0]).toEqual({ date: "2026-10-01", ITC: 400, TCS: 3000 });

    const board = (await (await sb.handler()(new Request("http://localhost/boards/" + out.board))).json()) as Board;
    const types = Object.values(board.spec.elements).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["Note", "Grid", "LineChart", "Metric", "Section", "Table"]));
    expect(board.datasets.close!.columns.map((c) => c.name)).toEqual(["date", "ITC", "TCS"]);
    expect(board.spec.elements[board.spec.root]!.children).toHaveLength(4);
    const element = (type: string) => Object.values(board.spec.elements).find((e) => e.type === type)!;
    // The wide chart's columns are ITC and TCS; the format given for close still applies.
    expect(element("LineChart").props.format).toBe("currency");
    expect(element("Table").props.columns).toEqual([{ field: "date", label: "Date" }, { field: "symbol", label: "Symbol" }, { field: "close", label: "Close", format: "currency" }]);
  });

  it("reports every broken part and draws nothing", async () => {
    const sb = await createShowboard({ db: file, replyTimeoutMs: 50 });
    const out = await sb.callTool("draw", { title: "Broken", items: [{ title: "Bad", sql: "select nope from prices" }, { title: "Both", sql: "select 1", dataset: "x" }, { component: "Metric", props: { label: "x" } }] });
    expect(out.ok).toBe(false);
    const body = JSON.parse(out.content);
    expect(body.problems.some((p: string) => p.startsWith('"Bad"'))).toBe(true);
    expect(body.problems.some((p: string) => p.startsWith('"Both": give one of'))).toBe(true);
  });

  it("saves a board as a recipe and redraws it for other values in one call", async () => {
    const boardsDir = join(dir, "kept", "boards");
    const sb = await createShowboard({ db: file, boardsDir, recipes: [builtIn], replyTimeoutMs: 50 });
    const saved = JSON.parse((await sb.callTool("draw", {
      title: "{symbols} rebased",
      items: [{ title: "Rebased to 100", sql: "select date, symbol, round(100.0 * close / first_value(close) over (partition by symbol order by date), 2) as rebased from prices where symbol in (:symbols) order by date" }],
      params: { symbols: ["ITC", "TCS"] },
      save_as: { name: "compare_prices", about: "Closing prices rebased to 100." },
    })).content);
    expect(saved.recipe).toContain("compare_prices");
    expect(existsSync(join(dir, "kept", "recipes", "compare_prices.json"))).toBe(true);

    const listed = (await (await sb.handler()(new Request("http://localhost/tools"))).json()) as { name: string; description: string }[];
    const recipeTool = listed.find((t) => t.name === "recipe")!;
    expect(recipeTool.description).toContain('compare_prices(symbols e.g. ["ITC","TCS"]): Closing prices rebased to 100.');
    expect(recipeTool.description).toContain("latest_close(");

    // A fresh server (tomorrow) still has it, and other values need one call.
    const later = await createShowboard({ db: file, boardsDir, recipes: [builtIn], replyTimeoutMs: 50 });
    const redrawn = JSON.parse((await later.callTool("recipe", { name: "compare_prices", params: { symbols: ["INFY"] }, note: "INFY alone." })).content);
    expect(redrawn.parts[0]).toMatchObject({ drawn: "line", rows: 3 });
    expect(redrawn.parts[0].rows_read[0]).toEqual({ date: "2026-10-01", symbol: "INFY", rebased: 100 });
    const board = (await (await later.handler()(new Request("http://localhost/boards/" + redrawn.board))).json()) as Board;
    expect(board.title).toBe("INFY rebased");
    expect(board.datasets.rebased_to_100!.origin).toContain(':symbols = ["INFY"]');

    expect(JSON.parse((await later.callTool("recipe", { name: "compare_prices" })).content).error).toContain('needs symbols, e.g. ["ITC","TCS"]');
    expect(JSON.parse((await later.callTool("recipe", { name: "latest_close", params: { symbols: ["TCS"], days: 3 } })).content).error).toContain('no parameter "days"');
    const clash = await later.callTool("draw", { title: "x", items: [{ sql: "select 1 as n" }], save_as: { name: "latest_close", about: "x" } });
    expect(JSON.parse(clash.content).error).toContain("one of the app's recipes");
  });

  it("refuses an app recipe that borrows a dataset", async () => {
    await expect(createShowboard({ db: file, recipes: [{ ...builtIn, items: [{ dataset: "x" }] }] })).rejects.toThrow("fetches its own rows");
  });

  it("writes a board-builder agent for Claude Code", () => {
    const agent = builderAgent("meridian", "haiku");
    expect(agent).toContain("model: haiku");
    expect(agent).toContain("mcp__meridian__draw, mcp__meridian__query_data");
  });
});
