// How much of a Claude plan's usage limit Showboard spends on the benchmark questions: the
// "current session" meter that claude.ai shows under Settings → Usage. Claude Code reports
// that meter in its stream (rate_limit_event, five_hour utilization), so this records it on
// every turn, with a tiny Haiku call before and after for a clean start and end. Compare it
// with the same questions asked on claude.ai (README). Nothing else may use the account
// while it runs, this tool's own Claude Code session included.
//
//   node bench/usage.mjs --dir <folder with .mcp.json> [--model opus] [--effort medium] [--after-reset]
//
// --after-reset waits for the five-hour window to reset first when it ends within 20 minutes.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    model: { type: "string", default: "opus" },
    effort: { type: "string", default: "medium" },
    "after-reset": { type: "boolean" },
  },
});
if (!values.dir) throw new Error("Pass --dir <folder with Showboard in .mcp.json>");
const dir = resolve(values.dir);
const questions = JSON.parse(readFileSync(join(ROOT, "bench", "questions.json"), "utf8"));
const STREAM = ["--output-format", "stream-json", "--verbose", "--setting-sources", "project", "--strict-mcp-config"];

function claude(args, prompt) {
  return new Promise((done, fail) => {
    const child = spawn(process.env.CLAUDE_BIN || "claude", ["-p", ...args, ...STREAM], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", fail);
    child.on("close", () =>
      done(
        out.split("\n").flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        }),
      ),
    );
    child.stdin.end(prompt);
  });
}

/** The five-hour meter as Claude Code last reported it: whole percent, and when it resets. */
function meter(events) {
  const window = events.filter((e) => e.type === "rate_limit_event").at(-1)?.rate_limit_info?.unifiedWindows?.five_hour;
  return window ? { percent: Math.round(window.utilization * 100), resetsAt: window.resetsAt } : null;
}

const probe = async () => meter(await claude(["--model", "haiku", "--tools", ""], "Reply with ok."));

let start = await probe();
if (values["after-reset"] && start && start.resetsAt * 1000 - Date.now() < 20 * 60_000) {
  const wait = Math.max(0, start.resetsAt * 1000 - Date.now()) + 60_000;
  console.log(`meter at ${start.percent}%; waiting ${Math.round(wait / 60_000)} min for the five-hour window to reset`);
  await new Promise((r) => setTimeout(r, wait));
  start = await probe();
}
const rows = [{ step: "start (Haiku probe)", percent: start?.percent ?? null }];
console.log(`start: ${start?.percent ?? "?"}%`);

// A folder's own settings are not read in -p until it is trusted, so allow the tools here.
const flags = ["--model", values.model, "--effort", values.effort, "--mcp-config", ".mcp.json", "--allowedTools", "mcp__showboard"];
for (const q of questions) {
  let session;
  for (const [i, prompt] of [q.ask, ...(q.then ? [q.then] : [])].entries()) {
    const started = Date.now();
    const events = await claude([...(session ? ["--resume", session] : []), ...flags], prompt);
    const result = events.find((e) => e.type === "result");
    session = result?.session_id;
    const output = Object.values(result?.modelUsage ?? {}).reduce((n, u) => n + (u.outputTokens ?? 0), 0);
    const tools = events.filter((e) => e.type === "assistant").flatMap((e) => e.message.content.filter((c) => c.type === "tool_use").map((c) => c.name.replace(/^mcp__showboard__/, "")));
    const row = { step: `${q.id}${i ? " (follow-up)" : ""}`, percent: meter(events)?.percent ?? null, steps: result?.num_turns, output, cost: result?.total_cost_usd, seconds: Math.round((Date.now() - started) / 1000), tools, reply: result?.result ?? "" };
    rows.push(row);
    console.log(`${row.step}: meter ${row.percent ?? "?"}%, ${row.steps} steps, ${output} out, $${row.cost?.toFixed(3)}, ${row.seconds} s, ${tools.join(" ")}`);
  }
}
const end = await probe();
rows.push({ step: "end (Haiku probe)", percent: end?.percent ?? null });
console.log(`end: ${end?.percent ?? "?"}%`);

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const results = join(ROOT, "bench", "results");
mkdirSync(results, { recursive: true });
writeFileSync(join(results, `usage-${stamp}.json`), `${JSON.stringify({ model: values.model, effort: values.effort, rows }, null, 2)}\n`);
const lines = [
  `# Plan usage ${stamp}: Showboard, ${values.model} at ${values.effort} effort`,
  "",
  "The meter is the five-hour \"current session\" percentage, as Claude Code reported it during each turn.",
  "",
  "| Step | Meter | Steps | Output tokens | Cost (list price) | Seconds |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.step} | ${r.percent ?? "?"}% | ${r.steps ?? ""} | ${r.output ?? ""} | ${r.cost === undefined ? "" : `$${r.cost.toFixed(3)}`} | ${r.seconds ?? ""} |`),
  "",
  `Used: ${start && end ? `${end.percent - start.percent} points` : "unknown"} of the five-hour window.`,
];
writeFileSync(join(results, `usage-${stamp}.md`), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}`);
