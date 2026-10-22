import { Fragment, useState, type ReactNode } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import type { BuiltInProps } from "../../spec/catalog.js";
import { formatValue, toNumber } from "../../spec/format.js";
import { useShowboard } from "../context.js";
import { Card, Missing, useDataset } from "./frame.js";

export function Grid({ element, children }: ComponentRenderProps<BuiltInProps<"Grid">>) {
  const columns = element.props.columns ?? 2;
  return (
    <div className="sb-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

export function Section({ element, children }: ComponentRenderProps<BuiltInProps<"Section">>) {
  return (
    <section className="sb-section">
      <h2 className="sb-section-title">{element.props.title}</h2>
      {element.props.subtitle ? <p className="sb-muted">{element.props.subtitle}</p> : null}
      <div className="sb-stack">{children}</div>
    </section>
  );
}

export function Metric({ element }: ComponentRenderProps<BuiltInProps<"Metric">>) {
  const { label, dataset: name, field, row = 0, format, caption } = element.props;
  const dataset = useDataset(name);
  const { format: opts } = useShowboard();
  if (!dataset) return <Missing what={`No dataset "${name}".`} />;
  const value = dataset.rows[row]?.[field];
  return (
    <Card dataset={dataset} className="sb-metric">
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value === undefined ? "–" : formatValue(value, format ?? (toNumber(value) === null ? "text" : undefined), opts)}</div>
      {caption ? <div className="sb-muted">{caption}</div> : null}
    </Card>
  );
}

export function Table({ element }: ComponentRenderProps<BuiltInProps<"Table">>) {
  const { dataset: name, title, limit = 100 } = element.props;
  const dataset = useDataset(name);
  const { format: opts } = useShowboard();
  if (!dataset) return <Missing what={`No dataset "${name}".`} />;
  const columns = (element.props.columns ?? dataset.columns.map((c) => c.name)).map((c) => (typeof c === "string" ? { field: c, label: undefined, format: undefined } : c));
  const rows = dataset.rows.slice(0, limit);
  const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c.field] === "number")).map((c) => c.field));
  return (
    <Card title={title} dataset={dataset}>
      <div className="sb-table-wrap">
        <table className="sb-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.field} className={numeric.has(c.field) ? "sb-num" : undefined}>{c.label ?? c.field}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.field} className={numeric.has(c.field) ? "sb-num" : undefined}>
                    {formatValue(r[c.field], c.format ?? (numeric.has(c.field) ? undefined : "text"), opts)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dataset.rows.length > rows.length ? <p className="sb-muted">Showing {rows.length} of {dataset.rows.length} rows.</p> : null}
    </Card>
  );
}

export function Note({ element }: ComponentRenderProps<BuiltInProps<"Note">>) {
  const { text, title, tone = "plain" } = element.props;
  return (
    <div className={`sb-note sb-tone-${tone}`}>
      {title ? <h3 className="sb-card-title">{title}</h3> : null}
      {blocks(text)}
    </div>
  );
}

/** Paragraphs and "- " bullet lists, with **bold**. Deliberately not full Markdown. */
function blocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={out.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split("\n")) {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) bullets.push(bullet[1]!);
      else {
        flush();
        if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
      }
    }
    flush();
  }
  return out;
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

export function ActionButton({ element }: ComponentRenderProps<BuiltInProps<"ActionButton">>) {
  const { label, action, input } = element.props;
  const { runAction } = useShowboard();
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "done" } | { kind: "error"; message: string }>({ kind: "idle" });
  const run = () => {
    setStatus({ kind: "busy" });
    Promise.resolve(runAction(action, input ?? {})).then(
      () => setStatus({ kind: "done" }),
      (err: Error) => setStatus({ kind: "error", message: err.message }),
    );
  };
  return (
    <div className="sb-action">
      <button type="button" className="sb-button" onClick={run} disabled={status.kind === "busy"}>{label}</button>
      {status.kind === "error" ? <span className="sb-error">{status.message}</span> : null}
      {status.kind === "done" ? <span className="sb-muted">Done</span> : null}
    </div>
  );
}
