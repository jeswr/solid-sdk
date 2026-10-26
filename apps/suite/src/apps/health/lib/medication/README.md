<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Medication schedules and adherence

Pure synchronous TypeScript. Import the public API from `./index`. No I/O, clock,
UI, persistence, dosage advice, or inferred spacing between doses.

- `validateSchedule(schedule)` validates a daily, ISO-weekday, every-N-local-days,
  or as-needed schedule. `id` identifies this schedule revision; callers must use
  a new id when changing its timing and retain old schedules for historical logs.
  `startDate` and optional `endDate` are inclusive local `YYYY-MM-DD` dates.
  Scheduled kinds have 1–24 unique explicit `HH:mm` times in any input order.
  Weekdays are unique integers Monday=1 through Sunday=7. Intervals are positive
  safe integers anchored to `startDate` and use calendar days, including across DST.
- `generateDueDoses(schedule, { start, end }, timeZone)` returns chronologically
  ordered `{ scheduleId, scheduledAt }` records in the half-open instant window.
  That pair identifies a dose across adjacent generation windows. The caller
  supplies an IANA time zone (or `UTC`) consistently for generation and logging.
- `logDose(schedule, timeZone, logs, { scheduledAt, at, outcome })` returns a new
  log array and new records. `outcome` is `taken` or `skipped`; taking after the
  due instant records `late`, while taking at/before it records `taken`. There is
  no assumed grace period. A skip is explicit; absence of a log is never a skip.
  Duplicate scheduled outcomes are rejected, including conflicting outcomes.
  Existing records and scheduled references are validated against the schedule.
  As-needed entries use `scheduledAt: null`, permit only `taken`, and must fall
  within the schedule's local date bounds; their event instants must be unique.
- `adherenceByPeriod(schedule, timeZone, logs, periods, asOf)` returns counts and
  percentages in caller period order. Periods may overlap. Expectations are due
  instants within each period and at/before `asOf`. Logs after `asOf` are ignored.
  Early or late logs belong to the **due** period, even across midnight. Adherence
  is `(taken + late) / expected * 100`; on-time adherence is `taken / expected *
  100`. Skips and unlogged due doses remain in the denominator. Percentages are
  unrounded; both are `null` for zero expectations, including as-needed schedules.

All instants are integer Unix milliseconds at whole-second precision, in
2000–2099, matching the existing calendar time-zone core. Both window endpoints
must be in that range. Local dates must also be in 2000–2099. A window may be
empty, spans at most 366 elapsed days, and may resolve at most 1024 time slots.
Split longer periods into bounded windows and aggregate counts before computing
percentages. Generation checks every slot on eligible dates in the conservative
local-date envelope of the window (UTC endpoints expanded by ±14 hours, the
calendar core's supported offset range). This includes slots and sometimes
adjacent dates outside the instant window, so midnight rollbacks cannot hide a
briefly visited date between the endpoints. A DST gap, overlap,
or skipped local date rejects the entire call; nothing is shifted, duplicated,
or omitted to invent a dosing policy. Unsupported zones/times use the stable
`invalid-zoned-time` code. All invalid input raises `MedicationError` with a
stable `code` and a message that excludes caller data. Unexpected fields, sparse
arrays and duplicate slots/outcomes are rejected.

The interpretations left unspecified by HLT-L5 are recorded in root `QUESTIONS.md`.
