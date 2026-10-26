<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Tasks smart lists

Pure projections and completion plans for Tasks (06-tasks §2.3–2.7, §4.3,
§4.6, §5.4–5.5). Import from `./index`. No storage, RDF, React or ambient clock.

`ListTask` is a projection: adapters map model state, P1–P4, SH-L1 order keys,
all-day `sched:dueTime` and timed `wf:dateDue`. All-day values are strict
`YYYY-MM-DD`; timed values are UTC ISO strings with seconds and optional three
millisecond digits. Instants and local dates must be within 1970–9999.
Runtime failures use `TaskListError.code`; rule/date objects reject unknown fields.
Task metadata may be added through `T extends ListTask` and is preserved by completion.
Adapters must shift absolute reminder timestamps separately using the old/new due delta;
reminders, serialization and conditional persistence are outside this projection.

- `filterSmartList(tasks, list, {clock, timeZone})` returns a fresh array in input
  order. Today includes overdue, Upcoming is today through day six, Overdue uses
  instant comparison for timed tasks and previous calendar dates for all-day tasks.
  All lists except Completed contain only open tasks. The clock is read once.
- `compareDue(timeZone)`, `comparePriority`, `compareManualOrder` work with
  `Array.toSorted`. Equal values compare equal. Missing dates/keys sort last;
  absent priority is P4. Due sorts local date, then all-day before timed, then
  instant. Keys follow SH-L1's base-62 format and ordinary lexical comparison.
- `nextOccurrence(due, rule, context)` advances one occurrence, or returns
  `undefined` on count/until exhaustion. `completeTask(task, options)` uses it to
  return an open original at the next due plus a closed history copy (without
  recurrence, with `derivedFrom`). Supply a distinct `occurrenceId` when a copy
  is needed. Other completions close the original. An advancing clock is captured
  once. Retain the original snapshot for undo and apply both writes conditionally.
- `rollUpSubtasks(tasks)` returns progress for every ID without changing states.
  Supply a complete one-level snapshot before filtering. Missing parents,
  duplicates, cycles and deeper nesting fail closed.

Rules support DAILY, WEEKLY with optional unique MO…SU `byDay`, MONTHLY with
optional positive 1…31 `byMonthDay`, and YEARLY; interval defaults to 1 and `from`
to `due`. `from: 'completion'` anchors on completion's local date and wall time
(all-day stays all-day). Weekly intervals use Monday-based weeks and include later
selected weekdays in the active week. Monthly/yearly advance interval periods,
skipping invalid dates without clamping or changing interval phase. No due uses
the completion instant. Due-based completion advances one instance even when late.
`count` includes the current occurrence and requires `completedOccurrences` (number
of existing closed copies); `until` is inclusive and must have the same date kind.
Count and until are mutually exclusive. Unsupported fields (including exceptions,
ordinal weekdays, negative month days) throw. DST gaps/folds throw instead of
choosing an offset; valid timed recurrences preserve wall time rather than adding
24 elapsed hours. No dependencies were added.
