import { useEffect, useRef } from "react";
import type { z } from "zod";
import { useShowboard, type ShowboardAction } from "./context.js";

/**
 * Lets Claude run something on this page (ui_act), for as long as the component is
 * mounted. The latest `run` is always used, so it can close over fresh state.
 */
export function useShowboardAction<I extends z.ZodObject>(action: ShowboardAction<I>): void {
  const { registerAction } = useShowboard();
  const latest = useRef(action);
  latest.current = action;
  const { name, description, input } = action;
  useEffect(
    () => registerAction({ name, description, input, run: (value) => latest.current.run(value as z.infer<I>) } as ShowboardAction),
    [registerAction, name, description, input],
  );
}

/** Tells Claude what this part of the page shows (get_screen), e.g. the page name or the filters. */
export function useShowboardState(key: string, value: unknown): void {
  const { publish, unpublish } = useShowboard();
  const json = JSON.stringify(value ?? null);
  useEffect(() => {
    publish(key, JSON.parse(json));
  }, [publish, key, json]);
  useEffect(() => () => unpublish(key), [unpublish, key]);
}
