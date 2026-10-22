import { z } from "zod";
import type { Reply, ScreenReport, ServerMessage } from "../spec/types.js";
import type { Hub } from "./hub.js";
import type { BoardStore } from "./store.js";
import type { ToolDef } from "./tools.js";
import { viewerResponse } from "./viewer.js";

// One fetch-style handler (Request → Response) so any server can mount it: Hono, Next.js
// route handlers, or the small node:http adapter in node.ts.
//
//   GET  /stream?tab=…   event stream to a browser tab
//   GET  /stream?pane=…  event stream to a pane, which only watches the boards
//   POST /screen         a tab reports what it shows
//   POST /reply          a tab answers a request (board shown, action done)
//   GET  /boards[/:id]   saved boards
//   GET  /tools          tool list, for the MCP bridge
//   POST /tools/:name    run a tool
//   GET  /health[?pane=…] up or not, and the board on screen; a polling pane names itself
//   GET  /               the built-in board page, when `viewer` is on
//
// It is meant for one person's machine. Browsers send an Origin header; POSTs from an
// origin not in the allow list are refused, so another website open in the same browser
// cannot run tools or actions. Requests without an Origin (the MCP bridge) are allowed.

export interface HttpOptions {
  /** Path the handler is mounted at, e.g. "/api/showboard". */
  basePath?: string;
  /** Origins allowed to call it. Default: any http://localhost or http://127.0.0.1 port. */
  isAllowedOrigin?: (origin: string) => boolean;
  /**
   * Host headers it answers. Default: localhost and 127.0.0.1, which stops a web page from
   * reaching it through a DNS name pointed at your machine. Widen it only behind real auth.
   */
  isAllowedHost?: (host: string) => boolean;
  /** Serve Showboard's own board page at the root, for use without an app. */
  viewer?: boolean;
}

export interface ToolCallResult {
  ok: boolean;
  /** JSON text, the shape Claude reads. */
  content: string;
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const KEEPALIVE_MS = 15_000;

const screenShape = z.object({
  tab: z.string().min(1).max(80),
  url: z.string().max(2000),
  title: z.string().max(300),
  focused: z.boolean(),
  state: z.record(z.string(), z.unknown()),
  actions: z.array(z.object({ name: z.string(), description: z.string(), input: z.record(z.string(), z.unknown()) })).max(200),
  components: z.array(z.object({ name: z.string(), description: z.string(), props: z.record(z.string(), z.unknown()) })).max(100),
  boardId: z.string().nullable(),
});
const replyShape = z.object({ request: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() });

/**
 * A tool's input schema without the keywords some agents' model APIs turn away ($schema,
 * propertyNames). Nothing is lost: every call is still checked against the full schema here.
 */
export function portable(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(portable);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema" && key !== "propertyNames").map(([key, value]) => [key, portable(value)]));
}

export async function callTool(tools: ToolDef[], name: string, input: unknown): Promise<ToolCallResult> {
  const def = tools.find((t) => t.name === name);
  if (!def) return { ok: false, content: JSON.stringify({ error: `Unknown tool ${name}.` }) };
  const parsed = def.input.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, content: JSON.stringify({ error: "Bad input.", problems: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) }) };
  }
  try {
    const out = await def.run(parsed.data as never);
    const failed = typeof out === "object" && out !== null && "error" in out;
    return { ok: !failed, content: JSON.stringify(out) };
  } catch (err) {
    return { ok: false, content: JSON.stringify({ error: (err as Error).message }) };
  }
}

export function createHandler(deps: { hub: Hub; boards: BoardStore; tools: ToolDef[] }, options: HttpOptions = {}) {
  const base = (options.basePath ?? "").replace(/\/$/, "");
  const isAllowedOrigin = options.isAllowedOrigin ?? ((o: string) => LOCAL_ORIGIN.test(o));
  const isAllowedHost = options.isAllowedHost ?? ((h: string) => LOCAL_HOST.test(h));
  const { hub, boards, tools } = deps;

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base)) return new Response("Not found", { status: 404 });
    if (!isAllowedHost(req.headers.get("host") ?? url.host)) return new Response("Host not allowed", { status: 403 });
    const path = url.pathname.slice(base.length) || "/";
    const origin = req.headers.get("origin");
    if (origin && !isAllowedOrigin(origin)) return new Response("Origin not allowed", { status: 403 });
    const cors: Record<string, string> = origin ? { "access-control-allow-origin": origin, vary: "origin" } : {};

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } });
    }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
    const readJson = async () => {
      if (!req.headers.get("content-type")?.includes("application/json")) throw new Error("Send JSON (content-type: application/json).");
      return req.json() as Promise<unknown>;
    };

    try {
      if (req.method === "GET" && path === "/stream") {
        const tab = url.searchParams.get("tab");
        const pane = url.searchParams.get("pane");
        if (!tab && !pane) return json({ error: "tab or pane is required" }, 400);
        return stream(tab ? { tab } : { pane: pane! }, cors);
      }
      if (req.method === "POST" && path === "/screen") {
        const report = screenShape.parse(await readJson());
        hub.report(report as ScreenReport);
        return json({ ok: true });
      }
      if (req.method === "POST" && path === "/reply") {
        const reply = replyShape.parse(await readJson());
        return json({ ok: hub.reply(reply as Reply) });
      }
      if (req.method === "GET" && path === "/boards") return json(boards.list());
      if (req.method === "GET" && path.startsWith("/boards/")) {
        const board = boards.get(decodeURIComponent(path.slice("/boards/".length)));
        return board ? json(board) : json({ error: "No such board" }, 404);
      }
      if (req.method === "GET" && path === "/tools") {
        return json(tools.map((t) => ({ name: t.name, description: t.description, input_schema: portable(z.toJSONSchema(t.input)) })));
      }
      if (req.method === "POST" && path.startsWith("/tools/")) {
        return json(await callTool(tools, decodeURIComponent(path.slice("/tools/".length)), await readJson()));
      }
      if (req.method === "GET" && path === "/health") {
        const pane = url.searchParams.get("pane");
        if (pane) hub.touch(pane.slice(0, 80));
        return json({ ok: true, tabs: hub.connected, panes: hub.watching, board: hub.shown?.id ?? null, shows: hub.shows, page: options.viewer === true });
      }
      if (req.method === "GET" && options.viewer) {
        const page = await viewerResponse(path);
        if (page) return page;
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (err as Error).message;
      return json({ error: message }, 400);
    }
  };

  function stream(who: { tab: string } | { pane: string }, cors: Record<string, string>): Response {
    let disconnect = () => {};
    let keepalive: NodeJS.Timeout | undefined;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The stream closed between the check and the write; cancel() cleans up.
          }
        };
        const send = (message: ServerMessage) => write(`data: ${JSON.stringify(message)}\n\n`);
        disconnect = "tab" in who ? hub.connect(who.tab, send) : hub.watch(who.pane.slice(0, 80), send);
        send({ type: "hello", board: hub.shown ?? boards.latest() });
        keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);
      },
      cancel() {
        clearInterval(keepalive);
        disconnect();
      },
    });
    return new Response(body, { headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
}
