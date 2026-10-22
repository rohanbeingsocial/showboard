import { useState } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import type { BuiltInProps } from "../../spec/catalog.js";
import { formatAxis, formatValue, toNumber } from "../../spec/format.js";
import { useShowboard } from "../context.js";
import { Card, Missing, useDataset } from "./frame.js";
import { SERIES_COLORS, textWidth } from "./scale.js";

const MAX_SLICES = 7;
const SIZE = 168;

export function PieChart({ element }: ComponentRenderProps<BuiltInProps<"PieChart">>) {
  const { dataset: name, label, value, title, format } = element.props;
  const dataset = useDataset(name);
  const { format: opts } = useShowboard();
  const [hover, setHover] = useState<number | null>(null);
  if (!dataset) return <Missing what={`No dataset "${name}".`} />;

  const all = dataset.rows
    .map((r) => ({ label: String(r[label] ?? "–"), value: toNumber(r[value]) ?? 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const slices = all.length > MAX_SLICES + 1 ? [...all.slice(0, MAX_SLICES), { label: "Other", value: all.slice(MAX_SLICES).reduce((t, s) => t + s.value, 0) }] : all;
  const total = slices.reduce((t, s) => t + s.value, 0);
  if (!total) return <Card title={title} dataset={dataset}><Missing what="No positive values to draw." /></Card>;

  const r = SIZE / 2;
  const inner = r * 0.66;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const path = arc(r, r, r - 2, inner, angle, angle + sweep);
    angle += sweep;
    return { ...s, path, color: i === slices.length - 1 && s.label === "Other" ? "var(--sb-muted)" : SERIES_COLORS[i % SERIES_COLORS.length] };
  });
  const focus = hover !== null ? arcs[hover] : undefined;
  // The middle shows the full amount when it fits the hole, else the short form ($1.8M).
  const full = formatValue(focus?.value ?? total, format, opts);
  const middle = textWidth(full, 16) <= inner * 2 - 16 ? full : formatAxis(focus?.value ?? total, format, opts);

  return (
    <Card title={title} dataset={dataset}>
      <div className="sb-pie">
        <svg width={SIZE} height={SIZE} role="img" aria-label={title ?? `${value} by ${label}`}>
          {arcs.map((a, i) => (
            <path key={a.label} d={a.path} fill={a.color} className="sb-slice" opacity={hover === null || hover === i ? 1 : 0.4} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
          <text x={r} y={r - 4} textAnchor="middle" className="sb-pie-value">{middle}</text>
          <text x={r} y={r + 15} textAnchor="middle" className="sb-axis">{focus ? `${Math.round((focus.value / total) * 100)}%` : "Total"}</text>
        </svg>
        <ul className="sb-pie-legend">
          {arcs.map((a, i) => (
            <li key={a.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? "sb-active" : undefined}>
              <span className="sb-swatch" style={{ background: a.color }} />
              <span className="sb-pie-label">{a.label}</span>
              <span className="sb-num">{formatValue(a.value, format, opts)}</span>
              <span className="sb-num sb-muted">{((a.value / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** A ring segment from angle a0 to a1 (radians). A full circle is split in two so the path closes. */
function arc(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI;
    return `${arc(cx, cy, outer, inner, a0, mid)} ${arc(cx, cy, outer, inner, mid, a1)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (radius: number, a: number) => `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
  return `M${p(outer, a0)} A${outer},${outer} 0 ${large} 1 ${p(outer, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
}
