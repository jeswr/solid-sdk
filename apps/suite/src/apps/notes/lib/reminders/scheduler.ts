// AUTHORED-BY Codex GPT-6.1-Sol
import type { Note } from "../model/note";
import { CLAIM_TTL, type FiredReminderStore } from "./fired-store";

const DAY = 86_400_000;
export const MAX_REMINDER_DELAY = 24 * DAY;

/** Persisted reminder identities survive moves, including filename collisions.
 * An external reminder uses its URL only when its identifier cannot be saved.
 */
export function reminderKey(note: Note): string {
  return JSON.stringify([note.reminderId ?? note.url, note.reminder]);
}

/** Browser-independent delivery; the shared store arbitrates each delivery. */
export function createReminderScheduler(options: {
  fired: FiredReminderStore;
  /** Guarded pod identification; a conflict re-reads the winning note. */
  identify?: (note: Note) => Promise<Note | undefined>;
  now?: () => number;
  /** False means the delivery owner disappeared before delivery. */
  notify: (note: Note) => undefined | boolean;
}) {
  const clock = options.now ?? Date.now;
  const isDue = (note: Note, now: number) => {
    if (note.location === "trashed" || !note.reminder) return false;
    const time = Date.parse(note.reminder);
    return time > now - DAY && time <= now;
  };
  return {
    async tick(notes: readonly Note[], now: number, canDeliver = true): Promise<void> {
      for (let note of notes) {
        if (!canDeliver || !isDue(note, now)) continue;
        if (!note.reminderId && options.identify) {
          try {
            const identified = await options.identify(note);
            if (!identified) continue;
            if (
              identified.reminderId &&
              identified.reminder === note.reminder &&
              (await options.fired.wasDelivered(reminderKey(note), clock()).catch(() => false))
            ) {
              // Identification already reached the pod. Preserve a prior URL-keyed
              // delivery before claiming the new identity, without delaying writes.
              await options.fired.markDelivered(reminderKey(identified), clock()).catch(() => {});
              continue;
            }
            note = identified;
          } catch {
            // Read-only and offline pods still get best-effort URL-keyed delivery.
          }
          if (!isDue(note, now)) continue;
        }
        const key = reminderKey(note);
        const owner = crypto.randomUUID();
        const claimedAt = clock();
        if (!(await options.fired.claim(key, claimedAt, owner))) continue;
        if (!(await options.fired.owns(key, clock(), owner)) || clock() >= claimedAt + CLAIM_TTL)
          continue;
        if (options.notify(note) === false) await options.fired.release(key, owner);
        else await options.fired.deliver(key, clock(), owner);
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
