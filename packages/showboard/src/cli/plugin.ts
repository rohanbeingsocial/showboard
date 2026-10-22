import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolBackend } from "./mcp.js";

// How the Claude Code plugin and the Claude desktop extension start Showboard: `showboard mcp
// --plugin <host>`. Their server serves from the data set in their options, on a port of its
// own (4711 for the plugin, 4712 for the extension). A project that starts its own Showboard
// (`showboard init` wrote it into .mcp.json) keeps that one: the plugin's server lists no
// tools there, so Claude does not see each tool twice and the two never share a port. Until
// data is set, it lists no tools either and tells Claude how the person sets it up there.

export const PLUGIN_HOSTS = ["claude-code", "claude-desktop"] as const;
export type PluginHost = (typeof PLUGIN_HOSTS)[number];

const NO_DATA =
  "Showboard (charts, tables and dashboards drawn from the user's data) is installed but has no data yet, so it offers no tools. " +
  "If the user asks for a chart, a dashboard or a board of their data, tell them how to set it up: ";

export const SETUP_INSTRUCTIONS: Record<PluginHost, string> = {
  "claude-code":
    NO_DATA +
    "run /plugin, open Showboard on the Installed tab, choose Configure options, and set Data to the full path of a folder of " +
    "spreadsheets (.xlsx, .csv), one spreadsheet or a SQLite file, or Database URL to a Postgres URL; closing /plugin applies it. " +
    "For one project only, `npx showboard init <files>` (or `--db <url>`) in that project's folder does it instead.",
  "claude-desktop":
    NO_DATA +
    "open Settings, then Extensions, click Showboard, and choose a Spreadsheet folder (.xlsx, .csv), " +
    "or give a Database: a Postgres URL or the full path of a SQLite file.",
};

/**
 * Where the plugin's server keeps its boards unless --boards says: the data folder Claude Code
 * gives each plugin (CLAUDE_PLUGIN_DATA, in the server's environment), else one in the home
 * folder. It stays off the command line because Anthropic's plugin directory refuses a server
 * command whose paths use any variable but ${CLAUDE_PLUGIN_ROOT}.
 */
export function pluginBoardsDir(host: PluginHost, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const data = env.CLAUDE_PLUGIN_DATA?.trim();
  return data ? join(data, "boards") : join(home, ".showboard", host, "boards");
}

/** Whether the folder's .mcp.json starts a Showboard of its own: one named showboard, or run by it. */
export function projectHasShowboard(root: string): boolean {
  let config: { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
  try {
    config = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  } catch {
    return false; // no .mcp.json here, or one that is not JSON
  }
  return Object.entries(config.mcpServers ?? {}).some(([name, server]) => {
    const words = [server?.command, ...(Array.isArray(server?.args) ? server.args : [])];
    return name === "showboard" || words.some((w) => typeof w === "string" && w.includes("showboard"));
  });
}

/** Why the plugin's server lists no tools here, as the instructions it gives; null to serve. */
export function pluginIdle(host: PluginHost, root: string, hasData: boolean): { instructions: string } | null {
  if (projectHasShowboard(root)) return { instructions: "" };
  if (!hasData) return { instructions: SETUP_INSTRUCTIONS[host] };
  return null;
}

export const noTools: ToolBackend = {
  list: async () => [],
  call: async (name) => ({ ok: false, content: JSON.stringify({ error: `Showboard has no tool ${name} here.` }) }),
};
