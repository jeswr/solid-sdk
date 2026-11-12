// AUTHORED-BY Codex GPT-6.1-Sol
import type { Outbox, PendingIntent, QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import type { CalendarHttpError } from "../lib/model";
import {
  createEventChannel,
  decodeEventIntent,
  type EventIntent,
  eventIntent,
} from "./event-channel";
import { type OutboxStorage, reviveEventWrite, strongEventEtag } from "./event-write";
import { createSeriesIntents, type SeriesRecovery } from "./intents";
import type { EventWrite } from "./repository";
import type { CalendarInfo } from "./view";

export type { OutboxStorage } from "./event-write";
export const outboxKey = (webId: string) => `suite:calendar:outbox:${webId}`;
interface Binding {
  outbox: Outbox;
  storage: QueueingStorageClient;
  signal: AbortSignal;
}
/** Calendar UI policy over the shared queue. Demo submissions remain in memory. */
export function createEventOutbox(
  webId: string,
  legacy: OutboxStorage,
  send: (write: EventWrite, fetch?: typeof globalThis.fetch) => Promise<unknown>,
  changed: (writes: EventWrite[], offline: boolean) => void,
  allowed: (write: EventWrite) => void,
  recovery: SeriesRecovery | undefined,
  options: {
    demo: boolean;
    storageUrl: string;
    calendars(): readonly CalendarInfo[];
    conflict?(error: CalendarHttpError): void;
  },
) {
  const intents = recovery && createSeriesIntents(webId, legacy, send, allowed, recovery);
  let binding: Binding | undefined;
  let generation = 0;
  let retained: PendingIntent<EventIntent>[] = [];
  // Only demo entries and the optimistic gap before submit settles live here.
  const submitting = new Map<string, EventIntent>();
  const active = new Set<Promise<unknown>>();
  const attempts = new Map<string, Promise<void>>();
  let demoOffline = false;
  const etags = new Map<string, { previous: Set<string | null>; current: string | null }>();
  const trackedSend = async (write: EventWrite, fetch?: typeof globalThis.fetch) => {
    const known = etags.get(write.url);
    const prior = write.kind === "create" ? null : write.etag;
    const conditional =
      write.kind !== "create" && known?.previous.has(prior) && strongEventEtag(known.current)
        ? { ...write, etag: known.current }
        : write;
    const result = await send(conditional, fetch);
    const previous = known?.previous ?? new Set<string | null>();
    previous.add(prior);
    const current = typeof result === "string" ? result : null;
    previous.add(current);
    etags.set(write.url, { previous, current });
    return result;
  };
  const channel = createEventChannel({ ...options, allowed, send: trackedSend });
  const visible = () =>
    retained.flatMap((row) =>
      row.intent && row.status !== "failed" && row.status !== "conflict" ? [row.intent] : [],
    );
  function publish() {
    const entries = new Map(visible().map((intent) => [intent.id, intent.write]));
    for (const [id, intent] of submitting) entries.set(id, intent.write);
    changed(
      [...entries.values()],
      retained.some((row) => row.status === "waiting") ||
        (options.demo && submitting.size > 0 && demoOffline),
    );
  }
  async function refresh(current: Binding) {
    const version = ++generation;
    const rows = await channel.pending(current.outbox);
    if (binding !== current || current.signal.aborted || version !== generation) return;
    retained = rows;
    publish();
  }
  const check = (current: Binding) => {
    current.signal.throwIfAborted();
    if (current !== binding) throw new Error("Calendar session changed");
  };
  let importing = Promise.resolve();
  async function importLegacy(current: Binding) {
    const migrate = async () => {
      check(current);
      let writes: unknown[] = [];
      let raw: string | null;
      try {
        raw = legacy.getItem(outboxKey(webId));
      } catch {
        return;
      }
      try {
        if (raw) {
          const envelope = JSON.parse(raw);
          if (
            envelope.v === 1 &&
            envelope.webId === webId &&
            Array.isArray(envelope.writes) &&
            envelope.writes.length <= 100
          )
            writes = envelope.writes;
        }
      } catch {
        /* Drop corrupt JSON for this account. */
      }
      while (writes.length) {
        check(current);
        let intent: EventIntent | undefined;
        try {
          const write = reviveEventWrite(writes[0]);
          allowed(write);
          // A digest permits deduplication after an interrupted import.
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(writes[0])),
          );
          const id = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          const prior = visible()
            .filter((item) => item.write.url === write.url)
            .at(-1);
          intent = decodeEventIntent(
            JSON.parse(
              JSON.stringify(
                eventIntent(
                  write,
                  id,
                  write.kind !== "create" && prior?.write.kind !== "delete"
                    ? prior?.write.data
                    : undefined,
                ),
              ),
            ),
          );
        } catch {
          /* Drop invalid entries individually, retaining valid neighbours. */
        }
        if (intent) {
          const pending = await channel.pending(current.outbox);
          check(current);
          if (!pending.some((row) => row.intent?.id === intent.id))
            await channel.enqueue(current.outbox, intent);
        }
        check(current);
        writes.shift();
        legacy.setItem(outboxKey(webId), JSON.stringify({ v: 1, webId, writes }));
        await refresh(current);
      }
      legacy.setItem(outboxKey(webId), JSON.stringify({ v: 1, webId, writes: [] }));
    };
    const locks = globalThis.navigator?.locks;
    if (locks) await locks.request(`solid-suite:calendar:legacy:${webId}`, migrate);
    else await migrate();
  }
  async function flushWork() {
    await importing;
    await Promise.all([...active]);
    if (binding) await refresh(binding);
    if (intents) await intents.lock(() => intents.recover());
    if (options.demo) {
      for (const [id, intent] of submitting) {
        try {
          allowed(intent.write);
          await trackedSend(intent.write);
          submitting.delete(id);
          demoOffline = false;
        } catch (error) {
          if (!(error instanceof TypeError && error.message === "Calendar network unavailable"))
            throw error;
          demoOffline = true;
          break;
        }
      }
      publish();
    }
    // The shell drives durable replay.
  }
  let flushing: Promise<void> | undefined;
  function flush(): Promise<void> {
    flushing ??= flushWork().finally(() => {
      flushing = undefined;
    });
    return flushing;
  }
  return {
    channel,
    connect(current: Binding) {
      current.signal.throwIfAborted();
      if (current.outbox.webId !== webId) throw new Error("Calendar outbox identity mismatch");
      binding = current;
      const update = () => {
        void refresh(current).catch(() => {});
      };
      const stop = current.outbox.on("change", update);
      update();
      importing = importing
        .then(() => importLegacy(current))
        .catch(() => {
          /* Retain legacy data on storage/session failures. */
        });
      return () => {
        stop();
        if (binding === current) {
          binding = undefined;
          generation++;
        }
      };
    },
    restore: publish,
    flush,
    compound: intents
      ? async (...args: Parameters<typeof intents.run>) => {
          await flush();
          if (
            retained.some(
              (row) => row.intent && [args[0].url, args[1].url].includes(row.intent.write.url),
            )
          )
            throw new Error(
              "Reconnect before finishing this series edit. Your draft is still here.",
            );
          return intents.lock(() => intents.run(...args));
        }
      : undefined,
    async resolve(url: string, etag: string | null, requireConfirmation = true): Promise<string> {
      await flush();
      const current = binding;
      if (current) {
        check(current);
        await refresh(current);
        const pending = retained.filter((row) => row.intent?.write.url === url);
        if (pending.length) {
          if (!requireConfirmation) return etag ?? "";
          throw new Error("Reconnect before finishing this series edit. Your draft is still here.");
        }
      } else if (submitting.size && requireConfirmation)
        throw new Error("Reconnect before finishing this series edit. Your draft is still here.");
      const known = etags.get(url);
      const latest = known?.previous.has(etag) ? known.current : etag;
      if (!strongEventEtag(latest)) {
        if (!requireConfirmation && submitting.size) return etag ?? "";
        throw new Error("Reload this event before saving");
      }
      return latest;
    },
    async save(write: EventWrite, requireConfirmation = false) {
      allowed(write);
      const current = binding;
      if (!options.demo && !current)
        throw new Error("Your storage is still opening. Please try again.");
      if (current) {
        await importing;
        check(current);
        await refresh(current);
      }
      const predecessor = [...visible(), ...submitting.values()]
        .filter((item) => item.write.url === write.url)
        .at(-1);
      if (predecessor?.write.kind === "delete") throw new Error("Reload this event before saving");
      const after = write.kind !== "create" ? predecessor?.write.data : undefined;
      const intent = decodeEventIntent(
        JSON.parse(JSON.stringify(eventIntent(write, crypto.randomUUID(), after))),
      );
      submitting.set(intent.id, intent);
      publish();
      const previous = attempts.get(write.url);
      const attempt = async () => {
        try {
          await previous;
          if (current) {
            check(current);
            await refresh(current);
          }
          if (options.demo) {
            await trackedSend(intent.write);
            demoOffline = false;
          } else {
            // The real-session check above guarantees this binding.
            const connected = current as Binding;
            const pending = retained.some((row) => row.intent?.write.url === write.url);
            if (pending) {
              if (requireConfirmation)
                throw new Error(
                  "Reconnect before finishing this series edit. Your draft is still here.",
                );
              await channel.enqueue(connected.outbox, intent);
            } else {
              const result = await channel.submit(connected.storage, intent);
              if (result.queued && requireConfirmation) {
                const rows = await channel.pending(connected.outbox);
                const row = rows.find((entry) => entry.intent?.id === intent.id);
                if (row) await connected.outbox.discard(row.id);
                throw new Error(
                  "Reconnect before finishing this series edit. Your draft is still here.",
                );
              }
            }
          }
          submitting.delete(intent.id);
        } catch (error) {
          if (
            options.demo &&
            error instanceof TypeError &&
            error.message === "Calendar network unavailable" &&
            !requireConfirmation
          ) {
            demoOffline = true;
            return;
          }
          submitting.delete(intent.id);
          throw error;
        } finally {
          if (current && binding === current && !current.signal.aborted) await refresh(current);
          publish();
        }
      };
      const task = attempt();
      active.add(task);
      attempts.set(write.url, task);
      try {
        await task;
      } finally {
        active.delete(task);
        if (attempts.get(write.url) === task) attempts.delete(write.url);
      }
    },
  };
}
