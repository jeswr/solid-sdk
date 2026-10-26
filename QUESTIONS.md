<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L2 (sst-u974)

1. `10-pure-libraries-2.md` and task CAL-L2 specify behaviour but no public API or date-value
   contract. Options: implement a complete ICS reader/all-day model, or expose the requested
   timed recurrence core. Conservative reading implemented: a local `YYYY-MM-DDTHH:mm:ss`
   DTSTART plus an explicit IANA zone, fixed elapsed duration, numeric UTC window, a single
   RRULE string, and local/UTC EXDATE/RDATE arrays. Date-only, floating, period-valued RDATE,
   leap-second and unknown inputs are rejected with a typed error. An ICS adapter/all-day
   recurrence is outside this lane.
2. `07-parity-backlog.md` Calendar mentions the `rrule` library; the newer CAL-L2 brief and
   `10-pure-libraries-2.md` permit a handwritten subset and require Intl zone semantics.
   Options: add a dependency, or implement only the named subset. Conservative reading:
   implement the subset without dependencies; enforce hard output and work limits by throwing,
   never returning a silently truncated recurrence set.
