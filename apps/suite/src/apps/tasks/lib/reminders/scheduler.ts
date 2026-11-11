// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes, pendingReminders, type Reminder } from "../model/reminders";
import { type FiredReminderStore, reminderKey } from "./fired-store";

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

/** All-day markers are browser-local dates, regardless of the stored UTC due time. */
export function reminderDue(task: ReminderTask): Date | undefined {
  if (!task.allDay) return task.due;
  const [year, month, day] = task.allDay.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function reminderFireTimes(task: ReminderTask, reminder: Reminder) {
  return computeFireTimes(task.url, reminderDue(task), [reminder]);
}

/** Only scheduling inputs identify an edit; titles, priorities and modified timestamps do not. */
export function reminderSchedule(task: ReminderTask, reminder: Reminder): string {
  return JSON.stringify([
    task.url,
    reminder.offset ?? (reminder.time as Date).toISOString(),
    reminderDue(task)?.toISOString(),
  ]);
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
  active: () => boolean = () => true,
): Promise<ReminderTickResult> {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(windowMs) || windowMs < 0)
    throw new RangeError("Invalid reminder clock or window.");
  const lower = now.getTime() - Math.min(windowMs, 86400000);
  const due: DueReminder[] = [];
  const errors: unknown[] = [];
  try {
    if (active()) await store.prune?.();
  } catch (error) {
    errors.push(error);
  }
  for (const task of tasks) {
    if (task.state !== "open" || !task.due) continue;
    for (const reminder of task.reminders) {
      try {
        const times = pendingReminders(reminderFireTimes(task, reminder), now, new Set());
        for (const time of times) {
          if (!active()) break;
          if (
            time.at.getTime() <= lower ||
            !(await store.claim(reminderKey(task.url, reminder, time.at, reminderDue(task))))
          )
            continue;
          // A moved task's new URL claims afresh; its identity key still records the fire.
          const trigger = reminder.offset ?? (reminder.time as Date).toISOString();
          if (
            task.identity &&
            active() &&
            !(await store.claim(
              `${task.identity}|${trigger}@${time.at.toISOString()}|due=${reminderDue(task)?.toISOString()}`,
            ))
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
