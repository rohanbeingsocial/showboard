import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS, pickAgents, readTomlTable, setTomlTable, writeAgent, type AgentName } from "../src/cli/agents.js";

const launch = { command: "npx", args: ["-y", "showboard", "mcp", "--file", "data"] };
const agent = (name: AgentName) => AGENTS.find((a) => a.name === name)!;
const folder = () => mkdtempSync(join(tmpdir(), "showboard-init-"));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;

describe("init for each agent", () => {
  it("picks Claude Code, plus the agents a folder already has settings for", () => {
    const root = folder();
    expect(pickAgents(undefined, root).map((a) => a.name)).toEqual(["claude"]);
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, "opencode.json"), "{}");
    expect(pickAgents(undefined, root).map((a) => a.name)).toEqual(["claude", "codex", "opencode"]);
    expect(pickAgents(["all"], root).map((a) => a.name)).toEqual(["claude", "codex", "opencode", "gemini", "cursor", "vscode"]);
    expect(pickAgents(["codex,antigravity"], root).map((a) => a.name)).toEqual(["codex", "antigravity"]);
    expect(() => pickAgents(["cursr"], root)).toThrow(/Unknown agent cursr/);
  });

  it("adds the server beside the ones already there", () => {
    const root = folder();
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    writeAgent(agent("claude"), launch, root);
    expect(json(join(root, ".mcp.json")).mcpServers).toEqual({ other: { command: "x" }, showboard: launch });

    writeAgent(agent("opencode"), launch, root);
    expect(json(join(root, "opencode.json"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: { showboard: { type: "local", command: ["npx", "-y", "showboard", "mcp", "--file", "data"], enabled: true, timeout: 30000 } },
    });
    writeAgent(agent("gemini"), launch, root);
    expect(json(join(root, ".gemini", "settings.json")).mcpServers).toEqual({ showboard: launch });
    writeAgent(agent("vscode"), launch, root);
    expect(json(join(root, ".vscode", "mcp.json")).servers).toEqual({ showboard: { type: "stdio", ...launch } });
  });

  it("writes the user-wide agents under the home folder, not the project", () => {
    const root = folder();
    const home = folder();
    expect(writeAgent(agent("antigravity"), launch, root, home)).toBe(join(home, ".gemini", "config", "mcp_config.json"));
    expect(json(join(home, ".gemini", "config", "mcp_config.json")).mcpServers).toEqual({ showboard: launch });
    writeAgent(agent("windsurf"), launch, root, home);
    expect(json(join(home, ".codeium", "windsurf", "mcp_config.json")).mcpServers).toEqual({ showboard: launch });
  });

  it("refuses a settings file it cannot read as JSON rather than overwrite it", () => {
    const root = folder();
    mkdirSync(join(root, ".vscode"));
    writeFileSync(join(root, ".vscode", "mcp.json"), '{ // my servers\n "servers": {} }');
    expect(() => writeAgent(agent("vscode"), launch, root)).toThrow();
    expect(readFileSync(join(root, ".vscode", "mcp.json"), "utf8")).toContain("// my servers");
  });

  it("replaces Codex's table and keeps the rest of the file", () => {
    const before = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.showboard]",
      'command = "old"',
      "",
      "[mcp_servers.showboard.env]",
      'A = "1"',
      "",
      "[mcp_servers.other]",
      'command = "keep"',
      "",
    ].join("\n");
    const after = setTomlTable(before, "mcp_servers.showboard", { command: "cmd", args: ["/c", "npx", "-y", "showboard", "mcp", "--file", "C:\\data"], startup_timeout_sec: 60 });
    expect(after).toBe(
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.other]",
        'command = "keep"',
        "",
        "[mcp_servers.showboard]",
        'command = "cmd"',
        'args = ["/c", "npx", "-y", "showboard", "mcp", "--file", "C:\\\\data"]',
        "startup_timeout_sec = 60",
        "",
      ].join("\n"),
    );
    expect(setTomlTable("", "mcp_servers.showboard", { command: "npx" })).toBe('[mcp_servers.showboard]\ncommand = "npx"\n');
  });

  it("reads back the entry it wrote, for every agent", () => {
    const root = folder();
    const home = folder();
    const windows = { command: "node", args: ["C:\\Rohan's stuff\\main.js", "mcp", "--file", "data", "--port", "4711"] };
    for (const a of AGENTS) {
      writeAgent(a, windows, root, home);
      expect(a.read(readFileSync(a.file(root, home), "utf8")), a.name).toEqual(windows);
    }
    expect(agent("claude").read('{"mcpServers":{"other":{"command":"x"}}}')).toBeUndefined();
    expect(readTomlTable("[mcp_servers.showboard]\ncommand = 'npx'\nargs = ['-y', 'showboard']\n", "mcp_servers.showboard")).toEqual({ command: "npx", args: ["-y", "showboard"] });
    expect(readTomlTable('[mcp_servers.other]\ncommand = "x"\n', "mcp_servers.showboard")).toBeUndefined();
  });
});
