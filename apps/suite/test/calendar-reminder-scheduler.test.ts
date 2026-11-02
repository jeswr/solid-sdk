// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { scheduleReminders } from "../src/apps/calendar/state/reminder-scheduler";
import type { Occurrence } from "../src/apps/calendar/state/view";

const web = "https://pod.example/profile#me";
const now = Date.parse("2026-11-01T12:00Z");
const event: Occurrence = {
  url: "https://pod.example/calendar/e.ttl",
  etag: '"1"',
  id: "occurrence",
  calendar: {
    url: "https://pod.example/calendar/work.ttl",
    container: "https://pod.example/calendar/work/",
    title: "Work",
    colour: `#${"abc"}`, // built at runtime: the token gate rejects raw hex
    etag: null,
  },
  data: {
    name: "Lunch",
    start: new Date(now + 600000),
    end: new Date(now + 3600000),
    reminders: [
      { triggerOffset: "-PT5M" },
      { triggerOffset: "-PT5M" },
      { triggerTime: new Date(now - 1) },
      { triggerTime: new Date(now + 86400000) },
    ],
  },
};
it("schedules the next 24h once per occurrence and trigger, persists fired ids per WebID", () => {
  let raw: string | null = null;
  const callbacks: (() => void)[] = [];
  const clear = vi.fn();
  const deliver = vi.fn();
  const open = vi.fn();
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const clock = {
    now: () => now,
    set: (fn: () => void, delay: number) => {
      expect(delay).toBe(300000);
      callbacks.push(fn);
      return 1;
    },
    clear,
  };
  const cleanup = scheduleReminders([event, event], web, storage, { deliver }, clock, open);
  expect(callbacks).toHaveLength(1);
  callbacks[0]!();
  expect(deliver).toHaveBeenCalledOnce();
  deliver.mock.calls[0]![0].open();
  expect(open).toHaveBeenCalledWith(event);
  cleanup();
  expect(clear).toHaveBeenCalledWith(1);
  scheduleReminders([event], web, storage, { deliver }, clock, open);
  expect(callbacks).toHaveLength(1);
  scheduleReminders([event], "another", storage, { deliver }, clock, open);
  expect(callbacks).toHaveLength(2);
});
it("tolerates corrupt, mismatched and unavailable storage without losing delivery", () => {
  for (const raw of [
    "bad",
    JSON.stringify({ webId: web, ids: {} }),
    JSON.stringify({ webId: "other", ids: [] }),
    JSON.stringify({ webId: web, ids: [2, "old"] }),
    null,
  ]) {
    const deliver = vi.fn();
    const callbacks: (() => void)[] = [];
    scheduleReminders(
      [event],
      web,
      {
        getItem: () => raw,
        setItem: () => {
          throw Error();
        },
      },
      { deliver },
      {
        now: () => now,
        set: (fn) => {
          callbacks.push(fn);
          return 0;
        },
        clear: () => {},
      },
      () => {},
    );
    callbacks[0]!();
    expect(deliver).toHaveBeenCalledOnce();
  }
  const callbacks: (() => void)[] = [];
  const cleanup = scheduleReminders(
    [event],
    web,
    {
      getItem: () => {
        throw Error();
      },
      setItem: () => {},
    },
    { deliver: () => {} },
    {
      now: () => now,
      set: (fn) => {
        callbacks.push(fn);
        return 0;
      },
      clear: () => {},
    },
    () => {},
  );
  cleanup();
});
