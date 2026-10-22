import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sqliteOver, type Database, type TableInfo } from "./db.js";
import { parseCsv, shapeSheet, sqlName, uniqueNames, type Cell, type ColumnType } from "./sheets.js";

// Excel and CSV files as a database. Each sheet becomes a table in an in-memory SQLite copy,
// so Claude can join across files with SQL; the files themselves are only ever read. The
// copy is query-only, and it is rebuilt when a file changes (checked at most once a second).

export interface FilesOptions {
  /** How often to look for changed files, in ms. Default 1000. */
  recheckMs?: number;
}

const READABLE = new Set([".xlsx", ".xlsm", ".csv", ".tsv"]);
const SQL_TYPES: Record<ColumnType, string> = { integer: "INTEGER", real: "REAL", boolean: "INTEGER", date: "TEXT", datetime: "TEXT", time: "TEXT", text: "TEXT" };
const TYPE_NAMES: Record<ColumnType, string> = { integer: "integer", real: "number", boolean: "boolean (1/0)", date: "date (YYYY-MM-DD)", datetime: "datetime (YYYY-MM-DD HH:MM:SS)", time: "time (HH:MM:SS)", text: "text" };

interface Loaded {
  db: Database;
  tables: TableInfo[];
  notes: string[];
  signature: string;
  /** The one currency the files' amounts are written in, if they agree. */
  currency?: string;
}

/** Opens .xlsx, .xlsm, .csv and .tsv files, or folders of them, as one read-only database. */
export async function openFiles(paths: string[], options: FilesOptions = {}): Promise<Database> {
  const targets = paths.map((p) => resolve(p));
  const recheckMs = options.recheckMs ?? 1000;
  let current = await load(targets);
  if (!current.tables.length) {
    current.db.close();
    throw new Error(`No tables could be read from ${paths.join(", ")}.${current.notes.length ? ` ${current.notes.join(" ")}` : ""}`);
  }
  let checkedAt = Date.now();
  let reloading: Promise<Loaded> | null = null;

  async function fresh(): Promise<Loaded> {
    if (reloading) return reloading;
    if (Date.now() - checkedAt < recheckMs) return current;
    checkedAt = Date.now();
    if (signature(targets) === current.signature) return current;
    reloading = load(targets)
      .then((next) => {
        const old = current;
        current = next;
        void old.db.close();
        return next;
      })
      .finally(() => {
        reloading = null;
      });
    return reloading;
  }

  return {
    kind: "sqlite",
    async describe() {
      return (await fresh()).tables;
    },
    async query(sql, limits, values) {
      return (await fresh()).db.query(sql, limits, values);
    },
    notes: () => current.notes,
    currency: () => current.currency,
    async close() {
      await current.db.close();
    },
  };
}

/** The readable files a list of paths names, folders expanded one level. */
function expand(targets: string[]): { files: string[]; notes: string[] } {
  const files: string[] = [];
  const notes: string[] = [];
  const consider = (path: string, named: boolean) => {
    const name = basename(path);
    if (name.startsWith("~$") || name.startsWith(".")) return; // Excel's lock files, hidden files
    const ext = extname(name).toLowerCase();
    if (READABLE.has(ext)) files.push(path);
    else if (ext === ".xls" || ext === ".ods" || ext === ".numbers") notes.push(`${display(path)}: ${ext} files cannot be read; save it as .xlsx or .csv.`);
    else if (named) notes.push(`${display(path)}: not a spreadsheet (.xlsx, .xlsm, .csv or .tsv).`);
  };
  for (const target of targets) {
    let stat;
    try {
      stat = statSync(target);
    } catch {
      notes.push(`${display(target)}: not found.`);
      continue;
    }
    if (stat.isDirectory()) for (const entry of readdirSync(target).sort()) consider(join(target, entry), false);
    else consider(target, true);
  }
  return { files, notes };
}

function signature(targets: string[]): string {
  return expand(targets)
    .files.map((f) => {
      try {
        const s = statSync(f);
        return `${f}:${s.size}:${s.mtimeMs}`;
      } catch {
        return `${f}:gone`;
      }
    })
    .join("|");
}

const display = (path: string) => {
  const rel = relative(process.cwd(), path);
  return (rel && !rel.startsWith("..") ? rel : path).split(sep).join("/");
};

async function load(targets: string[]): Promise<Loaded> {
  const { DatabaseSync } = await import("node:sqlite");
  const sig = signature(targets);
  const { files, notes } = expand(targets);
  const db = new DatabaseSync(":memory:");
  const tables: TableInfo[] = [];
  const taken = new Set<string>();
  const currencies = new Set<string>();

  for (const file of files) {
    let sheets: { name: string | null; rows: Cell[][] }[];
    try {
      sheets = await readSheets(file);
    } catch (err) {
      notes.push(`${display(file)}: could not be read (${(err as Error).message}).`);
      continue;
    }
    const stem = sqlName(basename(file, extname(file)), "sheet");
    for (const sheet of sheets) {
      const shaped = shapeSheet(sheet.rows);
      if (!shaped || !shaped.columns.length) continue;
      const [table] = uniqueNames([sheets.length > 1 && sheet.name ? `${stem}_${sqlName(sheet.name, "sheet")}` : stem], taken);
      write(db, table!, shaped.columns.map((c) => ({ name: c.name, type: SQL_TYPES[c.type] })), shaped.rows);
      for (const c of shaped.columns) if (c.currency) currencies.add(c.currency);
      tables.push({
        table: table!,
        rows: shaped.rows.length,
        // The heading is shown only when the name hides something ("Net Sales (₹)"), not for "Order ID".
        columns: shaped.columns.map((c) => ({ name: c.name, type: TYPE_NAMES[c.type], ...(c.label.toLowerCase().replace(/\s+/g, "_") !== c.name ? { label: c.label } : {}) })),
        source: sheet.name ? `${display(file)} › ${sheet.name}` : display(file),
        ...(shaped.notes.length ? { notes: shaped.notes } : {}),
      });
    }
  }
  // Claude's SQL only reads; query_only also turns away anything that tries to write.
  db.exec("PRAGMA query_only = ON");
  const inner = sqliteOver(db);
  return { db: inner, tables, notes, signature: sig, ...(currencies.size === 1 ? { currency: [...currencies][0]! } : {}) };
}

function write(db: DatabaseSync, table: string, columns: { name: string; type: string }[], rows: (string | number | null)[][]) {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  db.exec(`CREATE TABLE ${quote(table)} (${columns.map((c) => `${quote(c.name)} ${c.type}`).join(", ")})`);
  if (!rows.length) return;
  const insert = db.prepare(`INSERT INTO ${quote(table)} VALUES (${columns.map(() => "?").join(", ")})`);
  db.exec("BEGIN");
  for (const row of rows) insert.run(...row);
  db.exec("COMMIT");
}

async function readSheets(file: string): Promise<{ name: string | null; rows: Cell[][] }[]> {
  const ext = extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") return [{ name: null, rows: parseCsv(decode(readFileSync(file)), ext === ".tsv" ? "\t" : undefined) }];
  const { default: readExcelFile } = await import("read-excel-file/node");
  const sheets = await readExcelFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] }));
}

/** UTF-8 (with or without a BOM), UTF-16 from Excel's "Unicode text", or Windows-1252 from older Excel. */
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
