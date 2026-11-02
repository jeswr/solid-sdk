// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes } from "../lib/model";
import type { OutboxStorage } from "./outbox";
import type { Occurrence } from "./view";
export interface ReminderNotice {
  id: string;
  title: string;
  open: () => void;
}
export interface ReminderSink {
  deliver(notice: ReminderNotice): void;
}
export interface ReminderClock {
  now(): number;
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
/** Replace deliver with the shell tray once SH-06 lands. */
export function scheduleReminders(
  events: readonly Occurrence[],
  webId: string,
  storage: OutboxStorage,
  sink: ReminderSink,
  clock: ReminderClock,
  open: (event: Occurrence) => void,
): () => void {
  const key = `suite:calendar:fired:${webId}`;
  const fired = new Set<string>();
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const envelope = JSON.parse(raw);
      if (envelope.webId === webId && Array.isArray(envelope.ids))
        for (const id of envelope.ids) if (typeof id === "string") fired.add(id);
    }
  } catch {
    /* Disabled storage leaves in-tab deduplication available. */
  }
  const planned = new Set<string>();
  const timers: unknown[] = [];
  const now = clock.now();
  for (const event of events)
    for (const time of computeFireTimes(event.data)) {
      const id = JSON.stringify([event.url, event.data.start, +time]);
      if (+time < now || +time >= now + 86400000 || fired.has(id) || planned.has(id)) continue;
      planned.add(id);
      timers.push(
        clock.set(() => {
          fired.add(id);
          try {
            storage.setItem(key, JSON.stringify({ webId, ids: [...fired].slice(-5000) }));
          } catch {
            /* Notifications still work in private browsing. */
          }
          sink.deliver({ id, title: event.data.name, open: () => open(event) });
        }, +time - now),
      );
    }
  return () => {
    for (const timer of timers) clock.clear(timer);
  };
}
