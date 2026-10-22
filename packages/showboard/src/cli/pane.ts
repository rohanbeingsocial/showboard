import { spawn } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import type { FormatOptions } from "../spec/format.js";
import type { Board, BoardSummary, ServerMessage } from "../spec/types.js";
import { boardToText, fit, INKS, type Block, type Line, type Span } from "../text/index.js";

// `showboard pane`: the board on screen, drawn as text in a terminal. Split the terminal
// beside any coding agent (Claude Code, Codex, OpenCode, Gemini CLI…) and each board appears
// here as the agent draws it. The pane only watches; the board page has the full charts.

export interface PaneOptions {
  /** Where Showboard answers: http://127.0.0.1:4710, or an app's mount such as …/api/showboard. */
  url: string;
  /** Number format; read from describe_data when not given. */
  format?: FormatOptions;
  /** Print the board on screen once and exit. */
  once?: boolean;
}

const RETRY_MS = 2000;
const KEYS = "←/→ boards · ↑/↓ scroll · s sources · 1-9 buttons · o browser · q quit";

export async function runPane(options: PaneOptions): Promise<void> {
  const base = options.url.replace(/\/$/, "");
  const color = !process.env.NO_COLOR && (process.stdout.isTTY === true || Boolean(process.env.FORCE_COLOR));
  let format = options.format;

  async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, init);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  async function readFormat(): Promise<void> {
    if (format) return;
    try {
      const out = await getJson<{ content: string }>("/tools/describe_data", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      format = (JSON.parse(out.content) as { format?: FormatOptions }).format ?? {};
    } catch {
      // An app that keeps describe_data to itself: numbers print in the default format.
    }
  }

  if (options.once) {
    const health = await getJson<{ board: string | null }>("/health");
    const id = health.board ?? (await getJson<BoardSummary[]>("/boards"))[0]?.id;
    if (!id) {
      console.log(`No boards yet at ${base}.`);
      return;
    }
    await readFormat();
    const board = await getJson<Board>(`/boards/${encodeURIComponent(id)}`);
    const width = Math.min(process.stdout.columns || Number(process.env.COLUMNS) || 100, 120) - 1;
    for (const line of frame(board, boardToText(board, { width, format }))) console.log(paint(line, color));
    return;
  }

  const pane = `cli-${process.pid}`;
  let live: Board | null = null; // the board the agent showed last
  let picked: Board | null = null; // one chosen with the arrows, until the agent shows another
  let status = "Connecting…";
  let message = "";
  let sources = false;
  let scroll = 0;
  let list: BoardSummary[] = [];
  const out = process.stdout;

  const board = () => picked ?? live;

  function render(): void {
    const width = Math.max(30, (out.columns || 100) - 1);
    const height = Math.max(5, out.rows || 30);
    const current = board();
    const blocks = current ? boardToText(current, { width, format, sources }) : [];
    const body: Line[] = current ? frame(current, blocks, picked ? `older board · → back to the latest` : status) : waiting(width);
    const footer: Line[] = [[{ text: fit(message || KEYS, width), dim: true }]];
    const room = height - footer.length;
    scroll = Math.max(0, Math.min(scroll, body.length - room));
    const shown = body.slice(scroll, scroll + room);
    while (shown.length < room) shown.push([]);
    out.write(`\x1b[H\x1b[2J${[...shown, ...footer].map((l) => paint(l, color)).join("\n")}`);
  }

  function waiting(width: number): Line[] {
    return [
      [{ text: "Showboard", bold: true, ink: "accent" }, { text: ` · ${status}`, dim: true }],
      [],
      ...[`Boards appear here as your coding agent draws them.`, `Watching ${base}.`].map((t) => [{ text: fit(t, width) }]),
    ];
  }

  async function connect(): Promise<void> {
    for (;;) {
      try {
        const res = await fetch(`${base}/stream?pane=${pane}`);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        status = `live · ${base.replace(/^https?:\/\//, "")}`;
        message = "";
        await readFormat();
        render();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!chunk.startsWith("data: ")) continue;
            const msg = JSON.parse(chunk.slice(6)) as ServerMessage;
            if ((msg.type === "hello" || msg.type === "board") && msg.board) {
              live = msg.board;
              picked = null; // a new board from the agent always comes to the front
              scroll = 0;
              render();
            }
          }
        }
        status = "Showboard stopped; waiting for it…";
      } catch {
        status = `Waiting for Showboard at ${base}…`;
      }
      render();
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  async function step(by: number): Promise<void> {
    try {
      list = await getJson<BoardSummary[]>("/boards");
      const at = list.findIndex((b) => b.id === board()?.id);
      const next = list[Math.max(0, (at < 0 ? 0 : at) + by)];
      if (!next) return;
      const chosen = await getJson<Board>(`/boards/${encodeURIComponent(next.id)}`);
      picked = chosen.id === live?.id && chosen.at === live.at ? null : chosen;
      scroll = 0;
      message = "";
    } catch (err) {
      message = (err as Error).message;
    }
    render();
  }

  async function press(n: number): Promise<void> {
    const current = board();
    const actions = current ? boardToText(current, { width: 80, format }).filter((b) => b.kind === "action") : [];
    const action = actions[n - 1];
    if (!action || action.kind !== "action") return;
    message = `Running ${action.label}…`;
    render();
    try {
      const res = await getJson<{ ok: boolean; content: string }>("/tools/ui_act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: action.action, input: action.input }) });
      const result = JSON.parse(res.content) as { error?: string };
      message = res.ok ? `${action.label}: done in the app.` : `${action.label}: ${result.error ?? "failed"}`;
    } catch (err) {
      message = `${action.label}: ${(err as Error).message}`;
    }
    render();
  }

  out.write("\x1b[?1049h\x1b[?25l"); // a screen of its own, cursor hidden
  const restore = () => out.write("\x1b[?25h\x1b[?1049l");
  process.on("exit", restore);
  out.on("resize", render);
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (text: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => {
      const name = key?.name ?? text;
      if (name === "q" || (key?.ctrl && name === "c")) process.exit(0);
      else if (name === "s") {
        sources = !sources;
        render();
      } else if (name === "left" || name === "h") void step(1);
      else if (name === "right" || name === "l") void step(-1);
      else if (name === "up" || name === "k") (scroll--, render());
      else if (name === "down" || name === "j") (scroll++, render());
      else if (name === "pageup") ((scroll -= (out.rows || 30) - 3), render());
      else if (name === "pagedown") ((scroll += (out.rows || 30) - 3), render());
      else if (name === "home") ((scroll = 0), render());
      else if (name === "o") openBrowser(base);
      else if (text && /^[1-9]$/.test(text)) void press(Number(text));
    });
  }
  render();
  await connect();
}

/** The board's heading over its body, with its buttons numbered for the keys 1–9. */
function frame(board: Board, blocks: Block[], status = ""): Line[] {
  const at = new Date(board.at);
  const when = Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);
  const lines: Line[] = [[{ text: board.title, bold: true }], [{ text: [when, status].filter(Boolean).join(" · "), dim: true }], []];
  let n = 0;
  for (const block of blocks) {
    if (block.kind === "text") lines.push(...block.lines);
    else lines.push([{ text: `[${++n <= 9 ? n : "·"}] `, ink: "accent", bold: true }, { text: block.label, ink: "accent" }, { text: "  runs in the app", dim: true }]);
  }
  return lines;
}

const SGR_RESET = "\x1b[0m";

function paint(line: Line, color: boolean): string {
  if (!color) return line.map((s) => s.text).join("");
  return line.map((s) => (style(s) ? `${style(s)}${s.text}${SGR_RESET}` : s.text)).join("");
}

function style(span: Span): string {
  const codes: string[] = [];
  if (span.bold) codes.push("1");
  if (span.dim) codes.push("2");
  if (span.ink) {
    const hex = INKS[span.ink];
    codes.push(`38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}`);
  }
  return codes.length ? `\x1b[${codes.join(";")}m` : "";
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // No browser to open here; the URL is in the pane's heading.
  }
}
