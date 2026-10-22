// Built by build.mjs from packages/showboard/src/text. Do not edit.

// packages/showboard/src/spec/format.ts
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function formatValue(value, format, opts = {}) {
  if (value === null || value === void 0) return "\u2013";
  const { locale, currency = "USD" } = opts;
  if (format === "text") return String(value);
  if (format === "date") return formatDate(value, locale);
  const n = toNumber(value);
  if (n === null) return typeof value === "object" ? JSON.stringify(value) : String(value);
  switch (format) {
    case "integer":
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
    case "currency":
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
    case "percent":
      return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n);
    case "compact":
      return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
  }
}
function formatAxis(value, format, opts = {}) {
  const { locale, currency = "USD" } = opts;
  if (format === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
  if (format === "currency") return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function formatDate(value, locale) {
  const date = parseDate(value);
  if (!date) return String(value);
  const text = typeof value === "string" ? value : "";
  const options = /^\d{4}-\d{2}$/.test(text) ? { month: "short", year: "numeric", timeZone: "UTC" } : /^\d{4}-\d{2}-\d{2}$/.test(text) ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(locale, options).format(date);
}
function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// packages/showboard/src/text/index.ts
var INKS = {
  s1: "#3987e5",
  s2: "#d95926",
  s3: "#199e70",
  s4: "#c98500",
  s5: "#d55181",
  s6: "#2f9e44",
  s7: "#9085e9",
  s8: "#e66767",
  accent: "#3987e5",
  muted: "#8b93a3",
  good: "#4ade80",
  bad: "#f87171",
  warn: "#fbbf24",
  info: "#60a5fa"
};
var MAX_DEPTH = 24;
var MAX_SLICES = 7;
var MAX_BAR_ROWS = 24;
var MIN_TILE = 16;
var SOURCE_LINES = 8;
var EIGHTHS = ["", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589"];
var DOTS = [
  [1, 2, 4, 64],
  [8, 16, 32, 128]
];
var TONES = { info: "info", good: "good", warn: "warn", bad: "bad" };
var series = (i) => `s${i % 8 + 1}`;
function boardToText(board, options) {
  const ctx = {
    board,
    width: Math.max(24, Math.floor(options.width)),
    format: options.format ?? {},
    sources: options.sources ?? false,
    tableRows: options.tableRows ?? 12,
    chartRows: Math.max(3, options.chartRows ?? 8),
    // Datasets are state too, so a prop can read one cell: { "$state": "/data/sales/0/total" }.
    state: { ...board.spec.state ?? {}, data: Object.fromEntries(Object.entries(board.datasets).map(([name, d]) => [name, d.rows])) },
    blocks: [],
    seen: /* @__PURE__ */ new Set()
  };
  draw(ctx, board.spec.root, 0);
  return ctx.blocks;
}
function lineText(line) {
  return line.map((s) => s.text).join("");
}
function push(ctx, ...given) {
  const lines = given.map((l) => clip(l, ctx.width));
  const last = ctx.blocks.at(-1);
  if (last?.kind === "text") last.lines.push(...lines);
  else ctx.blocks.push({ kind: "text", lines });
}
function clip(line, width) {
  let used = 0;
  const out = [];
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
function gap(ctx) {
  const last = ctx.blocks.at(-1);
  if (!last) return;
  if (last.kind === "action" || last.lines.length && lineText(last.lines.at(-1)) !== "") push(ctx, []);
}
function draw(ctx, key, depth) {
  const element = ctx.board.spec.elements[key];
  if (!element || depth > MAX_DEPTH || ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const props = resolve(element.props ?? {}, ctx.state);
  const children = element.children ?? [];
  switch (element.type) {
    case "Grid": {
      const kids = children.map((k) => ctx.board.spec.elements[k]);
      if (kids.length && kids.every((k) => k?.type === "Metric")) {
        gap(ctx);
        metrics(ctx, children.map((k) => resolve(ctx.board.spec.elements[k].props ?? {}, ctx.state)));
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
      ctx.blocks.push({ kind: "action", label: String(props.label ?? props.action ?? "Run"), action: String(props.action ?? ""), input: props.input ?? {} });
      return;
    default:
      gap(ctx);
      if (props.title) push(ctx, [{ text: fit(String(props.title), ctx.width), bold: true }]);
      push(ctx, [{ text: fit(`\u2039${element.type}\u203A shows in the app`, ctx.width), dim: true }]);
      for (const child of children) draw(ctx, child, depth + 1);
  }
}
function part(ctx, props, body) {
  if (props.title) push(ctx, [{ text: fit(String(props.title), ctx.width), bold: true }]);
  const dataset = typeof props.dataset === "string" ? ctx.board.datasets[props.dataset] : void 0;
  if (!dataset) {
    push(ctx, [{ text: fit(`No dataset "${String(props.dataset)}".`, ctx.width), ink: "bad" }]);
    return;
  }
  push(ctx, ...body(ctx, props, dataset));
  if (ctx.sources) source(ctx, dataset);
}
function source(ctx, dataset) {
  push(ctx, [{ text: fit(`\u21B3 ${dataset.name} \xB7 ${dataset.rows.length} rows${dataset.truncated ? " (truncated)" : ""}`, ctx.width), dim: true }]);
  const lines = dataset.origin.split("\n").flatMap((l) => wrap(l, ctx.width - 2));
  for (const l of lines.slice(0, SOURCE_LINES)) push(ctx, [{ text: `  ${l}`, dim: true }]);
  if (lines.length > SOURCE_LINES) push(ctx, [{ text: `  \u2026 ${lines.length - SOURCE_LINES} more lines`, dim: true }]);
}
function metrics(ctx, list) {
  const perRow = Math.max(1, Math.min(list.length, Math.floor((ctx.width + 2) / (MIN_TILE + 2))));
  const tile = Math.floor((ctx.width - 2 * (perRow - 1)) / perRow);
  for (let start = 0; start < list.length; start += perRow) {
    const row = list.slice(start, start + perRow).map((props) => {
      const dataset = typeof props.dataset === "string" ? ctx.board.datasets[props.dataset] : void 0;
      const value = dataset?.rows[Number(props.row ?? 0)]?.[String(props.field)];
      const format = props.format ?? (value !== void 0 && toNumber(value) === null ? "text" : void 0);
      return {
        label: String(props.label ?? props.field ?? ""),
        value: !dataset ? `No dataset "${String(props.dataset)}"` : value === void 0 ? "\u2013" : formatValue(value, format, ctx.format),
        caption: props.caption ? String(props.caption) : ""
      };
    });
    const lines = [[], [], []];
    row.forEach((m, i) => {
      const sep = i ? "  " : "";
      lines[0].push({ text: sep + padEnd(fit(m.label, tile), tile), dim: true });
      lines[1].push({ text: sep }, { text: padEnd(fit(m.value, tile), tile), bold: true });
      lines[2].push({ text: sep + padEnd(fit(m.caption, tile), tile), dim: true });
    });
    if (!row.some((m) => m.caption)) lines.pop();
    if (start) push(ctx, []);
    push(ctx, ...lines.map(trimEnd));
  }
}
function lineChart(ctx, props, dataset) {
  const x = String(props.x);
  const ys = (Array.isArray(props.y) ? props.y : [props.y]).map(String);
  const format = props.format;
  const dates = dataset.rows.length > 0 && dataset.rows.every((r) => parseDate(r[x]) !== null);
  const items = dataset.rows.map((r, i) => ({ key: dates ? parseDate(r[x]).getTime() : i, label: r[x], values: ys.map((c) => toNumber(r[c])) }));
  if (dates) items.sort((a, b) => a.key - b.key);
  const values = items.flatMap((p) => p.values.filter((v) => v !== null));
  if (!values.length) return [[{ text: "No numbers to draw.", dim: true }]];
  const monthly = dates && items.every((p) => new Date(p.key).toISOString().slice(8) === "01T00:00:00.000Z");
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1];
  const H = ctx.chartRows;
  const marks = /* @__PURE__ */ new Map([[0, formatAxis(hi, format, ctx.format)], [H - 1, formatAxis(lo, format, ctx.format)]]);
  if (H >= 6) marks.set(Math.floor((H - 1) / 2), formatAxis((hi + lo) / 2, format, ctx.format));
  const lw = Math.max(...[...marks.values()].map(cellWidth)) + 1;
  const cols = Math.max(8, ctx.width - lw - 1);
  const dotW = cols * 2;
  const dotH = H * 4;
  const keys = items.map((p) => p.key);
  const kmin = Math.min(...keys);
  const kmax = Math.max(...keys);
  const sx = (k) => kmax === kmin ? Math.floor((dotW - 1) / 2) : Math.round((k - kmin) / (kmax - kmin) * (dotW - 1));
  const sy = (v) => Math.round((v - lo) / (hi - lo) * (dotH - 1));
  const bits = new Uint8Array(cols * H);
  const owner = new Int8Array(cols * H).fill(-1);
  const dot = (dx, dy, s) => {
    if (dx < 0 || dy < 0 || dx >= dotW || dy >= dotH) return;
    const cell = (H - 1 - (dy >> 2)) * cols + (dx >> 1);
    bits[cell] |= DOTS[dx & 1][3 - (dy & 3)];
    owner[cell] = s;
  };
  ys.forEach((_, s) => {
    let prev = null;
    for (const item of items) {
      const v = item.values[s];
      if (v === null || v === void 0) {
        prev = null;
        continue;
      }
      const point = [sx(item.key), sy(v)];
      if (prev) segment(prev, point, (dx, dy) => dot(dx, dy, s));
      else dot(point[0], point[1], s);
      prev = point;
    }
  });
  const out = [];
  for (let r = 0; r < H; r++) {
    const line = [{ text: padStart(marks.get(r) ?? "", lw - 1) + " ", dim: true }, { text: marks.has(r) ? "\u2524" : "\u2502", dim: true }];
    let run = null;
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const s = owner[cell];
      const ch = bits[cell] ? String.fromCharCode(10240 + bits[cell]) : " ";
      const ink = s >= 0 ? series(s) : void 0;
      if (run && run.ink === ink) run.text += ch;
      else line.push(run = ink ? { text: ch, ink } : { text: ch });
    }
    out.push(trimEnd(line));
  }
  out.push([{ text: " ".repeat(lw) + "\u2514" + "\u2500".repeat(cols), dim: true }]);
  const label = (v, key) => monthly ? new Intl.DateTimeFormat(ctx.format.locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(key)) : dates ? formatDate(v, ctx.format.locale) : String(v ?? "");
  const first = label(items[0].label, items[0].key);
  const last = label(items.at(-1).label, items.at(-1).key);
  const room = cols + 1;
  const axis = items.length > 1 && cellWidth(first) + cellWidth(last) + 2 <= room ? first + " ".repeat(room - cellWidth(first) - cellWidth(last)) + last : fit(first, room);
  out.push([{ text: " ".repeat(lw) + axis, dim: true }]);
  const legend = ys.map((name, s) => {
    const latest = [...items].reverse().find((p) => p.values[s] !== null)?.values[s];
    return [{ text: "\u25CF ", ink: series(s) }, { text: `${name} ` }, { text: latest === void 0 || latest === null ? "\u2013" : formatValue(latest, format, ctx.format), bold: true }];
  });
  out.push(...flow(legend, ctx.width));
  return out;
}
function barChart(ctx, props, dataset) {
  const x = String(props.x);
  const ys = (Array.isArray(props.y) ? props.y : [props.y]).map(String);
  const format = props.format;
  const rows = dataset.rows.slice(0, MAX_BAR_ROWS);
  const label = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, ctx.format.locale) : String(v ?? "\u2013");
  const items = rows.map((r) => ({ label: label(r[x]), values: ys.map((c) => toNumber(r[c])) }));
  const values = items.flatMap((i) => i.values.filter((v) => v !== null));
  if (!values.length) return [[{ text: "No numbers to draw.", dim: true }]];
  const shown = items.map((i) => i.values.map((v) => v === null ? "\u2013" : formatValue(v, format, ctx.format)));
  const vw = Math.max(...shown.flat().map(cellWidth));
  const lw = Math.max(4, Math.min(Math.max(...items.map((i) => cellWidth(i.label))), Math.floor(ctx.width * 0.4), ctx.width - vw - 8));
  const bw = Math.max(1, ctx.width - lw - vw - 2);
  const max = Math.max(...values.map(Math.abs)) || 1;
  const out = [];
  if (ys.length > 1) out.push(...flow(ys.map((name, s) => [{ text: "\u25A0 ", ink: series(s) }, { text: name }]), ctx.width));
  items.forEach((item, i) => {
    item.values.forEach((v, s) => {
      const name = s === 0 ? padEnd(fit(item.label, lw), lw) : " ".repeat(lw);
      const cells = v === null ? "" : bar(Math.abs(v) / max * bw);
      out.push(trimEnd([{ text: `${name} ` }, { text: cells, ink: v !== null && v < 0 ? "bad" : series(s) }, { text: " ".repeat(bw - cellWidth(cells) + 1) }, { text: padStart(shown[i][s], vw) }]));
    });
  });
  if (dataset.rows.length > rows.length) out.push([{ text: `+${dataset.rows.length - rows.length} more rows`, dim: true }]);
  return out;
}
function pieChart(ctx, props, dataset) {
  const format = props.format;
  const all = dataset.rows.map((r) => ({ label: String(r[String(props.label)] ?? "\u2013"), value: toNumber(r[String(props.value)]) ?? 0 })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const slices = all.length > MAX_SLICES + 1 ? [...all.slice(0, MAX_SLICES), { label: "Other", value: all.slice(MAX_SLICES).reduce((t, s) => t + s.value, 0) }] : all;
  const total = slices.reduce((t, s) => t + s.value, 0);
  if (!total) return [[{ text: "No positive values to draw.", dim: true }]];
  const ink = (i) => slices[i].label === "Other" && i === slices.length - 1 ? "muted" : series(i);
  const strip = [];
  let used = 0;
  slices.forEach((s, i) => {
    const end = i === slices.length - 1 ? ctx.width : Math.round((used + s.value) / total * ctx.width);
    const from = Math.round(used / total * ctx.width);
    used += s.value;
    if (end > from) strip.push({ text: "\u2588".repeat(end - from), ink: ink(i) });
  });
  const shares = slices.map((s) => formatValue(s.value / total, "percent", ctx.format));
  const amounts = slices.map((s) => formatValue(s.value, format, ctx.format));
  const sw = Math.max(...shares.map(cellWidth));
  const aw = Math.max(...amounts.map(cellWidth));
  const withAmounts = ctx.width - sw - aw - 6 >= 6;
  const lw = Math.max(4, ctx.width - sw - 4 - (withAmounts ? aw + 2 : 0));
  return [
    strip,
    ...slices.map((s, i) => trimEnd([{ text: "\u25A0 ", ink: ink(i) }, { text: padEnd(fit(s.label, lw), lw) + "  " }, { text: padStart(shares[i], sw), bold: true }, ...withAmounts ? [{ text: "  " + padStart(amounts[i], aw), dim: true }] : []]))
  ];
}
function table(ctx, props, dataset) {
  const given = Array.isArray(props.columns) ? props.columns : dataset.columns.map((c) => c.name);
  let columns = given.map((c) => typeof c === "string" ? { field: c, label: c, format: void 0 } : c).map((c) => ({ field: c.field, label: c.label ?? c.field, format: c.format }));
  const limit = Math.min(Number(props.limit ?? 100) || 100, ctx.tableRows);
  const rows = dataset.rows.slice(0, limit);
  const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c.field] === "number")).map((c) => c.field));
  const cells = rows.map((r) => columns.map((c) => formatValue(r[c.field], c.format ?? (numeric.has(c.field) ? void 0 : "text"), ctx.format).replace(/\s+/g, " ")));
  let widths = columns.map((c, i) => Math.min(32, Math.max(cellWidth(c.label), ...cells.map((row) => cellWidth(row[i])))));
  const total = () => widths.reduce((t, w) => t + w, 0) + 2 * (widths.length - 1);
  while (total() > ctx.width) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 6) break;
    widths[widest]--;
  }
  let dropped = 0;
  while (total() > ctx.width && widths.length > 1) {
    widths = widths.slice(0, -1);
    columns = columns.slice(0, -1);
    dropped++;
  }
  const cellAt = (text, i) => numeric.has(columns[i].field) ? padStart(fit(text, widths[i]), widths[i]) : padEnd(fit(text, widths[i]), widths[i]);
  const out = [
    trimEnd([{ text: columns.map((c, i) => cellAt(c.label, i)).join("  "), bold: true }]),
    [{ text: widths.map((w) => "\u2500".repeat(w)).join("  "), dim: true }],
    ...cells.map((row) => trimEnd([{ text: columns.map((_, i) => cellAt(row[i], i)).join("  ") }]))
  ];
  const notes = [dataset.rows.length > rows.length ? `Showing ${rows.length} of ${dataset.rows.length} rows.` : "", dropped ? `${dropped} more column${dropped === 1 ? "" : "s"} in the full board.` : ""].filter(Boolean);
  if (notes.length) out.push([{ text: fit(notes.join(" "), ctx.width), dim: true }]);
  return out;
}
function note(ctx, props) {
  const tone = TONES[String(props.tone ?? "plain")];
  const bar2 = tone ? [{ text: "\u258C ", ink: tone }] : [];
  const width = ctx.width - (tone ? 2 : 0);
  if (props.title) push(ctx, [...bar2, { text: fit(String(props.title), width), bold: true }]);
  let first = true;
  for (const para of String(props.text ?? "").split(/\n{2,}/)) {
    if (!first) push(ctx, tone ? [...bar2] : []);
    first = false;
    for (const raw of para.split("\n")) {
      if (!raw.trim()) continue;
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
      const spans = inline(bullet ? bullet[1] : raw);
      const lines = wrapSpans(spans, width - (bullet ? 2 : 0));
      lines.forEach((l, i) => push(ctx, [...bar2, ...bullet ? [{ text: i ? "  " : "\u2022 " }] : [], ...l]));
    }
  }
}
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part2) => part2.startsWith("**") && part2.endsWith("**") && part2.length > 4 ? { text: part2.slice(2, -2), bold: true } : { text: part2 });
}
function flow(items, width) {
  const out = [];
  let line = [];
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
function wrapSpans(spans, width) {
  const words = [];
  for (const s of spans) for (const piece of s.text.split(/(\s+)/)) if (piece) words.push({ ...s, text: piece });
  const out = [];
  let line = [];
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
function wrap(text, width) {
  return wrapSpans([{ text }], width).map(lineText);
}
function segment([x0, y0], [x1, y1], plot) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (; ; ) {
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
function bar(cells) {
  if (cells <= 0) return "";
  const eighths = Math.max(1, Math.round(cells * 8));
  return "\u2588".repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8];
}
function resolve(value, state) {
  if (Array.isArray(value)) return value.map((v) => resolve(v, state));
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === "$state" && typeof entries[0][1] === "string") return pointer(state, entries[0][1]);
    return Object.fromEntries(entries.map(([k, v]) => [k, resolve(v, state)]));
  }
  return value;
}
function pointer(state, path) {
  let at = state;
  for (const raw of path.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (at === null || typeof at !== "object") return void 0;
    at = at[key];
  }
  return at;
}
function cellWidth(text) {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 768 && c <= 879 || c >= 8203 && c <= 8207 || c === 65039) continue;
    width += c >= 4352 && c <= 4447 || c >= 11904 && c <= 42191 && c !== 12351 || c >= 44032 && c <= 55203 || c >= 63744 && c <= 64255 || c >= 65072 && c <= 65103 || c >= 65280 && c <= 65376 || c >= 65504 && c <= 65510 || c >= 127744 && c <= 129791 || c >= 131072 && c <= 262141 ? 2 : 1;
  }
  return width;
}
function cut(text, width) {
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
function fit(text, width) {
  if (cellWidth(text) <= width) return text;
  return width <= 1 ? cut(text, width) : `${cut(text, width - 1)}\u2026`;
}
function padEnd(text, width) {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}
function padStart(text, width) {
  return " ".repeat(Math.max(0, width - cellWidth(text))) + text;
}
function trimEnd(line) {
  const out = line.map((s) => ({ ...s }));
  while (out.length) {
    const last = out.at(-1);
    last.text = last.text.replace(/\s+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}
export {
  INKS,
  boardToText,
  cellWidth,
  fit,
  lineText,
  series,
  wrap
};
