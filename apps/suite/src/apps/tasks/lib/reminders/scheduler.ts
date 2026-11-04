// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes, pendingReminders, type Reminder } from "../model/reminders";
import type { FiredReminderStore } from "./fired-store";

export interface ReminderTask {
  url: string;
  title: string;
  due?: Date;
  allDay?: string;
  reminders: Reminder[];
  state: "open" | "closed";
  /** Survives moves between projects, which change the URL and anonymous trigger ids. */
  identity?: string;
}
export interface DueReminder {
  taskUrl: string;
  title: string;
  fireTime: Date;
}
export interface ReminderTickResult {
  due: DueReminder[];
  errors: unknown[];
}

/**
 * Scan pending triggers in (now-window, now], capped at 24h and defaulting to that
 * catch-up bound on every tick, including after reload. Atomic claims deduplicate
 * overlapping ticks across tabs. Deliver every returned event even if errors exist;
 * failed items remain unclaimed and can retry on the next tick.
 * All-day markers use the browser's start of day, ignoring the stored UTC time.
 * A task with an `identity` also claims an identity key, so a reminder that fired before
 * a move (new URL, new trigger ids) does not fire again from the moved copy.
 */
export async function collectDueReminders(
  tasks: readonly ReminderTask[],
  now: Date,
  store: FiredReminderStore,
  windowMs = 86400000,
): Promise<ReminderTickResult> {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(windowMs) || windowMs < 0)
    throw new RangeError("Invalid reminder clock or window.");
  const lower = now.getTime() - Math.min(windowMs, 86400000);
  const due: DueReminder[] = [];
  const errors: unknown[] = [];
  for (const task of tasks) {
    if (task.state !== "open" || !task.due) continue;
    let date = task.due;
    if (task.allDay) {
      const [year, month, day] = task.allDay.split("-").map(Number) as [number, number, number];
      date = new Date(year, month - 1, day);
    }
    for (const reminder of task.reminders) {
      try {
        const times = pendingReminders(
          computeFireTimes(task.url, date, [reminder]),
          now,
          new Set(),
        );
        for (const time of times) {
          if (time.at.getTime() <= lower || !(await store.claim(time.key))) continue;
          // A moved task's new URL claims afresh; its identity key still records the fire.
          const trigger = reminder.offset ?? (reminder.time as Date).toISOString();
          if (
            task.identity &&
            !(await store.claim(`${task.identity}|${trigger}@${time.at.toISOString()}`))
          )
            continue;
          due.push({ taskUrl: task.url, title: task.title, fireTime: time.at });
        }
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return { due: due.sort((a, b) => a.fireTime.getTime() - b.fireTime.getTime()), errors };
}
