import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Where each coding agent reads its MCP servers, and how `showboard init` adds Showboard
// there. Project files are written with paths relative to the project, for agents that
// start servers in it; Cursor does not, and the user-wide files (Antigravity, Windsurf)
// serve every project, so those name the project folder with --root.

export type AgentName = "claude" | "codex" | "opencode" | "bharatcode" | "gemini" | "cursor" | "vscode" | "antigravity" | "windsurf";

/** How the agent starts Showboard: the command and its arguments. */
export interface Launch {
  command: string;
  args: string[];
}

export interface Agent {
  name: AgentName;
  label: string;
  /** The file it writes: inside the project, or under the user's home for user-wide ones. */
  file(root: string, home: string): string;
  userWide?: boolean;
  /** How the project folder reaches the server (see above). */
  root?: "absolute" | "workspace-variable";
  /** Whether the project already uses this agent. */
  detect?(root: string): boolean;
  /** The file's new text, given its current text (empty when it does not exist yet). */
  update(text: string, launch: Launch): string;
  /** Showboard's entry in the file's text, read back (for doctor); undefined when it has none. */
  read(text: string): Launch | undefined;
  /** What to tell the person once it is written. */
  note: string;
}

const here = (root: string, ...path: string[]) => existsSync(join(root, ...path));

/** A JSON file's servers under `key`, with Showboard's entry added or replaced. */
function jsonServers(key: string, entry: (launch: Launch) => Record<string, unknown>, top: Record<string, unknown> = {}) {
  return (text: string, launch: Launch) => {
    const config = (text.trim() ? JSON.parse(text) : { ...top }) as Record<string, unknown>;
    config[key] = { ...(config[key] as Record<string, unknown> | undefined), showboard: entry(launch) };
    return `${JSON.stringify(config, null, 2)}\n`;
  };
}

const plain = (launch: Launch) => ({ command: launch.command, args: launch.args });

/** Showboard's entry under `key` in a JSON settings file, as a launch. */
function jsonEntry(key: string, launchOf: (entry: Record<string, unknown>) => Launch | undefined = plainLaunch) {
  return (text: string) => {
    const servers = (JSON.parse(text) as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    const entry = servers?.showboard;
    return entry && typeof entry === "object" ? launchOf(entry as Record<string, unknown>) : undefined;
  };
}

function plainLaunch(entry: Record<string, unknown>): Launch | undefined {
  return typeof entry.command === "string" ? { command: entry.command, args: Array.isArray(entry.args) ? entry.args.map(String) : [] } : undefined;
}

// OpenCode's settings, which BharatCode (a fork of OpenCode) reads as well.
const opencodeSettings = {
  // Its settings may be opencode.jsonc instead; one with comments is left to the person.
  file: (root: string) => join(root, here(root, "opencode.jsonc") && !here(root, "opencode.json") ? "opencode.jsonc" : "opencode.json"),
  update: jsonServers("mcp", (launch) => ({ type: "local", command: [launch.command, ...launch.args], enabled: true, timeout: 30_000 }), { $schema: "https://opencode.ai/config.json" }),
  read: jsonEntry("mcp", (entry) => (Array.isArray(entry.command) && entry.command.length ? { command: String(entry.command[0]), args: entry.command.slice(1).map(String) } : undefined)),
};

export const AGENTS: Agent[] = [
  {
    name: "claude",
    label: "Claude Code",
    file: (root) => join(root, ".mcp.json"),
    update: jsonServers("mcpServers", plain),
    read: jsonEntry("mcpServers"),
    note: "Restart Claude Code in this folder, and approve the showboard server when it asks.",
  },
  {
    name: "codex",
    label: "Codex",
    file: (root) => join(root, ".codex", "config.toml"),
    detect: (root) => here(root, ".codex"),
    update: (text, launch) => setTomlTable(text, "mcp_servers.showboard", { command: launch.command, args: launch.args, startup_timeout_sec: 60 }),
    read: (text) => {
      const table = readTomlTable(text, "mcp_servers.showboard");
      return table && typeof table.command === "string" ? { command: table.command, args: Array.isArray(table.args) ? table.args.map(String) : [] } : undefined;
    },
    note: "Codex reads .codex/config.toml only in a trusted project: trust this folder when Codex asks.",
  },
  {
    name: "opencode",
    label: "OpenCode",
    ...opencodeSettings,
    detect: (root) => here(root, "opencode.json") || here(root, "opencode.jsonc") || here(root, ".opencode"),
    note: "Restart OpenCode in this folder; `opencode mcp list` shows whether it connected.",
  },
  {
    name: "bharatcode",
    label: "BharatCode",
    ...opencodeSettings,
    note: "Restart BharatCode in this folder (`bharatcode .`, signed in with `bharatcode auth login`); `bharatcode mcp list` shows whether it connected.",
  },
  {
    name: "gemini",
    label: "Gemini CLI",
    file: (root) => join(root, ".gemini", "settings.json"),
    detect: (root) => here(root, ".gemini"),
    update: jsonServers("mcpServers", plain),
    read: jsonEntry("mcpServers"),
    note: "Restart Gemini CLI in this folder (trust it if asked); `gemini mcp list` shows whether it connected.",
  },
  {
    name: "cursor",
    label: "Cursor",
    file: (root) => join(root, ".cursor", "mcp.json"),
    root: "absolute",
    detect: (root) => here(root, ".cursor"),
    update: jsonServers("mcpServers", plain),
    read: jsonEntry("mcpServers"),
    note: "Cursor starts servers outside the project, so the entry names this folder; turn it on under Settings > MCP.",
  },
  {
    name: "vscode",
    label: "VS Code",
    file: (root) => join(root, ".vscode", "mcp.json"),
    root: "workspace-variable",
    detect: (root) => here(root, ".vscode"),
    update: jsonServers("servers", (launch) => ({ type: "stdio", command: launch.command, args: launch.args })),
    read: jsonEntry("servers"),
    note: "VS Code lists it under MCP Servers; start it there, then use agent mode.",
  },
  {
    name: "antigravity",
    label: "Antigravity",
    file: (_root, home) => join(home, ".gemini", "config", "mcp_config.json"),
    userWide: true,
    root: "absolute",
    update: jsonServers("mcpServers", plain),
    read: jsonEntry("mcpServers"),
    note: "Antigravity reads this file for every project, and the entry names this folder. Open the agent panel's … menu > MCP Servers > Manage, and refresh.",
  },
  {
    name: "windsurf",
    label: "Windsurf",
    file: (_root, home) => join(home, ".codeium", "windsurf", "mcp_config.json"),
    userWide: true,
    root: "absolute",
    update: jsonServers("mcpServers", plain),
    read: jsonEntry("mcpServers"),
    note: "Windsurf reads this file for every project, and the entry names this folder. Refresh the MCP servers in Cascade.",
  },
];

export const agentNames = AGENTS.map((a) => a.name);

/** The agents to set up: the ones named, or Claude Code plus any this project already uses. */
export function pickAgents(given: string[] | undefined, root: string): Agent[] {
  const names = (given ?? []).flatMap((g) => g.split(",")).map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return AGENTS.filter((a) => a.name === "claude" || (!a.userWide && a.detect?.(root)));
  if (names.includes("all")) return AGENTS.filter((a) => !a.userWide || names.includes(a.name));
  const unknown = names.filter((n) => !agentNames.includes(n as AgentName));
  if (unknown.length) throw new Error(`Unknown agent ${unknown.join(", ")}. Agents: ${agentNames.join(", ")}, or all.`);
  return AGENTS.filter((a) => names.includes(a.name));
}

/** Writes one agent's file; answers the path written. */
export function writeAgent(agent: Agent, launch: Launch, root: string, home = homedir()): string {
  const file = agent.file(root, home);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, agent.update(text, launch));
  return file;
}

type TomlValue = string | number | boolean | string[];

/** A TOML table set to these keys, replacing the table (and its sub-tables) if it is there. */
export function setTomlTable(text: string, table: string, values: Record<string, TomlValue>): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) skipping = header[1] === table || header[1]!.startsWith(`${table}.`);
    if (!skipping) kept.push(line);
  }
  while (kept.length && kept.at(-1)!.trim() === "") kept.pop();
  const body = Object.entries(values).map(([key, value]) => `${key} = ${toml(value)}`);
  return [...kept, ...(kept.length ? [""] : []), `[${table}]`, ...body, ""].join("\n");
}

/** One table's keys, read back from text setTomlTable wrote (strings, numbers, booleans, arrays of strings). */
export function readTomlTable(text: string, table: string): Record<string, TomlValue> | undefined {
  let found: Record<string, TomlValue> | undefined;
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) {
      inside = header[1] === table;
      if (inside) found = {};
      continue;
    }
    const pair = inside ? /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (!pair || !found) continue;
    const value = tomlValue(pair[2]!);
    if (value !== undefined) found[pair[1]!] = value;
  }
  return found;
}

/** TOML's basic strings, numbers, booleans and arrays of them read as JSON; 'literal' strings have no escapes. */
function tomlValue(text: string): TomlValue | undefined {
  for (const candidate of [text, text.replace(/'([^']*)'/g, (_, v: string) => JSON.stringify(v))]) {
    try {
      return JSON.parse(candidate) as TomlValue;
    } catch {
      // try the next reading; a form neither knows (a hand-written table, say) is left out
    }
  }
  return undefined;
}

function toml(value: TomlValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
