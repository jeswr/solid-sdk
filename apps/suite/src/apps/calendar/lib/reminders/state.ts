// AUTHORED-BY Codex GPT-6.1-Sol
import type { Clock, ReminderAction, ReminderState, ReminderStatus } from "./types";
import { id, instant, now, ReminderError, record, revision, validateState } from "./validation";

export function createReminderState(): ReminderState {
  return new Map();
}

/** JSON tuple encoding prevents delimiter collisions, including in untrusted resource IDs. */
export function reminderKey(eventId: string, occurrenceId: string, reminderId: string): string {
  for (const value of [eventId, occurrenceId, reminderId]) id(value, "invalid-event");
  return JSON.stringify([eventId, occurrenceId, reminderId]);
}

export function reminderReducer(
  state: ReminderState,
  action: ReminderAction,
  clock: Clock,
): ReminderState {
  validateState(state);
  record(action, ["type", "key", "until", "revision"], "invalid-action");
  id(action.key, "invalid-action");
  const currentTime = now(clock);
  const previous = state.get(action.key);
  const currentRevision = previous?.revision ?? 0;
  const result = new Map<string, ReminderStatus>(state);
  switch (action.type) {
    case "deliver":
      record(action, ["type", "key", "revision"], "invalid-action");
      revision(action.revision, "invalid-action");
      if (action.revision === currentRevision && previous?.status !== "dismissed") {
        result.set(action.key, { status: "delivered", revision: currentRevision });
      }
      return result;
    case "snooze":
      record(action, ["type", "key", "until"], "invalid-action");
      instant(action.until, "invalid-action");
      if (action.until <= currentTime || previous?.status === "dismissed") {
        throw new ReminderError("invalid-action");
      }
      revision(currentRevision + 1, "invalid-state");
      result.set(action.key, {
        status: "snoozed",
        until: action.until,
        revision: currentRevision + 1,
      });
      return result;
    case "dismiss":
      record(action, ["type", "key"], "invalid-action");
      if (previous?.status !== "dismissed") {
        revision(currentRevision + 1, "invalid-state");
        result.set(action.key, { status: "dismissed", revision: currentRevision + 1 });
      }
      return result;
    default:
      throw new ReminderError("invalid-action");
  }
}
