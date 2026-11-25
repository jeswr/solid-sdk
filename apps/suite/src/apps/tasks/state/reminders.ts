// AUTHORED-BY Claude Opus 5.5
"use client";
import { toast } from "@jeswr/suite-ui";
import { useEffect, useRef } from "react";
import {
  createAccountFiredStore,
  createIndexedDbFiredStore,
  createLocalStorageFiredStore,
  createMemoryFiredStore,
  type FiredReminderStore,
  LEGACY_LOCAL_KEY,
  purgeUnscopedFiredReminders,
  SCOPED_LOCAL_KEY,
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
/** One durable store per tab, so a strict-mode remount claims against the same keys. */
function durableStore(): FiredReminderStore {
  if (sharedStore) return sharedStore;
  let fallback = createMemoryFiredStore();
  try {
    if (typeof localStorage !== "undefined") {
      // The old unscoped record held task URLs and titles for every account: drop it.
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      fallback = fallbackFiredStore(
        createLocalStorageFiredStore(localStorage, SCOPED_LOCAL_KEY),
        report,
        fallback,
      );
    }
  } catch (error) {
    report(error);
  }
  try {
    if (typeof indexedDB !== "undefined")
      void purgeUnscopedFiredReminders(indexedDB).catch(() => undefined);
  } catch {
    /* Best effort: the records are unreachable to the scoped store either way. */
  }
  sharedStore ??=
    typeof indexedDB === "undefined"
      ? fallback
      : fallbackFiredStore(createIndexedDbFiredStore(indexedDB), report, fallback);
  return sharedStore;
}
/** Claims are scoped to `webId` (digested with the key), so accounts never share fired state. */
export function firedReminderStore(webId = ""): FiredReminderStore {
  const existing = accountStores.get(webId);
  if (existing) return existing;
  const store = createAccountFiredStore(durableStore(), () => webId);
  accountStores.set(webId, store);
  return store;
}
const accountStores = new Map<string, FiredReminderStore>();
/** The signed-in WebID of a Tasks cache, which is the reminder source in the app. */
function sourceAccount(source: ReminderSource): string {
  const webId: unknown = Reflect.get(source, "webId");
  return typeof webId === "string" ? webId : "";
}

const granted = () => typeof Notification !== "undefined" && Notification.permission === "granted";

/** Through the controlling service worker when there is one (Android Chrome forbids the
 * constructor), else the Notification constructor. Failures are reported, never thrown. */
async function showSystemNotification(event: ReminderEvent, open: (taskUrl: string) => void) {
  try {
    const registration = navigator.serviceWorker?.controller
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
    if (registration) {
      // The worker's notificationclick handler owns the click; `data.taskUrl` names the task.
      await registration.showNotification(event.title, {
        body: event.body,
        tag: event.tag,
        data: { taskUrl: event.taskUrl },
      });
      return;
    }
    const notification = new Notification(event.title, { body: event.body, tag: event.tag });
    notification.onclick = () => {
      window.focus();
      open(event.taskUrl);
      notification.close();
    };
  } catch (error) {
    report(error);
  }
}

/** A system notification when already permitted, plus a toast that stays until dismissed. */
export async function deliverReminder(
  event: ReminderEvent,
  open: (taskUrl: string) => void,
): Promise<void> {
  if (granted()) await showSystemNotification(event, open);
  // There is no notification tray yet, so the toast must outlast a user who is away.
  toast(`Reminder: ${event.title}`, {
    id: event.tag,
    description: event.body,
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: { label: "Open", onClick: () => open(event.taskUrl) },
  });
}

/** Chromium's feature check: Android Chrome's constructor throws a TypeError. */
function notificationsUsable(): boolean {
  if (navigator.serviceWorker?.controller) return true;
  try {
    new Notification("").close();
  } catch (error) {
    return !(error instanceof TypeError);
  }
  return true;
}

const PROMPTED = "tasks:notification-prompt";
let prompted = false;
/** After saving a reminder, offer notifications once per session when they can work. Never
 * prompts by itself. */
export function offerNotificationPermission(): void {
  if (
    prompted ||
    typeof Notification === "undefined" ||
    Notification.permission !== "default" ||
    !notificationsUsable()
  )
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
  /** The signed-in account; fired reminders are recorded per account. */
  webId?: string,
): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    let testNow: Date | undefined;
    const scheduler = startReminderScheduler({
      source,
      store: store ?? firedReminderStore(webId ?? sourceAccount(source)),
      notify: (event) => deliverReminder(event, (url) => latest.current(url)),
      now: () => testNow ?? new Date(),
      onError: (errors) => report(...errors),
      // A hidden tab could only show a toast nobody sees; leave the claim to a visible tab.
      canDeliver: () => document.visibilityState !== "hidden" || granted(),
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
  }, [source, store, webId]);
}
