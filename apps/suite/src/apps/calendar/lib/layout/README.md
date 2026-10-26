<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar layout geometry

Import from `./layout/index`. These pure functions return fresh geometry; they never mutate
inputs and have no React, RDF, network, locale or host-timezone dependency.

- `monthGrid(year, month, weekStartsOn)` returns six arrays of seven cells, including adjacent
  months. Month is 1–12; week start is 0 (Sunday) through 6 (Saturday). Each cell contains a
  `YYYY-MM-DD` date, day number, `inMonth`, and zero-based row/column.
- `layoutMonthEvents(events, year, month, weekStartsOn)` returns six `BarRow`s covering the
  same grid. Date events have `{ id, startDate, endDate }`, with an **exclusive** end date.
  Bars are clipped/split at row boundaries. Each bar has a lane, column/span, left/width
  fractions of its row, and continuation flags. Each row reports its `laneCount`.
- `layoutAllDayEvents(events, startDate, dayCount)` returns one `BarRow` for 1–7 days.
- `layoutTimeGrid(events, dayCount)` packs `{ id, day, startMinute, endMinute }` intervals
  for 1–7 display days. Day is a zero-based display index. Minutes are finite, fractional,
  and in `[0, 1440]`, with `startMinute < endMinute`. Placements retain those inputs and add
  column/columnCount, left/width fractions **within the day**, and top/height fractions of
  1440 minutes. Heights that underflow to zero are rejected.

All intervals are half-open: touching endpoints share a lane/column. Events sort by start,
descending end (longest first for equal starts), then id in code-unit order. Timed events
sort by day first. First-fit lanes restart per week row; timed widths are equal across each
connected overlap cluster and reset for the next cluster. Columns do not expand into gaps.
Empty rows have zero lanes. Events outside the visible date range are validated then omitted.

Dates must be real Gregorian dates in years 0001–9999; grids extending outside that range
are rejected. IDs must be nonblank strings, unique per call (use occurrence/segment IDs when
splitting an event). `CalendarLayoutError` extends `Error` and exposes a `code` union:
`invalid-date`, `invalid-range`, or `invalid-event`. Invalid values are never echoed in errors.

Callers expand recurrence, choose a timezone, project to display-day/minute coordinates and
split overnight timed events before layout. A DST gap or repeated hour cannot be inferred
from minute coordinates; the caller supplies its resolved display projection. This library
performs Gregorian date arithmetic only, using UTC internally to avoid host DST effects.

```ts
const weeks = monthGrid(2026, 10, 1);
const bars = layoutMonthEvents([
  { id: "https://example.org/calendar/trip", startDate: "2026-10-02", endDate: "2026-10-06" },
], 2026, 10, 1);
const slots = layoutTimeGrid([
  { id: "https://example.org/calendar/meeting", day: 0, startMinute: 540, endMinute: 600 },
], 7);
```
