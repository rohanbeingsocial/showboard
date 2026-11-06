// Turns a spreadsheet's raw cells into a clean table for SQLite. Real sheets are messy:
// title lines above the header, blank rows, "Total" rows that would double count, "N/A"
// in number columns, "₹1,23,456" or "1.234,50" stored as text. This finds the header row, names the
// columns for SQL, guesses each column's type and converts the values.

export type Cell = string | number | boolean | Date | null;

export type ColumnType = "integer" | "real" | "date" | "datetime" | "time" | "boolean" | "text";

export interface SheetColumn {
  /** SQL-safe name, e.g. net_sales. */
  name: string;
  /** The header as written in the sheet, e.g. "Net Sales (₹)". */
  label: string;
  type: ColumnType;
  /** For numbers written with a currency ("₹1,23,456", "Price ($)"), its ISO code. */
  currency?: string;
}

export interface SheetTable {
  columns: SheetColumn[];
  rows: (string | number | null)[][];
  /** What was skipped or guessed, for Claude to read in describe_data. */
  notes: string[];
}

const MISSING = /^(n\/?a|na|null|none|nil|-+|—|–|\?|#n\/a|#value!|#ref!|#div\/0!|#name\?|#num!|#null!)$/i;
const TOTAL = /^(grand\s+|sub-?)?totals?(\s*[:(\-–].*)?$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Words SQLite will not take as a bare column name; such columns get a trailing _.
const RESERVED = new Set(
  ("add all alter and as asc between by case check collate column commit constraint create cross default delete desc distinct drop else " +
    "escape except exists foreign from group having in index inner insert intersect into is isnull join left like limit natural not " +
    "notnull null of offset on or order outer primary references right select set table then to transaction union unique update using " +
    "values when where").split(" "),
);

/** Lowercase letters, digits and _, starting with a letter or _: usable in SQL without quotes. */
export function sqlName(text: string, fallback: string): string {
  const base = text
    .replace(/#/g, " no ")
    .replace(/%/g, " pct ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!base) return fallback;
  if (/^[0-9]/.test(base)) return `_${base}`;
  return RESERVED.has(base) ? `${base}_` : base;
}

/** Gives each name a numbered suffix when it is already taken. */
export function uniqueNames(names: string[], taken = new Set<string>()): string[] {
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate); n++) candidate = `${name}_${n}`;
    taken.add(candidate);
    return candidate;
  });
}

/** RFC 4180 CSV: quoted fields may hold the delimiter, newlines and "" for a quote. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (body[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The one of , ; tab and | that splits the first lines most evenly. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/, 6).filter((l) => l.trim());
  let best = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, "").split(d).length - 1);
    const min = Math.min(...counts);
    if (min > bestScore) {
      best = d;
      bestScore = min;
    }
  }
  return best;
}

const clean = (c: Cell | undefined): Cell => {
  if (c === undefined || c === null) return null;
  if (typeof c === "string") return c.trim() || null;
  if (typeof c === "number" && !Number.isFinite(c)) return null;
  if (c instanceof Date && Number.isNaN(c.getTime())) return null;
  return c;
};
const filled = (row: Cell[]) => row.reduce<number>((n, c) => n + (c === null ? 0 : 1), 0);
const isYear = (c: Cell) => typeof c === "number" && Number.isInteger(c) && c >= 1900 && c <= 2100;

export function shapeSheet(raw: Cell[][]): SheetTable | null {
  const rows = raw.map((r) => r.map(clean));
  const first = rows.findIndex((r) => filled(r) > 0);
  if (first < 0) return null;
  const notes: string[] = [];

  // The header is the first row at least half as wide as the widest of the opening rows
  // (rows above it are titles), when it is words (or years), not data.
  const width = Math.max(...rows.slice(first, first + 30).map(filled));
  let headerAt = -1;
  for (let i = first; i < Math.min(rows.length, first + 20); i++) {
    if (filled(rows[i]!) >= Math.max(1, Math.ceil(width / 2))) {
      headerAt = i;
      break;
    }
  }
  const candidate = rows[headerAt] ?? [];
  const words = candidate.filter((c) => typeof c === "string").length;
  const hasHeader = headerAt >= 0 && words > 0 && candidate.every((c) => c === null || typeof c === "string" || isYear(c));
  const dataFrom = hasHeader ? headerAt + 1 : first;
  if (hasHeader && headerAt > first) notes.push(`header on row ${headerAt + 1}; rows above it were titles`);

  const columnCount = Math.max(0, ...rows.slice(dataFrom).map((r) => r.length), candidate.length);
  const groups = hasHeader ? groupLabels(rows[headerAt - 1], columnCount) : [];
  const labels = Array.from({ length: columnCount }, (_, i) => {
    const own = hasHeader && candidate[i] !== null && candidate[i] !== undefined ? String(candidate[i]) : "";
    return [groups[i], own].filter(Boolean).join(" ");
  });

  const data: Cell[][] = [];
  const rowNumbers: number[] = []; // each data row's row in the sheet, for notes
  const totals: number[] = [];
  for (let i = dataFrom; i < rows.length; i++) {
    const row = rows[i]!;
    if (!filled(row)) continue;
    const lead = row.find((c) => c !== null);
    if (typeof lead === "string" && TOTAL.test(lead)) {
      totals.push(i + 1);
      continue;
    }
    if (hasHeader && row.every((c, j) => c === candidate[j] || (c === null && candidate[j] === null))) continue; // repeated header
    data.push(Array.from({ length: columnCount }, (_, j) => row[j] ?? null));
    rowNumbers.push(i + 1);
  }
  if (totals.length) notes.push(`skipped ${totals.length} total row${totals.length > 1 ? "s" : ""} (row ${totals.slice(0, 5).join(", ")}${totals.length > 5 ? ", …" : ""}) so sums do not double count`);
  if (!data.length && !hasHeader) return null;

  const keep = labels.map((label, j) => label !== "" || data.some((r) => r[j] !== null));
  const names = uniqueNames(labels.map((label, j) => sqlName(label, `column_${j + 1}`)));
  const columns: SheetColumn[] = [];
  const converters: ((c: Cell) => string | number | null)[] = [];
  const kept: number[] = [];
  labels.forEach((label, j) => {
    if (!keep[j]) return;
    const typed = inferColumn(data.map((r) => r[j]!), rowNumbers);
    const currency = typed.type === "integer" || typed.type === "real" ? (typed.currency ?? currencyIn(label)) : null;
    columns.push({ name: names[j]!, label: label || names[j]!, type: typed.type, ...(currency ? { currency } : {}) });
    converters.push(typed.convert);
    kept.push(j);
    if (typed.note) notes.push(`${names[j]}: ${typed.note}`);
  });
  return { columns, rows: data.map((r) => kept.map((j, k) => converters[k]!(r[j]!))), notes };
}

/** A row of group titles over a header ("Sales" over "Units | Value"), carried right across merged cells. */
function groupLabels(row: Cell[] | undefined, count: number): string[] {
  if (!row || row.filter((c) => typeof c === "string").length < 2 || row.some((c) => c !== null && typeof c !== "string")) return [];
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < count; i++) {
    if (typeof row[i] === "string") current = row[i] as string;
    out.push(current);
  }
  return out;
}

interface Typed {
  type: ColumnType;
  convert(c: Cell): string | number | null;
  note?: string;
  currency?: string;
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoTime = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const midnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
// Excel keeps a time of day as a date on 30/31 Dec 1899.
const timeOnly = (d: Date) => d.getUTCFullYear() < 1900;

const isPresent = (v: Cell): v is Exclude<Cell, null> => v !== null && !(typeof v === "string" && MISSING.test(v));

function inferColumn(values: Cell[], rows: number[]): Typed {
  const present = values.filter(isPresent);
  const text: Typed = { type: "text", convert: (c) => (c === null ? null : c instanceof Date ? (midnight(c) ? isoDate(c) : `${isoDate(c)} ${isoTime(c)}`) : String(c)) };
  if (!present.length) return text;
  const missingToNull = (f: (c: Exclude<Cell, null>) => string | number | null) => (c: Cell) => (c === null || (typeof c === "string" && MISSING.test(c)) ? null : f(c));

  if (present.every((v) => typeof v === "boolean" || (typeof v === "string" && /^(true|false)$/i.test(v)))) {
    return { type: "boolean", convert: missingToNull((c) => (c === true || (typeof c === "string" && /^true$/i.test(c)) ? 1 : 0)) };
  }

  if (present.every((v) => v instanceof Date)) {
    const dates = present as Date[];
    if (dates.every(timeOnly)) return { type: "time", convert: missingToNull((c) => isoTime(c as Date)) };
    const allMidnight = dates.every(midnight);
    return { type: allMidnight ? "date" : "datetime", convert: missingToNull((c) => (allMidnight ? isoDate(c as Date) : `${isoDate(c as Date)} ${isoTime(c as Date)}`)) };
  }

  const strings = present.filter((v): v is string => typeof v === "string");
  const numbers = numberColumn(values, rows);
  if (numbers.typed) return numbers.typed;

  // Text dates: ISO, "15-Mar-2026" / "Mar 15, 2026", or 03/04/2026 when the values show which part is the day.
  if (present.every((v) => v instanceof Date || typeof v === "string")) {
    const dated = present.every((v) => v instanceof Date || (parseTextDate(v as string, "dmy") ?? parseTextDate(v as string, "mdy")) !== null);
    if (dated) {
      const slashes = strings.map((s) => s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)).filter((m) => m !== null);
      const dayFirst = slashes.some((m) => Number(m[1]) > 12);
      const monthFirst = slashes.some((m) => Number(m[2]) > 12);
      if (slashes.length && dayFirst === monthFirst) {
        return { ...text, note: dayFirst ? "has dates in both day/month and month/day order; kept as text" : "dates like 03/04/2026 could be day/month or month/day; kept as text" };
      }
      const order = monthFirst ? "mdy" : "dmy";
      const values = present.map((v) => (v instanceof Date ? (midnight(v) ? isoDate(v) : `${isoDate(v)} ${isoTime(v)}`) : parseTextDate(v as string, order)!));
      const withTime = values.some((v) => v.length > 10);
      return {
        type: withTime ? "datetime" : "date",
        convert: missingToNull((c) => (c instanceof Date ? (midnight(c) ? isoDate(c) : `${isoDate(c)} ${isoTime(c)}`) : parseTextDate(String(c), order))),
        ...(slashes.length ? { note: `read ${slashes[0]![0]} as ${order === "dmy" ? "day/month/year" : "month/day/year"}` } : {}),
      };
    }
  }
  return numbers.note ? { ...text, note: numbers.note } : text;
}

const examples = (cells: { v: Cell; row: number }[]) =>
  `${cells
    .slice(0, 3)
    .map((c) => `row ${c.row} "${String(c.v)}"`)
    .join(", ")}${cells.length > 3 ? ", …" : ""}`;

/**
 * A column of numbers, some written as text. Each text value is read by the decimal mark it shows
 * ("1.234,50" and "1,234.50" are both 1234.5, even in one column); one that reads two ways
 * ("1,234", "1.234") follows the rest of the column, or is left empty when the column is split.
 * Not numbers: no `typed`, and a `note` when most values were, so a sum over the text is not trusted.
 */
function numberColumn(values: Cell[], rows: number[]): { typed?: Typed; note?: string } {
  const cells = values.map((v, k) => ({ v, row: rows[k]! })).filter((c) => isPresent(c.v));
  if (!cells.length || cells.some((c) => typeof c.v !== "number" && typeof c.v !== "string")) return {};
  const texts = cells.filter((c): c is { v: string; row: number } => typeof c.v === "string");
  // Leading zeros and 16+ digits are codes, not amounts: 007, 0612, card numbers.
  if (texts.some((c) => /^0\d/.test(c.v) || /^\d{16,}$/.test(c.v))) return {};
  const read = texts.map((c) => ({ ...c, r: readNumberText(c.v) }));
  const bad = read.filter((c) => c.r === null);
  if (bad.length) {
    const s = bad.length === 1 ? "is not a number" : "are not numbers";
    return bad.length * 2 <= cells.length ? { note: `kept as text: ${bad.length} of ${cells.length} values ${s} (${examples(bad)}), so a sum over it would be wrong` } : {};
  }

  const votes: Record<Decimal, number> = { ".": 0, ",": 0 };
  const twoWays: typeof read = [];
  for (const c of read) {
    const { ".": dot, ",": comma } = c.r!;
    if (dot === null) votes[","]++;
    else if (comma === null) votes["."]++;
    else if (dot !== comma) twoWays.push(c);
  }
  const notes: string[] = [];
  let settle: Decimal | null = votes[","] > 0 && votes["."] === 0 ? "," : ".";
  if (votes["."] && votes[","]) {
    notes.push(`mixes ${votes["."]} values written like 1,234.50 with ${votes[","]} like 1.234,50; each is read by its own decimal mark`);
    const [major, minor]: Decimal[] = votes["."] >= votes[","] ? [".", ","] : [",", "."];
    settle = votes[minor!] * 4 <= votes[major!] ? major! : null;
    if (twoWays.length) {
      notes.push(
        settle
          ? `${twoWays.length} value${twoWays.length > 1 ? "s" : ""} that read two ways (${examples(twoWays)}) used "${settle}" as the decimal mark, like most of the column`
          : `${twoWays.length} value${twoWays.length > 1 ? "s" : ""} left empty because each reads two ways (${examples(twoWays)})`,
      );
    }
  } else if (!votes["."] && !votes[","] && twoWays.some((c) => c.v.includes("."))) {
    notes.push(`values like "${twoWays.find((c) => c.v.includes("."))!.v}" could be a decimal or a thousands mark; read "." as the decimal mark`);
  }

  const toNumber = (s: string) => {
    const r = readNumberText(s);
    if (!r) return null;
    if (r["."] === null || r[","] === null || r["."] === r[","]) return r["."] ?? r[","];
    return settle ? r[settle] : null;
  };
  const parsed = cells.map((c) => (typeof c.v === "number" ? c.v : toNumber(c.v as string))).filter((n) => n !== null);
  if (texts.some((c) => c.v.trim().endsWith("%"))) notes.push("had percentages; 12.5% is stored as 12.5");
  const currencies = new Set(texts.map((c) => currencyIn(c.v)).filter((c) => c !== null));
  return {
    typed: {
      type: parsed.every(Number.isInteger) ? "integer" : "real",
      convert: (c) => (!isPresent(c) ? null : typeof c === "number" ? c : toNumber(String(c))),
      ...(notes.length ? { note: notes.join("; ") } : {}),
      ...(currencies.size === 1 ? { currency: [...currencies][0]! } : {}),
    },
  };
}

const CURRENCIES: [RegExp, string][] = [
  [/₹|\brs\b|\binr\b/i, "INR"],
  [/€|\beur\b/i, "EUR"],
  [/£|\bgbp\b/i, "GBP"],
  [/¥|\bjpy\b/i, "JPY"],
  [/\$|\busd\b/i, "USD"],
];

/** The currency a heading or amount is written in ("Net Sales (₹)", "$1,200", "Rs. 500"), as an ISO code. */
export function currencyIn(text: string): string | null {
  return CURRENCIES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

type Decimal = "." | ",";

/**
 * "1,234.50", "1.234,50", "1 234,50", "₹1,23,456", "$ 99", "(1,200)", "-3.5%", "1.2e6" → number; anything else → null.
 * `decimal` settles a value that reads two ways ("1,234" is 1234 with ".", 1.234 with ","); others show their own mark.
 */
export function parseNumberText(raw: string, decimal: Decimal = "."): number | null {
  const r = readNumberText(raw);
  return r ? (r[decimal] ?? r[decimal === "." ? "," : "."]) : null;
}

/** A number written as text, read with "." and with "," as the decimal mark; null when neither reads. */
export function readNumberText(raw: string): Record<Decimal, number | null> | null {
  let s = raw.trim();
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  if (/^[-+]/.test(s)) {
    if (s[0] === "-") sign = -sign;
    s = s.slice(1).trim();
  }
  s = s.replace(/^(rs\.?|inr|usd|eur|gbp|[$€£₹¥])\s*/i, "").replace(/\s*(inr|usd|eur|gbp|[$€£₹¥])$/i, "");
  if (/^[-+]/.test(s)) {
    if (s[0] === "-") sign = -sign;
    s = s.slice(1);
  }
  s = s.replace(/\s*%$/, "");
  const dot = readAs(s, ".");
  const comma = readAs(s, ",");
  if (dot === null && comma === null) return null;
  return { ".": dot === null ? null : sign * dot, ",": comma === null ? null : sign * comma };
}

function readAs(s: string, decimal: Decimal): number | null {
  const group = decimal === "." ? "," : ".";
  // Spaces and apostrophes only ever group digits: "1 234,50", "1'234.50".
  const body = s.replace(/[\s  '’]/g, group);
  const [d, g] = decimal === "." ? ["\\.", ","] : [",", "\\."];
  const plain = new RegExp(`^(\\d+(${d}\\d+)?|${d}\\d+)(e[-+]?\\d+)?$`, "i").test(body);
  const grouped = new RegExp(`^[1-9]\\d{0,2}(${g}\\d{2,3})*${g}\\d{3}(${d}\\d+)?$`).test(body);
  if (!plain && !grouped) return null;
  const n = Number(body.split(group).join("").replace(decimal, "."));
  return Number.isFinite(n) ? n : null;
}

/** A date written as text, as YYYY-MM-DD (with " HH:MM:SS" when it has a time), or null. */
export function parseTextDate(raw: string, order: "dmy" | "mdy"): string | null {
  const s = raw.trim();
  const time = (h?: string, m?: string, sec?: string) => (h === undefined ? "" : ` ${pad(Number(h))}:${m}:${sec ?? "00"}`);
  const valid = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out = (y: number, mo: number, d: number, t = "") => (valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}${t}` : null);

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) return out(Number(m[1]), Number(m[2]), Number(m[3]), time(m[4], m[5], m[6]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === "dmy" ? out(Number(m[3]), b, a, time(m[4], m[5], m[6])) : out(Number(m[3]), a, b, time(m[4], m[5], m[6]));
  }
  m = s.match(/^(\d{1,2})[ -]([a-z]{3,9})\.?[ ,-]+(\d{4})$/i);
  if (m && monthOf(m[2]!)) return out(Number(m[3]), monthOf(m[2]!)!, Number(m[1]));
  m = s.match(/^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i);
  if (m && monthOf(m[1]!)) return out(Number(m[3]), monthOf(m[1]!)!, Number(m[2]));
  return null;
}

/** 1-12 for "Mar", "March" or "Sept"; undefined for other words. */
function monthOf(word: string): number | undefined {
  const w = word.toLowerCase();
  const i = MONTHS.findIndex((name) => name.startsWith(w));
  return i >= 0 ? i + 1 : undefined;
}
