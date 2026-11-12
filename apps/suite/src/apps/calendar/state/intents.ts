// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import type { DatasetCore } from "@rdfjs/types";
import { isomorphic } from "rdf-isomorphic";
import { buildEvent, CalendarHttpError } from "../lib/model";
import type { SeriesReplacement } from "./editing";
import { type OutboxStorage, reviveEventWrite } from "./event-write";
import type { EventWrite } from "./repository";

type Create = Extract<EventWrite, { kind: "create" }>;
type Change = Exclude<EventWrite, { kind: "create" }>;
export interface SeriesIntent {
  created: Create;
  original: Change;
  replacementEtag?: string | null;
  attemptingOriginal?: boolean;
  rollback?: boolean;
  done?: boolean;
}
export const intentsKey = (webId: string) => `suite:calendar:intents:${webId}`;
const queues = new Map<string, Promise<unknown>>();

/** The outbox's storage seam, with an account envelope and model date revival. */
export class SeriesJournal {
  private memory: SeriesIntent[] = [];
  private available = true;
  constructor(
    readonly webId: string,
    private storage: OutboxStorage,
  ) {}
  list(): SeriesIntent[] {
    if (!this.available) return this.memory;
    let raw: string | null;
    try {
      raw = this.storage.getItem(intentsKey(this.webId));
    } catch {
      this.available = false;
      return this.memory;
    }
    try {
      if (!raw) return [];
      const envelope = JSON.parse(raw);
      if (envelope.v !== 1 || envelope.webId !== this.webId || !Array.isArray(envelope.intents))
        return [];
      return envelope.intents.map((intent: SeriesIntent) => {
        const created = reviveEventWrite(intent.created);
        const original = reviveEventWrite(intent.original);
        if (created.kind !== "create" || original.kind === "create" || created.url === original.url)
          throw new TypeError("Invalid series intent");
        return { ...intent, created, original };
      });
    } catch {
      return []; // Corrupt recovery data must never cause pod writes.
    }
  }
  put(intent: SeriesIntent): boolean {
    const entries = this.list().filter((entry) => entry.created.url !== intent.created.url);
    entries.push(intent);
    return this.store(entries);
  }
  remove(intent: SeriesIntent) {
    this.store(this.list().filter((entry) => entry.created.url !== intent.created.url));
  }
  private store(entries: SeriesIntent[]): boolean {
    this.memory = entries;
    if (!this.available) return false;
    try {
      this.storage.setItem(
        intentsKey(this.webId),
        JSON.stringify({ v: 1, webId: this.webId, intents: entries }),
      );
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }
  /** Cooperating tabs serialize recovery and foreground compound writes under the same key. */
  lock<T>(work: () => Promise<T>): Promise<T> {
    const key = intentsKey(this.webId);
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => {
        const locks = globalThis.navigator?.locks;
        return locks ? locks.request(key, work) : work();
      });
    queues.set(key, next);
    return next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  }
}
export interface SeriesRecovery {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  warn(message: string): void;
}
const conflictWarning =
  "An unfinished calendar edit changed elsewhere. Existing events were kept; you may see duplicate occurrences.";
const pendingWarning =
  "An unfinished calendar edit could not be recovered. It will retry when you reconnect or reopen Calendar.";
function strong(etag: string | null | undefined): etag is string {
  return Boolean(etag && etag !== "*" && !etag.startsWith("W/"));
}

/** Compound writes have one owner: they never also enter the single-write offline queue. */
export function createSeriesIntents(
  webId: string,
  storage: OutboxStorage,
  send: (write: EventWrite) => Promise<unknown>,
  allowed: (write: EventWrite) => void,
  recovery: SeriesRecovery,
) {
  const journal = new SeriesJournal(webId, storage);
  const fetch = createPodScopedFetch(recovery.storageUrl, { fetch: recovery.fetch });
  async function read(url: string) {
    try {
      return await fetchRdf(url, { fetch, headers: { "Cache-Control": "no-cache" } });
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return undefined;
      throw error;
    }
  }
  const matches = (
    document: { dataset: DatasetCore },
    write: Create | Extract<Change, { kind: "update" }>,
  ) => isomorphic([...document.dataset], [...buildEvent(write.url, write.data)]);
  function stop(intent: SeriesIntent, warn = false) {
    journal.remove(intent);
    if (warn) recovery.warn(conflictWarning);
  }
  async function compensate(intent: SeriesIntent) {
    intent.rollback = true;
    journal.put(intent);
    const replacement = await read(intent.created.url);
    if (!replacement) return stop(intent);
    if (
      !strong(replacement.etag) ||
      (intent.replacementEtag !== undefined && intent.replacementEtag !== null
        ? replacement.etag !== intent.replacementEtag
        : !matches(replacement, intent.created))
    )
      return stop(intent, true);
    // Persist the adopted ETag before deletion, including after an unacknowledged create.
    intent.replacementEtag = replacement.etag;
    journal.put(intent);
    try {
      await send({ kind: "delete", url: intent.created.url, etag: replacement.etag });
    } catch (error) {
      if (!(error instanceof CalendarHttpError)) throw error;
      if (error.status === 412) return stop(intent, true);
      if (error.status !== 404) throw error;
    }
    stop(intent);
  }
  async function replay(intent: SeriesIntent, reconcile = true): Promise<void> {
    allowed(intent.created);
    allowed(intent.original);
    if (intent.done) return stop(intent);
    const original = await read(intent.original.url);
    // The second response/checkpoint may have been lost. Identical RDF or absence is success.
    if (
      intent.attemptingOriginal &&
      (intent.original.kind === "delete"
        ? !original
        : original && matches(original, intent.original))
    )
      return stop(intent);
    if (intent.rollback || !original || original.etag !== intent.original.etag)
      return compensate(intent);
    let replacement = await read(intent.created.url);
    if (!replacement) {
      if (intent.replacementEtag !== undefined) return stop(intent, true);
      const etag = await send(intent.created);
      intent.replacementEtag = typeof etag === "string" ? etag : null;
      journal.put(intent);
      replacement = await read(intent.created.url);
    }
    if (
      !replacement ||
      !strong(replacement.etag) ||
      (intent.replacementEtag != null
        ? replacement.etag !== intent.replacementEtag
        : !matches(replacement, intent.created))
    )
      return stop(intent, true);
    intent.replacementEtag = replacement.etag;
    intent.attemptingOriginal = true;
    journal.put(intent);
    try {
      await send(intent.original);
    } catch (error) {
      if (reconcile && error instanceof CalendarHttpError && error.status === 412)
        return replay(intent, false);
      throw error;
    }
    intent.done = true;
    journal.put(intent);
    stop(intent);
  }
  return {
    lock: <T>(work: () => Promise<T>) => journal.lock(work),
    async recover() {
      for (const intent of journal.list()) {
        try {
          await replay(intent);
        } catch {
          recovery.warn(pendingWarning);
        }
      }
    },
    async run(created: Create, original: Change, replacement: SeriesReplacement): Promise<boolean> {
      const pending = journal.list().find((entry) => entry.original.url === original.url);
      if (pending) {
        replacement.current = {
          url: pending.created.url,
          etag: pending.replacementEtag ?? null,
          durable: true,
        };
        throw new Error("Reconnect to retry cleanup before editing this series.");
      }
      // An unavailable journal leaves the existing in-memory writer in charge.
      const intent: SeriesIntent = { created, original };
      allowed(created);
      allowed(original);
      if (!journal.put(intent)) {
        journal.remove(intent);
        return false;
      }
      try {
        const etag = await send(created);
        intent.replacementEtag = typeof etag === "string" ? etag : null;
        replacement.current = { url: created.url, etag: intent.replacementEtag, durable: true };
        journal.put(intent);
        if (!strong(intent.replacementEtag)) throw new Error("Reload this event before saving");
        intent.attemptingOriginal = true;
        journal.put(intent);
        await send(original);
        intent.done = true;
        journal.put(intent);
        stop(intent);
        replacement.current = undefined;
        return true;
      } catch (error) {
        try {
          // A lost original response must be reconciled before removing its replacement.
          intent.rollback = true;
          journal.put(intent);
          await replay(intent);
          replacement.current = undefined;
        } catch {
          recovery.warn(pendingWarning);
        }
        throw error;
      }
    },
  };
}
