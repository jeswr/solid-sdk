<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L4 questions (sst-ajqa)

1. What RRULE grammar and replacement semantics should series edits accept? The task and
   specs/apps/11-pure-libraries-3.md name edit scopes but do not define an API or exception
   migration. Options: general recurrence expansion/implicit exception shifting, or a bounded
   explicit planner. Conservative implementation: DAILY/WEEKLY with INTERVAL and COUNT or UTC
   UNTIL; reject other clauses. Callers provide complete replacement timing/rules/exceptions;
   the planner never shifts exceptions implicitly. Selected occurrences are checked against
   the original rule in its zone. First-occurrence following edits replace the original.
2. What date range and precision are required for Intl conversion? The task specifies neither.
   Options: historic second-level offsets and unbounded dates, or a documented modern subset.
   Conservative implementation: years 2000–2099, whole-second instants/wall times, minute-aligned
   IANA offsets within ±14 hours. Exhaustive candidate matching handles half-hour overlaps and
   date-line gaps as well as ordinary DST. Unsupported inputs fail with typed errors.
