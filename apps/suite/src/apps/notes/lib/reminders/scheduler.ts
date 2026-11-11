// AUTHORED-BY Codex GPT-6.1-Sol
import type { Note } from "../model/note";
import type { FiredReminderStore } from "./fired-store";

const DAY = 86_400_000;
export const MAX_REMINDER_DELAY = 24 * DAY;

/** Creation metadata survives moves, including filename collisions in the destination.
 * Legacy documents without a creation time retain their resource identity.
 */
export function reminderKey(note: Note): string {
  return JSON.stringify([note.created ? [note.creator, note.created] : note.url, note.reminder]);
}

/** Browser-independent delivery; the shared store arbitrates each delivery. */
export function createReminderScheduler(options: {
  fired: FiredReminderStore;
  notify: (note: Note) => void;
}) {
  return {
    async tick(notes: readonly Note[], now: number, canDeliver = true): Promise<void> {
      for (const note of notes) {
        if (note.location === "trashed" || !note.reminder) continue;
        const time = Date.parse(note.reminder);
        if (!canDeliver || !(time > now - DAY && time <= now)) continue;
        if (await options.fired.claim(reminderKey(note), now)) options.notify(note);
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
