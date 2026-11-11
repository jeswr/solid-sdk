<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-charts

Shared, accessible SVG charts for Solid Suite: Health, knowledge graphs, Insights,
Money, Music and Sheets. React 19 is the only runtime peer; there are no runtime
package dependencies, canvas, chart frameworks, network requests or storage reads.
Apps supply prepared observations and own domain policy and aggregation.

## Install and styles

Inside this workspace, declare `"@jeswr/suite-charts": "workspace:*"` in the consuming
app. With a published package, install `@jeswr/suite-charts` alongside React 19.
Load the existing Suite token and theme styles before the chart stylesheet:

```tsx
import "@jeswr/suite-ui/styles/tokens.css";
import "@jeswr/suite-ui/styles/theme.css";
import "@jeswr/suite-charts/styles.css";
import { LineChart, BarChart, ScatterChart, TimelineChart, Sparkline, StatTile } from "@jeswr/suite-charts";
```

Both light and `.dark` themes use the host's suite-ui tokens. No style import is
implicit. The CSS export and every component class use the `sc-` prefix. Import
framework-free helpers from `@jeswr/suite-charts/scale`; that entry has no React
imports, including transitive imports.

## Types and common props

```ts
export type XValue = number | Date | string; // ISO 8601 date or date-time
export interface Point { x: XValue; y: number; label?: string }
export interface Series { id: string; label: string; points: readonly Point[] }
export interface ChartBase {
  title: string;
  description?: string;
  height?: number; // SVG height, defaults to 280; minimum 160
  className?: string;
  showTitle?: boolean; // defaults to true
}
```

LineChart, BarChart, ScatterChart and TimelineChart extend `ChartBase`. Each renders
an accessible figure named by `title`, an optional visible heading, a caption,
and a “Show table” / “Show chart” toggle. Tables retain every supplied observation,
including values excluded from plotting and timeline items outside the visible range.
Use stable, unique series, lane and item IDs. Arrays are readonly and never mutated.

### LineChart

```ts
interface LineChartProps extends ChartBase {
  series: readonly Series[];
  unit: string;
  yDomain?: [number, number];
  formatX?: (t: number) => string;
  formatY?: (v: number) => string;
  band?: { from: number; to: number; label: string };
  events?: readonly { x: XValue; label: string }[];
}
```

```tsx
<LineChart
  title="Resting pulse"
  description="Morning readings, in UTC."
  unit="bpm"
  series={[{ id: "pulse", label: "Pulse", points: [
    { x: "2026-11-01", y: 65 }, { x: "2026-11-02", y: 63 },
  ] }]}
  band={{ from: 60, to: 80, label: "Reference range" }}
  events={[{ x: "2026-11-02", label: "Started medication" }]}
/>
```

The first point determines numeric (`number`) or time (`Date` / ISO string) mode.
Mixed modes, including mismatched event x values, throw `TypeError`. Date objects
and ISO strings may be combined. For timestamp numbers displayed as time, wrap them
in `Date`. The default time formatting uses UTC. `formatX` receives a numeric x or
an epoch millisecond value. There is exactly one y axis and one unit. Bands are
recessive; events have dashed vertical markers. Pointer movement snaps a vertical
crosshair to the nearest observed x. Points are sorted by x within their series.

### BarChart

```ts
interface BarChartProps extends ChartBase {
  data: readonly { id: string; label: string; value: number }[];
  unit: string;
  orientation?: "vertical" | "horizontal"; // default vertical
  formatY?: (v: number) => string;
}
```

```tsx
<BarChart title="Net cash flow" unit="GBP" orientation="horizontal"
  data={[{ id: "oct", label: "October", value: 240 },
         { id: "nov", label: "November", value: -80 }]} />
```

Bars start at zero, with negatives extending below or to the left of the baseline.
Categories share the first colour slot. Labels remain available in full through
point tooltips and the table when axis labels are shortened.

### ScatterChart

```ts
interface ScatterChartProps extends ChartBase {
  points: readonly { id: string; x: number; y: number; label?: string }[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  trend?: boolean; // default false
}
```

```tsx
<ScatterChart title="Sleep and energy" xLabel="Sleep" xUnit="h" yLabel="Energy"
  points={[{ id: "mon", x: 7, y: 6, label: "Monday" },
           { id: "tue", x: 8, y: 8 }, { id: "wed", x: 6, y: 5 }]}
  trend />
```

With `trend`, the caption states `r = 0.xx (n = N)` and the plot shows a
least-squares line. Fewer than three finite observations, or zero variance on either
axis, gives “Not enough data for a trend” and no line. A correlation describes an
association; the consuming app supplies any interpretation.

### TimelineChart

```ts
interface TimelineChartProps extends ChartBase {
  lanes: readonly {
    id: string; label: string;
    items: readonly {
      id: string; start: XValue; end?: XValue; label: string;
      tone?: "neutral" | "active" | "past";
    }[];
  }[];
  range?: [XValue, XValue];
  now?: XValue;
}
```

```tsx
<TimelineChart title="Treatment history" now="2026-11-11"
  lanes={[{ id: "treatment", label: "Treatment", items: [
    { id: "course", start: "2026-11-01", label: "Current course", tone: "active" },
    { id: "visit", start: "2026-11-05", label: "Review visit" },
    { id: "previous", start: "2026-10-01", end: "2026-10-20", label: "Previous course", tone: "past" },
  ] }]} />
```

Intervals use rounded bars. An active item without an end extends to `now` with an
open right edge; other items without an end are diamonds. Omitted `now` is frozen
at mount; inject it for deterministic rendering or update the prop to advance it.
Labels sit to the left at widths of at least 480px and above each lane below 480px.
The chart grows vertically when needed for many lanes. `range` limits the visible
window; the table preserves the full history. Reversed or nonfinite item intervals
are counted as unplottable. A reversed range throws `RangeError`.

### Sparkline

```tsx
<Sparkline label="Resting pulse over the past week" values={[68, 66, 67, 64]} />
```

Props: `{ values: readonly number[]; label: string }`. This compact standalone
`role="img"` describes the first and last finite values, minimum and maximum in its
accessible name; empty input says “No data yet”. It has no interactive point controls.

### StatTile

```tsx
<StatTile label="Resting pulse" value={64} unit="bpm"
  delta={{ value: "2 bpm", direction: "down", good: true }}
  sparkline={[68, 66, 67, 64]} footnote="Compared with last week" />
```

```ts
interface StatTileProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; good?: boolean };
  sparkline?: readonly number[];
  footnote?: string;
}
```

The delta combines an inline SVG arrow (or a horizontal mark for `flat`) with
“Up”, “Down” or “No change” text and the supplied delta value. `good` controls an
optional semantic tone; it never supplies the only indication of direction.

### Legend

`<Legend series={series} />` accepts readonly `{ id: string; label: string }[]`.
It renders only for two to five series. LineChart includes it automatically.
Each item combines a coloured line swatch, its dash pattern and a text label.

## Framework-free helpers

```ts
linearScale(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number;
timeScale(domain: readonly [XValue, XValue], range: readonly [number, number]): (value: XValue) => number;
niceTicks(min: number, max: number, count?: number): number[];
toTime(x: XValue): number;
pearson(xs: readonly number[], ys: readonly number[]): number | undefined;
leastSquares(points: readonly { x: number; y: number }[]): { slope: number; intercept: number } | undefined;
```

Scales are unclamped; equal domain endpoints map to the range midpoint. Bounds
must be finite. `niceTicks` defaults to about five ticks, returns `[min]` for a
constant domain or count of one, and `[]` for a count below one. Counts are bounded
to keep tick generation finite. Descending domains return descending ticks.
`toTime` reads date-only ISO strings as UTC midnight and date-times without an
offset as UTC. Invalid strings and invalid Date objects throw `TypeError`; numbers
pass through so consumers can explicitly filter NaN/Infinity.

`pearson` requires at least three observations and nonzero variance on both axes;
length mismatch throws `RangeError`. `leastSquares` requires at least two points
and nonzero x variance. Both return `undefined` for nonfinite observations or an
unrepresentable result. Charts filter nonfinite points before calling them.

## Accessibility, responsiveness and colour

- Full charts expose a named figure, caption and accessible data table. Hiding the
  heading with `showTitle={false}` preserves the figure's accessible name.
- Plotted observations have one roving tab stop per chart. Arrow keys wrap between
  observations; Home/End move to the first/last point. Focus, hover or a tap exposes
  an HTML tooltip over the SVG. Escape dismisses it; Enter/Space reveals it again.
- Lines are 2px wide, point marks have at least an 8px diameter, and invisible
  radius-12 hit circles make points easier to target. Axis and legend text uses
  neutral foreground tokens, never series colours.
- Series position selects `--chart-1` through `--chart-5`, independently of values
  or rank. Every additional line has a distinct dash pattern. More than five
  series throws `RangeError` asking the caller to fold the rest into “Other”.
- ResizeObserver measures the containing width, with a 640px SSR/jsdom fallback.
  Full-chart SVGs use measured pixel dimensions without a viewBox, keeping labels
  at screen pixel size at widths down to 320px. No browser globals are read during
  render. Sparklines have a viewBox but contain no visible text to shrink.
- Empty input preserves the frame and says “No data yet”. Nonfinite points are
  skipped, with a caption such as “2 values could not be plotted”. Invalid ISO
  syntax throws instead of silently interpreting a locale-specific date.
- All styling uses suite-ui tokens; forced-colour mode uses CanvasText/Highlight
  system colours. Reduced motion disables transitions and animation.

## Development

```sh
export PATH=/opt/node24/bin:$PATH
pnpm exec turbo run lint build typecheck test --filter=@jeswr/suite-charts
pnpm run lint:root
```

`tsc` emits ESM and declarations; the build copies `styles.css` into `dist`.
Source and tests carry provenance markers. No generated `dist` is committed.
