import { createContext, useContext, type ComponentType } from "react";
import type { z } from "zod";
import type { FormatOptions } from "../spec/format.js";
import type { Board, Dataset } from "../spec/types.js";

/** An action the app lets Claude run with ui_act (and boards run from an ActionButton). */
export interface ShowboardAction<I extends z.ZodObject = z.ZodObject> {
  name: string;
  /** Written for Claude: what it does and when to use it. */
  description: string;
  input?: I;
  run(input: z.infer<I>): unknown | Promise<unknown>;
}

/** A component of the app's own that boards can use, next to the built-in ones. */
export interface ShowboardComponent<P extends z.ZodObject = z.ZodObject> {
  description: string;
  props: P;
  render: ComponentType<{ props: z.infer<P>; datasets: Record<string, Dataset> }>;
}

export interface ShowboardContextValue {
  board: Board | null;
  connected: boolean;
  /** Shows a saved board (from the board list) without asking Claude. */
  openBoard(id: string): Promise<void>;
  runAction(name: string, input: unknown): Promise<unknown>;
  registerAction(action: ShowboardAction): () => void;
  publish(key: string, value: unknown): void;
  unpublish(key: string): void;
  components: Record<string, ShowboardComponent>;
  format: FormatOptions;
  url: string;
}

export const ShowboardContext = createContext<ShowboardContextValue | null>(null);

export function useShowboard(): ShowboardContextValue {
  const value = useContext(ShowboardContext);
  if (!value) throw new Error("useShowboard needs a <ShowboardProvider> above it.");
  return value;
}

/** The board being drawn: its datasets, for components that read rows. */
export const BoardDataContext = createContext<Record<string, Dataset>>({});
