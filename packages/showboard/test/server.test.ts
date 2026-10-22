import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createShowboard, type Showboard } from "../src/server/index.js";
import type { ScreenReport, ServerMessage } from "../src/spec/types.js";

let file: string;
beforeAll(() => {
  file = join(mkdtempSync(join(tmpdir(), "showboard-")), "shop.sqlite");
  const setup = new DatabaseSync(file);
  setup.exec("CREATE TABLE sales (product TEXT, revenue REAL); INSERT INTO sales VALUES ('Lamp', 120), ('Desk', 450), ('Chair', 300);");
  setup.close();
});

const json = (body: unknown, origin?: string) =>
  ({ method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }) as RequestInit;
const parse = (content: string) => JSON.parse(content) as Record<string, unknown>;

/** Opens the event stream like a browser tab and returns a reader of its messages. */
async function openTab(handle: (r: Request) => Promise<Response>, tab: string) {
  const res = await handle(new Request(`http://localhost/sb/stream?tab=${tab}`));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async function next(): Promise<ServerMessage> {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (chunk.startsWith("data: ")) return JSON.parse(chunk.slice(6)) as ServerMessage;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += decoder.decode(value);
    }
  };
}

const report = (tab: string, extra: Partial<ScreenReport> = {}): ScreenReport => ({
  tab, url: "http://localhost:5173/", title: "Shop", focused: true, state: { page: "orders" },
  actions: [{ name: "open_page", description: "Open a page", input: z.toJSONSchema(z.object({ page: z.string() })) as Record<string, unknown> }],
  components: [], boardId: null, ...extra,
});

describe("showboard server", () => {
  let sb: Showboard;
  let handle: (r: Request) => Promise<Response>;
  beforeAll(async () => {
    sb = await createShowboard({ db: file, replyTimeoutMs: 1000 });
    handle = sb.handler({ basePath: "/sb" });
  });

  it("keeps query results as datasets and previews them", async () => {
    const out = await sb.callTool("query_data", { name: "top", sql: "select product, revenue from sales order by revenue desc", preview_rows: 2 });
    expect(out.ok).toBe(true);
    expect(parse(out.content)).toMatchObject({ dataset: "top", rows: 3, columns: ["product (text)", "revenue (number)"], preview: [{ product: "Desk", revenue: 450 }, { product: "Chair", revenue: 300 }] });
  });

  it("refuses a board that reads columns the dataset lacks, with the fix", async () => {
    const out = await sb.callTool("show_board", { title: "Top", spec: { root: "b", elements: { b: { type: "BarChart", props: { dataset: "top", x: "product", y: ["profit"] } } } } });
    expect(out.ok).toBe(false);
    expect(parse(out.content).problems).toEqual(['b: column "profit" is not in dataset "top" (it has: product, revenue).']);
  });

  it("sends a board to the tab, waits for it, and runs actions there", async () => {
    const next = await openTab(handle, "t1");
    expect((await next()).type).toBe("hello");
    expect((await handle(new Request("http://localhost/sb/screen", json(report("t1"))))).status).toBe(200);

    const screen = parse((await sb.callTool("get_screen", {})).content);
    expect(screen).toMatchObject({ connected: true, state: { page: "orders" }, actions: [{ name: "open_page" }] });

    const shown = sb.callTool("show_board", { title: "Best sellers", spec: { root: "b", elements: { b: { type: "BarChart", props: { dataset: "top", x: "product", y: ["revenue"] } } } } });
    const message = await next();
    if (message.type !== "board") throw new Error(`expected a board, got ${message.type}`);
    expect(message.board.datasets.top?.rows).toHaveLength(3);
    await handle(new Request("http://localhost/sb/reply", json({ request: message.request, ok: true, result: { problems: [] } })));
    expect(parse((await shown).content)).toMatchObject({ shown: true, board: message.board.id });

    const acted = sb.callTool("ui_act", { action: "open_page", input: { page: "products" } });
    const act = await next();
    if (act.type !== "act") throw new Error(`expected an action, got ${act.type}`);
    expect(act).toMatchObject({ action: "open_page", input: { page: "products" } });
    await handle(new Request("http://localhost/sb/reply", json({ request: act.request, ok: true, result: { opened: "products" } })));
    expect(parse((await acted).content)).toEqual({ done: true, result: { opened: "products" } });

    const reopened = sb.callTool("show_board", { id: message.board.id });
    const again = await next();
    if (again.type !== "board") throw new Error("expected the saved board");
    expect(again.board.title).toBe("Best sellers");
    await handle(new Request("http://localhost/sb/reply", json({ request: again.request, ok: true })));
    expect(parse((await reopened).content).shown).toBe(true);
  });

  it("refuses other websites and non-JSON posts, and answers local origins with CORS", async () => {
    expect((await handle(new Request("http://localhost/sb/tools/query_data", json({ name: "x", sql: "select 1" }, "https://evil.example")))).status).toBe(403);
    expect((await handle(new Request("http://rebound.example:4710/sb/boards"))).status).toBe(403);
    expect((await handle(new Request("http://localhost/sb/tools/describe_data", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }))).status).toBe(400);
    const ok = await handle(new Request("http://localhost/sb/tools/describe_data", json({}, "http://localhost:5173")));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("lists tools with JSON schemas for the MCP bridge", async () => {
    const tools = (await (await handle(new Request("http://localhost/sb/tools"))).json()) as { name: string; input_schema: { type: string } }[];
    expect(tools.map((t) => t.name)).toEqual(["describe_data", "recipe", "draw", "query_data", "show_board", "list_boards", "get_screen", "ui_act"]);
    expect(tools.every((t) => t.input_schema.type === "object")).toBe(true);
  });
});

describe("without a browser", () => {
  it("saves the board and says nothing is on screen", async () => {
    const sb = await createShowboard({ db: file, replyTimeoutMs: 200 });
    await sb.callTool("query_data", { name: "all_sales", sql: "select * from sales" });
    const out = parse((await sb.callTool("show_board", { title: "All", spec: { root: "t", elements: { t: { type: "Table", props: { dataset: "all_sales" } } } } })).content);
    expect(out).toMatchObject({ shown: false });
    expect(String(out.note)).toMatch(/No browser/);
    expect(parse((await sb.callTool("list_boards", {})).content).boards).toHaveLength(1);
    expect(parse((await sb.callTool("ui_act", { action: "x" })).content).error).toMatch(/No browser/);
  });
});
