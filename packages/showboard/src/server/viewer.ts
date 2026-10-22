import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The board page `showboard serve` opens at its root, for people with no app of their own
// (a folder of spreadsheets, a database). It is a prebuilt bundle (scripts/build-viewer.mjs);
// the same relative path finds dist/viewer from both src/server and dist/server. The path is
// built at run time, not as new URL("…", import.meta.url), which bundlers take for a file to
// bundle: an app that bundles Showboard (Next.js) never serves this page.

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "viewer");
const TYPES: Record<string, string> = { "viewer.js": "text/javascript; charset=utf-8", "viewer.css": "text/css; charset=utf-8", "icon.svg": "image/svg+xml" };

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Showboard</title>
    <link rel="icon" href="icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="viewer.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="viewer.js"></script>
  </body>
</html>
`;

/** The page or one of its files, or null for any other path. */
export async function viewerResponse(path: string): Promise<Response | null> {
  if (path === "/" || path === "/index.html") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  const name = path.slice(1);
  if (!TYPES[name]) return null;
  try {
    return new Response(await readFile(join(DIR, name)), { headers: { "content-type": TYPES[name]!, "cache-control": "no-cache" } });
  } catch {
    return new Response("The board page is not built. Run npm run build in the showboard package.", { status: 404 });
  }
}
