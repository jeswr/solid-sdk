<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L8 conservative readings

1. **DST overlaps** (tasks.json CAL-L8; 14-pure-libraries-6): the task specifies gaps but
   no overlap tie-break. Options are earlier, later, retaining the original offset, or
   rejection. Retain the moving edge's original offset when it identifies a candidate;
   otherwise reject with `AMBIGUOUS_TIME` unless the caller supplies `overlap: "earlier"`
   or `"later"`.
2. **All-day gestures** (CAL-L8): options are dropping partial minutes or rejecting them,
   and mapping the start handle to the end or rejecting it. Require minute deltas to be
   whole multiples of 1,440 and support `move` / `resize-end`; reject `resize-start`.
   Preserve the calendar-day span for all-day moves, including 23/25-hour days; exact
   elapsed duration preservation applies to timed moves.
   Reject an all-day move when a skipped exclusive end date makes that span impossible.
3. **Snap versus minimum duration** (CAL-L8): when the stationary edge is off-grid,
   clamping exactly one step away would leave the moving edge off-grid. Clamp outward
   to a wall-clock grid boundary that leaves at least one elapsed snap step. DST gap
   adjustment takes precedence over grid alignment when the first valid instant is
   off-grid.
4. **Series offsets and supported dates** (CAL-L8): return both elapsed millisecond
   changes and wall-clock minute changes for each edge, alongside the requested scope
   (default `this`). Consumers choose the appropriate representation; no RRULE is read
   or edited. Support integer epoch milliseconds with Gregorian local and UTC years
   0001–9999, rejecting out-of-range input/output with `INVALID_RANGE`. Days are signed
   integers bounded by absolute value, and the two delta limits apply independently.
