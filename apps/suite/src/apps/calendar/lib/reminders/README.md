<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Reminder scheduling

Pure TypeScript; import from `./reminders/index`. No timers, notifications, storage, RDF,
React or ambient clock. Times are integer epoch milliseconds within the JavaScript Date
range. Supply a `Clock` function; every operation samples it exactly once.

`ReminderEvent` represents one pre-expanded occurrence, with stable `id` and `occurrenceId`,
resolved `start`, optional `end` (inclusive equality is allowed), and reminders with stable
IDs unique within the occurrence. The caller resolves recurrence, time zones and all-day
dates before calling. Relative triggers are `{kind: "relative", offset: "-PT15M"}`,
optionally `related: "start" | "end"` (start by default). End-relative reminders require an
end. Absolute triggers are `{kind: "absolute", at: epochMilliseconds}`.

`parseTriggerOffset` accepts signed `PT` durations containing hours, minutes and/or seconds,
including up to three fractional second digits. Units are fixed elapsed time; use `-PT24H`
only when exactly 24 hours is intended. Calendar day/week/month/year durations need
timezone-aware resolution and are rejected. Raw ICS date-times, alarm repetition and
unknown fields are also rejected. Adapt ICS/RDF alarms to this contract outside the library.

- `dueReminders(events, {from?, to}, state, clock)` returns due reminders in `[from, to)`,
  sorted by effective due time then tuple key in code-unit order. `from` defaults to now.
  An explicit lookback includes overdue work. Empty windows are valid. It validates all
  inputs, including reminders outside the window and those already dismissed/delivered.
- `nextWakeup(events, state, clock)` returns the earliest pending instant, now if overdue,
  or `null` if none. This considers the supplied occurrences only, without a window limit.
  Recompute when occurrences or state change. The caller manages timers and any timer cap.
- `createReminderState()` creates an empty Map. `reminderKey(eventId, occurrenceId, reminderId)`
  encodes a JSON tuple without delimiter collisions. `reminderReducer(state, action, clock)`
  returns a fresh Map; inputs are never mutated. Actions are `snooze` (`key`, future `until`),
  `dismiss` (`key`), and `deliver` (`key`, returned `revision`). Dismissal is terminal and
  idempotent; delivered reminders can be snoozed again. Snooze replaces the effective due
  time and increments the revision, so an old delivery acknowledgement cannot consume it.
  Only acknowledge work actually delivered. Scanning alone never consumes reminders.

Reuse the returned state across overlapping windows to deduplicate deliveries. State is
per account and alarm occurrence; persist and prune it in the caller. A delivered/dismissed
identity stays suppressed even if its trigger changes. New occurrences use new IDs.
Independent alarm IDs at the same instant remain separate deliveries.

```ts
const clock = () => Date.parse("2026-10-26T09:45:00Z");
const events = [{
  id: "https://example.org/calendar/meeting",
  occurrenceId: "2026-10-26",
  start: Date.parse("2026-10-26T10:00:00Z"),
  reminders: [{id: "notice", trigger: {kind: "relative", offset: "-PT15M"}}],
}] satisfies ReminderEvent[];
let state = createReminderState();
for (const due of dueReminders(events, {to: clock() + 60_000}, state, clock)) {
  // Caller delivers the notification, then acknowledges its revision.
  state = reminderReducer(state, {type: "deliver", key: due.key, revision: due.revision}, clock);
}
const wakeAt = nextWakeup(events, state, clock); // null
```

Invalid/unsupported input throws `ReminderError` with a typed `code`; messages contain no
input values. See `QUESTIONS.md` for the conservative interpretations of the brief.
