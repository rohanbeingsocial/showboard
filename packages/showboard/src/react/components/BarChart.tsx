import { useState, type ReactNode } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import type { BuiltInProps } from "../../spec/catalog.js";
import { formatAxis, formatDate, formatValue, toNumber } from "../../spec/format.js";
import { useShowboard } from "../context.js";
import { Card, Missing, useDataset, useWidth } from "./frame.js";
import { Legend, pickLabelIndexes } from "./LineChart.js";
import { SERIES_COLORS, barPath, linear, niceTicks, textWidth, tooltipLeft, truncate, valueDomain } from "./scale.js";

const VERTICAL_HEIGHT = 240;
const MAX_BARS = 60;
const MAX_THICKNESS = 24; // bars stay slim; the rest of each band is air
const GAP = 2; // between the bars of one category

export function BarChart({ element }: ComponentRenderProps<BuiltInProps<"BarChart">>) {
  const { dataset: name, x, y, title, format } = element.props;
  const dataset = useDataset(name);
  const { format: opts } = useShowboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!dataset) return <Missing what={`No dataset "${name}".`} />;

  const rows = dataset.rows.slice(0, MAX_BARS);
  const label = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, opts.locale) : String(v ?? "–"));
  const items = rows.map((r) => ({ label: label(r[x]), values: y.map((col) => toNumber(r[col])) }));
  const values = items.flatMap((i) => i.values.filter((v): v is number => v !== null));
  if (!values.length) return <Card title={title} dataset={dataset}><Missing what="No numbers to draw." /></Card>;

  // Long or many labels read better as rows than squeezed under columns.
  const horizontal = element.props.horizontal ?? (items.length > 12 || Math.max(...items.map((i) => i.label.length)) > 12);
  const [lo, hi] = valueDomain(values, "bar");
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);
  const groups = y.length;
  const color = (s: number) => SERIES_COLORS[s % SERIES_COLORS.length];
  const dim = (i: number) => (hover === null || hover === i ? 1 : 0.45);
  const short = (v: number) => formatAxis(v, format, opts);
  const more = dataset.rows.length > rows.length ? <p className="sb-muted">First {rows.length} of {dataset.rows.length} rows.</p> : null;

  // The chart, and where the tooltip for the hovered category goes.
  const drawn = ((): { svg: ReactNode; tipAt?: { left: number; top: number } } => {
    if (width <= 0) return { svg: null };
    if (horizontal) {
      const thick = groups === 1 ? 16 : 9;
      const row = groups * thick + (groups - 1) * GAP + 12;
      const labelWidth = Math.min(width * 0.38, Math.max(...items.map((i) => textWidth(i.label))) + 12);
      const valueRoom = groups === 1 ? Math.max(...values.map((v) => textWidth(short(v), 11))) + 10 : 12;
      const height = items.length * row + 24;
      const sx = linear(lo, hi, labelWidth, width - valueRoom);
      // Beside the hovered row, past its value label, so it covers no other row's label.
      const tipAt = hover === null ? undefined : { left: tooltipLeft(Math.max(...items[hover]!.values.map((v) => sx(v ?? 0))) + valueRoom, width), top: Math.max(0, hover * row - 8) };
      const svg = (
        <svg width={width} height={height} role="img" aria-label={title ?? `${y.join(", ")} by ${x}`}>
          {ticks.map((t) => (
            <g key={t}>
              {t === 0 ? null : <line className="sb-grid-line" x1={sx(t)} x2={sx(t)} y1={0} y2={height - 20} />}
              <text className="sb-axis" x={sx(t)} y={height - 6} textAnchor="middle">{short(t)}</text>
            </g>
          ))}
          {items.map((item, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={i * row} width={width} height={row} fill="transparent" />
              <text className="sb-axis sb-axis-strong" x={labelWidth - 10} y={i * row + row / 2} dy="0.32em" textAnchor="end">{truncate(item.label, Math.floor(labelWidth / 7))}</text>
              {item.values.map((v, s) => {
                if (v === null) return null;
                const x0 = Math.min(sx(0), sx(v));
                return <path key={s} d={barPath(x0, i * row + 6 + s * (thick + GAP), Math.max(1, Math.abs(sx(v) - sx(0))), thick, v < 0 ? "left" : "right")} fill={color(s)} opacity={dim(i)} />;
              })}
              {groups === 1 && item.values[0] !== null ? (
                <text className="sb-axis sb-value" x={Math.max(sx(0), sx(item.values[0]!)) + 6} y={i * row + row / 2} dy="0.32em">{short(item.values[0]!)}</text>
              ) : null}
            </g>
          ))}
          <line className="sb-baseline" x1={sx(0)} x2={sx(0)} y1={0} y2={height - 20} />
        </svg>
      );
      return { svg, tipAt };
    }
    const left = Math.max(...ticks.map((t) => textWidth(short(t)))) + 10;
    const band = (width - 8 - left) / items.length;
    const bar = Math.max(1, Math.min(MAX_THICKNESS, (band * 0.7 - GAP * (groups - 1)) / groups));
    const group = groups * bar + GAP * (groups - 1);
    // One series with room to spare gets its value on each column; the axis carries the rest.
    const capLabels = groups === 1 && items.length <= 16 && values.every((v) => textWidth(short(v), 11) <= band - 6);
    const top = capLabels && hi > 0 ? 20 : 10;
    const bottom = VERTICAL_HEIGHT - 26 - (capLabels && lo < 0 ? 16 : 0);
    const sy = linear(lo, hi, bottom, top);
    const labelIdx = new Set(pickLabelIndexes(items.length, Math.max(2, Math.floor((width - left) / 70))));
    const tipAt = hover === null ? undefined : { left: tooltipLeft(left + (hover + 0.5) * band + group / 2, width), top: 6 };
    const svg = (
      <svg width={width} height={VERTICAL_HEIGHT} role="img" aria-label={title ?? `${y.join(", ")} by ${x}`}>
        {ticks.map((t) => (
          <g key={t}>
            {t === 0 ? null : <line className="sb-grid-line" x1={left} x2={width - 8} y1={sy(t)} y2={sy(t)} />}
            <text className="sb-axis" x={left - 8} y={sy(t)} dy="0.32em" textAnchor="end">{short(t)}</text>
          </g>
        ))}
        {items.map((item, i) => {
          const x0 = left + i * band + (band - group) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={left + i * band} y={0} width={band} height={bottom} fill="transparent" />
              {item.values.map((v, s) =>
                v === null ? null : (
                  <path key={s} d={barPath(x0 + s * (bar + GAP), Math.min(sy(0), sy(v)), bar, Math.max(1, Math.abs(sy(v) - sy(0))), v < 0 ? "bottom" : "top")} fill={color(s)} opacity={dim(i)} />
                ),
              )}
              {capLabels && item.values[0] !== null ? (
                <text className="sb-axis sb-value" x={x0 + bar / 2} y={item.values[0]! < 0 ? sy(item.values[0]!) + 14 : sy(item.values[0]!) - 6} textAnchor="middle">{short(item.values[0]!)}</text>
              ) : null}
              {labelIdx.has(i) ? (
                <text className="sb-axis" x={left + i * band + band / 2} y={VERTICAL_HEIGHT - 8} textAnchor="middle">{truncate(item.label, Math.max(4, Math.floor(Math.max(band, 70) / 7)))}</text>
              ) : null}
            </g>
          );
        })}
        <line className="sb-baseline" x1={left} x2={width - 8} y1={sy(0)} y2={sy(0)} />
      </svg>
    );
    return { svg, tipAt };
  })();
  const tip = hover !== null ? items[hover] : undefined;

  return (
    <Card title={title} dataset={dataset}>
      {groups > 1 ? <Legend names={y} /> : null}
      <div ref={ref} className="sb-chart">
        {drawn.svg}
        {tip && drawn.tipAt ? (
          <div className="sb-tooltip" style={drawn.tipAt}>
            <div className="sb-tooltip-title">{tip.label}</div>
            {y.map((col, s) => (
              <div key={col} className="sb-tooltip-row">
                <span className="sb-swatch" style={{ background: color(s) }} />
                <span>{col}</span>
                <span className="sb-num">{formatValue(tip.values[s], format, opts)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {more}
    </Card>
  );
}
