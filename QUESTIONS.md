<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-858y — conservative interpretations

1. **DST gaps and overlaps** — 13-pure-libraries-5.md requires fail-closed pure
   libraries; HLT-L5 requires DST-safe generation but supplies no disambiguation
   policy. Options: move/omit a nonexistent time, choose an overlap occurrence, or
   reject. This lane rejects nonexistent and ambiguous times on eligible local
   dates in a conservative envelope (UTC endpoints expanded by ±14 hours),
   including slots and adjacent dates outside the instant window. This ensures
   midnight rollbacks cannot hide a briefly visited date between the endpoints.
   It reuses the calendar time-zone core's documented 2000–2099, whole-second
   instant support. Windows are half-open, limited to 366 elapsed days and 1024
   local-time conversions; unsupported input raises a typed medication error.
2. **Late and adherence** — HLT-L5 and 07-parity-backlog.md §Health give no late
   tolerance or percentage formula. Options: invent a grace interval, require a
   clinician-configured interval, or compare directly with the due instant. This
   lane uses the due instant: taken later is `late`, taken at/before is `taken`.
   Both count toward adherence; a separate on-time percentage excludes late.
   Each period uses doses due by an explicit `asOf` instant; unlogged doses count
   as missed, future doses are excluded, and zero expected doses yields `null`
   percentages. Logs after `asOf` are ignored for retrospective calculations.
3. **Interval and as-needed semantics** — HLT-L5 lists schedule kinds without
   further constraints. Options: elapsed 24-hour intervals or local calendar days;
   prescribed or unprescribed expectations for as-needed medication. This lane
   anchors every-N-days to the inclusive schedule start date in local calendar
   days, uses ISO weekdays (Monday=1), and makes the optional end date inclusive.
   Times per day are explicit unique `HH:mm` slots, never inferred spacing.
   As-needed schedules generate no expected doses; taken events can be logged,
   while skips and scheduled-dose references are rejected.
