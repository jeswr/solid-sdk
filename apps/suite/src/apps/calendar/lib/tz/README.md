<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Calendar time and series edit helpers

Pure TypeScript, using the runtime's Intl/IANA database. No I/O or dependencies.
Import from `./index`. Errors are `CalendarTimeError` with stable `code` values;
messages exclude caller data.

`wallClockToInstant("2024-11-03T01:30:00", "America/New_York", "later")`
returns epoch milliseconds. Gaps always throw `nonexistent-time`. An overlap without
an explicit `earlier`/`later` choice throws `ambiguous-time`.
`instantToWallClock(instant, zone)` returns `{ wallTime, offsetMinutes }`.
`secondaryZoneDisplay(instant, primaryZone, secondaryZone)` also returns the primary
clock, signed offset difference, and calendar-day difference (which can be ±2).
Offsets are local minus UTC; all calculations use the supplied instant, including DST.

The supported subset is Gregorian years 2000–2099, whole seconds, wall strings exactly
`YYYY-MM-DDTHH:mm:ss`, and named zones recognised by Intl (including UTC and IANA aliases).
Both the wall time and instant must lie within that range. The inverse exhaustively
matches all minute offsets within ±14 hours, covering modern IANA offsets without
assuming the size of DST changes. Historic dates, leap seconds, fractional seconds,
floating/default zones and numeric offset zone identifiers are rejected. Results depend
on the installed runtime's timezone database; there is no bundled database or cache.

`planSeriesEdit(series, scope, selectedOriginalInstant, completeReplacement)` returns
`{ original, create }`. A non-null `original` replaces the original timing record;
null removes it. A non-null `create` is a new record. IDs are caller-supplied, nonblank
opaque strings. Metadata remains the caller's responsibility. The plan owns its exception
arrays and does not mutate inputs.

- `this-event`: add the **original** selected instant to EXDATE; create the supplied
  nonrecurring replacement with a distinct ID, even if its time moves.
- `this-and-following`: truncate the original RRULE to UTC UNTIL one second before the
  selected instant; remove COUNT; retain only earlier EXDATEs; create the supplied
  recurring replacement with a distinct ID. Splitting at DTSTART removes the original.
- `all-events`: replace the complete timing record with the same ID, including its
  explicit rule and exceptions. The replacement can also remove recurrence.

The planner accepts bare, uppercase RRULE values containing FREQ=DAILY or FREQ=WEEKLY,
optional INTERVAL, and either COUNT or UTC `UNTIL=YYYYMMDDTHHmmssZ`. Positive integers
are canonical decimal values at most 36600. No prefix, BY clauses, RDATE, all-day dates,
monthly/yearly rules, multiple RRULEs or recurrence overrides are supported. The caller
must resolve existing overrides before planning. Unsupported rules fail closed.

Selected instants and EXDATEs must be actual members of the original rule, with the
series' explicit overlap choice. EXDATEs do not reduce COUNT. Rule membership uses
Gregorian wall time, so 09:00 remains 09:00 across DST. COUNT membership that encounters
an intervening gap is rejected with `nonexistent-time`; it is never silently miscounted.
Shared COUNT prefixes are checked once per series, with converted wall times reused
across exceptions and the selection. Each plan permits at most 128 exhaustive inverse
timezone conversions in total across the original series, replacement and selection,
including rules without COUNT. Plans exceeding this work limit fail closed with
`invalid-series`; the budget and caches are local to each call.
UNTIL is inclusive; COUNT and UNTIL cannot coexist, per
[RFC 5545 §3.3.10](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.10).

Replacement rules, starts, durations and EXDATEs are **complete explicit inputs**.
In particular a following edit does not invent a remaining COUNT, copy future exceptions
or shift exceptions onto moved dates. Supply those in the replacement. This deliberately
avoids guessing the meaning of changing a series' schedule; see root QUESTIONS.md.
