import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { AGENTS, pickAgents, type Agent, type Launch } from "./agents.js";

// `showboard doctor` checks a folder's setup the way an agent will meet it, with no agent and
// no model. It reads each agent's settings file, starts each Showboard entry exactly as that
// agent would (same command, same folder), and makes the agent's first moves over MCP: the
// handshake, the tool list, describe_data. Every problem comes with its fix, so the coding agent
// that ran init can finish the job without the person.

export interface Check {
  /** What was checked: "node", or the agents an entry belongs to ("claude,codex"). */
  check: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  root: string;
  checks: Check[];
  /** What to do, or tell the person, once everything passes. */
  next: string[];
}

export interface DoctorOptions {
  root: string;
  /** --agent: check only these, and fail for one that is not set up. */
  agents?: string[];
  home?: string;
  /** How to run this command line, for the fixes it prints: `npx -y showboard`, or node and this file. */
  self: string;
  /** How long a started entry has to answer each step; npx may download Showboard first. */
  timeoutMs?: number;
}

/** node:sqlite, which spreadsheets and SQLite files need, is built in without a flag from Node 22.13 and 23.4. */
export function nodeHasSqlite(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 23 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
}

interface Found {
  agent: Agent;
  /** The settings file, as the person would name it. */
  file: string;
  launch: Launch;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const { root, self } = options;
  const home = options.home ?? homedir();
  const checks: Check[] = [];
  const next: string[] = [];
  const report = (): DoctorReport => ({ ok: !checks.some((c) => c.status === "fail"), root, checks, next });

  checks.push(
    nodeHasSqlite()
      ? { check: "node", status: "ok", detail: `Node.js ${process.versions.node}` }
      : { check: "node", status: "fail", detail: `Node.js ${process.versions.node} is too old: Showboard needs 22.13 or later to read spreadsheets and SQLite files.`, fix: "Install Node.js 22.13 or later (https://nodejs.org), then start the agent again." },
  );

  const named = options.agents?.length ? pickAgents(options.agents, root) : undefined;
  const found: Found[] = [];
  const unset: { agent: Agent; status: Check["status"]; detail: string; unreadable?: boolean }[] = [];
  for (const agent of named ?? AGENTS) {
    const path = agent.file(root, home);
    const file = agent.userWide ? path : relative(root, path);
    // A user-wide file serves every project: unless named, only an entry for this folder concerns it.
    const mine = named !== undefined || !agent.userWide;
    if (!existsSync(path)) {
      if (named) unset.push({ agent, status: "fail", detail: `${agent.label}: there is no ${file}.` });
      continue;
    }
    let launch: Launch | undefined;
    try {
      const text = readFileSync(path, "utf8");
      launch = text.trim() ? agent.read(text) : undefined;
    } catch (err) {
      if (mine) unset.push({ agent, status: "fail", detail: `${agent.label}: ${file} could not be read (${(err as Error).message}).`, unreadable: true });
      continue;
    }
    if (!launch) {
      if (mine) unset.push({ agent, status: named ? "fail" : "warn", detail: `${agent.label}: ${file} has no showboard server.` });
      continue;
    }
    if (!mine && !namesFolder(launch, root)) continue; // a user-wide entry for another folder
    found.push({ agent, file, launch });
  }

  // The exact init command for an agent: the data options of an entry already there, if any.
  const known = found[0]?.launch ?? (named ? AGENTS.filter((a) => !a.userWide).map((a) => readEntry(a, root, home)).find(Boolean) : undefined);
  const data = known ? initArgs(known.args) : "<files or folder | --db … | --url …>";
  const initFor = (names: string) => `${self} init ${data} --agent ${names}`;
  for (const u of unset) {
    const init = initFor(u.agent.name);
    checks.push({ check: u.agent.name, status: u.status, detail: u.detail, fix: u.unreadable ? `Make it plain JSON again, or add the showboard server by hand (${init} prints the entry).` : init });
  }

  if (!found.length && !named) {
    checks.push({
      check: "setup",
      status: "fail",
      detail: "Showboard is not set up for any agent in this folder.",
      fix: `${self} init <spreadsheet files or folder> | --db <file.sqlite | postgres url> | --url <your app's Showboard url>  [--agent claude,codex,…]`,
    });
    return report();
  }

  // Agents with the same entry start the same server: check it once.
  const groups = new Map<string, Found[]>();
  for (const f of found) groups.set(JSON.stringify(f.launch), [...(groups.get(JSON.stringify(f.launch)) ?? []), f]);
  const urls = new Set<string>();
  const ports = new Set<string>();
  for (const group of groups.values()) {
    const args = group[0]!.launch.args.map((a) => a.replaceAll("${workspaceFolder}", root));
    const url = flag(args, "--url");
    if (url) urls.add(url);
    else ports.add(flag(args, "--port") ?? "4710");
    const init = initFor(group.map((g) => g.agent.name).join(","));
    checks.push(await checkEntry(group, { command: group[0]!.launch.command, args }, root, self, init, options.timeoutMs));
  }

  if (report().ok) {
    for (const note of new Set(found.map((f) => f.agent.note))) next.push(note);
    for (const port of ports) next.push(`Boards appear at http://localhost:${port} while the agent runs. Ask the person to open it in a browser, or to run this in a terminal beside the agent: ${self} pane${port === "4710" ? "" : ` --url http://127.0.0.1:${port}`}`);
    for (const url of urls) next.push(`Boards appear on the app's page that renders <Board />, while the app runs, or in a terminal: ${self} pane --url ${url}`);
    next.push('To try it, ask the agent: "What is in my data? Draw me a board of it."');
  }
  return report();
}

/** An agent's Showboard entry in this folder, if its settings file has one it can read. */
function readEntry(agent: Agent, root: string, home: string): Launch | undefined {
  try {
    const text = readFileSync(agent.file(root, home), "utf8");
    return text.trim() ? agent.read(text) : undefined;
  } catch {
    return undefined;
  }
}

async function checkEntry(group: Found[], launch: Launch, root: string, self: string, init: string, timeoutMs?: number): Promise<Check> {
  const check = group.map((g) => g.agent.name).join(",");
  const who = group.map((g) => `${g.agent.label} (${g.file})`).join(", ");
  const fail = (detail: string, fix: string): Check => ({ check, status: "fail", detail: `${who}: ${detail}`, fix });

  const script = /^node(\.exe)?$/i.test(launch.command) ? launch.args[0] : undefined;
  // node finds the script from the folder the agent starts it in: the project, for every agent init writes.
  if (script && !existsSync(resolve(root, script))) {
    return fail(`the entry starts ${script}, which does not exist.`, `Build Showboard there (npm run build), or rerun init from where Showboard is now: ${init}`);
  }
  const url = flag(launch.args, "--url");
  const app = url ? await health(url) : undefined;
  if (url && app !== "ok") {
    const path = new URL(url).pathname;
    if (app === "down") return fail(`Showboard forwards to the app at ${url}, which is not running.`, `Start the app, then run ${self} doctor again.`);
    if (app === 404) return fail(`the app runs, but nothing answers at ${url}/health.`, `Mount Showboard's handler at ${path} with handler({ basePath: "${path}" }) (${self} guide shows how for each framework), or rerun init with the --url it is mounted at.`);
    return fail(`the app answered ${url}/health with ${typeof app === "number" ? `HTTP ${app}` : "something that is not Showboard"}.`, "Read the app's server log for the error.");
  }

  const result = await probe(launch, root, timeoutMs);
  if (result.error) return fail(`Showboard did not start: ${result.error}.${result.log ? ` It said: ${result.log}` : ""}`, fixFor(`${result.error}\n${result.log}`, self));
  if (!result.tools.includes("draw")) return fail(`Showboard started, but its tool list has no draw (${result.tools.join(", ") || "no tools"}).`, `Run ${self} doctor again; if it repeats, the app's Showboard may be outdated.`);

  const database = result.data?.database;
  const sources = result.data?.sources ?? [];
  const tables = database?.tables ?? [];
  const names = tables.map((t) => t.table);
  const data = [
    database ? `${tables.length} ${tables.length === 1 ? "table" : "tables"}${names.length ? `: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}` : ""}` : "",
    sources.length ? `${sources.length} app ${sources.length === 1 ? "source" : "sources"}` : "",
  ].filter(Boolean);
  const notes = database?.notes?.length ? ` Notes on the data: ${database.notes.slice(0, 3).join(" ")}` : "";
  if (!tables.length && !sources.length) {
    return { check, status: "warn", detail: `${who}: Showboard starts, but finds no tables to read.${notes}`, fix: "Check the files, folder or --db the entry names; rerun init with the right ones." };
  }
  return { check, status: "ok", detail: `${who}: Showboard starts and answers (${result.tools.length} tools). Data: ${data.join(", ")}.${notes}` };
}

/** The fix for what a server that would not start said. */
function fixFor(said: string, self: string): string {
  const port = /Port (\d+) is taken/.exec(said);
  if (port) return `Another program uses port ${port[1]}. Rerun init with --port <a free port>, the same for every agent.`;
  if (/ENOENT|could not run|not recognized/i.test(said)) return "The entry's command is not on this machine's PATH. Install Node.js 22.13 or later, or rerun init so the entry names a command that exists.";
  if (/Node\.js 22\.13|node:sqlite/i.test(said)) return "Install Node.js 22.13 or later, then start the agent again.";
  if (/Pass --db|SHOWBOARD_DB/.test(said)) return `The entry names no data. Rerun ${self} init with spreadsheet files, --db, or --url; or set SHOWBOARD_DB where the agent starts.`;
  if (/password authentication|ECONNREFUSED|getaddrinfo|role .* does not exist/i.test(said)) return "Showboard could not reach the Postgres database: check the URL (or SHOWBOARD_DB) and that the database is running.";
  if (/no such file|does not exist|unable to open|cannot find/i.test(said)) return `A file the entry names is missing. Check its --db or file paths, and rerun ${self} init with the right ones.`;
  return `Fix what it said, then run ${self} doctor again.`;
}

export interface ProbeResult {
  tools: string[];
  /** describe_data's answer. */
  data?: {
    database: { kind: string; tables: { table: string; rows?: number }[]; notes?: string[] } | null;
    sources?: { name: string }[];
  };
  error?: string;
  /** The last lines the server wrote to stderr. */
  log: string;
}

/** Starts an entry as an agent would and makes an agent's first MCP calls; stops it after. */
export async function probe(launch: Launch, cwd: string, timeoutMs = 45_000): Promise<ProbeResult> {
  const child = spawn(launch.command, launch.args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let log = "";
  child.stderr.on("data", (chunk: Buffer) => (log = (log + chunk.toString()).slice(-4000)));
  let ended: (err: Error) => void = () => {};
  const gone = new Promise<never>((_, reject) => (ended = reject));
  gone.catch(() => {}); // only a pending request listens
  child.on("error", (err) => ended(new Error(`could not run ${launch.command} (${err.message})`)));
  child.on("exit", (code) => ended(new Error(`it exited${code === null ? "" : ` with code ${code}`}`)));

  const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
      if (typeof message.id === "number") pending.get(message.id)?.(message);
    } catch {
      // not a protocol line
    }
  });
  let id = 0;
  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = async <T>(method: string, params: object): Promise<T> => {
    const n = ++id;
    let timer: NodeJS.Timeout | undefined;
    const answer = new Promise<{ result?: unknown; error?: { message: string } }>((done) => pending.set(n, done));
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer to ${method} within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)));
    send({ id: n, method, params });
    try {
      const message = await Promise.race([answer, gone, late]);
      if (message.error) throw new Error(`${method}: ${message.error.message}`);
      return message.result as T;
    } finally {
      clearTimeout(timer);
      pending.delete(n);
    }
  };

  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "showboard-doctor", version: "0.2.0" } });
    send({ method: "notifications/initialized" });
    const list = await request<{ tools?: { name: string }[] }>("tools/list", {});
    const tools = (list.tools ?? []).map((t) => t.name);
    let data: ProbeResult["data"];
    if (tools.includes("describe_data")) {
      const out = await request<{ content?: { text?: string }[] }>("tools/call", { name: "describe_data", arguments: {} });
      try {
        data = JSON.parse(out.content?.[0]?.text ?? "") as ProbeResult["data"];
      } catch {
        // an answer that is not JSON: leave the data out
      }
    }
    return { tools, data, log: lastLines(log) };
  } catch (err) {
    return { tools: [], error: (err as Error).message, log: lastLines(log) };
  } finally {
    await stop(child);
  }
}

/** Closing stdin ends an MCP server; a server that hangs on (or cmd /c's child) is killed with its children. */
async function stop(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.stdin?.end();
  const timer = new Promise<"late">((done) => setTimeout(() => done("late"), 3000).unref());
  if ((await Promise.race([exited, timer])) !== "late") return;
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGKILL");
  await Promise.race([exited, new Promise((done) => setTimeout(done, 2000).unref())]);
}

/** The server's last few lines, without Node's notice that node:sqlite is experimental. */
function lastLines(log: string): string {
  return log
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l))
    .slice(-4)
    .join(" ")
    .trim();
}

/** Whether Showboard answers at a URL: "ok", "down" (nothing listening), an HTTP status, or "other" (not Showboard's answer). */
async function health(url: string): Promise<"ok" | "down" | "other" | number> {
  let res: Response;
  try {
    // A dev server may compile the route on its first request, so give it a while.
    res = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return "down";
  }
  if (!res.ok) return res.status;
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  return body?.ok === true ? "ok" : "other";
}

/** An entry's `mcp …` arguments as init takes them: the data options, without the folder. */
function initArgs(args: string[]): string {
  const rest = args.slice(args.indexOf("mcp") + 1);
  return rest.filter((_, i) => rest[i] !== "--root" && rest[i - 1] !== "--root").map(shellArg).join(" ");
}

/** An argument as it is typed in a shell: quoted when it holds spaces. */
export const shellArg = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function namesFolder(launch: Launch, root: string): boolean {
  const given = flag(launch.args, "--root");
  const same = (a: string) => (process.platform === "win32" ? a.toLowerCase() : a);
  return given !== undefined && same(resolve(given)) === same(resolve(root));
}

/** The report as lines for a terminal. */
export function formatReport(report: DoctorReport, self: string): string {
  const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
  const lines = [`showboard doctor: ${report.root}`, ""];
  for (const c of report.checks) {
    lines.push(`  ${mark[c.status]} ${c.detail}`);
    if (c.fix && c.status !== "ok") lines.push(`      Fix: ${c.fix}`);
  }
  lines.push("");
  if (report.ok) lines.push("Showboard is set up. Next:", ...report.next.map((n) => `  - ${n}`));
  else lines.push(`Fix the ✗ items, then check again: ${self} doctor`);
  return `${lines.join("\n")}\n`;
}
