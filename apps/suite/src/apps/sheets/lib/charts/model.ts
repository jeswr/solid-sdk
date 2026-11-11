// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChartSpec } from "./spec";

export function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}
const textHeader = (values: unknown[]) =>
  values.some(
    (value) => typeof value === "string" && value.trim() !== "" && numeric(value) === null,
  ) &&
  values.every(
    (value) =>
      value === null ||
      value === undefined ||
      (typeof value === "string" && numeric(value) === null),
  );

export function detectHeaders(values: unknown[][]) {
  const firstRow = values[0] ?? [];
  const row = textHeader(firstRow);
  return { row, column: textHeader((row ? values.slice(1) : values).map((cells) => cells[0])) };
}
export interface ChartSeries {
  name: string;
  values: (number | null)[];
}
export function chartData(spec: ChartSpec, input: unknown[][]) {
  const width = Math.max(0, ...input.map((row) => row.length));
  let values: unknown[][] = input.map((row) =>
    Array.from({ length: width }, (_, i) => row[i] ?? null),
  );
  if (spec.series === "rows")
    values = Array.from({ length: width }, (_, i) => values.map((row) => row[i]));
  const headers = detectHeaders(values);
  const names = headers.row ? (values.shift() as unknown[]) : [];
  const offset = headers.column ? 1 : 0;
  const labels = values.map((row, i) => (headers.column ? String(row[0] ?? "") : `Item ${i + 1}`));
  const count = Math.max(0, (values[0]?.length ?? names.length) - offset);
  const series: ChartSeries[] = Array.from({ length: count }, (_, i) => ({
    name: String(names[i + offset] ?? `Series ${i + 1}`),
    values: values.map((row) => numeric(row[i + offset])),
  }));
  return { labels, series };
}
export type ChartMark =
  | { kind: "rect"; x: number; y: number; width: number; height: number; colour: string }
  | { kind: "circle"; x: number; y: number; radius: number; colour: string }
  | { kind: "path"; d: string; fill: boolean; colour: string };
export interface ChartLabel {
  x: number;
  y: number;
  text: string;
}
export interface SvgChartModel {
  title: string;
  description: string;
  marks: ChartMark[];
  labels: ChartLabel[];
  legend: { name: string; colour: string }[];
  empty: boolean;
}
export const seriesColour = (index: number) => `var(--chart-${(index % 5) + 1})`;

function scale(numbers: number[]) {
  const divisor = Math.max(1, ...numbers.map(Math.abs));
  const min = Math.min(0, ...numbers.map((v) => v / divisor));
  const max = Math.max(0, ...numbers.map((v) => v / divisor));
  return {
    min: min * divisor,
    max: max * divisor,
    ratio: (v: number) => (v / divisor - min) / (max - min || 1),
  };
}

/** Fixed SVG viewBox 480 × 280; layout has no DOM, theme or engine dependency. */
export function chartModel(spec: ChartSpec, values: unknown[][]): SvgChartModel {
  const data = chartData(spec, values);
  const model: SvgChartModel = {
    title: spec.title.trim() || `${spec.type} chart`,
    description: data.series
      .map((series) => {
        const numbers = series.values.filter((value): value is number => value !== null);
        return numbers.length
          ? `${series.name}: ${numbers.length} values, ${Math.min(...numbers)} to ${Math.max(...numbers)}.`
          : `${series.name}: no numeric values.`;
      })
      .join(" "),
    marks: [],
    labels: [],
    legend: [],
    empty: true,
  };
  const all = data.series.flatMap((series) => series.values).filter((v): v is number => v !== null);
  if (!all.length) {
    model.description = "No numeric data to display.";
    return model;
  }
  // Nonempty numeric data guarantees a first series and matching category labels.
  const first = data.series[0] as ChartSeries;
  model.legend = spec.legend
    ? data.series.map((series, i) => ({ name: series.name, colour: seriesColour(i) }))
    : [];
  if (spec.type === "pie") {
    const positive = first.values.map((v) => Math.max(0, v ?? 0));
    const divisor = Math.max(...positive);
    const scaled = positive.map((v) => (divisor === 0 ? 0 : v / divisor));
    const total = scaled.reduce((sum, v) => sum + v, 0);
    let angle = -Math.PI / 2;
    model.legend = [];
    scaled.forEach((v, i) => {
      if (v === 0) return;
      const sweep = (v / total) * Math.PI * 2;
      const colour = seriesColour(i);
      if (sweep === Math.PI * 2)
        model.marks.push({ kind: "circle", x: 240, y: 130, radius: 100, colour });
      else {
        const end = angle + sweep;
        model.marks.push({
          kind: "path",
          d: `M240 130 L${240 + Math.cos(angle) * 100} ${130 + Math.sin(angle) * 100} A100 100 0 ${sweep > Math.PI ? 1 : 0} 1 ${240 + Math.cos(end) * 100} ${130 + Math.sin(end) * 100} Z`,
          fill: true,
          colour,
        });
      }
      if (spec.legend) model.legend.push({ name: data.labels[i] as string, colour });
      angle += sweep;
    });
    model.description += " Pie uses the first series; zero and negative values are omitted.";
  } else {
    const verticalValues =
      spec.type === "scatter"
        ? data.series
            .slice(1)
            .flatMap((s) => s.values)
            .filter((v): v is number => v !== null)
        : all;
    const { min, max, ratio } = scale(verticalValues);
    const y = (v: number) => 230 - ratio(v) * 200;
    const x = (i: number) => 50 + ((i + 0.5) * 400) / data.labels.length;
    const baseline = y(0);
    model.labels.push(
      ...(spec.type === "bar"
        ? [
            { x: 50, y: 255, text: String(min) },
            { x: 450, y: 255, text: String(max) },
          ]
        : [
            { x: 22, y: 35, text: String(max) },
            { x: 22, y: 230, text: String(min) },
          ]),
    );
    if (spec.type === "scatter") {
      const xs = first.values;
      const ys = data.series.slice(1);
      const horizontal = scale(xs.filter((v): v is number => v !== null));
      model.legend = spec.legend
        ? ys.map((s, i) => ({ name: s.name, colour: seriesColour(i) }))
        : [];
      ys.forEach((series, s) => {
        series.values.forEach((v, i) => {
          if (v !== null && xs[i] !== null)
            model.marks.push({
              kind: "circle",
              x: 50 + horizontal.ratio(xs[i] as number) * 400,
              y: y(v),
              radius: 4,
              colour: seriesColour(s),
            });
        });
      });
      model.labels.push(
        { x: 50, y: 255, text: String(horizontal.min) },
        { x: 450, y: 255, text: String(horizontal.max) },
      );
      model.description += " Scatter uses the first numeric series for x coordinates.";
    } else {
      data.labels.forEach((label, i) => {
        model.labels.push(
          spec.type === "bar"
            ? { x: 25, y: 35 + ((i + 0.5) * 200) / data.labels.length, text: label }
            : { x: x(i), y: 255, text: label },
        );
      });
      data.series.forEach((series, s) => {
        let path = "";
        let connected = false;
        series.values.forEach((v, i) => {
          if (v === null) {
            connected = false;
            return;
          }
          const colour = seriesColour(s);
          if (spec.type === "line") {
            path += `${connected ? " L" : " M"}${x(i)} ${y(v)}`;
            connected = true;
            model.marks.push({ kind: "circle", x: x(i), y: y(v), radius: 3, colour });
          } else {
            const band = 400 / data.labels.length;
            const thickness = (band * 0.8) / data.series.length;
            if (spec.type === "column")
              model.marks.push({
                kind: "rect",
                x: x(i) - band * 0.4 + s * thickness,
                y: Math.min(baseline, y(v)),
                width: thickness,
                height: Math.abs(y(v) - baseline),
                colour,
              });
            else {
              const zero = 50 + ratio(0) * 400;
              const end = 50 + ratio(v) * 400;
              model.marks.push({
                kind: "rect",
                x: Math.min(zero, end),
                y: 30 + ((i + (s + 0.1) / data.series.length) * 200) / data.labels.length,
                width: Math.abs(end - zero),
                height: 160 / data.labels.length / data.series.length,
                colour,
              });
            }
          }
        });
        if (path)
          model.marks.push({ kind: "path", d: path.trim(), fill: false, colour: seriesColour(s) });
      });
    }
  }
  model.empty = model.marks.length === 0;
  return model;
}
