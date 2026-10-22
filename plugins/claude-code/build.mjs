// Bundles showboard's text renderer (packages/showboard/src/text) into hooks/board-text.js,
// since a Claude Code mod imports only its own files. `--to <folder>` also copies the mod
// there, such as a session's mods folder while developing it.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = fileURLToPath(new URL(".", import.meta.url));
const { values } = parseArgs({ options: { to: { type: "string" } } });

await build({
  entryPoints: [join(here, "../../packages/showboard/src/text/index.ts")],
  outfile: join(here, "hooks/board-text.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  banner: { js: "// Built by build.mjs from packages/showboard/src/text. Do not edit." },
  logLevel: "warning",
});

if (values.to) {
  const to = join(values.to, "showboard");
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const part of [".claude-plugin", "hooks", "types", "test", "README.md"]) cpSync(join(here, part), join(to, part), { recursive: true });
  console.log(`copied the mod to ${to}`);
}
