import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolBackend } from "./mcp.js";

// How the Claude Code plugin starts Showboard: `showboard mcp --plugin`. The plugin's server
// serves every project from the data set in the plugin's options, on its own port. A project that starts
// its own Showboard (`showboard init` wrote it into .mcp.json) keeps that one: the plugin's
// server lists no tools there, so Claude does not see each tool twice and the two never share
// a port. Until data is set, it lists no tools either and tells Claude how to set it up.

export const SETUP_INSTRUCTIONS =
  "Showboard (charts, tables and dashboards drawn from the user's data) is installed but has no data yet, so it offers no tools. " +
  "If the user asks for a chart, a dashboard or a board of their data, tell them how to set it up: run /plugin, open Showboard " +
  "on the Installed tab, choose Configure options, and set Data to the full path of a folder of spreadsheets (.xlsx, .csv), " +
  "one spreadsheet or a SQLite file, or Database URL to a Postgres URL. Closing /plugin applies it (or run /reload-plugins). " +
  "For one project only, `npx showboard init <files>` (or `--db <url>`) in that project's folder does it instead.";

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
export function pluginIdle(root: string, hasData: boolean): { instructions: string } | null {
  if (projectHasShowboard(root)) return { instructions: "" };
  if (!hasData) return { instructions: SETUP_INSTRUCTIONS };
  return null;
}

export const noTools: ToolBackend = {
  list: async () => [],
  call: async (name) => ({ ok: false, content: JSON.stringify({ error: `Showboard has no tool ${name} here.` }) }),
};
