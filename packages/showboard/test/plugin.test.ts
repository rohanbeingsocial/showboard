import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginIdle, projectHasShowboard, SETUP_INSTRUCTIONS } from "../src/cli/plugin.js";

const folder = (mcpJson?: string) => {
  const root = mkdtempSync(join(tmpdir(), "showboard-plugin-"));
  if (mcpJson !== undefined) writeFileSync(join(root, ".mcp.json"), mcpJson);
  return root;
};

describe("the plugin's server", () => {
  it("notices a project that starts its own Showboard, however it is named or run", () => {
    expect(projectHasShowboard(folder(JSON.stringify({ mcpServers: { showboard: { command: "npx", args: ["-y", "showboard", "mcp", "--file", "sales.csv"] } } })))).toBe(true);
    expect(projectHasShowboard(folder(JSON.stringify({ mcpServers: { shop: { command: "node", args: ["C:/x/showboard/dist/cli/main.js", "mcp", "--url", "http://127.0.0.1:3000/api/showboard"] } } })))).toBe(true);
    expect(projectHasShowboard(folder(JSON.stringify({ mcpServers: { boards: { command: "showboard", args: ["mcp", "--db", "shop.sqlite"] } } })))).toBe(true);
  });

  it("serves everywhere else", () => {
    expect(projectHasShowboard(folder())).toBe(false);
    expect(projectHasShowboard(folder(JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } } })))).toBe(false);
    expect(projectHasShowboard(folder("{ not json"))).toBe(false);
    expect(projectHasShowboard(folder(JSON.stringify({ mcpServers: { odd: null } })))).toBe(false);
  });

  it("steps aside for the project's own Showboard, says how to set up without data, and otherwise serves", () => {
    const own = folder(JSON.stringify({ mcpServers: { showboard: { command: "npx", args: ["-y", "showboard", "mcp"] } } }));
    expect(pluginIdle(own, true)).toEqual({ instructions: "" });
    expect(pluginIdle(own, false)).toEqual({ instructions: "" });
    expect(pluginIdle(folder(), false)).toEqual({ instructions: SETUP_INSTRUCTIONS });
    expect(pluginIdle(folder(), true)).toBeNull();
  });
});
