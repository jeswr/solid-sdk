// AUTHORED-BY Codex GPT-6.1-Sol
export type XValue = number | Date | string;
export interface Point {
  x: XValue;
  y: number;
  label?: string;
}
export interface Series {
  id: string;
  label: string;
  points: readonly Point[];
}
export interface ChartBase {
  title: string;
  description?: string;
  height?: number;
  className?: string;
  showTitle?: boolean;
}
export interface LineChartProps extends ChartBase {
  series: readonly Series[];
  unit: string;
  yDomain?: [number, number];
  formatX?: (t: number) => string;
  formatY?: (v: number) => string;
  band?: { from: number; to: number; label: string };
  events?: readonly { x: XValue; label: string }[];
}
export interface BarChartProps extends ChartBase {
  data: readonly { id: string; label: string; value: number }[];
  unit: string;
  orientation?: "vertical" | "horizontal";
  formatY?: (v: number) => string;
}
export interface ScatterChartProps extends ChartBase {
  points: readonly { id: string; x: number; y: number; label?: string }[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  trend?: boolean;
}
export interface TimelineChartProps extends ChartBase {
  formatX?: (t: number) => string;
  lanes: readonly {
    id: string;
    label: string;
    items: readonly {
      id: string;
      start: XValue;
      end?: XValue;
      label: string;
      tone?: "neutral" | "active" | "past";
    }[];
  }[];
  range?: [XValue, XValue];
  now?: XValue;
}
export interface SparklineProps {
  values: readonly number[];
  label: string;
}
export interface StatTileProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; good?: boolean };
  sparkline?: readonly number[];
  footnote?: string;
}
export interface LegendProps {
  series: readonly Pick<Series, "id" | "label">[];
}
