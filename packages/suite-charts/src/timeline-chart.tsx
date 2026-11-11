// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useState } from "react";
import { linearScale, toTime } from "./scale.js";
import {
  DataTable,
  Empty,
  extent,
  Frame,
  type Mark,
  rawX,
  skippedNote,
  Tooltip,
  timeText,
  usePoints,
  XAxis,
} from "./shared.js";
import type { TimelineChartProps } from "./types.js";

export function TimelineChart(props: TimelineChartProps) {
  const [clock] = useState(() => Date.now());
  const now = toTime(props.now ?? clock);
  let skipped = 0;
  const lanes = props.lanes.map((lane) => ({
    ...lane,
    items: lane.items.flatMap((item) => {
      const start = item.start instanceof Date ? item.start.getTime() : toTime(item.start);
      const open = item.end === undefined && item.tone === "active";
      const end =
        item.end !== undefined
          ? item.end instanceof Date
            ? item.end.getTime()
            : toTime(item.end)
          : open
            ? now
            : start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        skipped++;
        return [];
      }
      return [{ ...item, start, end, open, point: item.end === undefined && !open }];
    }),
  }));
  const domain: [number, number] = props.range
    ? [toTime(props.range[0]), toTime(props.range[1])]
    : extent(lanes.flatMap((l) => l.items.flatMap((i) => [i.start, i.end])));
  if (domain[1] < domain[0]) throw new RangeError("Timeline range must run from earlier to later");
  return (
    <Frame
      {...props}
      note={skippedNote(skipped)}
      table={
        <DataTable
          title={props.title}
          headers={["Lane", "Item", "Start (UTC)", "End (UTC)", "Status"]}
          rows={props.lanes.flatMap((l) =>
            l.items.map((i) => [
              l.label,
              i.label,
              rawX(i.start),
              i.end === undefined
                ? i.tone === "active"
                  ? `Ongoing (through ${rawX(props.now ?? clock)})`
                  : "Point event"
                : rawX(i.end),
              i.tone ?? "neutral",
            ]),
          )}
        />
      }
    >
      {(width, height) => (
        <TimelinePlot
          title={props.title}
          lanes={lanes}
          domain={domain}
          width={width}
          height={height}
        />
      )}
    </Frame>
  );
}
type PreparedLanes = readonly {
  id: string;
  label: string;
  items: readonly {
    id: string;
    label: string;
    tone?: "neutral" | "active" | "past";
    start: number;
    end: number;
    open: boolean;
    point: boolean;
  }[];
}[];
function TimelinePlot({
  title,
  lanes,
  domain,
  width,
  height,
}: {
  title: string;
  lanes: PreparedLanes;
  domain: [number, number];
  width: number;
  height: number;
}) {
  const narrow = width < 480;
  const left = narrow ? 16 : 136,
    right = width - 16,
    top = 20;
  const actualHeight = Math.max(height, lanes.length * (narrow ? 72 : 48) + 64);
  const bottom = actualHeight - 48;
  const row = (bottom - top) / Math.max(1, lanes.length);
  const x = linearScale(domain, [left, right]);
  const visible = lanes.flatMap((lane, i) =>
    lane.items
      .filter((item) => item.end >= domain[0] && item.start <= domain[1])
      .map((item) => ({
        ...item,
        lane: lane.label,
        key: `${lane.id}:${item.id}`,
        px: x(Math.max(domain[0], item.start)),
        endX: x(Math.min(domain[1], item.end)),
        py: top + row * (i + 0.5) + (narrow ? 10 : 0),
      })),
  );
  const marks: Mark[] = visible.map((item) => ({
    key: item.key,
    px: item.px,
    py: item.py,
    text: `${item.lane}, ${item.label}: ${timeText(item.start)}${item.open ? `, ongoing through ${timeText(item.end)}` : item.point ? ", point event" : ` to ${timeText(item.end)}`}, ${item.tone ?? "neutral"}`,
  }));
  const interaction = usePoints(marks);
  return (
    <div className="sc-plot">
      {/* biome-ignore lint/a11y/useSemanticElements: interactive timeline SVG needs group semantics. */}
      <svg
        className="sc-svg"
        width={width}
        height={actualHeight}
        role="group"
        aria-label={`${title} plot`}
      >
        {lanes.map((lane, i) => (
          <g key={lane.id}>
            <text
              className="sc-lane-label"
              x={narrow ? left : left - 12}
              y={narrow ? top + row * i + 14 : top + row * (i + 0.5) + 4}
              textAnchor={narrow ? "start" : "end"}
            >
              {!narrow && lane.label.length > 18 ? `${lane.label.slice(0, 17)}…` : lane.label}
            </text>
            <line
              className="sc-grid"
              x1={left}
              x2={right}
              y1={top + row * (i + 1)}
              y2={top + row * (i + 1)}
            />
          </g>
        ))}
        <XAxis
          values={domain[0] === domain[1] ? [domain[0]] : domain}
          scale={x}
          bottom={bottom}
          format={(n) => timeText(n).slice(0, 10)}
          label="UTC"
        />
        {visible.map((item, i) => {
          const mark = marks[i];
          if (!mark) return null;
          const end = Math.max(item.px + 2, item.endX);
          return (
            <g
              key={item.key}
              {...interaction.props(mark, i)}
              className={`sc-point sc-tone-${item.tone ?? "neutral"}`}
            >
              {item.point ? (
                <path
                  className="sc-mark sc-diamond"
                  d={`M ${item.px} ${item.py - 6} l 6 6 l -6 6 l -6 -6 Z`}
                />
              ) : item.open ? (
                <path
                  className="sc-mark sc-interval sc-open-end"
                  data-open-end="true"
                  d={`M ${end} ${item.py - 8} H ${item.px + 4} Q ${item.px} ${item.py - 8} ${item.px} ${item.py - 4} V ${item.py + 4} Q ${item.px} ${item.py + 8} ${item.px + 4} ${item.py + 8} H ${end}`}
                />
              ) : (
                <rect
                  className="sc-mark sc-interval"
                  x={item.px}
                  y={item.py - 8}
                  width={end - item.px}
                  height="16"
                  rx="4"
                />
              )}
              <circle className="sc-hit" cx={item.px} cy={item.py} r="12" />
            </g>
          );
        })}
        {!visible.length && <Empty width={width} height={actualHeight} />}
      </svg>
      <Tooltip
        mark={interaction.active}
        id={interaction.tooltipId}
        width={width}
        height={actualHeight}
      />
    </div>
  );
}
