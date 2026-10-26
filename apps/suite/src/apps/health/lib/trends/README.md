<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Health goals and trends

Import from `./index`. Pure TypeScript, with no React, SDK, storage, network, or ambient clock.
Each `HealthSeries` describes one person's single metric: `steps` (whole steps), `sleepMinutes`
or `activeMinutes` (fractional minutes allowed), an explicit time zone, and `totals` containing
`{ timestamp, value }`. Timestamps are integer Unix milliseconds identifying the total's local
Gregorian date; local years 0001–9999 are supported. Source normalization, deduplication and
sleep/workout interval attribution happen before this library. It never sums or replaces
multiple totals for the same local day: those inputs throw `HealthTrendsError`.

```ts
import { dailyGoalProgress, classifyTrend, personalBests, rollingAverages } from "./index";

const history = {
  metric: "steps",
  timeZone: "America/New_York",
  totals: [
    { timestamp: Date.parse("2024-03-09T17:00:00Z"), value: 6000 },
    { timestamp: Date.parse("2024-03-10T16:00:00Z"), value: 8000 },
  ],
} as const;
dailyGoalProgress(history, 6000, { clock: () => Date.parse("2024-03-11T04:00:00Z") });
// Today is March 11: value/ratio null, achieved false, current/longest streak 2.
classifyTrend(history, 100); // { classification: "up", slope: 2000, count: 2 }
personalBests(history); // Both days are successive record highs, with local date labels.
rollingAverages(history, { start: "2024-03-09", end: "2024-03-11" });
// One row per local calendar day; missing March 11 is null. Both averages are null.
```

- `dailyGoalProgress(series, target, { clock })`: the positive target uses the series unit and
  applies to all supplied history. Samples after the injected instant throw, including future
  samples on the same local day. The clock is read once. `ratio` is an uncapped fraction,
  `achieved` means value ≥ target, and missing today has null value/ratio. The current streak
  ends today when achieved, otherwise yesterday, allowing today to remain unfinished. Missing
  or below-target completed days break streaks. Longest streak covers only supplied history.
- `rollingAverages(series, { start, end })`: inclusive local date labels, one row per day with
  `value`, `average7` and `average30`. Each trailing calendar window must have every day's total;
  gaps/incomplete windows yield null. History before `start` can fill windows; data after `end`
  cannot. Missing dates are never imputed as zero. A civil date skipped by a date-line change
  counts as a gap. DST days still count as one day, irrespective of their elapsed length.
- `classifyTrend(series, threshold)`: ordinary least-squares slope in metric units per civil
  day. Observed dates retain their actual spacing through gaps. The explicit threshold is an
  absolute nonnegative finite number: slope > threshold → up, slope < −threshold → down,
  equality → flat. Empty/single-day history has null slope/classification. This is a numeric
  direction with no clinical or statistical-significance claim.
- `personalBests(series)`: chronological record highs, including the first observed day as the
  baseline. Equal values do not establish another record. Empty history returns an empty array.
  All three supported metrics use higher totals as the numeric record, without health advice.

All functions sort copies and validate all supplied totals, including observations outside an
output date range. Totals must be finite, nonnegative and ≤ `Number.MAX_SAFE_INTEGER`; steps
must also be integers. Inputs with malformed shapes, dates, metrics, zones, timestamps, negative
values, or duplicate local days are rejected. Errors use `HealthTrendsError` with codes
`invalid-input`, `duplicate-day`, `invalid-clock`, `future-observation`, or `arithmetic-overflow`.
No input values are included in errors. Calculations use IEEE-754 numbers; compare fractional
outputs with tolerance. Coverage of every TypeScript file is enforced at 100% by app Vitest.
