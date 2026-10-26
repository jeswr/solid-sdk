<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L5 conservative interpretations

1. **Window and delivery policy** (11-pure-libraries-3; CAL-L5 task description): should
   windows include both endpoints, or be half-open? Should scanning consume reminders?
   Chosen: `[from, to)`, defaulting `from` to one injected-clock snapshot. Scans are pure;
   callers acknowledge deliveries with the reducer and reuse that state across windows.
   Overdue reminders inside an explicit lookback window are returned; next wakeup is now
   when an unacknowledged reminder is overdue.
2. **Temporal input scope** (07-parity-backlog, Calendar data mapping; CAL-L5): should this
   library expand recurrence, resolve all-day dates/time zones, or parse whole ICS alarms?
   Chosen: accept pre-expanded occurrences with stable occurrence IDs and resolved epoch
   milliseconds. Relative triggers support signed `PT` hours/minutes/seconds durations
   (millisecond precision), relative to start by default or explicitly end. Absolute
   triggers take epoch milliseconds. Nominal day/week/month/year durations, floating/date
   values, repetitions and unknown fields are rejected rather than assigned time-zone or
   recurrence semantics. Callers must resolve those inputs before scheduling.
3. **Snooze/dismiss identity** (02-suite-shell §7; CAL-L5): should dismiss affect an entire
   series or just one alarm occurrence? Chosen: one event/occurrence/reminder tuple;
   dismissal is terminal, delivery can be snoozed again, snooze must be strictly future.
   Revisions fence stale delivery acknowledgements. Editing an already delivered trigger
   under the same identity does not deliver it again; a distinct occurrence/alarm ID is
   required for a new reminder. Persistent storage and pruning belong to the caller.
