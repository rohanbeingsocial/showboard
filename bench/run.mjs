// What it costs Claude Code to answer data questions with charts, two ways, on the same
// spreadsheets (examples/spreadsheets) with the same model:
//
//   app        the Claude app's method: read the uploaded files with code, then write the
//              charts as one self-contained HTML artifact (board.html)
//   showboard  Showboard over the same files: SQL in, board out
//
// Every question runs in a fresh `claude -p` session (a follow-up, where given, continues
// it), and the token counts and cost come from Claude Code's own usage report. Your user
// settings (hooks, plugins) are left out with --setting-sources project, and both ways get a
// minimal tool set. Results go to bench/results/.
//
//   node bench/run.mjs [--model opus] [--effort medium] [--reps 1] [--modes app,showboard] [--only trend,targets]

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "examples", "spreadsheets", "data");
const CLI = join(ROOT, "packages", "showboard", "dist", "cli", "main.js");
const PORT = 4720;

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "opus" },
    effort: { type: "string", default: "medium" },
    reps: { type: "string", default: "1" },
    modes: { type: "string", default: "app,showboard" },
    only: { type: "string" },
  },
});
const questions = JSON.parse(readFileSync(join(ROOT, "bench", "questions.json"), "utf8")).filter((q) => !values.only || values.only.split(",").includes(q.id));
const modes = values.modes.split(",");

if (!existsSync(join(DATA, "Sales 2026.xlsx"))) await run("node", [join(ROOT, "examples", "spreadsheets", "make.mjs")], ROOT);
if (!existsSync(CLI)) throw new Error("Build first: npm run build");
const files = readdirSync(DATA).filter((f) => !f.startsWith("."));

const COMMON = "This is an isolated benchmark run: skip any personal start-up routine (kernel, memory or state files) and use only this folder.";
const PROMPTS = {
  app: `You are answering in a chat app, the way the Claude app (claude.ai) does. The user uploaded these files, in ./data: ${files.join(", ")}. Analyse them with code (Python 3 with pandas and openpyxl is installed; Node works too). Show your answer as charts in one self-contained HTML file named board.html, the way you would make an artifact (it may load a chart library from a CDN), and reply briefly. ${COMMON}`,
  showboard: `The user's spreadsheets (./data: ${files.join(", ")}) are loaded as tables. Show your answer on their board with the showboard tools, and reply briefly. ${COMMON}`,
};

function flags(mode, dir) {
  const base = ["--model", values.model, "--effort", values.effort, "--output-format", "stream-json", "--verbose", "--setting-sources", "project", "--strict-mcp-config"];
  if (mode === "app") return [...base, "--tools", "Bash", "Read", "Write", "Glob", "--allowedTools", "Bash", "Read", "Write", "Glob", "--append-system-prompt", PROMPTS.app];
  const mcp = join(dir, "mcp.json");
  writeFileSync(mcp, JSON.stringify({ mcpServers: { showboard: { command: "node", args: [CLI, "mcp", "data", "--port", String(PORT)] } } }));
  return [...base, "--mcp-config", mcp, "--tools", "", "--allowedTools", "mcp__showboard", "--append-system-prompt", PROMPTS.showboard];
}

function run(command, args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(input ?? "");
  });
}

/** `showboard mcp` joins a Showboard already on its port, so wait for the last run's to close. */
async function portFree() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/tools`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${PORT} is still held by an earlier Showboard`);
}

/** One `claude -p` turn: its usage, the tools it called and its reply. */
async function turn(mode, dir, prompt, resume) {
  if (mode === "showboard") await portFree();
  const started = Date.now();
  const { out, err } = await run(process.env.CLAUDE_BIN || "claude", [...(resume ? ["--resume", resume] : []), ...flags(mode, dir)], dir, prompt);
  const events = out.split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const result = events.find((e) => e.type === "result");
  if (!result) throw new Error(`no result from claude (${mode}): ${err.slice(0, 400)}`);
  const tools = events.filter((e) => e.type === "assistant").flatMap((e) => e.message.content.filter((c) => c.type === "tool_use").map((c) => c.name.replace(/^mcp__showboard__/, "")));
  const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  for (const u of Object.values(result.modelUsage ?? {})) {
    usage.input += u.inputTokens ?? 0;
    usage.cacheWrite += u.cacheCreationInputTokens ?? 0;
    usage.cacheRead += u.cacheReadInputTokens ?? 0;
    usage.output += u.outputTokens ?? 0;
  }
  return { session: result.session_id, models: Object.keys(result.modelUsage ?? {}), steps: result.num_turns, cost: result.total_cost_usd, seconds: (Date.now() - started) / 1000, usage, tools, reply: result.result ?? "" };
}

/** Whether the answer reached the screen: board.html written (app) or a board saved (showboard). */
function delivered(mode, dir, since) {
  if (mode === "app") {
    const file = join(dir, "board.html");
    return existsSync(file) && statSync(file).mtimeMs >= since ? `board.html ${Math.round(statSync(file).size / 1024)} KB` : "no board.html";
  }
  const boards = join(dir, ".showboard", "boards");
  const n = existsSync(boards) ? readdirSync(boards).filter((f) => statSync(join(boards, f)).mtimeMs >= since).length : 0;
  return n ? `${n} board${n > 1 ? "s" : ""}` : "no board";
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const runsDir = join(ROOT, "bench", ".runs", stamp);
const resultsDir = join(ROOT, "bench", "results");
mkdirSync(resultsDir, { recursive: true });
const rows = [];
const save = () => writeFileSync(join(resultsDir, `${stamp}-${values.model}.json`), `${JSON.stringify(rows, null, 2)}\n`);

for (let rep = 1; rep <= Number(values.reps); rep++) {
  for (const q of questions) {
    for (const mode of modes) {
      const dir = join(runsDir, `${q.id}-${mode}-${rep}`);
      mkdirSync(dir, { recursive: true });
      cpSync(DATA, join(dir, "data"), { recursive: true });
      const prompts = [q.ask, ...(q.then ? [q.then] : [])];
      let session;
      for (const [i, prompt] of prompts.entries()) {
        const since = Date.now();
        try {
          const t = await turn(mode, dir, prompt, session);
          session = t.session;
          rows.push({ question: q.id, part: i ? "follow-up" : "ask", mode, rep, ...t, delivered: delivered(mode, dir, since) });
          console.log(`${q.id}${i ? " (follow-up)" : ""} ${mode}: ${t.steps} steps, ${t.usage.output} out, ${t.usage.cacheRead} cached in, $${t.cost.toFixed(3)}, ${t.seconds.toFixed(0)} s, ${rows.at(-1).delivered}`);
        } catch (err) {
          rows.push({ question: q.id, part: i ? "follow-up" : "ask", mode, rep, error: err.message });
          console.log(`${q.id} ${mode}: FAILED ${err.message}`);
          break;
        }
        save();
      }
    }
  }
}

// The table: one line per question and way, then totals per way.
const fmt = (n) => n.toLocaleString("en-US");
const models = [...new Set(rows.flatMap((r) => r.models ?? []))].join(", ");
const lines = [`# Benchmark ${stamp}, model ${values.model}${models ? ` (${models})` : ""}, ${values.effort} effort`, "", "| Question | Way | Steps | Output tokens | Input tokens (new) | Input tokens (cached) | Cost (list price) | Seconds | Delivered |", "|---|---|---|---|---|---|---|---|---|"];
const totals = {};
for (const r of rows.filter((r) => !r.error)) {
  lines.push(`| ${r.question}${r.part === "follow-up" ? " (follow-up)" : ""} | ${r.mode} | ${r.steps} | ${fmt(r.usage.output)} | ${fmt(r.usage.input + r.usage.cacheWrite)} | ${fmt(r.usage.cacheRead)} | $${r.cost.toFixed(3)} | ${r.seconds.toFixed(0)} | ${r.delivered} |`);
  const t = (totals[r.mode] ??= { steps: 0, output: 0, fresh: 0, cached: 0, cost: 0, seconds: 0 });
  t.steps += r.steps;
  t.output += r.usage.output;
  t.fresh += r.usage.input + r.usage.cacheWrite;
  t.cached += r.usage.cacheRead;
  t.cost += r.cost;
  t.seconds += r.seconds;
}
lines.push("", "| Way | Steps | Output tokens | Input tokens (new) | Input tokens (cached) | Cost (list price) | Seconds |", "|---|---|---|---|---|---|---|");
for (const [mode, t] of Object.entries(totals)) lines.push(`| ${mode} | ${t.steps} | ${fmt(t.output)} | ${fmt(t.fresh)} | ${fmt(t.cached)} | $${t.cost.toFixed(2)} | ${t.seconds.toFixed(0)} |`);
const failed = rows.filter((r) => r.error);
if (failed.length) lines.push("", `Failed: ${failed.map((r) => `${r.question} ${r.mode} (${r.error})`).join("; ")}`);
writeFileSync(join(resultsDir, `${stamp}-${values.model}.md`), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nRuns kept in ${runsDir}`);
