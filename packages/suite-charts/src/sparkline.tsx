// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { linearScale } from "./scale.js";
import { extent, numberText } from "./shared.js";
import type { SparklineProps } from "./types.js";

export function Sparkline({ values, label }: SparklineProps) {
  const valid = values.flatMap((value, i) => (Number.isFinite(value) ? [{ value, i }] : []));
  const domain = extent(valid.map((p) => p.value));
  const y = linearScale(domain, [44, 4]);
  const x = (index: number) =>
    values.length === 1 ? 80 : 4 + (index / Math.max(1, values.length - 1)) * 152;
  const [min, max] = valid.length
    ? valid.reduce(
        ([a, b], p) => [Math.min(a, p.value), Math.max(b, p.value)],
        [Infinity, -Infinity],
      )
    : [0, 0];
  const skipped = values.length - valid.length;
  const summary = valid.length
    ? `First ${numberText(valid[0]?.value ?? 0)}, last ${numberText(valid.at(-1)?.value ?? 0)}, min ${numberText(min ?? 0)}, max ${numberText(max ?? 0)}`
    : "No data yet";
  return (
    <svg
      className="sc-sparkline"
      width="160"
      height="48"
      viewBox="0 0 160 48"
      role="img"
      aria-label={`${label}: ${summary}${skipped ? `. ${skipped} ${skipped === 1 ? "value could" : "values could"} not be plotted` : ""}`}
    >
      <title>{label}</title>
      {valid.length > 0 && (
        <polyline
          className="sc-line sc-series-1"
          points={valid.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")}
        />
      )}
      {valid.length === 1 && (
        <circle
          className="sc-mark sc-series-1"
          cx={x(valid[0]?.i ?? 0)}
          cy={y(valid[0]?.value ?? 0)}
          r="4"
        />
      )}
    </svg>
  );
}
