import type { Spec, UIElement } from "@json-render/core";
import type { ValueFormat } from "../spec/catalog.js";
import { parseDate } from "../spec/format.js";
import type { Column, Dataset } from "../spec/types.js";
import { isNote, isRow, isSection, type DataPart, type Item, type View } from "./items.js";

// Turns the short form (items) into a spec. A data part without a component gets its chart
// from the shape of its rows: dates with numbers make a line, a few labels with numbers make
// bars, one row of numbers makes headline metrics, anything else a table. Long rows (date,
// symbol, close) are turned wide, one line per symbol. Every choice can be overridden.

export interface ViewHints {
  show?: View;
  x?: string;
  y?: string[];
  series?: string;
}

export interface Planned {
  show: Exclude<View, "auto">;
  /** The rows to draw: the result itself, or its wide form when it had a series column. */
  dataset: Dataset;
  x?: string;
  /** Measures for charts and metrics; the columns, in order, for a table. */
  y: string[];
  /** The column a wide chart's values came from (its y are then the series values). */
  measure?: string;
  /** Formats read off the rows for columns given none: fractions named like attainment print as percents. */
  guessed: Record<string, ValueFormat>;
  /** What was left out, for Claude. */
  notes: string[];
}

/** What a data part drew from: its rows, and how to draw them unless it names a component. */
export interface Resolved {
  dataset?: Dataset;
  plan?: Planned;
}

const MAX_LINES = 6;
const MAX_BARS = 4;
const MAX_METRICS = 6;
const MAX_TABLE_COLUMNS = 12;
const MAX_BAR_ROWS = 40;
/** Numbers that label rather than measure: a year on the x axis is not a value to plot. */
const LABEL_NUMBERS = /^(year|fy|quarter|qtr|month|week|day|period|rank|id)$|_(year|fy|quarter|month|week|id)$/i;
/** Names of a part of a whole. Not pct or rate: those often hold 12.5 for 12.5%. */
const FRACTION_NAMES = /(^|_)(share|attainment|fraction|of_target|of_total)(_|$)/i;

/** Fraction columns (attainment 0.83, share 0.35) print as percents unless a format is given. */
function guessFormats(dataset: Dataset, numbers: string[]): Record<string, ValueFormat> {
  const guessed: Record<string, ValueFormat> = {};
  for (const col of numbers.filter((c) => FRACTION_NAMES.test(c))) {
    const values = dataset.rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
    if (values.length && values.every((v) => Math.abs(v) <= 3) && values.some((v) => !Number.isInteger(v))) guessed[col] = "percent";
  }
  return guessed;
}

export function planView(dataset: Dataset, hints: ViewHints = {}): Planned {
  const names = dataset.columns.map((c) => c.name);
  for (const col of [hints.x, hints.series, ...(hints.y ?? [])]) {
    if (col !== undefined && !names.includes(col)) throw new Error(`column "${col}" is not in the result (it has: ${names.join(", ")}).`);
  }
  const present = (col: string) => dataset.rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
  const dates = names.filter((c) => {
    const v = present(c);
    return v.length > 0 && v.every((x) => parseDate(x) !== null);
  });
  const numbers = names.filter((c) => {
    const v = present(c);
    return !LABEL_NUMBERS.test(c) && v.length > 0 && v.every((x) => typeof x === "number" || typeof x === "bigint");
  });
  const labels = names.filter((c) => !dates.includes(c) && !numbers.includes(c));
  const rows = dataset.rows.length;
  const notes: string[] = [];
  const guessed = guessFormats(dataset, numbers);

  let show = hints.show && hints.show !== "auto" ? hints.show : undefined;
  if (!show) {
    if (!rows || !numbers.length) show = "table";
    else if (rows === 1 && !hints.x) show = "metrics";
    else if (dates.length) show = "line";
    else if (labels.length && rows <= MAX_BAR_ROWS) show = "bar";
    else show = "table";
  }

  if (show === "table") {
    const columns = hints.y ?? names;
    if (columns.length > MAX_TABLE_COLUMNS) notes.push(`Showing the first ${MAX_TABLE_COLUMNS} of ${columns.length} columns.`);
    return { show, dataset, y: columns.slice(0, MAX_TABLE_COLUMNS), guessed, notes };
  }
  if (show === "metrics") {
    const measures = hints.y ?? numbers;
    if (!measures.length) throw new Error("metrics need a number column.");
    if (measures.length > MAX_METRICS) notes.push(`Showing the first ${MAX_METRICS} of ${measures.length} numbers.`);
    if (rows > 1) notes.push(`Metrics read the first of ${rows} rows.`);
    return { show, dataset, y: measures.slice(0, MAX_METRICS), guessed, notes };
  }

  const x = hints.x ?? (show === "line" ? (dates[0] ?? labels[0]) : (labels[0] ?? dates[0])) ?? names.find((c) => !numbers.includes(c));
  if (!x) throw new Error(`a ${show} chart needs a column for the x axis or labels (the result has only numbers: ${names.join(", ")}).`);
  let measures = (hints.y ?? numbers).filter((c) => c !== x);
  if (!measures.length) throw new Error(`a ${show} chart needs a number column besides "${x}".`);

  // Long rows: x repeats, once per value of another label column. Draw one line per value.
  const series =
    hints.series ??
    (show !== "pie" && new Set(dataset.rows.map((r) => String(r[x]))).size < rows
      ? labels.filter((c) => c !== x).find((c) => {
          const distinct = new Set(dataset.rows.map((r) => String(r[c]))).size;
          return distinct >= 2 && distinct <= 24;
        })
      : undefined);
  let drawn = dataset;
  let measure: string | undefined;
  if (series) {
    measure = measures[0]!;
    if (measures.length > 1) notes.push(`One ${show === "line" ? "line" : "bar"} per ${series}, showing ${measure} (${measures.slice(1).join(", ")} left out).`);
    const wide = pivot(dataset, x, series, measure, show === "line" ? MAX_LINES : MAX_BARS);
    if (wide.dropped) notes.push(`${wide.dropped} more ${series} values left out; filter in SQL to choose.`);
    drawn = wide.dataset;
    measures = wide.series;
  }

  const max = show === "line" ? MAX_LINES : show === "bar" ? MAX_BARS : 1;
  if (measures.length > max) notes.push(`Showing ${max} of ${measures.length} number columns (${measures.slice(max).join(", ")} left out).`);
  return { show, dataset: drawn, x, y: measures.slice(0, max), ...(measure ? { measure } : {}), guessed, notes };
}

/** (x, series, value) rows → one row per x with a column per series value, in order of first appearance. */
function pivot(dataset: Dataset, x: string, series: string, measure: string, max: number): { dataset: Dataset; series: string[]; dropped: number } {
  const keys = [...new Set(dataset.rows.map((r) => String(r[series])))].filter((k) => k !== x);
  const kept = keys.slice(0, max);
  const byX = new Map<string, Record<string, unknown>>();
  for (const row of dataset.rows) {
    const key = String(row[series]);
    if (!kept.includes(key)) continue;
    const at = String(row[x]);
    const wide = byX.get(at) ?? { [x]: row[x] };
    wide[key] = row[measure];
    byX.set(at, wide);
  }
  const type = dataset.columns.find((c) => c.name === measure)?.type ?? "number";
  const columns: Column[] = [dataset.columns.find((c) => c.name === x)!, ...kept.map((name) => ({ name, type }))];
  return {
    dataset: { ...dataset, columns, rows: [...byX.values()], origin: `${dataset.origin}\n-- drawn as one ${measure} column per ${series}` },
    series: kept,
    dropped: keys.length - kept.length,
  };
}

/** The spec for a board's items, in reading order; `fill` puts parameter values into titles. */
export function buildSpec(items: Item[], resolved: Map<DataPart, Resolved>, fill: (text: string) => string = (t) => t): Spec {
  const elements: Record<string, UIElement> = {};
  let count = 0;
  const add = (prefix: string, element: UIElement) => {
    const key = `${prefix}${++count}`;
    elements[key] = element;
    return key;
  };
  const titled = (title: string | undefined) => (title ? { title: fill(title) } : {});

  const place = (item: Item): string => {
    if (isSection(item)) {
      return add("section", { type: "Section", props: { title: fill(item.section), ...(item.subtitle ? { subtitle: fill(item.subtitle) } : {}) }, children: item.items.map(place) });
    }
    if (isRow(item)) return add("row", { type: "Grid", props: { columns: item.row.length }, children: item.row.map(place) });
    if (isNote(item)) return add("note", { type: "Note", props: { text: item.note, ...titled(item.title), ...(item.tone ? { tone: item.tone } : {}) } });

    const { dataset, plan } = resolved.get(item) ?? {};
    if (item.component) return add("part", { type: item.component, props: { ...(dataset ? { dataset: dataset.name } : {}), ...item.props } });
    if (!plan) throw new Error(`"${item.title ?? "a part"}" has no rows to draw.`);
    const name = plan.dataset.name;
    const formatOf = (col: string | undefined) => (col ? (item.formats?.[col] ?? plan.guessed[col]) : undefined);
    const format = (col: string | undefined) => {
      const f = formatOf(col);
      return f ? { format: f } : {};
    };
    // A wide chart's columns are series values; its format belongs to the column they came from.
    const measure = plan.measure ?? plan.y[0];
    switch (plan.show) {
      case "metrics": {
        const strip = add("metrics", {
          type: "Grid",
          props: { columns: Math.min(4, plan.y.length) },
          children: plan.y.map((field) => add("metric", { type: "Metric", props: { label: humanize(field), dataset: name, field, ...format(field) } })),
        });
        return item.title ? add("section", { type: "Section", props: titled(item.title), children: [strip] }) : strip;
      }
      case "table": {
        const columns = plan.y.map((field) => {
          const label = humanize(field);
          return label === field && !formatOf(field) ? field : { field, ...(label !== field ? { label } : {}), ...format(field) };
        });
        return add("table", { type: "Table", props: { dataset: name, columns, ...titled(item.title) } });
      }
      case "pie":
        return add("chart", { type: "PieChart", props: { dataset: name, label: plan.x!, value: plan.y[0]!, ...titled(item.title), ...format(measure) } });
      case "line":
        return add("chart", { type: "LineChart", props: { dataset: name, x: plan.x!, y: plan.y, ...titled(item.title), ...format(measure) } });
      case "bar": {
        const x = plan.x!;
        const long = plan.dataset.rows.length > 8 || plan.dataset.rows.some((r) => String(r[x] ?? "").length > 14);
        return add("chart", { type: "BarChart", props: { dataset: name, x, y: plan.y, ...titled(item.title), ...format(measure), ...(long ? { horizontal: true } : {}) } });
      }
    }
  };

  const children = items.map(place);
  elements.root = { type: "Grid", props: { columns: 1 }, children };
  return { root: "root", elements };
}

/** "total_pnl_pct" → "Total pnl pct". */
export function humanize(column: string): string {
  const text = column.replace(/_+/g, " ").trim();
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 80);
}
