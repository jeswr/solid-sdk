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
  const outcomes = new WeakMap<EventWrite, unknown>();
  const etags = new Map<string, string | null>();
  const knownEtags = new Map<string, Set<string | null>>();
  let sending: EventWrite | undefined;
  function conditional(write: EventWrite) {
    if (write.kind !== "create") {
      if (!write.etag || write.etag === "*" || write.etag.startsWith("W/"))
        throw new Error("Reload this event before saving");
    }
  }
  async function drain() {
    while (entries.length) {
      const write = entries[0] as EventWrite;
      try {
        conditional(write);
        allowed(write);
        sending = write;
        const etag = await send(write);
        if (typeof etag === "string" || etag === null) {
          etags.set(write.url, etag);
          const known = knownEtags.get(write.url) ?? new Set<string | null>();
          known.add(write.kind === "create" ? null : write.etag);
          known.add(etag);
          knownEtags.set(write.url, known);
        }
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
        etags.delete(write.url);
        knownEtags.delete(write.url);
        // A dependent intent must never run after its prerequisite failed.
        for (const entry of entries) if (entry.url === write.url) outcomes.set(entry, error);
        entries = entries.filter((entry) => entry.url !== write.url);
      } finally {
        sending = undefined;
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
    async resolve(url: string, etag: string | null, requireConfirmation = true): Promise<string> {
      const dependencies = entries.filter((entry) => entry.url === url);
      if (dependencies.length) await flush();
      for (const dependency of dependencies)
        if (outcomes.has(dependency)) throw outcomes.get(dependency);
      if (entries.some((entry) => entry.url === url)) {
        if (!requireConfirmation) return etag ?? "";
        throw new Error("Reconnect before finishing this series edit. Your draft is still here.");
      }
      const current = knownEtags.get(url)?.has(etag) ? etags.get(url) : etag;
      if (!current || current === "*" || current.startsWith("W/"))
        throw new Error("Reload this event before saving");
      return current;
    },
    async save(write: EventWrite, requireConfirmation = false) {
      const dependency = entries.find((entry) => entry.url === write.url);
      if (!dependency) conditional(write);
      allowed(write);
      // A create waiting offline has no server ETag yet: edit or cancel that queued intent.
      if (
        !requireConfirmation &&
        dependency?.kind === "create" &&
        dependency !== sending &&
        write.kind !== "create"
      ) {
        if (write.kind === "delete") entries = entries.filter((entry) => entry !== dependency);
        else dependency.data = write.data;
        publish();
        return;
      }
      if (entries.length >= 100 || JSON.stringify([...entries, write]).length > 512000)
        throw new Error("Calendar outbox is full");
      entries.push(write);
      publish();
      if (!offline) await flush();
      const error = outcomes.get(write);
      if (error !== undefined) throw error;
      if (requireConfirmation && entries.includes(write)) {
        entries = entries.filter((entry) => entry !== write);
        publish();
        throw new Error("Reconnect before finishing this series edit. Your draft is still here.");
      }
    },
  };
}
