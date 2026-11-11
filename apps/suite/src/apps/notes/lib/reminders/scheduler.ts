// AUTHORED-BY Codex GPT-6.1-Sol
import type { Note } from "../model/note";
import type { FiredReminderStore } from "./fired-store";

const DAY = 86_400_000;
export const MAX_REMINDER_DELAY = 24 * DAY;

/** Persisted reminder identities survive moves, including filename collisions.
 * Legacy reminders use the resource URL until a save migrates their claims
 * to a persisted identifier.
 */
export function reminderKey(note: Note): string {
  return JSON.stringify([note.reminderId ?? note.url, note.reminder]);
}

/** Browser-independent delivery; the shared store arbitrates each delivery. */
export function createReminderScheduler(options: {
  fired: FiredReminderStore;
  /** False means the delivery owner disappeared before delivery. */
  notify: (note: Note) => undefined | boolean;
}) {
  return {
    async tick(notes: readonly Note[], now: number, canDeliver = true): Promise<void> {
      for (const note of notes) {
        if (note.location === "trashed" || !note.reminder) continue;
        const time = Date.parse(note.reminder);
        if (!canDeliver || !(time > now - DAY && time <= now)) continue;
        const key = reminderKey(note);
        const owner = crypto.randomUUID();
        if (!(await options.fired.claim(key, now, owner))) continue;
        if (options.notify(note) === false) await options.fired.release(key, owner);
        else await options.fired.deliver(key, now, owner);
      }
    },
    nextDelay(notes: readonly Note[], now: number): number {
      let delay = MAX_REMINDER_DELAY;
      for (const note of notes) {
        if (note.location === "trashed" || !note.reminder) continue;
        const time = Date.parse(note.reminder);
        if (time > now) delay = Math.min(delay, time - now);
      }
      return delay;
    },
  };
}
