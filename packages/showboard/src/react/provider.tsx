import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import type { FormatOptions } from "../spec/format.js";
import type { Board, Reply, ScreenReport, ServerMessage } from "../spec/types.js";
import { checkElementProps } from "../spec/validate.js";
import { ShowboardContext, type ShowboardAction, type ShowboardComponent, type ShowboardContextValue } from "./context.js";

export interface ShowboardProviderProps {
  /** Where the Showboard handler is: "http://127.0.0.1:4710", or "/api/showboard" when your server mounts it. */
  url: string;
  /** Your own components boards may use. */
  components?: Record<string, ShowboardComponent>;
  /** Number formatting for boards, e.g. { locale: "en-IN", currency: "INR" }. */
  format?: FormatOptions;
  /** Called when Claude shows a board, e.g. to switch to the page that holds <Board />. */
  onBoard?(board: Board): void;
  children: ReactNode;
}

const REPORT_DELAY_MS = 250;
// Defaults live outside the component so they keep one identity across renders.
const NO_COMPONENTS: Record<string, ShowboardComponent> = {};
const NO_FORMAT: FormatOptions = {};

function tabId(): string {
  const key = "showboard-tab";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    // No sessionStorage: a server render (Next.js), which the browser repeats with its own id,
    // or storage the browser blocks, where the tab gets a new id each load.
    return typeof window === "undefined" ? "" : crypto.randomUUID();
  }
}

/** Pass `components` and `format` as stable objects (module constants or useMemo): a new object redraws every board. */
export function ShowboardProvider({ url, components = NO_COMPONENTS, format = NO_FORMAT, onBoard, children }: ShowboardProviderProps) {
  const base = url.replace(/\/$/, "");
  const [board, setBoard] = useState<Board | null>(null);
  const [connected, setConnected] = useState(false);
  const tab = useMemo(tabId, []);
  const actions = useRef(new Map<string, ShowboardAction>());
  const published = useRef(new Map<string, unknown>());
  const boardRef = useRef<Board | null>(null);
  const componentsRef = useRef(components);
  componentsRef.current = components;
  const onBoardRef = useRef(onBoard);
  onBoardRef.current = onBoard;
  const reportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const post = useCallback(
    (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch((err: Error) => {
        console.warn(`showboard: ${path} failed: ${err.message}`);
      }),
    [base],
  );

  const sendReport = useCallback(() => {
    const report: ScreenReport = {
      tab,
      url: location.href,
      title: document.title,
      focused: document.visibilityState === "visible" && document.hasFocus(),
      state: Object.fromEntries(published.current),
      actions: [...actions.current.values()].map((a) => ({ name: a.name, description: a.description, input: z.toJSONSchema(a.input ?? z.object({})) as Record<string, unknown> })),
      components: Object.entries(componentsRef.current).map(([name, c]) => ({ name, description: c.description, props: z.toJSONSchema(c.props) as Record<string, unknown> })),
      boardId: boardRef.current?.id ?? null,
    };
    void post("/screen", report);
  }, [post, tab]);

  const scheduleReport = useCallback(() => {
    clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(sendReport, REPORT_DELAY_MS);
  }, [sendReport]);

  const runAction = useCallback(async (name: string, input: unknown) => {
    const action = actions.current.get(name);
    if (!action) throw new Error(`No action "${name}" on this page. Actions: ${[...actions.current.keys()].join(", ") || "none"}.`);
    const parsed = (action.input ?? z.object({})).safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Bad input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
    return action.run(parsed.data);
  }, []);

  const show = useCallback(
    (next: Board) => {
      boardRef.current = next;
      setBoard(next);
      onBoardRef.current?.(next);
      scheduleReport();
    },
    [scheduleReport],
  );

  useEffect(() => {
    const source = new EventSource(`${base}/stream?tab=${encodeURIComponent(tab)}`);
    const reply = (r: Reply) => void post("/reply", r);
    source.onopen = () => {
      setConnected(true);
      scheduleReport();
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "hello") {
        if (message.board && !boardRef.current) {
          boardRef.current = message.board;
          setBoard(message.board);
        }
      } else if (message.type === "board") {
        show(message.board);
        if (message.request) reply({ request: message.request, ok: true, result: { problems: checkAppComponents(message.board, componentsRef.current) } });
      } else if (message.type === "act") {
        runAction(message.action, message.input).then(
          (result) => reply({ request: message.request, ok: true, result: result ?? null }),
          (err: Error) => reply({ request: message.request, ok: false, error: err.message }),
        );
      }
    };
    return () => source.close();
  }, [base, tab, post, runAction, scheduleReport, show]);

  useEffect(() => {
    window.addEventListener("focus", scheduleReport);
    window.addEventListener("blur", scheduleReport);
    document.addEventListener("visibilitychange", scheduleReport);
    return () => {
      window.removeEventListener("focus", scheduleReport);
      window.removeEventListener("blur", scheduleReport);
      document.removeEventListener("visibilitychange", scheduleReport);
      clearTimeout(reportTimer.current);
    };
  }, [scheduleReport]);

  const openBoard = useCallback(
    async (id: string) => {
      const res = await fetch(`${base}/boards/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Board ${id} could not be loaded (HTTP ${res.status}).`);
      show((await res.json()) as Board);
    },
    [base, show],
  );
  const registerAction = useCallback(
    (action: ShowboardAction) => {
      actions.current.set(action.name, action);
      scheduleReport();
      return () => {
        if (actions.current.get(action.name) === action) actions.current.delete(action.name);
        scheduleReport();
      };
    },
    [scheduleReport],
  );
  const publish = useCallback(
    (key: string, value: unknown) => {
      published.current.set(key, value);
      scheduleReport();
    },
    [scheduleReport],
  );
  const unpublish = useCallback(
    (key: string) => {
      published.current.delete(key);
      scheduleReport();
    },
    [scheduleReport],
  );

  const value = useMemo<ShowboardContextValue>(
    () => ({ board, connected, url: base, components, format, runAction, openBoard, registerAction, publish, unpublish }),
    [board, connected, base, components, format, runAction, openBoard, registerAction, publish, unpublish],
  );

  return <ShowboardContext.Provider value={value}>{children}</ShowboardContext.Provider>;
}

/** The server checks built-in components; the app's own ones are checked here, where their schemas live. */
function checkAppComponents(board: Board, components: Record<string, ShowboardComponent>): string[] {
  return Object.entries(board.spec.elements).flatMap(([key, element]) => {
    const def = components[element.type];
    return def ? checkElementProps(key, element.type, def.props, (element.props ?? {}) as Record<string, unknown>) : [];
  });
}
