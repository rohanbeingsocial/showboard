import type { DatabaseSync } from "node:sqlite";
import type { Column } from "../spec/types.js";

// Read-only access to the app's database. Claude writes the SQL; the database computes
// every number. Postgres runs each query in a READ ONLY transaction with a time limit, as
// one statement (extended protocol, so "…; COMMIT; DROP …" cannot slip through). SQLite
// opens the file read-only. A read-only database role is still the safest setup.

export interface QueryLimits {
  maxRows: number;
  timeoutMs: number;
}

export interface QueryResult {
  columns: Column[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export interface TableInfo {
  table: string;
  columns: Column[];
  /** Estimated row count, when the database keeps one. */
  rows?: number;
  /** Where the rows came from, e.g. "Sales 2026.xlsx › Orders". */
  source?: string;
  /** What was skipped or guessed while loading it. */
  notes?: string[];
}

export interface Database {
  kind: "postgres" | "sqlite";
  describe(): Promise<TableInfo[]>;
  /** `values` fill the SQL's placeholders ($1… for Postgres, ? for SQLite); see bindParams. */
  query(sql: string, limits: QueryLimits, values?: (string | number | null)[]): Promise<QueryResult>;
  /** Problems worth telling Claude about, such as a file that could not be read. */
  notes?(): string[];
  /** The currency the amounts are in, when the data says (spreadsheets written with ₹ or $). */
  currency?(): string | undefined;
  close(): Promise<void>;
}

/** The parts of a pg.Pool this module uses, so a host can pass its own pool. */
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end?(): Promise<void>;
}
interface PgClientLike {
  query(config: unknown): Promise<{ rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[] }>;
  release(err?: Error | boolean): void;
}

export type DatabaseInput = string | { pool: PgPoolLike } | Database;

/** Strips trailing semicolons; the query must be one SELECT (or WITH … SELECT, VALUES). */
export function cleanSql(sql: string): string {
  const body = sql.trim().replace(/;\s*$/, "").trim();
  const start = body.replace(/^(\s*(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/))*\s*/, "");
  if (!start) throw new Error("The SQL is empty.");
  if (!/^(select|with|values|table)\b/i.test(start)) throw new Error("Only a single SELECT (or WITH … SELECT) can run here.");
  return body;
}

/** The newline keeps a trailing "-- comment" in the query from swallowing the closing parenthesis. */
const limited = (body: string, maxRows: number, alias = "") => `SELECT * FROM (${body}\n) ${alias}LIMIT ${maxRows + 1}`;

export async function openDatabase(input: DatabaseInput): Promise<Database> {
  if (typeof input === "object" && "query" in input && "describe" in input) return input;
  if (typeof input === "object") return postgres(input.pool, false);
  if (/^postgres(ql)?:\/\//i.test(input)) {
    // webpackIgnore (honoured by webpack and Turbopack): in an app that bundles Showboard, as
    // Next.js does, pg stays a plain Node import; bundled, it trips on its optional native driver.
    const pg = await import(/* webpackIgnore: true */ "pg").catch(() => {
      throw new Error('A Postgres URL needs the "pg" package: npm install pg');
    });
    const Pool = (pg.default ?? pg).Pool;
    return postgres(new Pool({ connectionString: input, max: 4 }) as unknown as PgPoolLike, true);
  }
  return sqlite(input.replace(/^sqlite:(\/\/)?/i, ""));
}

// pg type ids: numeric and bigint arrive as strings by default; charts need numbers. Dates
// stay as the strings Postgres prints, so no time zone shifts "2026-03-01" to the 28th.
const NUMERIC_OIDS = new Set([20, 1700]);
const TEXT_KEPT_OIDS = new Set([1082, 1083, 1114, 1184, 1266]);
const PG_TYPE_NAMES: Record<number, string> = {
  16: "boolean", 20: "bigint", 21: "smallint", 23: "integer", 25: "text", 700: "real", 701: "double",
  1043: "varchar", 1082: "date", 1114: "timestamp", 1184: "timestamptz", 1700: "numeric", 114: "json", 3802: "jsonb",
};

async function postgres(pool: PgPoolLike, ownsPool: boolean): Promise<Database> {
  const pg = await import(/* webpackIgnore: true */ "pg");
  const types = (pg.default ?? pg).types;
  const typeParsers = {
    getTypeParser(oid: number, format?: string) {
      if (NUMERIC_OIDS.has(oid)) return (v: string) => Number(v);
      if (TEXT_KEPT_OIDS.has(oid)) return (v: string) => v;
      return types.getTypeParser(oid, format as "text");
    },
  };

  async function readOnly<T>(run: (client: PgClientLike) => Promise<T>, timeoutMs: number): Promise<T> {
    const client = await pool.connect();
    let failed: Error | undefined;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`);
      return await run(client);
    } catch (err) {
      failed = err as Error;
      throw err;
    } finally {
      // A connection whose ROLLBACK fails is broken: release(err) closes it instead of reusing it.
      await client.query("ROLLBACK").then(
        () => client.release(),
        (rollbackErr: Error) => client.release(failed ?? rollbackErr),
      );
    }
  }

  return {
    kind: "postgres",
    async query(sql, { maxRows, timeoutMs }, values) {
      const body = cleanSql(sql);
      return readOnly(async (client) => {
        const res = await client.query({
          text: limited(body, maxRows, "AS showboard_query "),
          ...(values?.length ? { values } : {}),
          queryMode: "extended",
          types: typeParsers,
        });
        const truncated = res.rows.length > maxRows;
        return {
          columns: res.fields.map((f) => ({ name: f.name, type: PG_TYPE_NAMES[f.dataTypeID] ?? `oid ${f.dataTypeID}` })),
          rows: truncated ? res.rows.slice(0, maxRows) : res.rows,
          truncated,
        };
      }, timeoutMs);
    },
    async describe() {
      return readOnly(async (client) => {
        const res = await client.query({
          text: `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, cl.reltuples::bigint AS estimate
                 FROM information_schema.columns c
                 JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
                 LEFT JOIN pg_namespace n ON n.nspname = c.table_schema
                 LEFT JOIN pg_class cl ON cl.relnamespace = n.oid AND cl.relname = c.table_name
                 WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE '\\_timescaledb%'
                   AND c.table_schema NOT LIKE 'timescaledb\\_%'
                 ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
          queryMode: "extended",
          types: typeParsers,
        });
        const tables = new Map<string, TableInfo>();
        for (const row of res.rows) {
          const name = row.table_schema === "public" ? String(row.table_name) : `${row.table_schema}.${row.table_name}`;
          const estimate = Number(row.estimate);
          const info = tables.get(name) ?? { table: name, columns: [], ...(estimate >= 0 ? { rows: estimate } : {}) };
          info.columns.push({ name: String(row.column_name), type: String(row.data_type) });
          tables.set(name, info);
        }
        return [...tables.values()];
      }, 10_000);
    },
    async close() {
      if (ownsPool) await pool.end?.();
    },
  };
}

async function sqlite(file: string): Promise<Database> {
  const { DatabaseSync } = await import(/* webpackIgnore: true */ "node:sqlite"); // a built-in some bundlers do not know yet
  return sqliteOver(new DatabaseSync(file, { readOnly: true }));
}

/** Queries an open node:sqlite database, which the caller has made read-only. */
export function sqliteOver(db: DatabaseSync): Database {
  const guessType = (rows: Record<string, unknown>[], name: string) => {
    const v = rows.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
    return typeof v === "number" || typeof v === "bigint" ? "number" : "text";
  };

  return {
    kind: "sqlite",
    async query(sql, { maxRows }, values = []) {
      // node:sqlite has no statement timeout; a read-only file and the row limit are the guards.
      const body = cleanSql(sql);
      const rows = db.prepare(limited(body, maxRows)).all(...values) as Record<string, unknown>[];
      const truncated = rows.length > maxRows;
      const kept = (truncated ? rows.slice(0, maxRows) : rows).map((r) => ({ ...r }));
      const names = kept.length ? Object.keys(kept[0]!) : [];
      return { columns: names.map((name) => ({ name, type: guessType(kept, name) })), rows: kept, truncated };
    },
    async describe() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      return tables.map(({ name }) => {
        const cols = db.prepare("SELECT name, type FROM pragma_table_info(?)").all(name) as { name: string; type: string }[];
        const count = db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number };
        return { table: name, columns: cols.map((c) => ({ name: c.name, type: c.type.toLowerCase() || "any" })), rows: Number(count.n) };
      });
    },
    async close() {
      db.close();
    },
  };
}
