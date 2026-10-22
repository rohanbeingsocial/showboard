import { z } from "zod";
import { FORMATS } from "../spec/catalog.js";

// The short form of a board that draw and recipes take. It can say everything a spec can
// (notes anywhere, side-by-side rows, titled sections, any component with any props) without
// element keys and children lists, and each part brings its own rows (sql, a dataset or a
// source), so one call fetches and draws. Nesting stops at section › row › part.

export const VIEWS = ["auto", "line", "bar", "pie", "metrics", "table"] as const;
export type View = (typeof VIEWS)[number];

export const nameShape = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, digits and _, starting with a letter");
const column = z.string().min(1).max(80);

export const dataPart = z.object({
  title: z.string().max(160).optional(),
  sql: z.string().min(1).max(20_000).optional().describe("A read-only SELECT; :name placeholders take values from params"),
  dataset: nameShape.optional().describe("An existing dataset instead of sql"),
  source: z.string().max(80).optional().describe("One of the app's sources instead of sql"),
  input: z.record(z.string(), z.unknown()).optional().describe("Input for the source"),
  show: z.enum(VIEWS).optional().describe("Default auto: picked from the result's shape"),
  x: column.optional(),
  y: z.array(column).min(1).max(12).optional().describe("Measures (charts, metrics) or columns in order (table)"),
  series: column.optional().describe("Column whose values each get a line or bar"),
  formats: z.record(z.string(), z.enum(FORMATS)).optional().describe('Per column, e.g. {"revenue": "currency", "change": "percent"}; percent expects a fraction'),
  component: z.string().max(80).optional().describe("Draw with this component and props instead (built-in or the app's); gets dataset filled in"),
  props: z.record(z.string(), z.unknown()).optional(),
});
export const notePart = z.object({
  note: z.string().min(1).max(6000).describe("Your text; '- ' lines are bullets, **bold** works. Quote only figures you have read"),
  title: z.string().max(160).optional(),
  tone: z.enum(["plain", "info", "good", "warn", "bad"]).optional(),
});
const part = z.union([notePart, dataPart]);
export const rowPart = z.object({ row: z.array(part).min(1).max(4).describe("Side by side") });
export const sectionPart = z.object({
  section: z.string().min(1).max(160),
  subtitle: z.string().max(400).optional(),
  items: z.array(z.union([rowPart, part])).min(1).max(12),
});
// Order matters: a union takes the first shape that fits, and dataPart fits almost anything.
export const itemShape = z.union([sectionPart, rowPart, notePart, dataPart]);

export type DataPart = z.infer<typeof dataPart>;
export type NotePart = z.infer<typeof notePart>;
export type RowPart = z.infer<typeof rowPart>;
export type SectionPart = z.infer<typeof sectionPart>;
export type Item = z.infer<typeof itemShape>;

export const isNote = (item: Item): item is NotePart => "note" in item;
export const isRow = (item: Item): item is RowPart => "row" in item;
export const isSection = (item: Item): item is SectionPart => "section" in item;

/** Every data part in reading order, through rows and sections. */
export function dataParts(items: Item[]): DataPart[] {
  return items.flatMap((item) => (isSection(item) ? dataParts(item.items) : isRow(item) ? dataParts(item.row) : isNote(item) ? [] : [item]));
}
