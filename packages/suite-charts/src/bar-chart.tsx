// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { linearScale, niceTicks } from "./scale.js";
import {
  DataTable,
  Empty,
  extent,
  Frame,
  type Mark,
  numberText,
  skippedNote,
  Tooltip,
  usePoints,
  withUnit,
  XAxis,
  YAxis,
} from "./shared.js";
import type { BarChartProps } from "./types.js";

export function BarChart(props: BarChartProps) {
  const data = props.data.filter((d) => Number.isFinite(d.value));
  return (
    <Frame
      {...props}
      note={skippedNote(props.data.length - data.length)}
      table={
        <DataTable
          title={props.title}
          headers={["Label", withUnit("Value", props.unit)]}
          rows={props.data.map((d) => [d.label, (props.formatY ?? numberText)(d.value)])}
        />
      }
    >
      {(width, height) => <BarPlot {...props} data={data} width={width} height={height} />}
    </Frame>
  );
}
function BarPlot({
  title,
  data,
  orientation = "vertical",
  formatY = numberText,
  unit,
  width,
  height,
}: BarChartProps & { width: number; height: number }) {
  const horizontal = orientation === "horizontal";
  const left = horizontal ? Math.min(120, width * 0.32) : 62,
    right = width - 16,
    top = 32,
    bottom = height - 64;
  const domain = extent(
    data.map((d) => d.value),
    true,
  );
  const scale = linearScale(domain, horizontal ? [left, right] : [bottom, top]);
  const slot = (horizontal ? bottom - top : right - left) / Math.max(1, data.length);
  const marks: Mark[] = data.map((d, i) => ({
    key: d.id,
    px: horizontal ? scale(d.value) : left + slot * (i + 0.5),
    py: horizontal ? top + slot * (i + 0.5) : scale(d.value),
    text: `${d.label}: ${withUnit(formatY(d.value), unit)}`,
  }));
  const interaction = usePoints(marks);
  return (
    <div className="sc-plot">
      {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG needs group semantics. */}
      <svg
        className="sc-svg"
        width={width}
        height={height}
        role="group"
        aria-label={`${title} plot`}
      >
        {horizontal ? (
          <>
            <XAxis
              values={niceTicks(...domain, width < 480 ? 3 : 5)}
              scale={scale}
              bottom={bottom}
              format={formatY}
              label={unit}
            />
            {niceTicks(...domain, 5).map((t) => (
              <line key={t} className="sc-grid" x1={scale(t)} x2={scale(t)} y1={top} y2={bottom} />
            ))}
          </>
        ) : (
          <YAxis
            domain={domain}
            scale={scale}
            left={left}
            right={right}
            top={top}
            bottom={bottom}
            format={formatY}
            label={unit}
          />
        )}
        <line
          className="sc-baseline"
          x1={horizontal ? scale(0) : left}
          x2={horizontal ? scale(0) : right}
          y1={horizontal ? top : scale(0)}
          y2={horizontal ? bottom : scale(0)}
        />
        {marks.map((mark, i) => {
          const datum = data[i];
          if (!datum) return null;
          const size = Math.max(1, slot * 0.65);
          return (
            <g key={mark.key} {...interaction.props(mark, i)} className="sc-point sc-series-1">
              <rect
                className="sc-bar sc-mark"
                x={horizontal ? Math.min(scale(0), mark.px) : mark.px - size / 2}
                y={horizontal ? mark.py - size / 2 : Math.min(scale(0), mark.py)}
                width={horizontal ? Math.abs(mark.px - scale(0)) : size}
                height={horizontal ? size : Math.abs(mark.py - scale(0))}
              />
              <circle className="sc-hit" cx={mark.px} cy={mark.py} r="12" />
              <text
                className="sc-axis"
                x={horizontal ? left - 8 : mark.px}
                y={horizontal ? mark.py + 4 : bottom + 20}
                textAnchor={horizontal ? "end" : "middle"}
              >
                {datum.label.length > 16 ? `${datum.label.slice(0, 15)}…` : datum.label}
              </text>
            </g>
          );
        })}
        {!data.length && <Empty width={width} height={height} />}
      </svg>
      <Tooltip mark={interaction.active} id={interaction.tooltipId} width={width} height={height} />
    </div>
  );
}
