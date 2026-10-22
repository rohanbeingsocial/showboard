#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { askFromEnv } from "../server/ask.js";
import { builderAgent, createShowboard, INSTRUCTIONS, serve, type Showboard } from "../server/index.js";
import { AGENTS, agentNames, pickAgents, writeAgent, type Launch } from "./agents.js";
import { formatReport, nodeHasSqlite, runDoctor, shellArg } from "./doctor.js";
import { remoteBackend, runMcp, type ToolBackend } from "./mcp.js";
import { runPane } from "./pane.js";
import { noTools, PLUGIN_HOSTS, pluginIdle, type PluginHost } from "./plugin.js";

const HELP = `showboard: a pen for your coding agent, to draw, show and do in your app

  Setting it up for someone? "showboard guide" prints the steps, written for coding agents,
  and "showboard doctor" checks the result.

  showboard serve --db <postgres-url | file.sqlite> [--port 4710] [--boards .showboard/boards]
  showboard serve <file.xlsx | file.csv | folder> ... [--port 4710]
      Serve the tools, the browser bridge and a board page at http://localhost:4710.
      Your own app can connect instead, with <ShowboardProvider url="http://127.0.0.1:4710">.

  showboard mcp --db <...> | <files...> [--port 4710] [--boards ...] [--root <folder>]
      The MCP server your coding agent starts. It also serves the browser bridge and board
      page, or joins a Showboard already serving on that port. --root: the project folder,
      for agents that start servers somewhere else.

  showboard mcp --url <http://localhost:3000/api/showboard>
      Only forward to a Showboard your own server mounts.

  showboard mcp --plugin <claude-code | claude-desktop> [--port 4711]
      How the Claude Code plugin and the Claude desktop extension start Showboard, on the
      data in SHOWBOARD_DATA or SHOWBOARD_DB. It lists no tools in a folder whose .mcp.json starts its own Showboard,
      and none until data is set (then it says how to set it).

  showboard pane [--url <http://127.0.0.1:4710>] [--once]
      The boards as text in this terminal: split it beside any coding agent and each board
      appears as the agent draws it. --once prints the board on screen and exits.

  showboard doctor [--agent <names>] [--json]
      Check this folder's setup as each agent will meet it: starts every Showboard entry the
      agents' settings hold, lists its tools and its data, and says how to fix what fails.
      Exits 1 when something must be fixed. --json for a report to read in code.

  showboard guide
      Step-by-step setup instructions for a coding agent: which path fits the project, the
      commands, your app's server code for Next.js, Express, Hono or node:http, and checks.

  showboard --version
      The version of Showboard this is.

  showboard init [--db <...> | <files...> | --url <...>] [--agent <names>] [--port 4710]
      Add Showboard to your coding agents in this folder. --agent names them, comma
      separated: ${agentNames.join(", ")}, or all (every one but the
      user-wide antigravity and windsurf). Without it: Claude Code, plus any agent this
      folder already has settings for. Claude Code also gets a board-builder agent
      (.claude/agents, --agent-model sonnet) that draws new kinds of boards on a cheaper model.

  Spreadsheets: .xlsx, .xlsm, .csv and .tsv files, or folders of them (also --file <path>).
  Each sheet becomes a table your agent can query; the files are only read, and reloaded
  when they change. --db can also come from the SHOWBOARD_DB environment variable, and
  the data from SHOWBOARD_DATA (a spreadsheet, a folder of them or a SQLite file).
  BHARATCODE_API_KEY adds a box to ask questions on the board page, with BharatCode's model.

  Amounts print in the currency the spreadsheets are written in (₹1,200 → rupees), or
  --currency INR (any ISO code) and --locale en-IN for how digits group.
`;

const VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string }).version;

const { positionals, values } = parseArguments({
  allowPositionals: true,
  options: {
    db: { type: "string" },
    file: { type: "string", multiple: true },
    url: { type: "string" },
    port: { type: "string", default: "4710" },
    boards: { type: "string", default: ".showboard/boards" },
    root: { type: "string" },
    agent: { type: "string", multiple: true },
    "agent-model": { type: "string", default: "sonnet" },
    currency: { type: "string" },
    locale: { type: "string" },
    once: { type: "boolean" },
    json: { type: "boolean" },
    plugin: { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

function parseArguments<const T extends ParseArgsConfig>(config: T) {
  try {
    return parseArgs(config);
  } catch (err) {
    console.error(`showboard: ${(err as Error).message.replace(/. To specify a positional argument.*$/, ".")} See showboard --help.`);
    process.exit(2);
  }
}
const command = positionals[0];
const port = Number(values.port);
/** An environment setting; empty, or a ${…} placeholder nobody filled in, is no setting. */
function setting(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.includes("${") ? value : undefined;
}
const givenFiles = [...(values.file ?? []), ...positionals.slice(1)];
// Without data on the command line: SHOWBOARD_DB, else SHOWBOARD_DATA, which may also name a
// database (the plugin's one Data setting takes any of them).
const envData = setting("SHOWBOARD_DATA");
const envDataIsDb = envData !== undefined && /^postgres(ql)?:\/\/|\.(sqlite3?|db3?)$/i.test(envData);
const db = values.db ?? (givenFiles.length ? undefined : (setting("SHOWBOARD_DB") ?? (envDataIsDb ? envData : undefined)));
const files = givenFiles.length || db || !envData ? givenFiles : [envData];
const page = `http://localhost:${port}`;
const openHint = `Ask the user to open ${page} in a browser, or to run "showboard pane" in a terminal beside you.`;

async function start(): Promise<Showboard> {
  if (!db && !files.length) throw new Error("Pass --db <postgres-url | file.sqlite>, spreadsheet files or a folder of them (or set SHOWBOARD_DB).");
  // Spreadsheets and SQLite files need node:sqlite: say so, rather than fail on its import.
  if (!nodeHasSqlite() && (files.length || !/^postgres(ql)?:/i.test(db ?? ""))) {
    throw new Error(`Showboard needs Node.js 22.13 or later to read spreadsheets and SQLite files; this is ${process.version}. Install a newer Node.js (https://nodejs.org), then start your agent again.`);
  }
  const format = { ...(values.currency ? { currency: values.currency.toUpperCase() } : {}), ...(values.locale ? { locale: values.locale } : {}) };
  return createShowboard({ db, files, boardsDir: values.boards, openHint, format });
}

async function isShowboardAt(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`);
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false; // nothing listening
  }
}

/** How an agent starts this Showboard: npx once it is installed from npm, else this very file. */
function launch(args: string[]): Launch {
  const self = fileURLToPath(import.meta.url);
  if (!self.split(/[\\/]/).includes("node_modules")) return { command: "node", args: [self, ...args] };
  // Windows cannot start npx directly from most agents; cmd /c runs it.
  return process.platform === "win32" ? { command: "cmd", args: ["/c", "npx", "-y", "showboard", ...args] } : { command: "npx", args: ["-y", "showboard", ...args] };
}

/** How a person or an agent runs this command line, for the commands Showboard suggests. */
function selfCommand(): string {
  const self = fileURLToPath(import.meta.url);
  return self.split(/[\\/]/).includes("node_modules") ? "npx showboard" : `node "${self}"`;
}

async function main(): Promise<void> {
  if (values.version || command === "version") {
    console.log(VERSION);
    return;
  }
  if (!command || values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.root) {
    if (values.root.includes("${")) throw new Error(`--root ${values.root} was not filled in by your editor; give the project folder's path instead.`);
    process.chdir(values.root);
  }
  const local = `http://127.0.0.1:${port}`;

  if (command === "pane") {
    const format = { ...(values.currency ? { currency: values.currency.toUpperCase() } : {}), ...(values.locale ? { locale: values.locale } : {}) };
    await runPane({ url: values.url ?? local, once: values.once, ...(Object.keys(format).length ? { format } : {}) });
    return;
  }

  if (command === "doctor") {
    const report = await runDoctor({ root: process.cwd(), agents: values.agent, self: selfCommand() });
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report, selfCommand()));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (command === "guide") {
    // The repository's SETUP.md, which the build copies next to the command line.
    const guide = readFileSync(new URL("../SETUP.md", import.meta.url), "utf8");
    process.stdout.write(`In these steps, "showboard" means: ${selfCommand()}\n\n${guide}`);
    return;
  }

  if (command === "serve") {
    const board = await start();
    await serve(board.handler({ viewer: true, ask: askFromEnv() }), { port });
    const tables = (await board.db?.describe())?.length ?? 0;
    console.log(`showboard: ${files.length ? `${tables} table${tables === 1 ? "" : "s"} from your spreadsheets` : `${board.db?.kind ?? "no"} database`}, ${board.tools.length} tools`);
    for (const note of board.db?.notes?.() ?? []) console.log(`showboard: ${note}`);
    console.log(`showboard: boards appear at ${page}${askFromEnv() ? ", with a box to ask questions there" : ""}`);
    return;
  }

  if (command === "mcp") {
    console.log = console.error; // stdout carries the MCP protocol only
    if (values.plugin && !PLUGIN_HOSTS.includes(values.plugin as PluginHost)) throw new Error(`--plugin takes ${PLUGIN_HOSTS.join(" or ")}, not ${values.plugin}.`);
    const idle = values.plugin ? pluginIdle(values.plugin as PluginHost, process.cwd(), Boolean(values.url || db || files.length)) : null;
    if (idle) {
      runMcp(noTools, idle.instructions, VERSION);
      return;
    }
    let backend: ToolBackend;
    if (values.url) backend = remoteBackend(values.url);
    else if (await isShowboardAt(local)) backend = remoteBackend(local);
    else {
      const board = await start();
      try {
        // The plugin's README promises no host but the user's database: no question box there.
        await serve(board.handler({ viewer: true, ask: values.plugin ? undefined : askFromEnv() }), { port });
        console.error(`showboard: serving the browser bridge and board page on ${local}`);
      } catch (err) {
        throw new Error(`Port ${port} is taken by something that is not Showboard (${(err as Error).message}). Pass --port.`);
      }
      backend = {
        list: async () => (await (await fetch(`${local}/tools`)).json()) as Awaited<ReturnType<ToolBackend["list"]>>,
        call: (name, input) => board.callTool(name, input),
      };
    }
    runMcp(backend, values.url ? INSTRUCTIONS : `${INSTRUCTIONS} Boards appear at ${page}; if no browser has it open, tell the user to open it.`, VERSION);
    return;
  }

  if (command === "init") {
    const source = values.db ? ["--db", values.db] : givenFiles.flatMap((f) => ["--file", f]);
    const formatArgs = [...(values.currency ? ["--currency", values.currency] : []), ...(values.locale ? ["--locale", values.locale] : [])];
    const args = values.url ? ["--url", values.url] : [...source, ...(values.port !== "4710" ? ["--port", values.port] : []), ...formatArgs];
    const root = process.cwd();
    const agents = pickAgents(values.agent, root);
    const written: string[] = [];
    const writtenFiles = new Set<string>();
    for (const agent of agents) {
      // Agents that read the same file (BharatCode reads OpenCode's) share its one entry.
      if (writtenFiles.has(agent.file(root, homedir()))) continue;
      const where = agent.root === "absolute" ? ["--root", root] : agent.root === "workspace-variable" ? ["--root", "${workspaceFolder}"] : [];
      const entry = launch(["mcp", ...where, ...args]);
      let file: string;
      try {
        file = writeAgent(agent, entry, root);
      } catch (err) {
        // A settings file with comments (JSONC) is not ours to rewrite.
        console.log(`showboard: ${agent.label}: could not update ${agent.file(root, "~")} (${(err as Error).message}). Add this server by hand: ${JSON.stringify({ showboard: entry })}`);
        continue;
      }
      const shown = agent.userWide ? file : relative(root, file) || file;
      writtenFiles.add(file);
      written.push(agent.name);
      console.log(`showboard: ${agent.label}: added to ${shown}. ${agent.note}`);
      for (const other of AGENTS.filter((a) => a !== agent && a.file(root, homedir()) === file)) {
        written.push(other.name);
        console.log(`showboard: ${other.label} reads ${shown} too. ${other.note}`);
      }
    }
    if (written.includes("claude")) {
      const agent = ".claude/agents/board-builder.md";
      if (existsSync(agent)) console.log(`showboard: kept your ${agent}.`);
      else {
        mkdirSync(".claude/agents", { recursive: true });
        writeFileSync(agent, builderAgent("showboard", values["agent-model"]));
        console.log(`showboard: added ${agent}: Claude Code builds new kinds of boards on ${values["agent-model"]} in a small context of its own (change the model there).`);
      }
    }
    if (launch([]).command === "node") console.log(`showboard: these entries start this checkout (${fileURLToPath(import.meta.url)}); run init again from an npm install to use npx.`);
    if (values.db && /:\/\/[^/:]+:[^@/]+@/.test(values.db)) console.log("showboard: that URL holds a password. Prefer SHOWBOARD_DB in your environment and leave --db out of the settings files.");
    for (const f of givenFiles) if (!existsSync(f)) console.log(`showboard: ${f} does not exist yet.`);
    if (!values.url && !values.db && !givenFiles.length && !setting("SHOWBOARD_DB")) console.log("showboard: no --db or files given; set SHOWBOARD_DB before starting your agent.");
    const others = agentNames.filter((n) => !written.includes(n));
    // Commands as they can be run from here, with a password in a URL left out.
    const same = args.map((a) => (/:\/\/[^/:]+:[^@/]+@/.test(a) ? "<url>" : shellArg(a))).join(" ");
    if (others.length) console.log(`showboard: for other agents, the same setup: ${selfCommand()} init ${same} --agent ${others.join(",")}`);
    if (!values.url) console.log(`showboard: once your agent is running here, open ${page} to see its boards, or run this in a terminal beside it: ${selfCommand()} pane${values.port === "4710" ? "" : ` --url http://127.0.0.1:${values.port}`}`);
    console.log(`showboard: check the setup with: ${selfCommand()} doctor`);
    return;
  }

  process.stdout.write(HELP);
  process.exitCode = 1;
}

main().catch((err: Error) => {
  console.error(`showboard: ${err.message}`);
  process.exit(1);
});
