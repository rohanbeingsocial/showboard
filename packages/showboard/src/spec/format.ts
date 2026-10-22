import type { ValueFormat } from "./catalog.js";

export interface FormatOptions {
  locale?: string;
  /** ISO currency code for the "currency" format, e.g. "USD" or "INR". */
  currency?: string;
}

/** Numbers arrive as numbers from Postgres numeric/bigint too (the server converts them). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatValue(value: unknown, format: ValueFormat | undefined, opts: FormatOptions = {}): string {
  if (value === null || value === undefined) return "–";
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

/** Short form for chart axes: compact numbers, currency symbol kept. */
export function formatAxis(value: number, format: ValueFormat | undefined, opts: FormatOptions = {}): string {
  const { locale, currency = "USD" } = opts;
  if (format === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
  if (format === "currency") return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** "2026-03" prints as a month, "2026-03-01" as a day; only full timestamps get a time. */
export function formatDate(value: unknown, locale?: string): string {
  const date = parseDate(value);
  if (!date) return String(value);
  const text = typeof value === "string" ? value : "";
  const options: Intl.DateTimeFormatOptions = /^\d{4}-\d{2}$/.test(text)
    ? { month: "short", year: "numeric", timeZone: "UTC" }
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
      : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** "2026-03" and "2026-03-01" parse as UTC dates, so a chart never shifts a day by time zone. */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}
