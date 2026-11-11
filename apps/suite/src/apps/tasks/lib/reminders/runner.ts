// AUTHORED-BY Claude Opus 5.5
import { formatDue } from "../format/due";
import type { StoredTask } from "../model/store";
import type { TaskView } from "../views/types";
import { createMemoryFiredStore, type FiredReminderStore } from "./fired-store";
import {
  collectDueReminders,
  type DueReminder,
  type ReminderTask,
  reminderFireTimes,
} from "./scheduler";

/** The slice of the Tasks cache snapshot the reminder runner reads. */
export interface ReminderSnapshot {
  readonly status: "loading" | "ready" | "error";
  readonly projects: readonly { readonly url: string }[];
  readonly tasks: Readonly<
    Record<string, { readonly status: string; readonly items: readonly StoredTask[] }>
  >;
  /** Visible projections: hidden (delayed-delete) and removed tasks are already absent. */
  readonly views: readonly TaskView[];
}
export interface ReminderSource {
  getSnapshot(): ReminderSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface ReminderEvent extends DueReminder {
  /** Trigger time identity, used as the Notification tag and toast id. */
  tag: string;
  /** Due-time text, e.g. "Due today 17:00". */
  body: string;
}
export type ReminderNotifier = (event: ReminderEvent) => void | Promise<void>;
export interface ReminderRun {
  delivered: ReminderEvent[];
  errors: unknown[];
  /** Claimed but not delivered (failed or stopped); retried by the next tick. */
  undelivered: ReminderEvent[];
}
export interface ReminderTickOptions {
  /** Earlier undelivered events, kept while their task is still due-able and in the window. */
  retry?: readonly ReminderEvent[];
  /** Checked before each claim and delivery, so a stopped scheduler leaves later keys untouched. */
  active?: () => boolean;
}
const WINDOW = 86400000;

/** True once the project list and every project's task load have settled. */
export function remindersReady(snapshot: ReminderSnapshot): boolean {
  return (
    snapshot.status === "ready" &&
    snapshot.projects.every((project) => {
      const load = snapshot.tasks[project.url];
      return load !== undefined && load.status !== "loading";
    })
  );
}

/** Open, visible, dated tasks with reminders. Invalid reminder data is reported, not thrown. */
export function reminderTasks(snapshot: ReminderSnapshot): {
  tasks: ReminderTask[];
  errors: unknown[];
} {
  const stored = new Map<string, StoredTask>();
  for (const load of Object.values(snapshot.tasks))
    for (const item of load.items) stored.set(item.url, item);
  const tasks: ReminderTask[] = [];
  const errors: unknown[] = [];
  for (const view of snapshot.views) {
    const item = stored.get(view.url);
    if (view.state !== "open" || !view.hasReminders || !view.due || !item) continue;
    try {
      const savedAt = item.task.modified ?? view.created;
      tasks.push({
        url: view.url,
        title: view.title || "Untitled task",
        due: view.due,
        ...(view.allDay ? { allDay: view.allDay } : {}),
        reminders: item.task.reminders,
        state: "open",
        ...(savedAt ? { savedAt } : {}),
        // Moves keep the creation time and title, but not the URL or anonymous trigger ids.
        ...(view.created ? { identity: `${view.created.toISOString()}|${view.title}` } : {}),
      });
    } catch (error) {
      errors.push(error);
    }
  }
  return { tasks, errors };
}

export function reminderBody(task: Pick<ReminderTask, "due" | "allDay">, now: Date): string {
  return `Due ${formatDue(task, now).replace(/^(Today|Tomorrow)\b/, (day) => day.toLowerCase())}`;
}

/** One scheduler tick: claim and deliver every due reminder. Never throws. */
export async function runReminderTick(
  snapshot: ReminderSnapshot,
  now: Date,
  store: FiredReminderStore,
  notify: ReminderNotifier,
  options: ReminderTickOptions = {},
): Promise<ReminderRun> {
  const { tasks, errors } = reminderTasks(snapshot);
  let due: DueReminder[] = [];
  try {
    const result = await collectDueReminders(tasks, now, store, WINDOW, options.active);
    due = result.due;
    errors.push(...result.errors);
  } catch (error) {
    errors.push(error);
  }
  const byUrl = new Map(tasks.map((task) => [task.url, task]));
  const events: ReminderEvent[] = [
    ...(options.retry ?? []).filter((event) => {
      const task = byUrl.get(event.taskUrl);
      if (!task || event.fireTime > now || event.fireTime.getTime() <= now.getTime() - WINDOW)
        return false;
      return task.reminders.some((reminder) => {
        try {
          return reminderFireTimes(task, reminder).some(
            (time) => time.at.getTime() === event.fireTime.getTime(),
          );
        } catch {
          return false;
        }
      });
    }),
    ...due.map((reminder) => ({
      ...reminder,
      tag: `${reminder.taskUrl}@${reminder.fireTime.toISOString()}`,
      body: reminderBody(byUrl.get(reminder.taskUrl) as ReminderTask, now),
    })),
  ];
  const delivered: ReminderEvent[] = [];
  const undelivered: ReminderEvent[] = [];
  for (const event of events) {
    if (options.active && !options.active()) {
      undelivered.push(event);
      continue;
    }
    try {
      await notify(event);
      delivered.push(event);
    } catch (error) {
      errors.push(error);
      undelivered.push(event);
    }
  }
  return { delivered, errors, undelivered };
}

/** Keep a tab-local claim cache across primary/fallback transitions. Reports the first failure. */
export function fallbackFiredStore(
  primary: FiredReminderStore,
  onError: (error: unknown) => void,
  fallback: FiredReminderStore = createMemoryFiredStore(),
): FiredReminderStore {
  let reported = false;
  const known = new Set<string>();
  function report(error: unknown) {
    if (!reported) {
      reported = true;
      onError(error);
    }
  }
  return {
    async claim(key) {
      if (known.has(key)) return false;
      // Reserve synchronously so overlapping callers in this tab cannot both win.
      known.add(key);
      try {
        return await primary.claim(key);
      } catch (error) {
        report(error);
        try {
          return await fallback.claim(key);
        } catch (error) {
          known.delete(key);
          throw error;
        }
      }
    },
    async prune() {
      try {
        await primary.prune?.();
      } catch (error) {
        report(error);
      }
      await fallback.prune?.();
    },
  };
}

export interface ReminderSchedulerOptions {
  source: ReminderSource;
  store: FiredReminderStore;
  notify: ReminderNotifier;
  now?: () => Date;
  onError?: (errors: unknown[]) => void;
  intervalMs?: number;
  /** False skips a tick before claiming, e.g. in a hidden tab that could only show a toast. */
  canDeliver?: () => boolean;
  /** Ticks when this document becomes visible again. */
  document?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
}
export interface ReminderScheduler {
  /** Queue one tick; resolves undefined while loading, unable to deliver, or after stop. */
  tick(): Promise<ReminderRun | undefined>;
  stop(): void;
}
export const REMINDER_INTERVAL = 5 * 60_000;

/** Ticks once tasks have loaded, every interval, and on becoming visible. Ticks run serially. */
export function startReminderScheduler(options: ReminderSchedulerOptions): ReminderScheduler {
  const { source, store, notify, document } = options;
  const now = options.now ?? (() => new Date());
  let stopped = false;
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  let undelivered: ReminderEvent[] = [];
  const tick = (): Promise<ReminderRun | undefined> => {
    const run = queue.then(async () => {
      const snapshot = source.getSnapshot();
      if (stopped || !remindersReady(snapshot) || options.canDeliver?.() === false)
        return undefined;
      const result = await runReminderTick(snapshot, now(), store, notify, {
        retry: undelivered,
        active: () => !stopped,
      });
      undelivered = result.undelivered;
      if (result.errors.length) options.onError?.(result.errors);
      return result;
    });
    // A throwing error reporter must not stall later ticks.
    queue = run.catch(() => undefined);
    return run;
  };
  const check = () => {
    if (loaded || !remindersReady(source.getSnapshot())) return;
    loaded = true;
    void tick();
  };
  const visible = () => {
    if (document?.visibilityState === "visible") void tick();
  };
  const unsubscribe = source.subscribe(check);
  const timer = setInterval(() => void tick(), options.intervalMs ?? REMINDER_INTERVAL);
  document?.addEventListener("visibilitychange", visible);
  check();
  return {
    tick,
    stop() {
      stopped = true;
      unsubscribe();
      clearInterval(timer);
      document?.removeEventListener("visibilitychange", visible);
    },
  };
}
