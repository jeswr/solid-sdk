// AUTHORED-BY Codex GPT-6
"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { AggregatedBucket } from "../lib/stats";

/** Keep SVG text in screen pixels when a chart is narrow. */
export function useSvgWidth() {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(220, Math.min(680, entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values),
    max = Math.max(...values);
  const points = values
    .map(
      (value, index) =>
        `${4 + (index / Math.max(1, values.length - 1)) * 212},${44 - ((value - min) / (max - min || 1)) * 36}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 220 52" className="hlt-sparkline" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export interface ChartSeries {
  label: string;
  aggregation: "sum" | "mean";
  buckets: readonly AggregatedBucket[];
}
function bucketText(series: ChartSeries, bucket: AggregatedBucket, unit: string) {
  return `${series.label}, ${bucket.key}: ${series.aggregation === "sum" ? "total" : "average"} of ${bucket.count} ${bucket.count === 1 ? "reading" : "readings"}: ${bucket.value.toLocaleString("en", { maximumFractionDigits: 1 })} ${unit}`;
}
export function TrendChart({
  series,
  unit,
  label,
}: {
  series: ChartSeries[];
  unit: string;
  label: string;
}) {
  const id = useId();
  const { ref, width } = useSvgWidth();
  const [tooltipPoint, setTooltip] = useState("");
  const [activePoint, setActivePoint] = useState("");
  const pointLabels = new Map<string, string>(
    series.flatMap((item, index) =>
      item.buckets.map(
        (bucket) => [`${index}:${bucket.key}`, bucketText(item, bucket, unit)] as const,
      ),
    ),
  );
  const selected = pointLabels.has(activePoint) ? activePoint : pointLabels.keys().next().value;
  const tooltip = pointLabels.get(tooltipPoint) ?? "";
  const latest = series
    .flatMap((item) => {
      const bucket = item.buckets.at(-1);
      return bucket ? [`Latest plotted ${bucketText(item, bucket, unit)}.`] : [];
    })
    .join(" ");
  const keys = [
    ...new Set(series.flatMap((item) => item.buckets.map((bucket) => bucket.key))),
  ].sort();
  const values = series.flatMap((item) => item.buckets.map((bucket) => bucket.value));
  const bottom = Math.floor(Math.min(...values) * 0.95);
  const top = Math.ceil(Math.max(...values) * 1.05) || 1;
  const x = (key: string) =>
    70 +
    ((Date.parse(key) - Date.parse(keys[0] ?? "2000-01-01")) /
      (Date.parse(keys.at(-1) ?? "2000-01-01") - Date.parse(keys[0] ?? "2000-01-01") || 1)) *
      (width - 110);
  const y = (value: number) => 218 - ((value - bottom) / (top - bottom || 1)) * 180;
  const ticks = [
    ...new Set(
      [keys[0], keys[Math.floor(keys.length / 2)], keys.at(-1)].filter(
        (key): key is string => !!key,
      ),
    ),
  ];
  return (
    <div className="hlt-chart-wrap">
      {/* biome-ignore lint/a11y/useSemanticElements: SVG group exposes keyboard points; a fieldset cannot replace this SVG. */}
      <svg
        ref={ref}
        viewBox={`0 0 ${width} 268`}
        role="group"
        aria-label={`${label} ${latest}`}
        className="hlt-chart"
        aria-describedby={id}
      >
        <text x="12" y="20">
          {unit}
        </text>
        {[0, 1, 2, 3].map((tick) => {
          const value = bottom + ((top - bottom) * tick) / 3;
          return (
            <g key={tick}>
              <line
                x1="70"
                x2={width - 40}
                y1={y(value)}
                y2={y(value)}
                className="hlt-chart-grid"
              />
              <text x="58" y={y(value) + 4} textAnchor="end">
                {value.toLocaleString("en", { maximumFractionDigits: 1 })}
              </text>
            </g>
          );
        })}
        {ticks.map((key) => (
          <text key={key} x={x(key)} y="248" textAnchor="middle">
            {new Date(key).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </text>
        ))}
        {series.map((item, seriesIndex) => (
          <g key={item.label}>
            <polyline
              fill="none"
              stroke={seriesIndex ? "var(--info)" : "var(--primary)"}
              strokeDasharray={seriesIndex ? "5 3" : undefined}
              strokeWidth="1.75"
              points={item.buckets.map((bucket) => `${x(bucket.key)},${y(bucket.value)}`).join(" ")}
            />
            {item.buckets.map((bucket) => {
              const text = bucketText(item, bucket, unit);
              const pointId = `${seriesIndex}:${bucket.key}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG points expose keyboard tooltips through button semantics.
                <circle
                  key={bucket.key}
                  cx={x(bucket.key)}
                  cy={y(bucket.value)}
                  r="4"
                  fill={seriesIndex ? "var(--info)" : "var(--primary)"}
                  tabIndex={selected === pointId ? 0 : -1}
                  role="button"
                  aria-label={text}
                  onClick={() => setTooltip(pointId)}
                  onKeyDown={(event) => {
                    const points = Array.from(
                      ref.current?.querySelectorAll<SVGCircleElement>('circle[role="button"]') ??
                        [],
                    );
                    const index = points.indexOf(event.currentTarget);
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? points.length - 1
                          : event.key === "ArrowRight" || event.key === "ArrowDown"
                            ? (index + 1) % points.length
                            : event.key === "ArrowLeft" || event.key === "ArrowUp"
                              ? (index - 1 + points.length) % points.length
                              : null;
                    if (next !== null) {
                      event.preventDefault();
                      points[next]?.focus();
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setTooltip(pointId);
                    }
                  }}
                  onFocus={() => {
                    setActivePoint(pointId);
                    setTooltip(pointId);
                  }}
                  onBlur={() => setTooltip("")}
                  onMouseEnter={() => setTooltip(pointId)}
                  onMouseLeave={() => setTooltip("")}
                >
                  <title>{text}</title>
                </circle>
              );
            })}
          </g>
        ))}
      </svg>
      <p id={id} className="hlt-chart-tooltip" role="status">
        {tooltip ||
          "Focus or hover on a point to see its value. Use arrow keys to move between points. Dates use UTC."}
      </p>
      {series.length > 1 && (
        <div className="hlt-legend">
          {series.map((item, index) => (
            <span key={item.label}>
              <span
                aria-hidden="true"
                className={index ? "hlt-key-secondary" : "hlt-key-primary"}
              />
              {item.label}
              {index ? " (dashed)" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
export function BucketTable({ series, unit }: { series: ChartSeries[]; unit: string }) {
  const keys = [
    ...new Set(series.flatMap((item) => item.buckets.map((bucket) => bucket.key))),
  ].sort();
  return (
    <div className="hlt-table-scroll">
      <table className="hlt-table">
        <caption>Chart data ({unit}) · UTC bucket start dates</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((item) => (
              <th scope="col" key={item.label}>
                {item.label} ({unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              {series.map((item) => (
                <td key={item.label}>
                  {item.buckets
                    .find((bucket) => bucket.key === key)
                    ?.value.toLocaleString("en", { maximumFractionDigits: 1 }) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
