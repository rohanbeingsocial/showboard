import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS, writeAgent } from "../src/cli/agents.js";
import { nodeHasSqlite, probe, runDoctor } from "../src/cli/doctor.js";

const folder = () => mkdtempSync(join(tmpdir(), "showboard-doctor-"));

// A stand-in for `showboard mcp`: answers the MCP calls doctor makes, from a fixed table list.
// With FAIL set it writes an error and exits, as Showboard does when its data will not open.
const FAKE = `
import { createInterface } from "node:readline";
if (process.env.FAIL) { console.error("showboard: unable to open database file"); process.exit(1); }
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send(m.id, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } });
  if (m.method === "tools/list") send(m.id, { tools: [{ name: "describe_data" }, { name: "draw" }] });
  if (m.method === "tools/call") send(m.id, { content: [{ type: "text", text: JSON.stringify({ database: { kind: "sqlite", tables: [{ table: "orders" }, { table: "products" }] }, sources: [] }) }] });
}).on("close", () => process.exit(0));
`;

function project(): { root: string; home: string; server: string } {
  const root = folder();
  const home = folder();
  const server = join(root, "fake-mcp.mjs");
  writeFileSync(server, FAKE);
  return { root, home, server };
}

describe("doctor", () => {
  it("knows which Node versions have node:sqlite without a flag", () => {
    expect(nodeHasSqlite("22.12.0")).toBe(false);
    expect(nodeHasSqlite("22.13.0")).toBe(true);
    expect(nodeHasSqlite("23.3.0")).toBe(false);
    expect(nodeHasSqlite("23.4.0")).toBe(true);
    expect(nodeHasSqlite("24.0.0")).toBe(true);
  });

  it("makes an agent's first MCP calls and stops the server", async () => {
    const { root, server } = project();
    const result = await probe({ command: process.execPath, args: [server, "mcp"] }, root, 10_000);
    expect(result.error).toBeUndefined();
    expect(result.tools).toEqual(["describe_data", "draw"]);
    expect(result.data?.database?.tables.map((t) => t.table)).toEqual(["orders", "products"]);
  });

  it("passes a working setup, once per entry, and says what to tell the person", async () => {
    const { root, home, server } = project();
    const entry = { command: process.execPath, args: [server, "mcp", "--db", "shop.sqlite"] };
    for (const name of ["claude", "codex"]) writeAgent(AGENTS.find((a) => a.name === name)!, entry, root, home);
    const report = await runDoctor({ root, home, self: "showboard", timeoutMs: 10_000 });
    expect(report.ok).toBe(true);
    const entries = report.checks.filter((c) => c.check !== "node");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ check: "claude,codex", status: "ok" });
    expect(entries[0]!.detail).toContain("2 tables: orders, products");
    expect(report.next.join("\n")).toMatch(/approve the showboard server[\s\S]*trust this folder[\s\S]*http:\/\/localhost:4710/);
  });

  it("fails with a fix the agent can run", async () => {
    // Nothing set up: init, with the options to choose from.
    const empty = await runDoctor({ root: folder(), home: folder(), self: "showboard" });
    expect(empty.ok).toBe(false);
    expect(empty.checks.at(-1)).toMatchObject({ check: "setup", status: "fail" });
    expect(empty.checks.at(-1)!.fix).toMatch(/^showboard init /);

    // A server that will not start: what it said, and the fix for it.
    const { root, home, server } = project();
    writeAgent(AGENTS.find((a) => a.name === "claude")!, { command: process.execPath, args: [server, "mcp", "--db", "gone.sqlite"] }, root, home);
    process.env.FAIL = "1";
    try {
      const broken = await runDoctor({ root, home, self: "showboard", timeoutMs: 10_000 });
      expect(broken.ok).toBe(false);
      expect(broken.checks.at(-1)!.detail).toContain("unable to open database file");
      expect(broken.checks.at(-1)!.fix).toMatch(/missing/);
    } finally {
      delete process.env.FAIL;
    }

    // An agent left out gets the same data options as the one that is set up.
    writeFileSync(join(root, "opencode.json"), '{"mcp":{}}');
    const partial = await runDoctor({ root, home, self: "showboard", timeoutMs: 10_000 });
    expect(partial.checks.find((c) => c.check === "opencode")).toMatchObject({ status: "warn", fix: "showboard init --db gone.sqlite --agent opencode" });
  });

  it("leaves user-wide settings for other folders alone", async () => {
    const { root, home, server } = project();
    writeAgent(AGENTS.find((a) => a.name === "claude")!, { command: process.execPath, args: [server, "mcp"] }, root, home);
    // Windsurf's file holds another project's entry; Antigravity's is empty.
    writeAgent(AGENTS.find((a) => a.name === "windsurf")!, { command: "node", args: ["x.js", "mcp", "--root", folder()] }, root, home);
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    writeFileSync(join(home, ".gemini", "config", "mcp_config.json"), "");
    const report = await runDoctor({ root, home, self: "showboard", timeoutMs: 10_000 });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.check)).toEqual(["node", "claude"]);
  });
});
