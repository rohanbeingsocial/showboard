// Types of board-text.js, which build.mjs bundles from showboard's src/text: a board drawn
// as lines of styled runs. Kept by hand; the exports are few.

export type Ink = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "accent" | "muted" | "good" | "bad" | "warn" | "info";
export const INKS: Record<Ink, string>;

export interface Span {
  text: string;
  ink?: Ink;
  bold?: boolean;
  dim?: boolean;
}
export type Line = Span[];
export type Block = { kind: "text"; lines: Line[] } | { kind: "action"; label: string; action: string; input: Record<string, unknown> };

export interface TextOptions {
  width: number;
  format?: { locale?: string; currency?: string };
  sources?: boolean;
  tableRows?: number;
  chartRows?: number;
}

/** A board as Showboard serves it (GET /boards/:id). */
export interface TextBoard {
  id: string;
  title: string;
  at: string;
  spec: { root: string; elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }>; state?: Record<string, unknown> };
  datasets: Record<string, { name: string; columns: { name: string; type: string }[]; rows: Record<string, unknown>[]; truncated: boolean; origin: string; at: string }>;
}

export function boardToText(board: TextBoard, options: TextOptions): Block[];
export function lineText(line: Line): string;
export function cellWidth(text: string): number;
export function fit(text: string, width: number): string;
