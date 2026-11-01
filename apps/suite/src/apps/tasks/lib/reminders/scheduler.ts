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
}
export interface DueReminder {
  taskUrl: string;
  title: string;
  fireTime: Date;
}
interface Tick {
  last?: number;
  tail: Promise<unknown>;
}
const ticks = new WeakMap<FiredReminderStore, Tick>();

/**
 * First tick uses (now-window, now]; later successful ticks catch up since the last tick,
 * bounded to 24h. Tick state belongs to the store instance; fired keys survive reloads.
 * Calls sharing a store are serialised so overlapping local ticks cannot emit duplicates.
 * All-day markers are interpreted as browser-local midnight, ignoring the stored UTC time.
 */
export function collectDueReminders(
  tasks: readonly ReminderTask[],
  now: Date,
  store: FiredReminderStore,
  windowMs = 5 * 60_000,
): Promise<DueReminder[]> {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(windowMs) || windowMs < 0)
    return Promise.reject(new RangeError("Invalid reminder clock or window."));
  let tick = ticks.get(store);
  if (!tick) {
    tick = { tail: Promise.resolve() };
    ticks.set(store, tick);
  }
  const state = tick;
  const instant = now.getTime();
  const result = state.tail.then(async () => {
    const lower = Math.max(instant - 86400000, Math.min(instant - windowMs, state.last ?? instant));
    const due: DueReminder[] = [];
    for (const task of tasks) {
      if (task.state !== "open" || !task.due) continue;
      let date = task.due;
      if (task.allDay) {
        const [year, month, day] = task.allDay.split("-").map(Number) as [number, number, number];
        date = new Date(year, month - 1, day);
      }
      const times = pendingReminders(
        computeFireTimes(task.url, date, task.reminders),
        now,
        new Set(),
      );
      for (const time of times) {
        if (time.at.getTime() <= lower || (await store.has(time.key))) continue;
        await store.add(time.key);
        due.push({ taskUrl: task.url, title: task.title, fireTime: time.at });
      }
    }
    state.last = instant;
    return due.sort((a, b) => a.fireTime.getTime() - b.fireTime.getTime());
  });
  state.tail = result.catch(() => {});
  return result;
}
