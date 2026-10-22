import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { JSONUIProvider, Renderer, type ComponentRegistry, type ComponentRenderProps } from "@json-render/react";
import type { Board as BoardData, BoardSummary } from "../spec/types.js";
import { BoardDataContext, useShowboard, type ShowboardComponent } from "./context.js";
import { BarChart } from "./components/BarChart.js";
import { ActionButton, Grid, Metric, Note, Section, Table } from "./components/basic.js";
import { Missing, ShowSourcesContext } from "./components/frame.js";
import { LineChart } from "./components/LineChart.js";
import { PieChart } from "./components/PieChart.js";

const BUILT_IN_REGISTRY: ComponentRegistry = { Grid, Section, Metric, LineChart, BarChart, PieChart, Table, Note, ActionButton };

export interface BoardProps {
  /** A board to draw; by default the one Claude showed last. */
  board?: BoardData | null;
  /** Shown before Claude has drawn anything. */
  empty?: ReactNode;
  className?: string;
}

/** Draws the board Claude showed. Put it on whichever page should hold Claude's answers. */
export function Board({ board: given, empty, className = "" }: BoardProps) {
  const { board: current, components, connected, format } = useShowboard();
  const board = given === undefined ? current : given;
  const [showSources, setShowSources] = useState(false);
  const registry = useMemo(() => ({ ...BUILT_IN_REGISTRY, ...appRegistry(components) }), [components]);

  if (!board) {
    return (
      <div className={`sb-board sb-board-empty ${className}`}>
        {empty ?? <p className="sb-muted">{connected ? "Ask your coding agent to show you something, and it appears here." : "Connecting to Showboard…"}</p>}
      </div>
    );
  }

  // Datasets are also state, so any prop can read a cell: { "$state": "/data/sales/0/total" }.
  const state = { ...board.spec.state, data: Object.fromEntries(Object.entries(board.datasets).map(([name, d]) => [name, d.rows])) };
  const at = new Date(board.at);
  return (
    <div className={`sb-board ${className}`}>
      <header className="sb-board-head">
        <div>
          <h1 className="sb-board-title">{board.title}</h1>
          <span className="sb-muted">{Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(format.locale, { dateStyle: "medium", timeStyle: "short" }).format(at)}</span>
        </div>
        <label className="sb-toggle">
          <input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> Show sources
        </label>
      </header>
      <BoardDataContext.Provider value={board.datasets}>
        <ShowSourcesContext.Provider value={showSources}>
          <JSONUIProvider key={`${board.id}:${board.at}`} registry={registry} initialState={state}>
            <Renderer spec={board.spec} registry={registry} fallback={Unknown} />
          </JSONUIProvider>
        </ShowSourcesContext.Provider>
      </BoardDataContext.Provider>
    </div>
  );
}

function Unknown({ element }: ComponentRenderProps) {
  return <Missing what={`This app has no "${element.type}" component.`} />;
}

/** Wraps the app's components so they get checked props and the board's datasets. */
function appRegistry(components: Record<string, ShowboardComponent>): ComponentRegistry {
  return Object.fromEntries(
    Object.entries(components).map(([name, def]) => {
      function AppComponent({ element }: ComponentRenderProps) {
        const datasets = useContext(BoardDataContext);
        const parsed = def.props.safeParse(element.props);
        if (!parsed.success) return <Missing what={`${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`} />;
        const Render = def.render;
        return <Render props={parsed.data} datasets={datasets} />;
      }
      AppComponent.displayName = `Showboard(${name})`;
      return [name, AppComponent];
    }),
  );
}

/** Saved boards, newest first; picking one shows it. */
export function BoardList({ className = "", limit = 30 }: { className?: string; limit?: number }) {
  const { url, board, openBoard, format } = useShowboard();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${url}/boards`)
      .then((res) => (res.ok ? (res.json() as Promise<BoardSummary[]>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((list) => live && setBoards(list.slice(0, limit)))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [url, limit, board?.id, board?.at]);

  if (error) return <p className="sb-error">Boards could not be loaded: {error}</p>;
  return (
    <ul className={`sb-board-list ${className}`}>
      {boards.map((b) => (
        <li key={b.id}>
          <button type="button" className={b.id === board?.id ? "sb-active" : undefined} onClick={() => void openBoard(b.id).catch((err: Error) => setError(err.message))}>
            <span>{b.title}</span>
            <span className="sb-muted">{new Date(b.at).toLocaleString(format.locale)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
