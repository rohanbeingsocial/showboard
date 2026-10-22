# Showboard pane for Claude Code

A Claude Code mod that keeps Showboard's boards in a pane beside the chat. Each board Claude draws (with `draw`, `recipe` or `show_board`) appears there as text: headline numbers, braille line charts, block bars, share bars, tables and notes, every figure read from the board's own data. Buttons on a board run your app's actions, as they do in the browser.

- **Opens by itself** when a board arrives and the terminal has room for a side pane; `/board` opens it anywhere.
- **Older / Newer** walks the saved boards; **Sources** shows the query under each part; **Open in browser** opens Showboard's page, when the server serves one.
- **Finds Showboard by itself**: the `showboard` server in this folder's `.mcp.json` (its `--url` or `--port`), else `http://127.0.0.1:4710`. Set the URL in `/config` for an app that mounts Showboard elsewhere, such as `http://127.0.0.1:3000/api/showboard`.

Other agents (Codex, OpenCode, Gemini CLI, …) get the same view from `showboard pane`, run in a terminal split beside them.

## Developing it

```bash
node build.mjs                 # bundles ../../packages/showboard/src/text into hooks/board-text.js
claude plugin validate .
claude plugin test .
claude --plugin-dir .          # a session with the mod loaded
```

`hooks/board-text.js` is generated; change the renderer in `packages/showboard/src/text` and build again.
