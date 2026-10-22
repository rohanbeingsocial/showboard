import { useMemo, useState, type MouseEvent } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import type { BuiltInProps } from "../../spec/catalog.js";
import { formatAxis, formatDate, formatValue, parseDate, toNumber } from "../../spec/format.js";
import { useShowboard } from "../context.js";
import { Card, Missing, useDataset, useWidth } from "./frame.js";
import { SERIES_COLORS, linear, niceTicks, textWidth, tooltipLeft, truncate, valueDomain } from "./scale.js";

const HEIGHT = 240;

export function LineChart({ element }: ComponentRenderProps<BuiltInProps<"LineChart">>) {
  const { dataset: name, x, y, title, format } = element.props;
  const dataset = useDataset(name);
  const { format: opts } = useShowboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const rows = dataset?.rows ?? [];
    const dates = rows.length > 0 && rows.every((r) => parseDate(r[x]) !== null);
    const items = rows.map((r, i) => ({ key: dates ? parseDate(r[x])!.getTime() : i, label: r[x], values: y.map((col) => toNumber(r[col])) }));
    if (dates) items.sort((a, b) => a.key - b.key);
    // Months often arrive as their first day ("2026-03-01"); they read as months, not days.
    const monthly = dates && items.every((p) => new Date(p.key).toISOString().slice(8) === "01T00:00:00.000Z");
    return { items, dates, monthly };
  }, [dataset, x, y]);

  if (!dataset) return <Missing what={`No dataset "${name}".`} />;
  const values = points.items.flatMap((p) => p.values.filter((v): v is number => v !== null));
  if (!values.length) return <Card title={title} dataset={dataset}><Missing what="No numbers to draw." /></Card>;

  const [lo, hi] = valueDomain(values, "line");
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);
  const left = Math.max(...ticks.map((t) => textWidth(formatAxis(t, format, opts)))) + 12;
  const plot = { left, right: Math.max(left + 40, width - 10), top: 10, bottom: HEIGHT - 28 };
  const keys = points.items.map((p) => p.key);
  const sx = linear(Math.min(...keys), Math.max(...keys), plot.left, plot.right);
  const sy = linear(lo, hi, plot.bottom, plot.top);
  const base = lo > 0 ? lo : hi < 0 ? hi : 0;
  const color = (s: number) => SERIES_COLORS[s % SERIES_COLORS.length];
  const monthOf = (key: number, year: boolean) => new Intl.DateTimeFormat(opts.locale, { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(key);
  const labelOf = (p: (typeof points.items)[number]) => (points.monthly ? monthOf(p.key, true) : points.dates ? formatDate(p.label, opts.locale) : String(p.label ?? ""));
  const maxLabels = Math.max(2, Math.floor((plot.right - plot.left) / 90));
  const months = points.monthly ? monthLabels(points.items.map((p) => p.key), maxLabels, monthOf) : [];
  const xLabels = months.length >= 2 ? months : pickLabelIndexes(points.items.length, maxLabels).map((i) => ({ index: i, text: labelOf(points.items[i]!) }));
  const single = y.length === 1 && points.items.every((p) => p.values[0] !== null);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left;
    let best = 0;
    points.items.forEach((p, i) => {
      if (Math.abs(sx(p.key) - mx) < Math.abs(sx(points.items[best]!.key) - mx)) best = i;
    });
    setHover(best);
  };
  const hovered = hover !== null ? points.items[hover] : undefined;

  return (
    <Card title={title} dataset={dataset}>
      {y.length > 1 ? <Legend names={y} /> : null}
      <div ref={ref} className="sb-chart">
        {width > 0 ? (
          <svg width={width} height={HEIGHT} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title ?? `${y.join(", ")} by ${x}`}>
            {ticks.map((t) => (
              <g key={t}>
                {t === base ? null : <line className="sb-grid-line" x1={plot.left} x2={plot.right} y1={sy(t)} y2={sy(t)} />}
                <text className="sb-axis" x={plot.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">{formatAxis(t, format, opts)}</text>
              </g>
            ))}
            <line className="sb-baseline" x1={plot.left} x2={plot.right} y1={sy(base)} y2={sy(base)} />
            {xLabels.map(({ index, text }) => (
              <text key={index} className="sb-axis" x={sx(points.items[index]!.key)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === points.items.length - 1 ? "end" : "middle"}>
                {truncate(text, 16)}
              </text>
            ))}
            {single ? <path d={`${linePath(points.items, 0, sx, sy)}L${plot.right.toFixed(1)},${sy(base).toFixed(1)}L${sx(points.items[0]!.key).toFixed(1)},${sy(base).toFixed(1)}Z`} fill={color(0)} fillOpacity={0.1} /> : null}
            {y.map((col, s) => (
              <path key={col} d={linePath(points.items, s, sx, sy)} fill="none" stroke={color(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hovered ? (
              <line className="sb-hover-line" x1={sx(hovered.key)} x2={sx(hovered.key)} y1={plot.top} y2={plot.bottom} />
            ) : null}
            {y.map((col, s) => {
              // A dot ends each line, and marks the hovered point.
              const at = hovered && hovered.values[s] !== null ? hovered : points.items.findLast((p) => p.values[s] !== null);
              return at ? <circle key={col} className="sb-dot" cx={sx(at.key)} cy={sy(at.values[s]!)} r={4} fill={color(s)} /> : null;
            })}
          </svg>
        ) : null}
        {hovered ? (
          <div className="sb-tooltip" style={{ left: tooltipLeft(sx(hovered.key), width), top: 6 }}>
            <div className="sb-tooltip-title">{labelOf(hovered)}</div>
            {y.map((col, s) => (
              <div key={col} className="sb-tooltip-row">
                <span className="sb-swatch" style={{ background: color(s) }} />
                <span>{col}</span>
                <span className="sb-num">{formatValue(hovered.values[s], format, opts)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function linePath(items: { key: number; values: (number | null)[] }[], series: number, sx: (v: number) => number, sy: (v: number) => number): string {
  let d = "";
  let pen = false; // a gap (null) lifts the pen
  for (const p of items) {
    const v = p.values[series];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(p.key).toFixed(1)},${sy(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Month ticks on calendar steps (every month, quarter, half or year), so labels land on
 * Jan/Apr/Jul/Oct rather than wherever even spacing falls. The year shows where it changes.
 */
function monthLabels(keys: number[], max: number, monthOf: (key: number, year: boolean) => string): { index: number; text: string }[] {
  const month = (key: number) => new Date(key).getUTCFullYear() * 12 + new Date(key).getUTCMonth();
  const span = month(keys.at(-1)!) - month(keys[0]!) + 1;
  const step = [1, 2, 3, 6, 12, 24, 60].find((s) => Math.ceil(span / s) <= max) ?? 120;
  let year: number | null = null;
  return keys.flatMap((key, index) => {
    if (month(key) % step !== 0) return [];
    const y = new Date(key).getUTCFullYear();
    const text = step >= 12 ? String(y) : monthOf(key, y !== year);
    year = y;
    return [{ index, text }];
  });
}

/** Up to `max` evenly spaced indexes, always including the first and last. */
export function pickLabelIndexes(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

export function Legend({ names }: { names: string[] }) {
  return (
    <div className="sb-legend">
      {names.map((n, i) => (
        <span key={n}>
          <span className="sb-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
          {n}
        </span>
      ))}
    </div>
  );
}
