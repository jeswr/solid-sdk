// AUTHORED-BY Claude Opus 5.5
"use client";
import { toast } from "@jeswr/suite-ui";
import { useEffect, useRef } from "react";
import {
  createIndexedDbFiredStore,
  createMemoryFiredStore,
  type FiredReminderStore,
} from "../lib/reminders/fired-store";
import {
  fallbackFiredStore,
  type ReminderEvent,
  type ReminderSource,
  startReminderScheduler,
} from "../lib/reminders/runner";

function report(...errors: unknown[]) {
  console.warn("Tasks reminders:", ...errors);
}

let sharedStore: FiredReminderStore | undefined;
/** One store per tab, so a strict-mode remount claims against the same keys. */
export function firedReminderStore(): FiredReminderStore {
  sharedStore ??=
    typeof indexedDB === "undefined"
      ? createMemoryFiredStore()
      : fallbackFiredStore(createIndexedDbFiredStore(indexedDB), report);
  return sharedStore;
}

/** A Web Notification when already permitted, plus an in-app toast either way. */
export function deliverReminder(event: ReminderEvent, open: (taskUrl: string) => void): void {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const notification = new Notification(event.title, { body: event.body, tag: event.tag });
      notification.onclick = () => {
        window.focus();
        open(event.taskUrl);
        notification.close();
      };
    } catch (error) {
      // Some mobile browsers only allow service-worker notifications; the toast still shows.
      report(error);
    }
  }
  toast(`Reminder: ${event.title}`, {
    id: event.tag,
    description: event.body,
    duration: 30_000,
    action: { label: "Open", onClick: () => open(event.taskUrl) },
  });
}

const PROMPTED = "tasks:notification-prompt";
let prompted = false;
/** After saving a reminder, offer notifications once per session; never prompts by itself. */
export function offerNotificationPermission(): void {
  if (prompted || typeof Notification === "undefined" || Notification.permission !== "default")
    return;
  prompted = true;
  try {
    if (sessionStorage.getItem(PROMPTED)) return;
    sessionStorage.setItem(PROMPTED, "1");
  } catch {
    /* Storage can be blocked; the module flag still limits this to once per page. */
  }
  toast("Get a notification when reminders are due?", {
    duration: 10_000,
    action: {
      label: "Allow notifications",
      onClick: () => {
        // Older Safari returns undefined and takes a callback instead of a promise.
        void Promise.resolve(Notification.requestPermission()).catch(report);
      },
    },
  });
}

interface TestHook {
  setNow(value: string | number | null): void;
  tick(): Promise<number>;
}
type TestWindow = Window & { tasksReminderTestHook?: TestHook };

/** §4.7 scheduler: on load, every 5 minutes and when visible. `open` may change per render. */
export function useReminderScheduler(
  source: ReminderSource,
  open: (taskUrl: string) => void,
  store?: FiredReminderStore,
): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    let testNow: Date | undefined;
    const scheduler = startReminderScheduler({
      source,
      store: store ?? firedReminderStore(),
      notify: (event) => deliverReminder(event, (url) => latest.current(url)),
      now: () => testNow ?? new Date(),
      onError: (errors) => report(...errors),
      document,
    });
    // Dev fixture builds only: Playwright sets the reminder clock and forces a tick.
    if (process.env.NEXT_PUBLIC_DEV_FIXTURES === "1") {
      (window as TestWindow).tasksReminderTestHook = {
        setNow: (value) => {
          testNow = value === null ? undefined : new Date(value);
        },
        tick: async () => (await scheduler.tick())?.delivered.length ?? -1,
      };
    }
    return () => {
      scheduler.stop();
      delete (window as TestWindow).tasksReminderTestHook;
    };
  }, [source, store]);
}
