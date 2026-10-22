import { z } from "zod";

// The components every board can use. The server checks a board against these schemas
// before it reaches the browser, and the same text tells Claude what it can draw.

export interface ComponentDef {
  description: string;
  props: z.ZodObject;
  /** Whether the element takes children (layout components). */
  hasChildren?: boolean;
}

export const FORMATS = ["number", "integer", "currency", "percent", "compact", "date", "text"] as const;
export type ValueFormat = (typeof FORMATS)[number];

const format = z.enum(FORMATS).optional().describe("How to print numbers; percent expects a fraction (0.12 → 12%)");
const datasetName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, digits and _").describe("A dataset made by query_data or use_source");
const column = z.string().min(1).max(80);
const title = z.string().max(160).optional();

export const BUILT_IN = {
  Grid: {
    description: "Places its children side by side in equal columns, wrapping to new rows.",
    props: z.object({ columns: z.number().int().min(1).max(4).optional() }),
    hasChildren: true,
  },
  Section: {
    description: "A titled group of children, stacked.",
    props: z.object({ title: z.string().max(160), subtitle: z.string().max(400).optional() }),
    hasChildren: true,
  },
  Metric: {
    description: "One headline number read from a dataset cell (row 0 unless row is set).",
    props: z.object({ label: z.string().max(80), dataset: datasetName, field: column, row: z.number().int().min(0).optional(), format, caption: z.string().max(160).optional() }),
  },
  LineChart: {
    description: "Lines over x (dates or ordered labels), one line per y column.",
    props: z.object({ dataset: datasetName, x: column, y: z.array(column).min(1).max(6), title, format }),
  },
  BarChart: {
    description: "Bars per x category, one bar per y column. horizontal suits long labels.",
    props: z.object({ dataset: datasetName, x: column, y: z.array(column).min(1).max(4), title, format, horizontal: z.boolean().optional() }),
  },
  PieChart: {
    description: "Donut of value by label; beyond 7 slices the rest are grouped as Other.",
    props: z.object({ dataset: datasetName, label: column, value: column, title, format }),
  },
  Table: {
    description: "Rows of a dataset. columns picks and orders them (all when omitted): column names, or { field, label?, format? }.",
    props: z.object({
      dataset: datasetName,
      columns: z.array(z.union([column, z.object({ field: column, label: z.string().max(80).optional(), format })])).max(12).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      title,
    }),
  },
  Note: {
    description: "Your explanation in plain text. Lines starting with '- ' become bullets; **bold** works. tone colours it.",
    props: z.object({ text: z.string().max(6000), title, tone: z.enum(["plain", "info", "good", "warn", "bad"]).optional() }),
  },
  ActionButton: {
    description: "A button that runs one of the app's actions (see get_screen) with the given input.",
    props: z.object({ label: z.string().max(60), action: z.string().max(80), input: z.record(z.string(), z.unknown()).optional() }),
  },
} satisfies Record<string, ComponentDef>;

export type BuiltInName = keyof typeof BUILT_IN;
export type BuiltInProps<N extends BuiltInName> = z.infer<(typeof BUILT_IN)[N]["props"]>;

export const isBuiltIn = (type: string): type is BuiltInName => Object.hasOwn(BUILT_IN, type);

/** Prop keys that name a dataset column, so the server can check them against the dataset. */
export function columnRefs(type: BuiltInName, props: Record<string, unknown>): string[] {
  const one = (v: unknown) => (typeof v === "string" ? [v] : []);
  const many = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);
  switch (type) {
    case "Metric":
      return one(props.field);
    case "LineChart":
    case "BarChart":
      return [...one(props.x), ...many(props.y)];
    case "PieChart":
      return [...one(props.label), ...one(props.value)];
    case "Table":
      return Array.isArray(props.columns) ? props.columns.flatMap((c) => (typeof c === "string" ? [c] : one((c as { field?: unknown }).field))) : [];
    default:
      return [];
  }
}

/** One line per component, e.g. `Metric {label, dataset, field, row?, format?}: One headline…`. */
export function describeComponents(defs: Record<string, { description: string; props: z.ZodObject | Record<string, unknown> }>): string {
  return Object.entries(defs)
    .map(([name, def]) => `${name} {${propSignature(def.props)}}: ${def.description}`)
    .join("\n");
}

function propSignature(props: z.ZodObject | Record<string, unknown>): string {
  if (props instanceof z.ZodObject) {
    return Object.entries(props.shape)
      .map(([key, schema]) => (schema.safeParse(undefined).success ? `${key}?` : key))
      .join(", ");
  }
  // A JSON schema reported by the browser for an app's own component.
  const shape = (props.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(props.required) ? (props.required as string[]) : []);
  return Object.keys(shape)
    .map((key) => (required.has(key) ? key : `${key}?`))
    .join(", ");
}
