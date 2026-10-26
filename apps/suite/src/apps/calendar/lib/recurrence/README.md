<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar recurrence and free/busy

Import from `./recurrence/index`. Pure TypeScript: no React, RDF, I/O, dependencies, or host
timezone interpretation. Zone conversion uses the runtime's Intl IANA timezone data.

```ts
const busy = expandRecurrence({
  start: "2026-03-01T09:00:00", // local wall time in the named zone
  timeZone: "America/New_York",
  durationMs: 3_600_000,
  rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=3",
  exdates: ["2026-03-08T09:00:00"],
  rdates: ["2026-03-10T13:00:00Z"],
}, {
  start: Date.parse("2026-03-01T00:00:00Z"),
  end: Date.parse("2026-04-01T00:00:00Z"),
});
const combined = mergeBusyIntervals(busy);
```

`expandRecurrence(input, window)` returns fresh `{ start, end }` intervals, sorted by start.
All numeric times are integer UTC epoch milliseconds in Gregorian years 0001–9999. Durations
are positive safe integers representing **fixed elapsed time**, as with ICS DTEND; nominal
day/week ICS DURATION values need an adapter and are not accepted. Intervals and windows are
half-open. Any occurrence overlapping the window is returned in full, including an occurrence
starting before the window; results are not clipped. Empty/reversed windows are rejected.

`start` is exactly `YYYY-MM-DDTHH:mm:ss` plus a required IANA `timeZone` (including `UTC`).
EXDATE/RDATE arrays (`exdates`/`rdates`) accept that same local format in the event's zone, or
`YYYY-MM-DDTHH:mm:ssZ` for an exact UTC instant. RDATE is independent of COUNT/UNTIL and may
precede DTSTART. Duplicates collapse by instant; EXDATE wins over every inclusion, including
DTSTART. COUNT is evaluated from DTSTART before exclusions and window filtering. Exclusions
do not cause replacement occurrences. Explicit dates are validated even outside the window.

Supported RRULE parts (case-insensitive; optional `RRULE:` prefix):

- FREQ: DAILY, WEEKLY, MONTHLY, YEARLY; INTERVAL defaults to 1.
- COUNT or inclusive UNTIL (`YYYYMMDDTHHmmssZ`, UTC required for zoned DTSTART), never both.
  COUNT and INTERVAL are positive RFC 32-bit integers. Omitting both produces a window-bounded
  expansion, still subject to the limits below.
- BYDAY: weekday lists; signed ordinals ±1…53 only for MONTHLY/YEARLY. A yearly ordinal is
  relative to the year unless BYMONTH is present, in which case it is relative to each month.
- BYMONTHDAY: ±1…31, negative values count from month end; invalid for WEEKLY.
- BYMONTH: 1…12. WKST: weekday, default MO; anchors interval weeks.

Lists union within each part and intersect between parts. Omitted date components derive
from DTSTART, following RFC expansion/limiting rules. Invalid generated dates (e.g. February
31) and generated DST gaps are skipped without consuming COUNT. Repeated local times choose
the first instant. Intl conversion round-trips candidate offsets from the surrounding four
days, covering hour, half-hour, historical second offsets, and whole-day IANA transitions.
Explicit nonexistent DTSTART/EXDATE/RDATE wall times are rejected rather than shifted.
DTSTART must match the rule, and UNTIL must not precede it: RFC 5545 leaves unsynchronized
DTSTART undefined, so this library rejects it.

`MAX_OCCURRENCES` is 10,000 distinct visible occurrences per call. `maxOccurrences` may lower
that cap but cannot raise it. Each explicit-date array is independently capped at 10,000 input
values. `MAX_SCAN_DAYS` is 366,000 calendar days examined from DTSTART, even when filtering or
the requested window produces few results. Limits **throw**, never truncate. A distant or
sparse recurrence exceeding the work bound must be handled by the caller as a typed error.

`mergeBusyIntervals(intervals)` validates, copies and sorts UTC intervals, then merges overlaps,
containment, duplicates, and touching endpoints. It accepts the expansion output directly and
can combine multiple calendars. It does not infer transparency, attendance, access rights or
free slots: callers supply only intervals that should count as busy. Empty input returns `[]`.

`RecurrenceError extends Error` exposes a `code`: `invalid-input`, `invalid-date`, `invalid-zone`,
`invalid-rule`, `unsupported-rule`, `start-mismatch`, `nonexistent-time`, or `limit-exceeded`.
Messages never echo calendar contents. Unknown input fields, unsupported rule parts (including
BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR, BYMINUTE, BYSECOND and extension parts), subdaily FREQ,
duplicate rule parts, malformed syntax and invalid combinations are rejected. This is a timed
recurrence core, not an ICS parser: date-only/all-day values, floating times, offsets in local
strings, fractional/leap seconds, multiple RRULEs, and period-valued RDATE are rejected.

Semantics reference: [RFC 5545 §3.3.10 and §3.8.5](https://www.rfc-editor.org/rfc/rfc5545).
