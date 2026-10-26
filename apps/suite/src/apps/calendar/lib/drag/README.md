<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar drag maths (CAL-L8)

`applyDrag(input)` is the pure shared operation for pointer, keyboard and edit-dialog
gestures. It takes integer epoch millisecond `start` / `end`, an Intl IANA `timeZone`,
`kind` (`move`, `resize-start`, `resize-end`), `deltaMinutes`, `snapMinutes`, and optional
signed integer `dayDelta`. It returns `start`, `end`, `clamped`, `dstAdjusted`, `scope`
and `seriesOffset`. Input is never mutated; the function reads no clock or host zone.

```ts
import { applyDrag } from "./index";

const result = applyDrag({
  start: Date.parse("2026-03-07T14:00:00Z"), // 09:00 New York
  end: Date.parse("2026-03-07T15:00:00Z"),
  timeZone: "America/New_York",
  kind: "move",
  deltaMinutes: 0,
  dayDelta: 1,
  snapMinutes: 15,
  scope: "following",
});
// result.start is 2026-03-08T13:00:00Z (still 09:00 after DST).
// result.seriesOffset.startMs is 82,800,000; startWallMinutes is 1,440.
```

Minutes and days are added to the moving edge's local Gregorian clock before snapping
to the nearest 5/10/15/30/60-minute boundary from local midnight; ties round toward the
later boundary, including before 1970. Fractional minutes are accepted at millisecond
precision. Timed moves preserve the exact input elapsed duration. Resizes keep the
other edge fixed and clamp outward on the grid to leave at least one elapsed snap
step. Events may cross any date boundary.

Zone inversion uses surrounding Intl offsets with round-trip checks. A gap resolves
to the transition's first valid millisecond, including half-hour and whole-date gaps,
and sets `dstAdjusted`. For overlaps, `overlap: "earlier" | "later"` selects explicitly;
when omitted, the moving edge's original offset is retained when possible, otherwise
an ambiguous target is rejected. Clamp boundaries choose earlier for a start and
later for an end so the minimum elapsed duration holds through a fold.

With `allDay: true`, inputs must identify the first instant of their local dates
(normally midnight; a midnight gap may start later). The end date is exclusive.
Minute deltas must be multiples of 1,440. Moves preserve the calendar-date span;
`resize-end` changes the exclusive end with a minimum of one local date.
`resize-start` is rejected. All-day moves across DST can be 23 or 25 elapsed hours.
A move whose exclusive end would require a skipped date is rejected with
`INVALID_RANGE` when the original calendar-date span cannot be retained.

`scope` defaults to `this` and also accepts `following` / `all`. The returned
`seriesOffset` gives actual changes after snap/clamp/DST, separately for each edge:
`startMs`, `endMs` (elapsed) and `startWallMinutes`, `endWallMinutes` (local Gregorian).
`startDayDelta` / `endDayDelta` give calendar-date offsets for all-day series, without
carrying a midnight gap's shifted hour into future occurrences.
Series consumers use the wall offsets to keep future occurrences' local clock times,
and elapsed offsets when planning an individual instance edit. No RRULE is accepted,
expanded or modified here; persistence and recurrence policy belong to the caller.

All errors are `CalendarDragError` with a stable `code`; messages contain no caller
data. The exported `MAX_DELTA_MINUTES` (525,600) and `MAX_DAY_DELTA` (366) are absolute,
independent limits, checked before Intl work. Epoch milliseconds and local wall dates
must lie within exported `MIN_EPOCH_MS` / `MAX_EPOCH_MS` (Gregorian years 0001–9999).

| Code | Cause |
| --- | --- |
| `INVALID_INPUT` | Input is not an object |
| `INVALID_DELTA` | Non-finite/wrong-type deltas, fractional days, or submillisecond minutes |
| `DELTA_TOO_LARGE` | Either signed delta exceeds its bound |
| `INVALID_SNAP` | Snap is not one of the exported `SNAP_MINUTES` |
| `INVALID_RANGE` | Invalid/out-of-range epoch, non-positive input/output, or unresolvable timing |
| `INVALID_GESTURE` | Unknown gesture or all-day start resizing |
| `INVALID_SCOPE` | Unknown recurrence edit scope |
| `INVALID_OVERLAP` | Unknown overlap choice |
| `INVALID_ALL_DAY` | Wrong flag type, partial-day delta, or non-date boundaries |
| `UNKNOWN_TIME_ZONE` | Missing, fixed-offset or Intl-rejected zone |
| `AMBIGUOUS_TIME` | Overlap without an explicit choice or matching original offset |
