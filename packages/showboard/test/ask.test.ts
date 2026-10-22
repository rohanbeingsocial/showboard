import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { askFromEnv } from "../src/server/ask.js";
import { createShowboard } from "../src/server/index.js";

function salesDb(): string {
  const file = join(mkdtempSync(join(tmpdir(), "showboard-ask-")), "sales.sqlite");
  const db = new DatabaseSync(file);
  db.exec("create table sales (region text, revenue integer); insert into sales values ('North', 120), ('South', 90), ('North', 30);");
  db.close();
  return file;
}

/** A Responses API that plays back these outputs, one per call, and keeps what it was sent. */
function fakeModel(outputs: unknown[][]) {
  const sent: { auth: string | null; body: Record<string, unknown> }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push({ auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ output: outputs[sent.length - 1] ?? [] }), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const call = (id: string, name: string, args: unknown) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const say = (text: string) => ({ type: "message", content: [{ type: "output_text", text }] });

describe("ask", () => {
  it("runs the tools the model calls and answers with its words", async () => {
    const model = fakeModel([
      [call("c1", "describe_data", {})],
      [call("c2", "draw", { title: "Revenue by region", items: [{ sql: "select region, sum(revenue) as revenue from sales group by region order by 2 desc" }] })],
      [say("North sold the most, ₹150.")],
    ]);
    const sb = await createShowboard({ db: salesDb(), replyTimeoutMs: 50 });
    const handle = sb.handler({ ask: { apiKey: "test-key", fetch: model.fetch } });

    expect(await (await handle(new Request("http://localhost/health"))).json()).toMatchObject({ ask: true });
    const res = await handle(new Request("http://localhost/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Which region sold the most?" }) }));
    const out = (await res.json()) as { answer: string; board: string; steps: number };
    expect(out).toMatchObject({ answer: "North sold the most, ₹150.", steps: 3 });
    expect(out.board).toMatch(/^b_/);

    // The key goes to the model API only; the API keeps no history, so each call resends it.
    expect(model.sent.every((s) => s.auth === "Bearer test-key" && s.body.store === false && s.body.model === "qwen-3.8-27b")).toBe(true);
    expect((model.sent[0]!.body.tools as { name: string }[]).map((t) => t.name).sort()).toEqual(["describe_data", "draw", "query_data", "recipe"]);
    const last = model.sent[2]!.body.input as { type?: string; output?: string }[];
    expect(last.filter((i) => i.type === "function_call_output")).toHaveLength(2);
    expect(JSON.parse(last.at(-1)!.output!)).toMatchObject({ board: out.board });
    await sb.close();
  });

  it("offers only its own few tools, and is off without a key", async () => {
    const model = fakeModel([[call("c1", "ui_act", { action: "delete_everything" })], [say("Done.")]]);
    const sb = await createShowboard({ db: salesDb(), replyTimeoutMs: 50 });
    const res = await sb.handler({ ask: { apiKey: "k", fetch: model.fetch } })(new Request("http://localhost/ask", { method: "POST", headers: { "content-type": "application/json" }, body: '{"question":"hi"}' }));
    expect(await res.json()).toMatchObject({ answer: "Done." });
    expect(JSON.parse((model.sent[1]!.body.input as { output?: string }[]).at(-1)!.output!)).toEqual({ error: "Unknown tool ui_act." });

    const off = sb.handler();
    expect((await off(new Request("http://localhost/ask", { method: "POST", headers: { "content-type": "application/json" }, body: '{"question":"hi"}' }))).status).toBe(404);
    expect(await (await off(new Request("http://localhost/health"))).json()).not.toHaveProperty("ask");
    // Another website open in the same browser cannot spend the key.
    const other = await sb.handler({ ask: { apiKey: "k", fetch: model.fetch } })(new Request("http://localhost/ask", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: '{"question":"hi"}' }));
    expect(other.status).toBe(403);
    await sb.close();
  });

  it("reads its key from the environment", () => {
    expect(askFromEnv({})).toBeUndefined();
    expect(askFromEnv({ BHARATCODE_API_KEY: "a" })).toEqual({ apiKey: "a" });
    expect(askFromEnv({ SHOWBOARD_ASK_KEY: "b", SHOWBOARD_ASK_URL: "http://localhost:1234/v1", SHOWBOARD_ASK_MODEL: "m" })).toEqual({ apiKey: "b", baseUrl: "http://localhost:1234/v1", model: "m" });
  });
});
