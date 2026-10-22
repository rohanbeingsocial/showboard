import { createInterface } from "node:readline";
import type { ToolCallResult } from "../server/http.js";

// A coding agent (Claude Code, Codex, OpenCode, Gemini CLI…) talks MCP over stdio to this
// process. The tools either run here (the process also serves the browser) or are forwarded
// to a Showboard already serving at a URL. The list is checked every few seconds and the
// agent is told when it changes (a recipe saved, the app restarted with new tools, or an app
// that was not up yet), so agents that listen need no restart.

export interface ToolBackend {
  /** `waitMs` is how long to keep trying while the app starts. */
  list(waitMs?: number): Promise<{ name: string; description: string; input_schema: unknown }[]>;
  call(name: string, input: unknown): Promise<ToolCallResult>;
}

const WATCH_MS = 10_000;

/** Forwards to a running Showboard. It may still be starting, so the list is retried for a while. */
export function remoteBackend(url: string, startWaitMs = 25_000): ToolBackend {
  const base = url.replace(/\/$/, "");
  return {
    async list(waitMs = startWaitMs) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        try {
          const res = await fetch(`${base}/tools`);
          if (res.ok) return (await res.json()) as Awaited<ReturnType<ToolBackend["list"]>>;
          if (Date.now() > deadline) throw new Error(`tool list failed: HTTP ${res.status}`);
        } catch (err) {
          if (Date.now() > deadline) throw new Error(`Showboard at ${base}: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
    async call(name, input) {
      const res = await fetch(`${base}/tools/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input ?? {}),
      });
      return (await res.json().catch(() => ({ ok: false, content: JSON.stringify({ error: `HTTP ${res.status}` }) }))) as ToolCallResult;
    },
  };
}

/** `instructions` may be empty: a server with nothing to say gives none. */
export function runMcp(backend: ToolBackend, instructions: string, version: string): void {
  const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const fingerprint = (tools: Awaited<ReturnType<ToolBackend["list"]>>) => JSON.stringify(tools.map((t) => [t.name, t.description, t.input_schema]));
  let listed: string | null = null;
  let watching = false;

  function watch() {
    if (watching) return;
    watching = true;
    setInterval(async () => {
      try {
        const now = fingerprint(await backend.list(0));
        if (now === listed) return;
        listed = now;
        send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      } catch {
        // The app is down for now; the next check tries again.
      }
    }, WATCH_MS).unref();
  }

  async function result(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: (params?.protocolVersion as string | undefined) ?? "2025-06-18",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "showboard", version },
          ...(instructions ? { instructions } : {}),
        };
      case "ping":
        return {};
      case "tools/list": {
        let tools: Awaited<ReturnType<ToolBackend["list"]>> = [];
        try {
          tools = await backend.list();
        } catch (err) {
          console.error(`showboard: ${(err as Error).message}. The tools appear once it answers.`);
        }
        listed = fingerprint(tools);
        watch();
        return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) };
      }
      case "tools/call": {
        const out = await backend.call(String(params?.name), params?.arguments ?? {});
        return { content: [{ type: "text", text: out.content }], isError: !out.ok };
      }
      default:
        return undefined;
    }
  }

  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: { id?: number | string | null; method: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // notifications need no reply
    try {
      const out = await result(msg.method, msg.params);
      if (out === undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
      else send({ jsonrpc: "2.0", id: msg.id, result: out });
    } catch (err) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: (err as Error).message } });
    }
  });
  lines.on("close", () => process.exit(0));
}
