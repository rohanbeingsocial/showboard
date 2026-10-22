// Bundles the built-in board page (src/viewer) into dist/viewer/viewer.js and viewer.css,
// copies the stylesheet apps import as showboard/styles.css, and gives the page the
// repository's icon (assets/showboard-icon.svg) as dist/viewer/icon.svg. It also copies
// SETUP.md, the setup steps for coding agents, to dist/ for `showboard guide`.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

cpSync(`${root}src/react/styles.css`, `${root}dist/react/styles.css`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/viewer/main.tsx"],
  outfile: "dist/viewer/viewer.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "warning",
});
cpSync(`${root}../../assets/showboard-icon.svg`, `${root}dist/viewer/icon.svg`);
// `showboard guide` prints the repository's setup steps for coding agents from here.
cpSync(`${root}../../SETUP.md`, `${root}dist/SETUP.md`);
