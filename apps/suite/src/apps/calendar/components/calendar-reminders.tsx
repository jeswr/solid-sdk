// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCalendarState, useEventsInRange } from "../state/calendar-context";
import { editorHref } from "../state/editing";
import { type ReminderSink, scheduleReminders } from "../state/reminder-scheduler";
import { addDays, calendarHref, dateKey, visibleRange } from "../state/view";
/** Stable integration seam for the future shell notifications tray. */
export const reminderSink: ReminderSink = {
  deliver: (notice) => {
    toast(notice.title, { id: notice.id, action: { label: "Open", onClick: notice.open } });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const notification = new Notification(notice.title, { tag: notice.id });
        notification.onclick = () => {
          notice.open();
          notification.close();
        };
      } catch {
        /* Some browsers require service workers for desktop notifications. */
      }
    }
  },
};

import { useCalendarNavigation } from "./calendar-app";

export function CalendarReminders() {
  const { session } = useCalendarState();
  const router = useRouter();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const today = dateKey(clock);
  const state = useEventsInRange(today, addDays(today, 32), false);
  const navigation = useCalendarNavigation();
  const range = visibleRange(navigation.view, navigation.date, navigation.weekStart);
  const visible = useEventsInRange(range.from, range.to, false);
  const memory = useRef(new Map<string, string>());
  useEffect(() => {
    if (state.status !== "ready") return;
    return scheduleReminders(
      [...state.events, ...(visible.status === "ready" ? visible.events : [])],
      session.webId,
      {
        getItem: (key) => {
          try {
            return localStorage.getItem(key) ?? memory.current.get(key) ?? null;
          } catch {
            return memory.current.get(key) ?? null;
          }
        },
        setItem: (key, value) => {
          memory.current.set(key, value);
          try {
            localStorage.setItem(key, value);
          } catch {}
        },
      },
      reminderSink,
      {
        now: () => Date.now(),
        set: (fn, delay) => setTimeout(fn, delay),
        clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      },
      (event) =>
        router.push(
          editorHref(event.url, event.data.start, calendarHref("week", dateKey(event.data.start))),
        ),
    );
  }, [state, visible, session.webId, router]);
  return null;
}
export function DesktopRemindersButton() {
  const [permission, setPermission] = useState<NotificationPermission>();
  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);
  return (
    <Button
      variant="ghost"
      disabled={permission === undefined || permission === "granted"}
      onClick={() => {
        void Notification.requestPermission().then((value) => {
          setPermission(value);
          if (value === "denied") toast("Desktop reminders are blocked in your browser settings.");
        });
      }}
    >
      {permission === "granted" ? "Desktop reminders on" : "Turn on desktop reminders"}
    </Button>
  );
}
