<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Health statistics

Pure TypeScript; import the public functions and types from `./index`. No SDK, RDF,
React, clock, storage, or network access. All readings in one series must describe the
same metric and use the same unit. Normalise with `convertUnit` before aggregation.

```ts
import { aggregateObservations, convertUnit, detectGaps, movingAverage } from "./index";

const options = { period: "day", timeZone: "America/New_York" } as const;
const observations = [
  { timestamp: Date.parse("2024-03-10T06:00:00Z"), value: convertUnit(150, "lb", "kg") },
  { timestamp: Date.parse("2024-03-12T06:00:00Z"), value: 68 },
];
const buckets = aggregateObservations(observations, options, "mean");
const missingDates = detectGaps(observations, options, { start: "2024-03-10", end: "2024-03-12" });
const trend = movingAverage([buckets[0]!.value, null, buckets[1]!.value], 2);
// missingDates: ["2024-03-11"]. trend: [null, null, null].
```

- `convertUnit(value, from, to)` supports kg/lb, km/mi, kcal/kJ (thermochemical kcal),
  and glucose mmol/L↔mg/dL (conventional approximate factor 18). Unit names are case-sensitive.
  Cross-dimension conversions and unknown units throw `RangeError`. No display rounding.
- `bucketKey(timestamp, options)` returns the Gregorian local start date of a day, Monday
  week, or calendar month. Timestamps are integer Unix milliseconds; timezone is explicit.
  Local years 0001–9999 are supported. A label is **not a UTC instant**: a local day may
  last 23, 24, 25, or another number of hours. Calendar arithmetic never adds elapsed
  24-hour durations to an observation's timestamp.
- `aggregateObservations(readings, options, method)` returns occupied buckets sorted by
  `key`, each with `value` and `count`. Methods: sum, arithmetic mean, min, max, last.
  `last` selects the latest timestamp; the later input wins ties. Empty input yields `[]`.
  Readings are point samples, never interval-split, deduplicated, or duration-weighted.
- `detectGaps(readings, options, { start, end })` returns missing bucket keys intersecting
  the inclusive range of local `YYYY-MM-DD` dates, including leading/trailing gaps.
  Partial weeks/months count as whole buckets: any reading in that bucket occupies it,
  even outside the date range. A civil date skipped by a timezone's date-line change
  counts as a missing calendar date. No reading values are imputed.
- `movingAverage(values, window)` returns a trailing, sample-based average at each input
  position. Window must be a positive safe integer. Incomplete windows and windows
  containing null return null. It resumes after a full non-null window. For a calendar
  average, align bucket values first and supply null at missing buckets.

Inputs are never mutated. Invalid dates, unsupported periods/timezones, non-finite
measurements, and arithmetic overflow throw `RangeError`. Zero and negative values are
accepted; clinical validation and medical interpretation belong to callers. Calculations
use IEEE-754 numbers, so consumers should compare fractional results with a tolerance.

`pnpm --filter @jeswr/app-suite run test` enforces 100% coverage per TypeScript file in
this directory (lines, statements, functions, branches). Tests live in
`apps/suite/test/health-stats.test.ts` and import through the public barrel.
