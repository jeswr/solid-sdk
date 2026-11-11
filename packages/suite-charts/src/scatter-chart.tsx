// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useId } from "react";
import { leastSquares, linearScale, niceTicks, pearson } from "./scale.js";
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
import type { ScatterChartProps } from "./types.js";

export function ScatterChart(props: ScatterChartProps) {
  const points = props.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const r = props.trend
    ? pearson(
        points.map((p) => p.x),
        points.map((p) => p.y),
      )
    : undefined;
  const fit = r === undefined ? undefined : leastSquares(points);
  const trendText = props.trend
    ? fit
      ? `r = ${r?.toFixed(2)} (n = ${points.length}).`
      : "Not enough data for a trend."
    : "";
  return (
    <Frame
      {...props}
      note={[trendText, skippedNote(props.points.length - points.length)].filter(Boolean).join(" ")}
      table={
        <DataTable
          title={props.title}
          headers={[
            "Label",
            withUnit(props.xLabel, props.xUnit),
            withUnit(props.yLabel, props.yUnit),
          ]}
          rows={props.points.map((p) => [p.label ?? p.id, numberText(p.x), numberText(p.y)])}
        />
      }
    >
      {(width, height) => (
        <ScatterPlot {...props} points={points} fit={fit} width={width} height={height} />
      )}
    </Frame>
  );
}
function ScatterPlot({
  title,
  points,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  fit,
  width,
  height,
}: ScatterChartProps & { fit: ReturnType<typeof leastSquares>; width: number; height: number }) {
  const left = 62,
    right = width - 16,
    top = 36,
    bottom = height - 64;
  const xd = extent(points.map((p) => p.x)),
    yd = extent(points.map((p) => p.y));
  const x = linearScale(xd, [left, right]),
    y = linearScale(yd, [bottom, top]);
  const marks: Mark[] = points.map((p) => ({
    key: p.id,
    px: x(p.x),
    py: y(p.y),
    text: `${p.label ?? title}, ${xLabel}: ${withUnit(numberText(p.x), xUnit)}, ${yLabel}: ${withUnit(numberText(p.y), yUnit)}`,
  }));
  const interaction = usePoints(marks);
  const clip = useId();
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
        <defs>
          <clipPath id={clip}>
            <rect x={left} y={top} width={Math.max(0, right - left)} height={bottom - top} />
          </clipPath>
        </defs>
        <YAxis
          domain={yd}
          scale={y}
          left={left}
          right={right}
          top={top}
          bottom={bottom}
          label={withUnit(yLabel, yUnit)}
        />
        <XAxis
          values={niceTicks(...xd, width < 480 ? 3 : 5)}
          scale={x}
          bottom={bottom}
          label={withUnit(xLabel, xUnit)}
        />
        {fit && (
          <line
            className="sc-trend"
            clipPath={`url(#${clip})`}
            x1={x(xd[0])}
            x2={x(xd[1])}
            y1={y(fit.slope * xd[0] + fit.intercept)}
            y2={y(fit.slope * xd[1] + fit.intercept)}
          />
        )}
        {marks.map((mark, i) => (
          <g key={mark.key} {...interaction.props(mark, i)} className="sc-point sc-series-1">
            <circle className="sc-hit" cx={mark.px} cy={mark.py} r="12" />
            <circle className="sc-mark" cx={mark.px} cy={mark.py} r="4" />
          </g>
        ))}
        {!points.length && <Empty width={width} height={height} />}
      </svg>
      <Tooltip mark={interaction.active} id={interaction.tooltipId} width={width} height={height} />
    </div>
  );
}
