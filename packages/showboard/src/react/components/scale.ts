// Small chart maths, so the package needs no chart library.

/** About `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Maps [d0, d1] onto [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/**
 * The value range a chart should show. Bars always start at zero; lines start at zero
 * unless every value sits far above it (prices), where zero would flatten the line.
 */
export function valueDomain(values: number[], kind: "line" | "bar"): [number, number] {
  if (!values.length) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (kind === "bar" || min <= 0 || min < max * 0.5) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  } else {
    const pad = (max - min) * 0.08 || max * 0.05;
    min -= pad;
    max += pad;
  }
  const ticks = niceTicks(min, max);
  return [Math.min(min, ticks[0] ?? min), Math.max(max, ticks.at(-1) ?? max)];
}

/** Rough text width in px for 12px UI text; enough to size margins. */
export const textWidth = (text: string, px = 12) => text.length * px * 0.58;

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A bar as an SVG path: square where it leaves the baseline, rounded at the value end. */
export function barPath(x: number, y: number, w: number, h: number, end: "top" | "bottom" | "left" | "right", radius = 4): string {
  const across = end === "top" || end === "bottom" ? w : h;
  const along = end === "top" || end === "bottom" ? h : w;
  const r = r2(Math.max(0, Math.min(radius, across / 2, along)));
  const [L, T, R, B] = [r2(x), r2(y), r2(x + w), r2(y + h)];
  switch (end) {
    case "top":
      return `M${L},${B}V${T + r}Q${L},${T} ${L + r},${T}H${R - r}Q${R},${T} ${R},${T + r}V${B}Z`;
    case "bottom":
      return `M${L},${T}V${B - r}Q${L},${B} ${L + r},${B}H${R - r}Q${R},${B} ${R},${B - r}V${T}Z`;
    case "right":
      return `M${L},${T}H${R - r}Q${R},${T} ${R},${T + r}V${B - r}Q${R},${B} ${R - r},${B}H${L}Z`;
    case "left":
      return `M${R},${T}H${L + r}Q${L},${T} ${L},${T + r}V${B - r}Q${L},${B} ${L + r},${B}H${R}Z`;
  }
}

/** Where a tooltip about `tipWidth` wide goes beside point x: to its right, or its left near the edge. */
export function tooltipLeft(x: number, width: number, tipWidth = 190): number {
  return x + 14 + tipWidth <= width ? x + 14 : Math.max(0, x - 14 - tipWidth);
}

export const SERIES_COLORS =["var(--sb-c1)", "var(--sb-c2)", "var(--sb-c3)", "var(--sb-c4)", "var(--sb-c5)", "var(--sb-c6)", "var(--sb-c7)", "var(--sb-c8)"];
