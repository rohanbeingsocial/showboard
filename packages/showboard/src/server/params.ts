// Named parameters in SQL, so a recipe can be written once and run with other values:
// `WHERE symbol IN (:symbols) AND date >= current_date - :days::int`. Each :name becomes the
// database's own placeholder ($1 for Postgres, ? for SQLite) and its value is sent apart
// from the SQL, never pasted into it. A list fills one placeholder per value.

export type ParamValue = string | number | null | (string | number)[];
export type Params = Record<string, ParamValue>;

export interface Bound {
  sql: string;
  values: (string | number | null)[];
  /** The parameter names the SQL used. */
  used: string[];
}

export function bindParams(sql: string, params: Params, kind: "postgres" | "sqlite"): Bound {
  const values: (string | number | null)[] = [];
  const used = new Set<string>();
  const placeholder = (value: string | number | null) => {
    values.push(value);
    return kind === "postgres" ? `$${values.length}` : "?";
  };
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1] ?? "";
    // Strings, quoted names and comments pass through untouched; "::" is a Postgres cast.
    let end = -1;
    if (ch === "'" || ch === '"') end = closingQuote(sql, i);
    else if (ch === "-" && next === "-") end = sql.indexOf("\n", i) < 0 ? sql.length : sql.indexOf("\n", i);
    else if (ch === "/" && next === "*") end = sql.indexOf("*/", i + 2) < 0 ? sql.length : sql.indexOf("*/", i + 2) + 2;
    else if (ch === ":" && next === ":") end = i + 2;
    if (end > i) {
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    const name = ch === ":" && !/[\w$]/.test(sql[i - 1] ?? "") ? /^[a-z_][a-z0-9_]*/i.exec(sql.slice(i + 1))?.[0] : undefined;
    if (!name) {
      out += ch;
      i++;
      continue;
    }
    if (!Object.hasOwn(params, name)) throw new Error(`The SQL uses :${name}, which has no value.`);
    const value = params[name]!;
    used.add(name);
    if (Array.isArray(value)) {
      if (!value.length) throw new Error(`:${name} needs at least one value.`);
      out += value.map(placeholder).join(", ");
    } else out += placeholder(value);
    i += 1 + name.length;
  }
  return { sql: out, values, used: [...used] };
}

/** Index just past the quote that closes the one at `start` ('' and "" inside are escapes). */
function closingQuote(sql: string, start: number): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

/** "ITC, HDFCBANK" for a list; used to fill {name} in board and item titles. */
export function fillTitle(template: string, params: Params): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) return whole;
    const value = params[name];
    return Array.isArray(value) ? value.join(", ") : String(value ?? "");
  });
}
