# Changelog

What changed in each Showboard release. The npm package, the Claude Code plugin and the Claude desktop extension ship together; full notes are on the [releases page](https://github.com/rohanbeingsocial/showboard/releases).

## 0.4.2 (6 Nov 2026)

Spreadsheet numbers with a comma decimal now add up:

- Amounts typed as text read `1.234,50`, `1 234,50` and `1'234.50` as well as `1,234.50`. Each value is read by its own decimal mark, so a column that mixes `1.234,50` and `1,234.50` totals correctly. Before, one `1.234,50` turned the whole column into text, and a sum over it came out wrong with no warning.
- A value that could be read two ways (`1.234` or `5,000`) follows the rest of its column. When the column is split between the two styles, the value is left empty and named in a note instead of guessed. A column with nothing to go by reads `.` as the decimal mark and says so.
- A column kept as text because a few values are not numbers (`1.234,5O`) now carries a note naming them. Agents are told to put such notes on the board, so the board tells you too.

Boards look designed and move:

- Design rules ([docs/design.md](docs/design.md)): scales for space (4–48px), type (12–28px), shape and motion, exposed as `--sb-*` variables.
- Clearer hierarchy:
  - A 28px board title.
  - 18px section titles with extra space above each section.
  - 24px card padding.
  - Notes washed in their tone's colour.
  - A switch for Show sources.
  - Highlighted table rows under the pointer.
  - A donut that centres in its card.
- Column names such as `revenue_2025` read "Revenue 2025" in legends, tooltips and table headers.
- Motion:
  - Boards build themselves in reading order: blocks rise in, bars grow from the baseline, lines draw, the donut sweeps, and headline numbers count up.
  - Tooltips fade and glide.
  - Everything stands still under reduced motion.
- `draw` gives agents short composition rules (title states the finding, answer first, one idea per chart, small tables, short notes); the board-builder agent follows them.

The documentation and demo also changed:

- A [browser demo](https://rohanbeingsocial.github.io/showboard/) on GitHub Pages, so you can see a board before installing.
- The README leads with the Claude Code plugin. It has a "How it compares" section, an architecture diagram ([docs/architecture.md](docs/architecture.md)) and a [Simplified Chinese translation](README.zh-CN.md).
- Technical evaluation guides moved to [docs/](docs/README.md).

## 0.4.1 (22 Oct 2026)

A fix for the Claude Code plugin's listing in Anthropic's plugin directory. The directory refuses a server command whose paths use any variable except `${CLAUDE_PLUGIN_ROOT}`.

- The plugin now starts `npx -y showboard@0.4.1 mcp --plugin claude-code --port 4711`, with no board folder on the command line. `mcp --plugin` finds the folder itself: the plugin's data folder (`CLAUDE_PLUGIN_DATA`), else `~/.showboard/<app>/boards`. Boards stay where 0.4.0 put them.
- The desktop extension drops its board folder argument the same way. Its boards stay in `~/.showboard/claude-desktop/boards`.

## 0.4.0 (22 Oct 2026)

One install, nothing else to run.

- **The Claude Code plugin brings its own Showboard server** along with the pane. Set **Data** (a folder of spreadsheets, one spreadsheet or a SQLite file) or **Database URL** (Postgres) when it asks. Boards appear beside the chat and at http://localhost:4711, in every project. A project where you ran `showboard init` keeps its own server, and the plugin steps aside there.
- **A Claude desktop extension** (`.mcpb`). Install it from Settings → Extensions → Advanced settings → Install Extension. No Node.js is needed. Boards appear at http://localhost:4712.
- `showboard mcp --plugin <claude-code | claude-desktop>` is how both start Showboard. `SHOWBOARD_DATA` names a spreadsheet, a folder of them or a SQLite file.
- `showboard init --agent bharatcode` sets up BharatCode, which reads OpenCode's settings.
- With `BHARATCODE_API_KEY` set, the board page of `serve` and `mcp` gets a box for asking questions without a coding agent.
- `showboard --version` works. An unknown option now prints a one-line error instead of a stack trace (the known issue in 0.2.0).
- The MCP server reports its real version. The package carries its MCP Registry name, `io.github.rohanbeingsocial/showboard`.

## 0.2.0 (22 Oct 2026)

The first release on npm.

- **One call per board.** `draw` takes one read-only SQL query per part and picks each chart from the shape of its rows. `recipe` redraws a saved board for new values.
- **Three places to show it:**
  - Showboard's own board page.
  - Your React app, where the agent can also read the screen (`get_screen`) and run the actions you register (`ui_act`).
  - `showboard pane`, which draws boards as text in a terminal beside your agent.
- **A Claude Code mod** that keeps the pane beside the chat.
- **Any agent that speaks MCP.** `showboard init --agent` writes the settings for Claude Code, Codex, OpenCode, Gemini CLI, Cursor, VS Code, Antigravity and Windsurf.
- **Set up by your agent.** `showboard guide` prints step-by-step instructions written for coding agents. `showboard doctor` checks the result the way each agent will meet it.
- **Data:** Postgres and SQLite, read-only. Also .xlsx, .xlsm, .csv and .tsv files or folders, reloaded when they change. `--currency` and `--locale` set how amounts print.
- **Benchmark:** compared with Claude Code on its own, on the same questions and files, it is 2.7× cheaper, uses 3.5× fewer output tokens and is 3.2× faster ([method](bench/README.md)).
- **Known issue:** `showboard --version`, like any unknown option, printed a stack trace. This was fixed in 0.4.0.
