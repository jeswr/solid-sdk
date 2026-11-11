// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import { useEffect, useRef } from "react";
import type { StoredNote } from "../lib/model/store";
import {
  createIndexedDbFiredStore,
  createMemoryFiredStore,
  type FiredReminderStore,
} from "../lib/reminders/fired-store";
import { createReminderScheduler, reminderKey } from "../lib/reminders/scheduler";

const granted = () => typeof Notification !== "undefined" && Notification.permission === "granted";
const prompted = new Set<string>();
// Share the fallback across mounts in this page when durable storage is unavailable.
const fallbackStores = new Map<string, FiredReminderStore>();

/** Offer once after the user saves a reminder; the action is a permission gesture. */
export function offerReminderPermission(account: string): void {
  if (
    prompted.has(account) ||
    typeof Notification === "undefined" ||
    Notification.permission !== "default"
  )
    return;
  prompted.add(account);
  try {
    const key = `suite.notes.reminders.prompted.${account}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    // The page flag still prevents repeated prompts when storage is unavailable.
  }
  toast("Get a notification when reminders are due?", {
    duration: 10_000,
    action: {
      label: "Allow notifications",
      onClick: () => {
        void Promise.resolve(Notification.requestPermission()).catch(() => {});
      },
    },
  });
}

/** Mounted once in NotesChrome; refs keep timers current without resetting claims. */
export function useNoteReminders(
  account: string,
  notes: readonly StoredNote[],
  open: (note: StoredNote) => void,
): void {
  const latest = useRef({ notes, open });
  latest.current = { notes, open };
  const check = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let fallback = fallbackStores.get(account);
    if (!fallback) {
      fallback = createMemoryFiredStore();
      fallbackStores.set(account, fallback);
    }
    const memory = fallback;
    const durable =
      typeof indexedDB === "undefined" ? memory : createIndexedDbFiredStore(account, indexedDB);
    const scheduler = createReminderScheduler({
      fired: {
        async claim(key, now) {
          // Reserve locally before I/O. A later storage failure must not redeliver
          // an already claimed reminder; concurrent tabs still arbitrate in IndexedDB.
          if (!(await memory.claim(key, now))) return false;
          try {
            return durable === memory || (await durable.claim(key, now));
          } catch {
            return true;
          }
        },
      },
      notify: (note) => {
        if (!active) return;
        const title = note.title || "Untitled note";
        const onOpen = () => latest.current.open(note as StoredNote);
        toast(title, {
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: { label: "Open", onClick: onOpen },
        });
        if (granted()) {
          try {
            const notification = new Notification(title, { tag: reminderKey(note) });
            notification.onclick = () => {
              window.focus();
              onOpen();
              notification.close();
            };
          } catch {
            // A browser can refuse the constructor even with permission (e.g. mobile).
          }
        }
      },
    });
    let timeout: ReturnType<typeof setTimeout>;
    const run = () => {
      clearTimeout(timeout);
      const now = Date.now();
      // React may immediately clean up and replay the mount effect. Check its
      // lifetime before claiming, so that replay cannot consume an unseen reminder.
      void Promise.resolve().then(() => {
        if (active)
          return scheduler.tick(
            latest.current.notes,
            Date.now(),
            document.visibilityState !== "hidden" || granted(),
          );
      });
      timeout = setTimeout(run, scheduler.nextDelay(latest.current.notes, now));
    };
    check.current = run;
    run();
    const interval = setInterval(run, 5 * 60_000);
    document.addEventListener("visibilitychange", run);
    return () => {
      active = false;
      check.current = () => {};
      clearTimeout(timeout);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", run);
    };
  }, [account]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new note list must reschedule the next due time
  useEffect(() => {
    check.current();
  }, [notes]);
}
