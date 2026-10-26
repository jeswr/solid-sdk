// AUTHORED-BY Codex GPT-6.1-Sol
import { reminderKey } from "./state";
import { triggerInstant } from "./triggers";
import type { Clock, DueReminder, ReminderEvent, ReminderState, ReminderWindow } from "./types";
import { id, instant, now, ReminderError, record, validateState } from "./validation";

function pending(events: readonly ReminderEvent[], state: ReminderState): DueReminder[] {
  validateState(state);
  if (!Array.isArray(events)) throw new ReminderError("invalid-event");
  const occurrences = new Set<string>();
  const result: DueReminder[] = [];
  for (const event of events) {
    record(event, ["id", "occurrenceId", "start", "end", "reminders"], "invalid-event");
    id(event.id, "invalid-event");
    id(event.occurrenceId, "invalid-event");
    instant(event.start);
    if (event.end !== undefined) {
      instant(event.end);
      if (event.end < event.start) throw new ReminderError("invalid-event");
    }
    const occurrence = JSON.stringify([event.id, event.occurrenceId]);
    if (occurrences.has(occurrence) || !Array.isArray(event.reminders)) {
      throw new ReminderError("invalid-event");
    }
    occurrences.add(occurrence);
    const reminderIds = new Set<string>();
    for (const reminder of event.reminders) {
      record(reminder, ["id", "trigger"], "invalid-event");
      id(reminder.id, "invalid-event");
      if (reminderIds.has(reminder.id)) throw new ReminderError("invalid-event");
      reminderIds.add(reminder.id);
      const key = reminderKey(event.id, event.occurrenceId, reminder.id);
      // Validate even dismissed or out-of-window triggers: unsupported inputs fail closed.
      const triggerAt = triggerInstant(event, reminder.trigger);
      const entry = state.get(key);
      if (entry?.status === "dismissed" || entry?.status === "delivered") continue;
      result.push({
        key,
        eventId: event.id,
        occurrenceId: event.occurrenceId,
        reminderId: reminder.id,
        triggerAt,
        dueAt: entry?.status === "snoozed" ? entry.until : triggerAt,
        revision: entry?.revision ?? 0,
      });
    }
  }
  return result.sort((a, b) => a.dueAt - b.dueAt || (a.key < b.key ? -1 : 1));
}

/** Includes from, excludes to. An explicit from enables catch-up after scheduler suspension. */
export function dueReminders(
  events: readonly ReminderEvent[],
  window: ReminderWindow,
  state: ReminderState,
  clock: Clock,
): DueReminder[] {
  const currentTime = now(clock);
  record(window, ["from", "to"], "invalid-window");
  const from = instant(window.from === undefined ? currentTime : window.from, "invalid-window");
  const to = instant(window.to, "invalid-window");
  if (from > to) throw new ReminderError("invalid-window");
  return pending(events, state).filter((reminder) => reminder.dueAt >= from && reminder.dueAt < to);
}

/** Absolute epoch milliseconds; overdue work wakes now, and an empty schedule returns null. */
export function nextWakeup(
  events: readonly ReminderEvent[],
  state: ReminderState,
  clock: Clock,
): number | null {
  const currentTime = now(clock);
  const first = pending(events, state)[0];
  return first === undefined ? null : Math.max(currentTime, first.dueAt);
}
