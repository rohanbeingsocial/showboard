import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Dataset } from "../../spec/types.js";
import { BoardDataContext } from "../context.js";

/** Whether the board shows where each chart's numbers came from (the SQL or the source). */
export const ShowSourcesContext = createContext(false);

export function useDataset(name: unknown): Dataset | undefined {
  const datasets = useContext(BoardDataContext);
  return typeof name === "string" ? datasets[name] : undefined;
}

/** Width of an element, kept current as it resizes, so charts draw at real pixel sizes. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The card around a chart or table: title, body, and the data source when asked. */
export function Card({ title, dataset, children, className = "" }: { title?: string; dataset?: Dataset; children: ReactNode; className?: string }) {
  const showSources = useContext(ShowSourcesContext);
  return (
    <section className={`sb-card ${className}`}>
      {title ? <h3 className="sb-card-title">{title}</h3> : null}
      {children}
      {showSources && dataset ? <Source dataset={dataset} /> : null}
    </section>
  );
}

function Source({ dataset }: { dataset: Dataset }) {
  return (
    <details className="sb-source">
      <summary>
        {dataset.name} · {dataset.rows.length} rows{dataset.truncated ? " (truncated)" : ""}
      </summary>
      <pre>{dataset.origin}</pre>
    </details>
  );
}

export function Missing({ what }: { what: string }) {
  return <div className="sb-missing">{what}</div>;
}
