// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { niceTicks } from "./scale.js";
import type { ChartBase, LegendProps } from "./types.js";

export const DASHES = [undefined, "8 4", "2 4", "10 3 2 3", "12 4 4 4"] as const;
export const numberText = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 4 });
export const timeText = (n: number) => new Date(n).toISOString();
export const withUnit = (text: string, unit = "") => (unit ? `${text} ${unit}` : text);
export function checkSeries(count: number) {
  if (count > 5)
    throw new RangeError('At most 5 series are supported; fold the rest into "Other".');
}
export function extent(values: readonly number[], zero = false, time = false): [number, number] {
  let min = zero ? 0 : Infinity,
    max = zero ? 0 : -Infinity;
  for (const value of values)
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  if (!Number.isFinite(min)) return [0, 1];
  // Time domains use an absolute 1 ms threshold: a relative one is ~1.8 s at epoch scale.
  if (time ? max - min < 1 : max - min <= 1e-12 * Math.max(Math.abs(min), Math.abs(max), 1)) {
    if (!time && min === 0 && max === 0) return [0, 1];
    const pad = time ? 86_400_000 : Math.max(Math.abs(min), Math.abs(max)) * 0.05 || 1;
    return [zero && min >= 0 ? 0 : min - pad, zero && max <= 0 ? 0 : max + pad];
  }
  return [min, max];
}
export function rawX(x: number | Date | string) {
  return x instanceof Date
    ? Number.isFinite(x.getTime())
      ? x.toISOString()
      : "Invalid Date"
    : String(x);
}
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) setWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function Frame({
  title,
  description,
  height = 280,
  className,
  showTitle = true,
  note,
  table,
  children,
}: ChartBase & {
  note?: string | undefined;
  table: ReactNode;
  children: (width: number, height: number) => ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const { ref, width } = useWidth();
  const id = useId();
  return (
    <figure
      aria-label={title}
      aria-describedby={`${id}-caption`}
      className={`sc-chart ${className ?? ""}`}
    >
      <div className="sc-heading">
        {showTitle && <h3>{title}</h3>}
        <button
          type="button"
          aria-controls={`${id}-data`}
          aria-label={`${showTable ? "Show chart" : "Show table"} for ${title}`}
          onClick={() => setShowTable(!showTable)}
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      <div ref={ref} id={`${id}-data`} className="sc-body">
        {showTable ? (
          <div className="sc-table-scroll">{table}</div>
        ) : (
          children(width, Math.max(160, height))
        )}
      </div>
      <figcaption id={`${id}-caption`}>
        {description && <span>{description} </span>}
        <span>Use arrow keys, Home and End to explore points, or show the data table.</span>
        {note && <span> {note}</span>}
      </figcaption>
    </figure>
  );
}
export function skippedNote(count: number) {
  return count ? `${count} ${count === 1 ? "value could" : "values could"} not be plotted.` : "";
}
export function DataTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <table className="sc-table">
      <caption>{title} — chart data</caption>
      <thead>
        <tr>
          {headers.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: column positions are fixed, stateless table cells.
            <th scope="col" key={`${i}:${h}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: read-only rows have no identity-dependent state.
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: column positions are fixed, stateless table cells.
                <th scope="row" key={j}>
                  {cell}
                </th>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: column positions are fixed, stateless table cells.
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function Legend({ series }: LegendProps) {
  checkSeries(series.length);
  if (series.length < 2) return null;
  return (
    <ul className="sc-legend" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.id}>
          <svg width="28" height="12" aria-hidden="true">
            <line
              className={`sc-line sc-series-${i + 1}`}
              x1="0"
              x2="28"
              y1="6"
              y2="6"
              strokeDasharray={DASHES[i]}
            />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}
export interface Mark {
  key: string;
  px: number;
  py: number;
  text: string;
}
export function usePoints(marks: readonly Mark[]) {
  const [selected, setSelected] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const elements = useRef(new Map<string, SVGGElement>());
  const tooltipId = useId();
  const active = marks.find((m) => m.key === hovered) ?? marks.find((m) => m.key === focused);
  const tabKey = marks.some((m) => m.key === selected) ? selected : marks[0]?.key;
  useEffect(() => {
    if (!active) return;
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHovered(undefined);
      setFocused(undefined);
      event.stopPropagation();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [active]);
  function onKeyDown(event: KeyboardEvent<SVGGElement>, index: number) {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? marks.length - 1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index + 1) % marks.length
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? (index - 1 + marks.length) % marks.length
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      const mark = marks[next];
      if (mark) elements.current.get(mark.key)?.focus();
    }
    if (event.key === "Escape" && active) {
      setHovered(undefined);
      setFocused(undefined);
      event.stopPropagation();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFocused(marks[index]?.key);
    }
  }
  return {
    active,
    tooltipId,
    hover: setHovered,
    props: (mark: Mark, index: number) => ({
      ref: (element: SVGGElement | null) => {
        if (element) elements.current.set(mark.key, element);
        else elements.current.delete(mark.key);
      },
      role: "button" as const,
      tabIndex: tabKey === mark.key ? 0 : -1,
      "aria-label": mark.text,
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => onKeyDown(event, index),
      onFocus: () => {
        setSelected(mark.key);
        setFocused(mark.key);
        setHovered(undefined);
      },
      onBlur: () => setFocused(undefined),
      onMouseEnter: () => setHovered(mark.key),
      onMouseLeave: () => setHovered(undefined),
      onClick: () => {
        setSelected(mark.key);
        setFocused(mark.key);
      },
    }),
  };
}
export function Tooltip({
  mark,
  id,
  width,
  height,
}: {
  mark: Mark | undefined;
  id: string;
  width: number;
  height: number;
}) {
  if (!mark) return null;
  return (
    <div
      id={id}
      role="tooltip"
      className="sc-tooltip"
      style={{
        left: Math.max(8, Math.min(width - 8, mark.px)),
        top: Math.max(8, Math.min(height - 48, mark.py - 36)),
        transform: mark.px > width / 2 ? "translateX(-100%)" : undefined,
      }}
    >
      {mark.text}
    </div>
  );
}
export function Empty({
  width,
  height,
  message = "No data yet",
}: {
  width: number;
  height: number;
  message?: string;
}) {
  return (
    <text className="sc-empty" x={width / 2} y={height / 2} textAnchor="middle">
      {message}
    </text>
  );
}
export function YAxis({
  domain,
  scale,
  left,
  right,
  top,
  bottom,
  format = numberText,
  label,
}: {
  domain: [number, number];
  scale: (n: number) => number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  format?: (n: number) => string;
  label?: string;
}) {
  return (
    <g className="sc-axis">
      <text x="4" y={top - 12}>
        {label}
      </text>
      {niceTicks(...domain, 5).map((value, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stateless ticks may round to the same value.
        <g key={`${i}:${value}`}>
          <line className="sc-grid" x1={left} x2={right} y1={scale(value)} y2={scale(value)} />
          <text x={left - 8} y={scale(value) + 4} textAnchor="end">
            {format(value)}
          </text>
        </g>
      ))}
      <line className="sc-grid" x1={left} x2={left} y1={top} y2={bottom} />
    </g>
  );
}
// AUTHORED-BY Claude Opus 5.5
/** Approximate rendered width of an axis label (12px UI font), used only to avoid overlaps. */
const LABEL_CHAR_WIDTH = 7;
const LABEL_GAP = 8;
type Anchor = "start" | "middle" | "end";
/**
 * Keep axis labels that do not overlap. The last label always stays (the most recent
 * value), then the first; a label that would collide with a kept one is dropped.
 */
export function visibleTicks(
  values: readonly number[],
  scale: (n: number) => number,
  format: (n: number) => string,
): { value: number; anchor: Anchor; text: string }[] {
  const ticks = values.map((value, i) => {
    const anchor: Anchor = i === 0 ? "start" : i === values.length - 1 ? "end" : "middle";
    const text = format(value);
    const width = text.length * LABEL_CHAR_WIDTH;
    const x = scale(value);
    const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    return { value, anchor, text, left, right: left + width };
  });
  // Priority: the last label, then the first, then the middle ones.
  const order = ticks.length > 1 ? [ticks.length - 1, 0, ...ticks.keys()].slice(0, -1) : [0];
  const kept = new Set<number>();
  for (const i of new Set(order)) {
    const tick = ticks[i];
    if (!tick) continue;
    const clear = [...kept].every((k) => {
      const other = ticks[k] as (typeof ticks)[number];
      return tick.right + LABEL_GAP <= other.left || tick.left >= other.right + LABEL_GAP;
    });
    if (clear) kept.add(i);
  }
  return ticks
    .filter((_, i) => kept.has(i))
    .map(({ value, anchor, text }) => ({ value, anchor, text }));
}
export function XAxis({
  values,
  scale,
  bottom,
  format = numberText,
  label,
}: {
  values: readonly number[];
  scale: (n: number) => number;
  bottom: number;
  format?: (n: number) => string;
  label?: string;
}) {
  const shown = visibleTicks(values, scale, format);
  return (
    <g className="sc-axis">
      {shown.map(({ value: v, anchor, text }, i) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless ticks may round to the same value.
          key={`${i}:${v}`}
          x={scale(v)}
          y={bottom + 20}
          textAnchor={anchor}
        >
          {text}
        </text>
      ))}
      {label && (
        <text x={scale(values[0] ?? 0)} y={bottom + 42}>
          {label}
        </text>
      )}
    </g>
  );
}
