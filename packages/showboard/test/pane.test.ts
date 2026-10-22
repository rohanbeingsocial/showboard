import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createShowboard, type Showboard } from "../src/server/index.js";
import type { ServerMessage } from "../src/spec/types.js";
import { boardToText, cellWidth, lineText, type Block } from "../src/text/index.js";

let file: string;
beforeAll(() => {
  file = join(mkdtempSync(join(tmpdir(), "showboard-pane-")), "shop.sqlite");
  const setup = new DatabaseSync(file);
  setup.exec(`
    CREATE TABLE orders (day TEXT, region TEXT, product TEXT, amount REAL);
    INSERT INTO orders VALUES
      ('2026-01-01','North','Lamp',120), ('2026-02-01','North','Desk',450), ('2026-03-01','North','Chair',300),
      ('2026-01-01','South','Lamp',80), ('2026-02-01','South','Desk',200), ('2026-03-01','South','Chair',260);`);
  setup.close();
});

const parse = (content: string) => JSON.parse(content) as Record<string, unknown>;

/** Opens an event stream (a tab or a pane) and returns a reader of its messages. */
async function open(handle: (r: Request) => Promise<Response>, query: string) {
  const res = await handle(new Request(`http://localhost/sb/stream?${query}`));
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

const BOARD = {
  title: "Sales so far",
  items: [
    { title: "Totals", sql: "select sum(amount) as revenue, count(*) as orders from orders" },
    { title: "Revenue by month", sql: "select day, region, sum(amount) as amount from orders group by day, region order by day" },
    { row: [{ title: "By product", sql: "select product, sum(amount) as amount from orders group by product order by amount desc" }, { title: "Share by region", sql: "select region, sum(amount) as amount from orders group by region", show: "pie" }] },
    { title: "Orders", sql: "select day, region, product, amount from orders order by amount desc", show: "table" },
    { note: "- **North** leads.\n- South trails.", title: "Reading it", tone: "info" },
  ],
};

describe("panes", () => {
  afterEach(() => vi.useRealTimers());

  it("puts every board on a pane's stream and tells the agent where it shows", async () => {
    const sb: Showboard = await createShowboard({ db: file, replyTimeoutMs: 500, openHint: "Ask the user to open http://localhost:4710." });
    const handle = sb.handler({ basePath: "/sb" });
    const next = await open(handle, "pane=p1");
    expect(await next()).toEqual({ type: "hello", board: null });

    const drawn = parse((await sb.callTool("draw", BOARD)).content);
    expect(drawn).toMatchObject({ shown: true, where: "pane" });
    expect(String(drawn.note)).toContain("Showboard pane");
    const message = await next();
    expect(message).toMatchObject({ type: "board", board: { title: "Sales so far" } });
    expect("request" in message && message.request).toBeFalsy(); // a pane is never asked to answer

    const health = (await (await handle(new Request("http://localhost/sb/health"))).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, tabs: 0, panes: 1, board: drawn.board, shows: 1 });
    // A pane that opens later starts from the board on screen.
    expect(await (await open(handle, "pane=p2"))()).toMatchObject({ type: "hello", board: { id: drawn.board } });
  });

  it("counts a pane that polls /health for a while after its last poll", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sb = await createShowboard({ db: file, replyTimeoutMs: 500 });
    const handle = sb.handler();
    const health = async (q = "") => (await (await handle(new Request(`http://localhost/health${q}`))).json()) as { panes: number };
    expect((await health()).panes).toBe(0);
    expect((await health("?pane=claude-pane")).panes).toBe(1);
    expect(parse((await sb.callTool("draw", { title: "Totals", items: [BOARD.items[0]] })).content)).toMatchObject({ shown: true, where: "pane" });
    vi.setSystemTime(Date.now() + 11_000);
    expect((await health()).panes).toBe(0);
    expect(parse((await sb.callTool("draw", { title: "Totals", items: [BOARD.items[0]] })).content)).toMatchObject({ shown: false });
  });

  it("still waits for a browser tab when one is open, and the pane gets the board too", async () => {
    const sb = await createShowboard({ db: file, replyTimeoutMs: 2000 });
    const handle = sb.handler({ basePath: "/sb" });
    const pane = await open(handle, "pane=p1");
    await pane();
    const tab = await open(handle, "tab=t1");
    await tab();
    const drawing = sb.callTool("draw", { title: "Totals", items: [BOARD.items[0]] });
    const message = await tab();
    if (message.type !== "board" || !message.request) throw new Error("the tab should be asked to confirm");
    await handle(new Request("http://localhost/sb/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: message.request, ok: true, result: { problems: [] } }) }));
    expect(parse((await drawing).content)).toMatchObject({ shown: true });
    expect(parse((await drawing).content).where).toBeUndefined();
    expect(await pane()).toMatchObject({ type: "board", board: { title: "Totals" } });
  });
});

describe("boards as text", () => {
  let blocks: (width: number, sources?: boolean) => Block[];
  beforeAll(async () => {
    const sb = await createShowboard({ db: file });
    const id = parse((await sb.callTool("draw", { ...BOARD, items: [...BOARD.items, { component: "ActionButton", props: { label: "Open North", action: "open_region", input: { region: "North" } } }] })).content).board as string;
    const board = (await (await sb.handler()(new Request(`http://localhost/boards/${id}`))).json()) as Parameters<typeof boardToText>[0];
    blocks = (width, sources = false) => boardToText(board, { width, sources, format: { locale: "en-US", currency: "USD" } });
  });
  const text = (b: Block[]) => b.flatMap((x) => (x.kind === "text" ? x.lines.map(lineText) : [`[${x.label}]`])).join("\n");

  it("reads every figure from the datasets", () => {
    const out = text(blocks(72));
    expect(out).toContain("Revenue"); // metric labels
    expect(out).toMatch(/1,410/); // sum of amounts
    expect(out).toMatch(/● North\s+300/); // a line per region, with its latest value
    expect(out).toMatch(/Desk\s+█+.*650/); // bars: Desk 450 + 200
    expect(out).toMatch(/■ North\s+61\.7%/); // pie share: 870 of 1,410
  });

  it("draws tables, notes and buttons", () => {
    const out = text(blocks(72));
    expect(out).toMatch(/Day\s+Region\s+Product\s+Amount/);
    expect(out).toContain("▌ • North leads.");
    const button = blocks(72).find((b) => b.kind === "action");
    expect(button).toEqual({ kind: "action", label: "Open North", action: "open_region", input: { region: "North" } });
  });

  it("keeps every line inside the width, and shows the SQL when asked", () => {
    for (const width of [24, 40, 80, 120]) {
      for (const block of blocks(width, true)) if (block.kind === "text") for (const line of block.lines) expect(cellWidth(lineText(line))).toBeLessThanOrEqual(width);
    }
    expect(text(blocks(80, true))).toContain("select product, sum(amount) as amount from orders");
  });
});
