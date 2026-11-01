// AUTHORED-BY Codex GPT-6.1-Sol
import { type CalendarDate, type CalendarEvent, validateEvent } from "../lib/model";
import type { EventWrite } from "./repository";
export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const outboxKey = (webId: string) => `suite:calendar:outbox:${webId}`;
function date(value: string): CalendarDate {
  return value.length === 10 ? value : new Date(value);
}
/** Revive only model date fields; a date-shaped title always stays text. */
function revive(write: EventWrite): EventWrite {
  if (!["create", "update", "delete"].includes(write.kind) || typeof write.url !== "string")
    throw new TypeError("Invalid outbox");
  if (write.kind !== "create" && (!write.etag || write.etag === "*" || write.etag.startsWith("W/")))
    throw new TypeError("Invalid ETag");
  if (write.kind === "delete") return write;
  const raw = write.data;
  const data: CalendarEvent = {
    ...raw,
    start: date(String(raw.start)),
    end: raw.end === undefined ? undefined : date(String(raw.end)),
    recurrence: raw.recurrence
      ? {
          ...raw.recurrence,
          until:
            raw.recurrence.until === undefined ? undefined : date(String(raw.recurrence.until)),
          exceptDate: raw.recurrence.exceptDate?.map((ex) => date(String(ex))),
        }
      : undefined,
    reminders: raw.reminders?.map((r) => ({
      ...r,
      triggerTime: r.triggerTime === undefined ? undefined : new Date(String(r.triggerTime)),
    })),
  };
  validateEvent(data);
  return { ...write, data };
}
export function createEventOutbox(
  webId: string,
  storage: OutboxStorage,
  send: (write: EventWrite) => Promise<unknown>,
  changed: (writes: EventWrite[], offline: boolean) => void,
  allowed: (write: EventWrite) => void,
) {
  let entries: EventWrite[] = [];
  let offline = false;
  try {
    const raw = storage.getItem(outboxKey(webId));
    if (raw) {
      const envelope = JSON.parse(raw);
      if (
        envelope.v === 1 &&
        envelope.webId === webId &&
        Array.isArray(envelope.writes) &&
        envelope.writes.length <= 100
      )
        entries = envelope.writes.map(revive);
    }
  } catch {
    /* Corrupt or unavailable storage does not prevent in-memory saves. */
  }
  function publish() {
    try {
      storage.setItem(outboxKey(webId), JSON.stringify({ v: 1, webId, writes: entries }));
    } catch {
      /* The current tab retains the queue when storage is full. */
    }
    changed([...entries], offline);
  }
  let running: Promise<void> | undefined;
  const outcomes = new Map<EventWrite, unknown>();
  async function drain() {
    while (entries.length) {
      const write = entries[0] as EventWrite;
      try {
        allowed(write);
        const etag = await send(write);
        if (typeof etag === "string") {
          for (const entry of entries)
            if (entry !== write && entry.url === write.url && entry.kind !== "create")
              entry.etag = etag;
        }
      } catch (error) {
        if (error instanceof TypeError && error.message === "Calendar network unavailable") {
          offline = true;
          publish();
          return;
        }
        outcomes.set(write, error);
      }
      entries = entries.filter((e) => e !== write);
      publish();
    }
  }
  function flush(): Promise<void> {
    if (running) return running;
    offline = false;
    running = drain().finally(() => {
      running = undefined;
    });
    return running;
  }
  return {
    restore: publish,
    flush,
    async save(write: EventWrite) {
      allowed(write);
      if (entries.length >= 100 || JSON.stringify([...entries, write]).length > 512000)
        throw new Error("Calendar outbox is full");
      entries.push(write);
      publish();
      if (!offline) await flush();
      const error = outcomes.get(write);
      outcomes.delete(write);
      if (error !== undefined) throw error;
    },
  };
}
