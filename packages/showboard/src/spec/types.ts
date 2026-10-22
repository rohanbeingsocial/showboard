import type { Spec } from "@json-render/core";

export type { Spec };

export interface Column {
  name: string;
  /** Database type name, or a guess from the values ("number", "text") for SQLite and sources. */
  type: string;
  /** The heading as written in a spreadsheet, when it differs from the name. */
  label?: string;
}

/** Rows Claude asked for, kept on the server under a name so boards can draw them. */
export interface Dataset {
  name: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  /** More rows matched than were kept. */
  truncated: boolean;
  /** The SQL, or `source(input)`, that produced the rows: shown under each chart. */
  origin: string;
  at: string;
}

export interface Board {
  id: string;
  title: string;
  spec: Spec;
  /** Snapshots of the datasets the board draws, so reopening it later shows the same numbers. */
  datasets: Record<string, Dataset>;
  at: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  at: string;
}

/** An action the app lets Claude run, as the browser reports it. */
export interface ActionInfo {
  name: string;
  description: string;
  /** JSON schema of the input. */
  input: Record<string, unknown>;
}

/** A component the app adds to the board catalog, as the browser reports it. */
export interface ComponentInfo {
  name: string;
  description: string;
  /** JSON schema of the props. */
  props: Record<string, unknown>;
}

/** What one browser tab tells the server about itself. */
export interface ScreenReport {
  tab: string;
  url: string;
  title: string;
  /** Whether the user is looking at this tab now. */
  focused: boolean;
  /** Whatever the app publishes with useShowboardState: page, filters, selection… */
  state: Record<string, unknown>;
  actions: ActionInfo[];
  components: ComponentInfo[];
  boardId: string | null;
}

/** Server → browser, over the event stream. */
export type ServerMessage =
  | { type: "hello"; board: Board | null }
  | { type: "board"; board: Board; request?: string }
  | { type: "act"; request: string; action: string; input: unknown };

/** Browser → server, the answer to a message that carried a request id. */
export interface Reply {
  request: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
