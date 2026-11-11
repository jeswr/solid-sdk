// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
// SEAM: replace these minimal views with @jeswr/suite-charts re-exports when it lands.
import { useId } from "react";
export interface Series {
  id: string;
  label: string;
  points: { x: number | Date | string; y: number; label?: string }[];
}
interface Common {
  title: string;
  description?: string;
  height?: number;
  className?: string;
}
export interface ScatterChartProps extends Common {
  points: { id: string; x: number; y: number; label?: string }[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  trend?: boolean;
}
export function ScatterChart({
  points,
  title,
  description,
  height = 220,
  className,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
}: ScatterChartProps) {
  const id = useId();
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return (
    <figure className={className}>
      <figcaption id={id}>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </figcaption>
      <svg viewBox="0 0 400 240" width="100%" height={height} role="img" aria-labelledby={id}>
        <title>{`${xLabel} (${xUnit ?? ""}) and ${yLabel} (${yUnit ?? ""}); ${valid.length} paired days`}</title>
        <path d="M45 15 V200 H390" fill="none" stroke="var(--border)" />
        {valid.map((p) => (
          <circle
            key={p.id}
            cx={45 + ((p.x - minX) / (maxX - minX || 1)) * 335}
            cy={195 - ((p.y - minY) / (maxY - minY || 1)) * 170}
            r="3"
            fill="var(--app-insights)"
            opacity="0.65"
          >
            <title>{`${p.label ?? p.id}: ${p.x} ${xUnit ?? ""}, ${p.y} ${yUnit ?? ""}`}</title>
          </circle>
        ))}
        <text x="200" y="232" textAnchor="middle" fill="var(--foreground-muted)" fontSize="12">
          {xLabel} {xUnit && `(${xUnit})`}
        </text>
        <text
          x="12"
          y="120"
          textAnchor="middle"
          transform="rotate(-90 12 120)"
          fill="var(--foreground-muted)"
          fontSize="12"
        >
          {yLabel} {yUnit && `(${yUnit})`}
        </text>
      </svg>
      <details>
        <summary>Show paired data</summary>
        <div className="ins-table">
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Day (X)</th>
                <th scope="col">
                  {xLabel} ({xUnit})
                </th>
                <th scope="col">
                  {yLabel} ({yUnit})
                </th>
              </tr>
            </thead>
            <tbody>
              {valid.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.label ?? p.id}</th>
                  <td>{p.x.toLocaleString("en-GB", { maximumFractionDigits: 1 })}</td>
                  <td>{p.y.toLocaleString("en-GB", { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
export interface BarChartProps extends Common {
  data: { id: string; label: string; value: number }[];
  unit: string;
  orientation?: "horizontal" | "vertical";
}
export function BarChart({ data, title, description, unit, className }: BarChartProps) {
  return (
    <figure className={className}>
      <figcaption>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </figcaption>
      <div className="ins-table">
        <table>
          <caption className="ins-sr">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Average ({unit})</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.label}</th>
                <td>{p.value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
export interface LineChartProps extends Common {
  series: Series[];
  unit: string;
  yDomain?: [number, number];
  formatX?: (x: number | Date | string) => string;
  formatY?: (y: number) => string;
  band?: { lower: number; upper: number };
  events?: { x: number | Date | string; label: string }[];
}
export function LineChart({
  series,
  title,
  description,
  unit,
  formatX,
  formatY,
  className,
}: LineChartProps) {
  return (
    <figure className={className}>
      <figcaption>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </figcaption>
      <details>
        <summary>Show rolling averages</summary>
        <div className="ins-table">
          <table>
            <caption>
              {title} ({unit})
            </caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">Day</th>
                <th scope="col">Value ({unit})</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.id}-${String(p.x)}`}>
                    <th scope="row">{s.label}</th>
                    <td>{formatX ? formatX(p.x) : String(p.x)}</td>
                    <td>
                      {formatY
                        ? formatY(p.y)
                        : p.y.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
export function Sparkline({
  values,
  label,
  title,
  className,
}: {
  values: number[];
  label: string;
  title?: string;
  description?: string;
  height?: number;
  className?: string;
}) {
  return (
    <span className={className} role="img" aria-label={`${label}: ${values.join(", ")}`}>
      {title}
    </span>
  );
}
export function StatTile({
  label,
  value,
  unit,
  delta,
  sparkline,
  title,
  description,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  sparkline?: number[];
  title?: string;
  description?: string;
  height?: number;
  className?: string;
}) {
  return (
    <article className={`ins-stat ${className ?? ""}`}>
      <h3>{title ?? label}</h3>
      <p className="ins-stat-value">
        {value} <span>{unit}</span>
      </p>
      {delta !== undefined && (
        <p>
          {delta > 0 ? "+" : ""}
          {delta.toLocaleString("en-GB", { maximumFractionDigits: 1 })} {unit} vs last week
        </p>
      )}
      {description && <p className="ins-muted">{description}</p>}
      {sparkline && <Sparkline values={sparkline} label={label} />}
    </article>
  );
}
