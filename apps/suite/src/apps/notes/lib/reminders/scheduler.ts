// AUTHORED-BY Codex GPT-6.1-Sol
import type { Note } from "../model/note";

const DAY = 86_400_000;
export const MAX_REMINDER_DELAY = 24 * DAY;
export const MAX_FIRED_REMINDERS = 2000;
type ReminderStorage = Pick<Storage, "getItem" | "setItem">;

/** Browser-independent delivery and account-scoped, bounded deduplication. */
export function createReminderScheduler(options: {
  account: string;
  storage: ReminderStorage;
  notify: (note: Note) => void;
}) {
  const key = `suite.notes.reminders.fired.${options.account}`;
  let fired = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(options.storage.getItem(key) ?? "[]");
    if (Array.isArray(parsed))
      for (const item of parsed)
        if (Array.isArray(item) && typeof item[0] === "string" && Number.isFinite(item[1]))
          fired.set(item[0], item[1]);
  } catch {
    // Blocked storage and malformed records still allow in-memory deduplication.
  }
  function prune(now: number) {
    fired = new Map(
      [...fired]
        .filter(([, time]) => time > now - 30 * DAY && time <= now)
        .sort((a, b) => a[1] - b[1])
        .slice(-MAX_FIRED_REMINDERS),
    );
  }
  return {
    tick(notes: readonly Note[], now: number, canDeliver = true): void {
      prune(now);
      for (const note of notes) {
        if (note.location === "trashed" || !note.reminder) continue;
        const time = Date.parse(note.reminder);
        const id = `${note.url}@${note.reminder}`;
        if (!canDeliver || !(time > now - DAY && time <= now) || fired.has(id)) continue;
        fired.set(id, now);
        options.notify(note);
      }
      prune(now);
      try {
        options.storage.setItem(key, JSON.stringify([...fired]));
      } catch {
        // The map remains authoritative for this mounted scheduler.
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
