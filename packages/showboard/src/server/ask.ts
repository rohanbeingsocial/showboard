import { z } from "zod";
import { callTool, portable } from "./http.js";
import type { ToolDef } from "./tools.js";

// The board page's question box, for someone with data and no coding agent. Showboard sends
// the question and a few of its own tools to a model behind an OpenAI-compatible Responses API
// (BharatCode's, unless SHOWBOARD_ASK_URL names another), runs the tools the model calls, and
// answers with the model's last words. The key stays on this server: the page only POSTs the
// question to /ask, which local pages alone can reach (see http.ts).

export interface AskOptions {
  apiKey: string;
  /** Default: BharatCode's model API. */
  baseUrl?: string;
  /** Default: qwen-3.8-27b. */
  model?: string;
  /** Model calls per question; default 8. */
  maxSteps?: number;
  fetch?: typeof fetch;
}

export interface AskAnswer {
  answer: string;
  /** The board drawn last, if any. */
  board?: string;
  steps: number;
}

const OFFERED = ["describe_data", "recipe", "draw", "query_data"];

const INSTRUCTIONS = [
  "You answer the user's questions about their data with a board on their screen.",
  "Call describe_data first, then draw with every part in one call: draw shows the board. The database computes every number, so aggregate, sort and round in SQL.",
  "If draw reports problems, fix them and draw again with the same id.",
  "Then reply in at most three short sentences, quoting only figures the tools returned.",
].join(" ");

interface OutputItem {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string }[];
}

/** SHOWBOARD_ASK_KEY or BHARATCODE_API_KEY turns the question box on. */
export function askFromEnv(env: NodeJS.ProcessEnv = process.env): AskOptions | undefined {
  const apiKey = env.SHOWBOARD_ASK_KEY ?? env.BHARATCODE_API_KEY;
  if (!apiKey) return undefined;
  return { apiKey, ...(env.SHOWBOARD_ASK_URL ? { baseUrl: env.SHOWBOARD_ASK_URL } : {}), ...(env.SHOWBOARD_ASK_MODEL ? { model: env.SHOWBOARD_ASK_MODEL } : {}) };
}

export async function ask(question: string, tools: ToolDef[], options: AskOptions): Promise<AskAnswer> {
  const send = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? "https://bharatcode.ai/api/model/v1").replace(/\/$/, "")}/responses`;
  const offered = tools.filter((t) => OFFERED.includes(t.name));
  const functions = offered.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: portable(z.toJSONSchema(t.input)) }));
  // The API keeps no history (store: false), so each call resends the conversation so far.
  const input: unknown[] = [{ role: "user", content: question }];
  let board: string | undefined;

  for (let step = 1; step <= (options.maxSteps ?? 8); step++) {
    const body = JSON.stringify({ model: options.model ?? "qwen-3.8-27b", instructions: INSTRUCTIONS, input, tools: functions, store: false });
    const request = () => send(url, { method: "POST", headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }, body });
    let res = await request();
    if (res.status === 503) {
      // Busy: BharatCode asks for a retry after a few seconds.
      await new Promise((r) => setTimeout(r, 3000));
      res = await request();
    }
    if (!res.ok) throw new Error(`The model API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const output = ((await res.json()) as { output?: OutputItem[] }).output ?? [];

    const calls = output.filter((o) => o.type === "function_call");
    if (!calls.length) {
      const text = output.flatMap((o) => (o.type === "message" ? (o.content ?? []) : [])).map((c) => c.text ?? "").join("").trim();
      return { answer: text || "(The model gave no answer.)", ...(board ? { board } : {}), steps: step };
    }
    for (const call of calls) {
      input.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments ?? "{}" });
      let args: unknown;
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = undefined;
      }
      const result = args === undefined ? { ok: false, content: JSON.stringify({ error: "The arguments were not valid JSON." }) } : await callTool(offered, call.name ?? "", args);
      if (result.ok && (call.name === "draw" || call.name === "recipe")) board = (JSON.parse(result.content) as { board?: string }).board ?? board;
      input.push({ type: "function_call_output", call_id: call.call_id, output: result.content });
    }
  }
  return { answer: `Stopped after ${options.maxSteps ?? 8} model calls.`, ...(board ? { board } : {}), steps: options.maxSteps ?? 8 };
}
