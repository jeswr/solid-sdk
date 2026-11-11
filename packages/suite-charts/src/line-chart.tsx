// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useId } from "react";
import { linearScale, toTime } from "./scale.js";
import {
  checkSeries,
  DASHES,
  DataTable,
  Empty,
  extent,
  Frame,
  Legend,
  type Mark,
  numberText,
  rawX,
  skippedNote,
  Tooltip,
  timeText,
  usePoints,
  withUnit,
  XAxis,
  YAxis,
} from "./shared.js";
import type { LineChartProps, XValue } from "./types.js";

function mode(x: XValue) {
  return typeof x === "number" ? "number" : "time";
}
function prepare({ series, events = [] }: LineChartProps) {
  checkSeries(series.length);
  const first = series.flatMap((s) => s.points)[0];
  const kind = first ? mode(first.x) : events[0] ? mode(events[0].x) : "number";
  const read = (value: XValue) => {
    if (mode(value) !== kind) throw new TypeError("LineChart cannot mix numeric and time x values");
    // Non-finite numeric values and invalid Date objects are counted as skipped observations.
    return value instanceof Date ? value.getTime() : toTime(value);
  };
  let skipped = 0;
  const groups = series.map((s, slot) => ({
    ...s,
    slot,
    points: s.points
      .flatMap((p, index) => {
        const x = read(p.x);
        if (!Number.isFinite(x) || !Number.isFinite(p.y)) {
          skipped++;
          return [];
        }
        return [{ ...p, x, key: `${s.id}:${index}` }];
      })
      .sort((a, b) => a.x - b.x),
  }));
  const markers = events.flatMap((e, i) => {
    const x = read(e.x);
    if (!Number.isFinite(x)) {
      skipped++;
      return [];
    }
    return [{ ...e, x, key: `event:${i}` }];
  });
  return { groups, markers, skipped, kind };
}
type Prepared = ReturnType<typeof prepare>;
export function LineChart(props: LineChartProps) {
  const prepared = prepare(props);
  const formatX = props.formatX ?? (prepared.kind === "time" ? timeText : numberText);
  const formatY = props.formatY ?? numberText;
  return (
    <Frame
      {...props}
      note={skippedNote(prepared.skipped)}
      table={
        <DataTable
          title={props.title}
          headers={["Series", "X", withUnit("Value", props.unit), "Label"]}
          rows={props.series.flatMap((s) =>
            s.points.map((p) => [
              s.label,
              Number.isFinite(p.x instanceof Date ? p.x.getTime() : toTime(p.x))
                ? formatX(toTime(p.x))
                : rawX(p.x),
              formatY(p.y),
              p.label ?? "",
            ]),
          )}
        />
      }
    >
      {(width, height) => (
        <>
          <LinePlot
            {...props}
            {...prepared}
            width={width}
            height={height}
            formatX={formatX}
            formatY={formatY}
            axisFormatX={
              props.formatX ??
              (prepared.kind === "time" ? (n) => timeText(n).slice(0, 10) : numberText)
            }
          />
          <Legend series={props.series} />
        </>
      )}
    </Frame>
  );
}
function LinePlot({
  groups,
  markers,
  kind,
  width,
  height,
  unit,
  title,
  yDomain,
  formatX,
  formatY,
  band,
  axisFormatX,
}: LineChartProps &
  Prepared & {
    width: number;
    height: number;
    formatX: (n: number) => string;
    formatY: (n: number) => string;
    axisFormatX: (n: number) => string;
  }) {
  const left = 62,
    right = width - 16,
    top = 42,
    bottom = height - 48;
  const all = groups.flatMap((s) => s.points);
  const xd = extent([...all.map((p) => p.x), ...markers.map((e) => e.x)]);
  const bandValid = band && Number.isFinite(band.from) && Number.isFinite(band.to);
  const yd =
    yDomain ?? extent([...all.map((p) => p.y), ...(bandValid ? [band.from, band.to] : [])]);
  const x = linearScale(xd, [left, right]),
    y = linearScale(yd, [bottom, top]);
  const marks: (Mark & { slot: number })[] = groups.flatMap((s) =>
    s.points
      .filter((p) => p.y >= Math.min(...yd) && p.y <= Math.max(...yd))
      .map((p) => ({
        slot: s.slot,
        key: p.key,
        px: x(p.x),
        py: y(p.y),
        text: `${s.label}, ${formatX(p.x)}: ${withUnit(formatY(p.y), unit)}${p.label ? `, ${p.label}` : ""}`,
      })),
  );
  const interaction = usePoints(marks);
  const clip = useId();
  const tickValues = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const ticks = [
    ...new Set([
      tickValues[0],
      ...(width >= 480 ? [tickValues[Math.floor(tickValues.length / 2)]] : []),
      tickValues.at(-1),
    ]),
  ].filter((v): v is number => v !== undefined);
  return (
    <div className="sc-plot">
      {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG data points need a group, not an HTML fieldset. */}
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={`${title} plot`}
        className="sc-svg"
        onMouseLeave={() => interaction.hover(undefined)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - bounds.left,
            py = event.clientY - bounds.top;
          if (px < left || px > right || py < top || py > bottom) {
            interaction.hover(undefined);
            return;
          }
          let closest: Mark | undefined;
          for (const mark of marks)
            if (
              !closest ||
              Math.abs(mark.px - px) < Math.abs(closest.px - px) ||
              (mark.px === closest.px && Math.abs(mark.py - py) < Math.abs(closest.py - py))
            )
              closest = mark;
          interaction.hover(closest?.key);
        }}
      >
        <defs>
          <clipPath id={clip}>
            <rect
              x={left - 12}
              y={top}
              width={Math.max(0, right - left + 24)}
              height={bottom - top}
            />
          </clipPath>
        </defs>
        <YAxis
          domain={yd}
          scale={y}
          left={left}
          right={right}
          top={top}
          bottom={bottom}
          format={formatY}
          label={unit}
        />
        <XAxis values={ticks} scale={x} bottom={bottom} format={axisFormatX} />
        {kind === "time" && (
          <text className="sc-axis" x={right} y={height - 4} textAnchor="end">
            UTC
          </text>
        )}
        <g clipPath={`url(#${clip})`}>
          {bandValid && (
            <g>
              <rect
                className="sc-band"
                x={left}
                y={Math.min(y(band.from), y(band.to))}
                width={Math.max(0, right - left)}
                height={Math.abs(y(band.from) - y(band.to))}
              />
              <text
                className="sc-band-label"
                x={left + 8}
                y={Math.max(
                  top + 14,
                  Math.min(bottom - 4, Math.min(y(band.from), y(band.to)) + 14),
                )}
              >
                {band.label}
              </text>
            </g>
          )}
          {markers.map((e) => (
            <g key={e.key}>
              <line className="sc-event" x1={x(e.x)} x2={x(e.x)} y1={top} y2={bottom} />
              <text className="sc-event-label" x={x(e.x) + 4} y={top + 12}>
                {e.label}
              </text>
            </g>
          ))}
          {interaction.active && (
            <line
              className="sc-crosshair"
              x1={interaction.active.px}
              x2={interaction.active.px}
              y1={top}
              y2={bottom}
            />
          )}
          {groups.map((s) => (
            <polyline
              key={s.id}
              className={`sc-line sc-series-${s.slot + 1}`}
              points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
              strokeDasharray={DASHES[s.slot]}
            />
          ))}
        </g>
        {marks.map((mark, i) => {
          const slot = mark.slot;
          return (
            <g
              key={mark.key}
              {...interaction.props(mark, i)}
              className={`sc-point sc-series-${slot + 1}`}
            >
              <circle className="sc-hit" cx={mark.px} cy={mark.py} r="12" />
              <circle className="sc-mark" cx={mark.px} cy={mark.py} r="4" />
            </g>
          );
        })}
        {!all.length && <Empty width={width} height={height} />}
      </svg>
      <Tooltip mark={interaction.active} id={interaction.tooltipId} width={width} height={height} />
    </div>
  );
}
