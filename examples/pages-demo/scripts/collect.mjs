// Copies real benchmark answers into src/answers.json for the demo page: each question,
// the board Claude drew for it with Showboard, and what the answer took both ways on
// average, over every try in the given runs. The boards come from bench/.runs (local only,
// gitignored), so this runs on a machine that ran the benchmark, and the JSON it writes is
// committed.
//
//   node examples/pages-demo/scripts/collect.mjs [--runs 2026-10-21-04-10,2026-10-21-05-01] [--board-rep 1]
//
// Boards come from the last run in --runs.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OUT = fileURLToPath(new URL("../src/answers.json", import.meta.url));

const { values } = parseArgs({
  options: { runs: { type: "string", default: "2026-10-21-04-10,2026-10-21-05-01" }, "board-rep": { type: "string", default: "1" } },
});
const runs = values.runs.split(",");
const questions = JSON.parse(readFileSync(join(ROOT, "bench", "questions.json"), "utf8"));
const results = runs.flatMap((run) => JSON.parse(readFileSync(join(ROOT, "bench", "results", `${run}-opus.json`), "utf8")).map((r) => ({ ...r, run })));

/** Average time and cost of one question in one mode, follow-up included. */
function average(id, mode) {
  const parts = results.filter((r) => r.question === id && r.mode === mode);
  const tries = new Set(parts.map((r) => `${r.run}:${r.rep}`)).size;
  if (!tries) throw new Error(`No ${mode} result for ${id} in ${runs.join(", ")}.`);
  const sum = (key) => parts.reduce((total, r) => total + r[key], 0) / tries;
  return { seconds: Math.round(sum("seconds")), cost: Number(sum("cost").toFixed(3)), tries };
}

const answers = questions.map((q) => {
  const dir = join(ROOT, "bench", ".runs", runs.at(-1), `${q.id}-showboard-${values["board-rep"]}`, ".showboard", "boards");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  // A follow-up redraws the same board, so each try keeps one: the last answer's.
  if (files.length !== 1) throw new Error(`Expected one board in ${dir}, found ${files.length}.`);
  const board = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
  return { id: q.id, ask: q.ask, then: q.then, showboard: average(q.id, "showboard"), alone: average(q.id, "app"), board };
});

writeFileSync(OUT, `${JSON.stringify(answers, null, 2)}\n`);
console.log(`${answers.length} answers from ${runs.join(", ")} → ${OUT}`);
