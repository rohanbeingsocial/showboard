import type { ValueFormat } from "../spec/catalog.js";
import { formatAxis, formatDate, formatValue, parseDate, toNumber, type FormatOptions } from "../spec/format.js";
import type { Board, Dataset } from "../spec/types.js";

// A board drawn in characters, for panes with no browser: a terminal split beside a coding
// agent, or the pane beside its chat. Lines become braille, bars become blocks, and every
// figure is still read from the board's datasets. The result is plain data (lines of styled
// runs, plus the board's buttons), so each pane paints it its own way.

/** A color a pane maps to its own: series 1–8, or a tone. */
export type Ink = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "accent" | "muted" | "good" | "bad" | "warn" | "info";

/** The inks in Showboard's dark-theme colors, for panes that paint in color. */
export const INKS: Record<Ink, string> = {
  s1: "#3987e5", s2: "#d95926", s3: "#199e70", s4: "#c98500", s5: "#d55181", s6: "#2f9e44", s7: "#9085e9", s8: "#e66767",
  accent: "#3987e5", muted: "#8b93a3", good: "#4ade80", bad: "#f87171", warn: "#fbbf24", info: "#60a5fa",
};

export interface Span {
  text: string;
  ink?: Ink;
  bold?: boolean;
  dim?: boolean;
}
export type Line = Span[];

/** Text to print, or one of the board's buttons (it runs an app action through ui_act). */
export type Block = { kind: "text"; lines: Line[] } | { kind: "action"; label: string; action: string; input: Record<string, unknown> };

export interface TextOptions {
  /** Cells per line. */
  width: number;
  format?: FormatOptions;
  /** Show the query or source under each part. */
  sources?: boolean;
  /** Rows a table shows (default 12). */
  tableRows?: number;
  /** Rows a line chart's plot takes (default 8). */
  chartRows?: number;
}

interface Element {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
}

interface Ctx {
  board: Board;
  width: number;
  format: FormatOptions;
  sources: boolean;
  tableRows: number;
  chartRows: number;
  state: Record<string, unknown>;
  blocks: Block[];
  seen: Set<string>;
}

const MAX_DEPTH = 24;
const MAX_SLICES = 7;
const MAX_BAR_ROWS = 24;
const MIN_TILE = 16;
const SOURCE_LINES = 8;
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
// Braille dots by column and row inside one cell.
const DOTS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];
const TONES: Record<string, Ink> = { info: "info", good: "good", warn: "warn", bad: "bad" };

export const series = (i: number): Ink => `s${(i % 8) + 1}` as Ink;

/** The board as blocks of lines, at most `width` cells wide. */
export function boardToText(board: Board, options: TextOptions): Block[] {
  const ctx: Ctx = {
    board,
    width: Math.max(24, Math.floor(options.width)),
    format: options.format ?? {},
    sources: options.sources ?? false,
    tableRows: options.tableRows ?? 12,
    chartRows: Math.max(3, options.chartRows ?? 8),
    // Datasets are state too, so a prop can read one cell: { "$state": "/data/sales/0/total" }.
    state: { ...(board.spec.state ?? {}), data: Object.fromEntries(Object.entries(board.datasets).map(([name, d]) => [name, d.rows])) },
    blocks: [],
    seen: new Set(),
  };
  draw(ctx, board.spec.root, 0);
  return ctx.blocks;
}

/** A line's text without its styles. */
export function lineText(line: Line): string {
  return line.map((s) => s.text).join("");
}

function push(ctx: Ctx, ...given: Line[]): void {
  const lines = given.map((l) => clip(l, ctx.width));
  const last = ctx.blocks.at(-1);
  if (last?.kind === "text") last.lines.push(...lines);
  else ctx.blocks.push({ kind: "text", lines });
}

/** A line cut to the width, an ellipsis where it was cut, so no pane ever wraps one. */
function clip(line: Line, width: number): Line {
  let used = 0;
  const out: Line = [];
  for (const span of line) {
    const w = cellWidth(span.text);
    if (used + w <= width) {
      out.push(span);
      used += w;
      continue;
    }
    out.push({ ...span, text: fit(span.text, width - used) });
    return out;
  }
  return out;
}

/** One empty line between parts, never two, and none at the top. */
function gap(ctx: Ctx): void {
  const last = ctx.blocks.at(-1);
  if (!last) return;
  if (last.kind === "action" || (last.lines.length && lineText(last.lines.at(-1)!) !== "")) push(ctx, []);
}

function draw(ctx: Ctx, key: string, depth: number): void {
  const element = ctx.board.spec.elements[key] as Element | undefined;
  if (!element || depth > MAX_DEPTH || ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const props = resolve(element.props ?? {}, ctx.state) as Record<string, unknown>;
  const children = element.children ?? [];
  switch (element.type) {
    case "Grid": {
      const kids = children.map((k) => ctx.board.spec.elements[k] as Element | undefined);
      if (kids.length && kids.every((k) => k?.type === "Metric")) {
        gap(ctx);
        metrics(ctx, children.map((k) => resolve(ctx.board.spec.elements[k]!.props ?? {}, ctx.state) as Record<string, unknown>));
        children.forEach((k) => ctx.seen.add(k));
        return;
      }
      for (const child of children) draw(ctx, child, depth + 1);
      return;
    }
    case "Section":
      gap(ctx);
      push(ctx, [{ text: fit(String(props.title ?? ""), ctx.width), bold: true, ink: "accent" }]);
      if (props.subtitle) push(ctx, ...wrap(String(props.subtitle), ctx.width).map((t) => [{ text: t, dim: true }]));
      for (const child of children) draw(ctx, child, depth + 1);
      return;
    case "Metric":
      gap(ctx);
      metrics(ctx, [props]);
      return;
    case "LineChart":
      gap(ctx);
      return part(ctx, props, lineChart);
    case "BarChart":
      gap(ctx);
      return part(ctx, props, barChart);
    case "PieChart":
      gap(ctx);
      return part(ctx, props, pieChart);
    case "Table":
      gap(ctx);
      return part(ctx, props, table);
    case "Note":
      gap(ctx);
      return note(ctx, props);
    case "ActionButton":
      gap(ctx);
      ctx.blocks.push({ kind: "action", label: String(props.label ?? props.action ?? "Run"), action: String(props.action ?? ""), input: (props.input as Record<string, unknown> | undefined) ?? {} });
      return;
    default:
      // One of the app's own components: it draws only in the app.
      gap(ctx);
      if (props.title) push(ctx, [{ text: fit(String(props.title), ctx.width), bold: true }]);
      push(ctx, [{ text: fit(`‹${element.type}› shows in the app`, ctx.width), dim: true }]);
      for (const child of children) draw(ctx, child, depth + 1);
  }
}

/** A chart or table: its title, its body, and where its numbers came from when asked. */
function part(ctx: Ctx, props: Record<string, unknown>, body: (ctx: Ctx, props: Record<string, unknown>, dataset: Dataset) => Line[]): void {
  if (props.title) push(ctx, [{ text: fit(String(props.title), ctx.width), bold: true }]);
  const dataset = typeof props.dataset === "string" ? ctx.board.datasets[props.dataset] : undefined;
  if (!dataset) {
    push(ctx, [{ text: fit(`No dataset "${String(props.dataset)}".`, ctx.width), ink: "bad" }]);
    return;
  }
  push(ctx, ...body(ctx, props, dataset));
  if (ctx.sources) source(ctx, dataset);
}

function source(ctx: Ctx, dataset: Dataset): void {
  push(ctx, [{ text: fit(`↳ ${dataset.name} · ${dataset.rows.length} rows${dataset.truncated ? " (truncated)" : ""}`, ctx.width), dim: true }]);
  const lines = dataset.origin.split("\n").flatMap((l) => wrap(l, ctx.width - 2));
  for (const l of lines.slice(0, SOURCE_LINES)) push(ctx, [{ text: `  ${l}`, dim: true }]);
  if (lines.length > SOURCE_LINES) push(ctx, [{ text: `  … ${lines.length - SOURCE_LINES} more lines`, dim: true }]);
}

function metrics(ctx: Ctx, list: Record<string, unknown>[]): void {
  const perRow = Math.max(1, Math.min(list.length, Math.floor((ctx.width + 2) / (MIN_TILE + 2))));
  const tile = Math.floor((ctx.width - 2 * (perRow - 1)) / perRow);
  for (let start = 0; start < list.length; start += perRow) {
    const row = list.slice(start, start + perRow).map((props) => {
      const dataset = typeof props.dataset === "string" ? ctx.board.datasets[props.dataset] : undefined;
      const value = dataset?.rows[Number(props.row ?? 0)]?.[String(props.field)];
      const format = (props.format as ValueFormat | undefined) ?? (value !== undefined && toNumber(value) === null ? "text" : undefined);
      return {
        label: String(props.label ?? props.field ?? ""),
        value: !dataset ? `No dataset "${String(props.dataset)}"` : value === undefined ? "–" : formatValue(value, format, ctx.format),
        caption: props.caption ? String(props.caption) : "",
      };
    });
    const lines: Line[] = [[], [], []];
    row.forEach((m, i) => {
      const sep = i ? "  " : "";
      lines[0]!.push({ text: sep + padEnd(fit(m.label, tile), tile), dim: true });
      lines[1]!.push({ text: sep }, { text: padEnd(fit(m.value, tile), tile), bold: true });
      lines[2]!.push({ text: sep + padEnd(fit(m.caption, tile), tile), dim: true });
    });
    if (!row.some((m) => m.caption)) lines.pop();
    if (start) push(ctx, []);
    push(ctx, ...lines.map(trimEnd));
  }
}

function lineChart(ctx: Ctx, props: Record<string, unknown>, dataset: Dataset): Line[] {
  const x = String(props.x);
  const ys = (Array.isArray(props.y) ? props.y : [props.y]).map(String);
  const format = props.format as ValueFormat | undefined;
  const dates = dataset.rows.length > 0 && dataset.rows.every((r) => parseDate(r[x]) !== null);
  const items = dataset.rows.map((r, i) => ({ key: dates ? parseDate(r[x])!.getTime() : i, label: r[x], values: ys.map((c) => toNumber(r[c])) }));
  if (dates) items.sort((a, b) => a.key - b.key);
  const values = items.flatMap((p) => p.values.filter((v): v is number => v !== null));
  if (!values.length) return [[{ text: "No numbers to draw.", dim: true }]];
  // Months often arrive as their first day; they read as months.
  const monthly = dates && items.every((p) => new Date(p.key).toISOString().slice(8) === "01T00:00:00.000Z");

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1];
  const H = ctx.chartRows;
  const marks = new Map<number, string>([[0, formatAxis(hi, format, ctx.format)], [H - 1, formatAxis(lo, format, ctx.format)]]);
  if (H >= 6) marks.set(Math.floor((H - 1) / 2), formatAxis((hi + lo) / 2, format, ctx.format));
  const lw = Math.max(...[...marks.values()].map(cellWidth)) + 1;
  const cols = Math.max(8, ctx.width - lw - 1);
  const dotW = cols * 2;
  const dotH = H * 4;
  const keys = items.map((p) => p.key);
  const kmin = Math.min(...keys);
  const kmax = Math.max(...keys);
  const sx = (k: number) => (kmax === kmin ? Math.floor((dotW - 1) / 2) : Math.round(((k - kmin) / (kmax - kmin)) * (dotW - 1)));
  const sy = (v: number) => Math.round(((v - lo) / (hi - lo)) * (dotH - 1));

  const bits = new Uint8Array(cols * H);
  const owner = new Int8Array(cols * H).fill(-1);
  const dot = (dx: number, dy: number, s: number) => {
    if (dx < 0 || dy < 0 || dx >= dotW || dy >= dotH) return;
    const cell = (H - 1 - (dy >> 2)) * cols + (dx >> 1);
    bits[cell]! |= DOTS[dx & 1]![3 - (dy & 3)]!;
    owner[cell] = s;
  };
  ys.forEach((_, s) => {
    let prev: [number, number] | null = null;
    for (const item of items) {
      const v = item.values[s];
      if (v === null || v === undefined) {
        prev = null;
        continue;
      }
      const point: [number, number] = [sx(item.key), sy(v)];
      if (prev) segment(prev, point, (dx, dy) => dot(dx, dy, s));
      else dot(point[0], point[1], s);
      prev = point;
    }
  });

  const out: Line[] = [];
  for (let r = 0; r < H; r++) {
    const line: Line = [{ text: padStart(marks.get(r) ?? "", lw - 1) + " ", dim: true }, { text: marks.has(r) ? "┤" : "│", dim: true }];
    let run: Span | null = null;
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const s = owner[cell]!;
      const ch = bits[cell] ? String.fromCharCode(0x2800 + bits[cell]!) : " ";
      const ink = s >= 0 ? series(s) : undefined;
      if (run && run.ink === ink) run.text += ch;
      else line.push((run = ink ? { text: ch, ink } : { text: ch }));
    }
    out.push(trimEnd(line));
  }
  out.push([{ text: " ".repeat(lw) + "└" + "─".repeat(cols), dim: true }]);
  const label = (v: unknown, key: number) =>
    monthly ? new Intl.DateTimeFormat(ctx.format.locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(key)) : dates ? formatDate(v, ctx.format.locale) : String(v ?? "");
  const first = label(items[0]!.label, items[0]!.key);
  const last = label(items.at(-1)!.label, items.at(-1)!.key);
  const room = cols + 1;
  const axis = items.length > 1 && cellWidth(first) + cellWidth(last) + 2 <= room ? first + " ".repeat(room - cellWidth(first) - cellWidth(last)) + last : fit(first, room);
  out.push([{ text: " ".repeat(lw) + axis, dim: true }]);

  // The legend carries each line's latest value, so the numbers are there to read.
  const legend: Span[][] = ys.map((name, s) => {
    const latest = [...items].reverse().find((p) => p.values[s] !== null)?.values[s];
    return [{ text: "● ", ink: series(s) }, { text: `${name} ` }, { text: latest === undefined || latest === null ? "–" : formatValue(latest, format, ctx.format), bold: true }];
  });
  out.push(...flow(legend, ctx.width));
  return out;
}

function barChart(ctx: Ctx, props: Record<string, unknown>, dataset: Dataset): Line[] {
  const x = String(props.x);
  const ys = (Array.isArray(props.y) ? props.y : [props.y]).map(String);
  const format = props.format as ValueFormat | undefined;
  const rows = dataset.rows.slice(0, MAX_BAR_ROWS);
  const label = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, ctx.format.locale) : String(v ?? "–"));
  const items = rows.map((r) => ({ label: label(r[x]), values: ys.map((c) => toNumber(r[c])) }));
  const values = items.flatMap((i) => i.values.filter((v): v is number => v !== null));
  if (!values.length) return [[{ text: "No numbers to draw.", dim: true }]];

  const shown = items.map((i) => i.values.map((v) => (v === null ? "–" : formatValue(v, format, ctx.format))));
  const vw = Math.max(...shown.flat().map(cellWidth));
  // Labels give up room before the bars do.
  const lw = Math.max(4, Math.min(Math.max(...items.map((i) => cellWidth(i.label))), Math.floor(ctx.width * 0.4), ctx.width - vw - 8));
  const bw = Math.max(1, ctx.width - lw - vw - 2);
  const max = Math.max(...values.map(Math.abs)) || 1;
  const out: Line[] = [];
  if (ys.length > 1) out.push(...flow(ys.map((name, s) => [{ text: "■ ", ink: series(s) }, { text: name }]), ctx.width));
  items.forEach((item, i) => {
    item.values.forEach((v, s) => {
      const name = s === 0 ? padEnd(fit(item.label, lw), lw) : " ".repeat(lw);
      const cells = v === null ? "" : bar((Math.abs(v) / max) * bw);
      out.push(trimEnd([{ text: `${name} ` }, { text: cells, ink: v !== null && v < 0 ? "bad" : series(s) }, { text: " ".repeat(bw - cellWidth(cells) + 1) }, { text: padStart(shown[i]![s]!, vw) }]));
    });
  });
  if (dataset.rows.length > rows.length) out.push([{ text: `+${dataset.rows.length - rows.length} more rows`, dim: true }]);
  return out;
}

function pieChart(ctx: Ctx, props: Record<string, unknown>, dataset: Dataset): Line[] {
  const format = props.format as ValueFormat | undefined;
  const all = dataset.rows
    .map((r) => ({ label: String(r[String(props.label)] ?? "–"), value: toNumber(r[String(props.value)]) ?? 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const slices = all.length > MAX_SLICES + 1 ? [...all.slice(0, MAX_SLICES), { label: "Other", value: all.slice(MAX_SLICES).reduce((t, s) => t + s.value, 0) }] : all;
  const total = slices.reduce((t, s) => t + s.value, 0);
  if (!total) return [[{ text: "No positive values to draw.", dim: true }]];
  const ink = (i: number): Ink => (slices[i]!.label === "Other" && i === slices.length - 1 ? "muted" : series(i));

  // One bar of the whole, each slice's share of its width, then the legend with the numbers.
  const strip: Line = [];
  let used = 0;
  slices.forEach((s, i) => {
    const end = i === slices.length - 1 ? ctx.width : Math.round(((used + s.value) / total) * ctx.width);
    const from = Math.round((used / total) * ctx.width);
    used += s.value;
    if (end > from) strip.push({ text: "█".repeat(end - from), ink: ink(i) });
  });
  const shares = slices.map((s) => formatValue(s.value / total, "percent", ctx.format));
  const amounts = slices.map((s) => formatValue(s.value, format, ctx.format));
  const sw = Math.max(...shares.map(cellWidth));
  const aw = Math.max(...amounts.map(cellWidth));
  // In a narrow pane the amounts go and the shares stay.
  const withAmounts = ctx.width - sw - aw - 6 >= 6;
  const lw = Math.max(4, ctx.width - sw - 4 - (withAmounts ? aw + 2 : 0));
  return [
    strip,
    ...slices.map((s, i) => trimEnd([{ text: "■ ", ink: ink(i) }, { text: padEnd(fit(s.label, lw), lw) + "  " }, { text: padStart(shares[i]!, sw), bold: true }, ...(withAmounts ? [{ text: "  " + padStart(amounts[i]!, aw), dim: true }] : [])])),
  ];
}

function table(ctx: Ctx, props: Record<string, unknown>, dataset: Dataset): Line[] {
  const given = Array.isArray(props.columns) ? (props.columns as unknown[]) : dataset.columns.map((c) => c.name);
  let columns = given.map((c) => (typeof c === "string" ? { field: c, label: c, format: undefined } : (c as { field: string; label?: string; format?: ValueFormat }))).map((c) => ({ field: c.field, label: c.label ?? c.field, format: c.format }));
  const limit = Math.min(Number(props.limit ?? 100) || 100, ctx.tableRows);
  const rows = dataset.rows.slice(0, limit);
  const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c.field] === "number")).map((c) => c.field));
  const cells = rows.map((r) => columns.map((c) => formatValue(r[c.field], c.format ?? (numeric.has(c.field) ? undefined : "text"), ctx.format).replace(/\s+/g, " ")));
  let widths = columns.map((c, i) => Math.min(32, Math.max(cellWidth(c.label), ...cells.map((row) => cellWidth(row[i]!)))));
  const total = () => widths.reduce((t, w) => t + w, 0) + 2 * (widths.length - 1);
  // Narrow the widest column a cell at a time; past that, leave columns off the end.
  while (total() > ctx.width) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest]! <= 6) break;
    widths[widest]!--;
  }
  let dropped = 0;
  while (total() > ctx.width && widths.length > 1) {
    widths = widths.slice(0, -1);
    columns = columns.slice(0, -1);
    dropped++;
  }
  const cellAt = (text: string, i: number) => (numeric.has(columns[i]!.field) ? padStart(fit(text, widths[i]!), widths[i]!) : padEnd(fit(text, widths[i]!), widths[i]!));
  const out: Line[] = [
    trimEnd([{ text: columns.map((c, i) => cellAt(c.label, i)).join("  "), bold: true }]),
    [{ text: widths.map((w) => "─".repeat(w)).join("  "), dim: true }],
    ...cells.map((row) => trimEnd([{ text: columns.map((_, i) => cellAt(row[i]!, i)).join("  ") }])),
  ];
  const notes = [dataset.rows.length > rows.length ? `Showing ${rows.length} of ${dataset.rows.length} rows.` : "", dropped ? `${dropped} more column${dropped === 1 ? "" : "s"} in the full board.` : ""].filter(Boolean);
  if (notes.length) out.push([{ text: fit(notes.join(" "), ctx.width), dim: true }]);
  return out;
}

/** Paragraphs and "- " bullets with **bold**, like the board's own Note. */
function note(ctx: Ctx, props: Record<string, unknown>): void {
  const tone = TONES[String(props.tone ?? "plain")];
  const bar: Span[] = tone ? [{ text: "▌ ", ink: tone }] : [];
  const width = ctx.width - (tone ? 2 : 0);
  if (props.title) push(ctx, [...bar, { text: fit(String(props.title), width), bold: true }]);
  let first = true;
  for (const para of String(props.text ?? "").split(/\n{2,}/)) {
    if (!first) push(ctx, tone ? [...bar] : []);
    first = false;
    for (const raw of para.split("\n")) {
      if (!raw.trim()) continue;
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
      const spans = inline(bullet ? bullet[1]! : raw);
      const lines = wrapSpans(spans, width - (bullet ? 2 : 0));
      lines.forEach((l, i) => push(ctx, [...bar, ...(bullet ? [{ text: i ? "  " : "• " }] : []), ...l]));
    }
  }
}

function inline(text: string): Span[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part }));
}

/** Runs laid out one after another, wrapped to the width, two spaces apart. */
function flow(items: Span[][], width: number): Line[] {
  const out: Line[] = [];
  let line: Line = [];
  let used = 0;
  for (const given of items) {
    const item = clip(given, width);
    const w = item.reduce((t, s) => t + cellWidth(s.text), 0);
    if (used && used + 2 + w > width) {
      out.push(line);
      line = [];
      used = 0;
    }
    if (used) line.push({ text: "  " });
    line.push(...item);
    used += (used ? 2 : 0) + w;
  }
  if (line.length) out.push(line);
  return out;
}

/** Styled runs wrapped at spaces to the width; a word longer than a line is cut. */
function wrapSpans(spans: Span[], width: number): Line[] {
  const words: Span[] = [];
  for (const s of spans) for (const piece of s.text.split(/(\s+)/)) if (piece) words.push({ ...s, text: piece });
  const out: Line[] = [];
  let line: Line = [];
  let used = 0;
  for (const word of words) {
    if (/^\s+$/.test(word.text)) {
      if (used) {
        line.push({ ...word, text: " " });
        used++;
      }
      continue;
    }
    let text = word.text;
    while (cellWidth(text) > width) {
      if (used) {
        out.push(trimEnd(line));
        line = [];
        used = 0;
      }
      const head = cut(text, width);
      out.push([{ ...word, text: head }]);
      text = text.slice(head.length);
    }
    if (used + cellWidth(text) > width) {
      out.push(trimEnd(line));
      line = [];
      used = 0;
    }
    line.push({ ...word, text });
    used += cellWidth(text);
  }
  if (line.length) out.push(trimEnd(line));
  return out;
}

/** Plain text wrapped at spaces to the width. */
export function wrap(text: string, width: number): string[] {
  return wrapSpans([{ text }], width).map(lineText);
}

/** Bresenham's line between two dots. */
function segment([x0, y0]: [number, number], [x1, y1]: [number, number], plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += stepX;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += stepY;
    }
  }
}

/** A bar `cells` long, to an eighth of a cell; anything above zero shows. */
function bar(cells: number): string {
  if (cells <= 0) return "";
  const eighths = Math.max(1, Math.round(cells * 8));
  return "█".repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8]!;
}

function resolve(value: unknown, state: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, state));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1 && entries[0]![0] === "$state" && typeof entries[0]![1] === "string") return pointer(state, entries[0]![1]);
    return Object.fromEntries(entries.map(([k, v]) => [k, resolve(v, state)]));
  }
  return value;
}

function pointer(state: Record<string, unknown>, path: string): unknown {
  let at: unknown = state;
  for (const raw of path.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** Cells a string takes in a terminal: wide East Asian letters and emoji take two. */
export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f) continue;
    width +=
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
        ? 2
        : 1;
  }
  return width;
}

/** The longest start of `text` that fits in `width` cells. */
function cut(text: string, width: number): string {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  return out || [...text][0] || "";
}

/** The text, or as much as fits with an ellipsis. */
export function fit(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  return width <= 1 ? cut(text, width) : `${cut(text, width - 1)}…`;
}

function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}

function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - cellWidth(text))) + text;
}

/** Drops trailing spaces, so a pane never wraps a line on blanks. */
function trimEnd(line: Line): Line {
  const out = line.map((s) => ({ ...s }));
  while (out.length) {
    const last = out.at(-1)!;
    last.text = last.text.replace(/\s+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}
