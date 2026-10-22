// Builds the Claude desktop extension, build/showboard-<version>.mcpb: Showboard as this
// checkout packs it, with its runtime dependencies, beside manifest.json and the icon. The
// desktop app runs it on its own Node.js, so the bundle carries everything the server needs.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const build = join(here, "build");
const stage = join(build, "showboard");
const MCPB = "@anthropic-ai/mcpb@2.1.2";

const { version } = JSON.parse(readFileSync(join(here, "../../packages/showboard/package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
if (manifest.version !== version) {
  console.error(`manifest.json says ${manifest.version} and the package ${version}: make them match.`);
  process.exit(1);
}

// npm and npx are .cmd files on Windows, which only a shell starts. No argument below holds a
// space (paths are relative to `cwd`), so the shell has nothing to split or quote.
const run = (line, cwd) => execSync(line, { cwd, stdio: "inherit" });

rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
run("npm pack --pack-destination ../../plugins/claude-desktop/build", join(here, "../../packages/showboard"));
copyFileSync(join(here, "manifest.json"), join(stage, "manifest.json"));
copyFileSync(join(here, "icon.png"), join(stage, "icon.png"));
const pkg = { name: "showboard-claude-desktop", version, private: true, dependencies: { showboard: `file:../showboard-${version}.tgz` } };
writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
run("npm install --omit=dev --no-audit --no-fund --no-package-lock", stage);
run(`npx -y ${MCPB} validate showboard/manifest.json`, build);
run(`npx -y ${MCPB} pack showboard showboard-${version}.mcpb`, build);
