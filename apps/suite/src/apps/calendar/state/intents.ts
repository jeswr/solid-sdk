// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch, podScopedUrl } from "@jeswr/guarded-fetch";
import {
  browserIntentStorage,
  DurableJournal,
  type IntentStorage,
  withJournalLock,
} from "@jeswr/solid-offline/journal";
import type { DatasetCore } from "@rdfjs/types";
import { isomorphic } from "rdf-isomorphic";
import { buildEvent, CalendarHttpError } from "../lib/model";
import type { SeriesMode, SeriesReplacement } from "./editing";
import { reviveEventWrite } from "./outbox";
import type { EventWrite } from "./repository";

type Create = Extract<EventWrite, { kind: "create" }>;
type Change = Exclude<EventWrite, { kind: "create" }>;
export interface SeriesOperation {
  mode: SeriesMode;
  action: "edit" | "delete";
}
export interface SeriesIntent {
  v: 1;
  id: string;
  startedAt: string;
  webId: string;
  storageUrl: string;
  operation: SeriesOperation;
  created: Create;
  original: Change;
  replacementEtag?: string | null;
  attemptingOriginal?: boolean;
  rollback?: boolean;
  done?: boolean;
}
export const intentsKey = (webId: string, storageUrl: string) =>
  `solid-suite:calendar:intent:${encodeURIComponent(webId)}:${encodeURIComponent(new URL(storageUrl).href)}:`;

/** One versioned record per operation, scoped to the authenticated account and pod. */
function decodeSeriesIntent(value: unknown, webId: string, storageUrl: string): SeriesIntent {
  const intent = value as SeriesIntent;
  if (
    intent.v !== 1 ||
    intent.webId !== webId ||
    intent.storageUrl !== storageUrl ||
    typeof intent.id !== "string" ||
    !intent.id ||
    typeof intent.startedAt !== "string" ||
    !["this", "following", "all"].includes(intent.operation.mode) ||
    !["edit", "delete"].includes(intent.operation.action)
  )
    throw new TypeError("Calendar recovery record is invalid.");
  const created = reviveEventWrite(intent.created);
  const original = reviveEventWrite(intent.original);
  if (created.kind !== "create" || original.kind === "create" || created.url === original.url)
    throw new TypeError("Invalid series intent");
  for (const field of ["attemptingOriginal", "rollback", "done"] as const)
    if (intent[field] !== undefined && typeof intent[field] !== "boolean")
      throw new TypeError("Invalid series checkpoint");
  if (intent.replacementEtag != null && typeof intent.replacementEtag !== "string")
    throw new TypeError("Invalid replacement ETag");
  return { ...intent, created, original };
}

const legacyKey = (webId: string) => `suite:calendar:intents:${webId}`;
const legacyHandoffs = new Set<string>();
type LegacyIntent = Pick<
  SeriesIntent,
  "created" | "original" | "replacementEtag" | "attemptingOriginal" | "rollback" | "done"
>;

export class SeriesJournal extends DurableJournal<SeriesIntent> {
  constructor(
    private webId: string,
    private storageUrl: string,
    warn: (message: string) => void,
    private source: () => IntentStorage = browserIntentStorage,
  ) {
    storageUrl = new URL(storageUrl).href;
    super(
      intentsKey(webId, storageUrl),
      (value) => decodeSeriesIntent(value, webId, storageUrl),
      warn,
      "This browser cannot save Calendar recovery. Keep this tab open until saving finishes; recovery will be lost on reload.",
      source,
    );
    this.storageUrl = storageUrl;
  }
  /** Copy checkpoints durably before retiring the old account-wide envelope. */
  migrateLegacy(): Promise<void> {
    // Other pods of this account can share the legacy envelope. Serialize its handoff too.
    return withJournalLock(legacyKey(this.webId), async () => {
      let storage: IntentStorage;
      let raw: string | null;
      try {
        storage = this.source();
        raw = storage.getItem(legacyKey(this.webId));
      } catch (error) {
        // New journals retain their normal memory fallback when no legacy handoff is known.
        if (legacyHandoffs.has(legacyKey(this.webId))) throw error;
        return;
      }
      if (raw === null) {
        legacyHandoffs.delete(legacyKey(this.webId));
        return;
      }
      legacyHandoffs.add(legacyKey(this.webId));
      let records: unknown[];
      try {
        const envelope = JSON.parse(raw);
        if (envelope.v !== 1 || envelope.webId !== this.webId || !Array.isArray(envelope.intents))
          throw new TypeError("Invalid legacy calendar journal");
        records = envelope.intents;
      } catch {
        storage.removeItem(legacyKey(this.webId));
        legacyHandoffs.delete(legacyKey(this.webId));
        return;
      }
      const existing = new Map(super.list().map((entry) => [entry.id, entry]));
      const remaining: unknown[] = [];
      for (const record of records) {
        let intent: SeriesIntent;
        try {
          const saved = record as LegacyIntent;
          intent = decodeSeriesIntent(
            {
              v: 1,
              id: `legacy:${saved.created.url}`,
              startedAt: "1970-01-01T00:00:00.000Z",
              webId: this.webId,
              storageUrl: this.storageUrl,
              operation: {
                mode: saved.created.data.recurrence ? "following" : "this",
                action: "edit",
              },
              created: saved.created,
              original: saved.original,
              replacementEtag: saved.replacementEtag,
              attemptingOriginal: saved.attemptingOriginal,
              rollback: saved.rollback,
              done: saved.done,
            },
            this.webId,
            this.storageUrl,
          );
          const createdUrl = new URL(intent.created.url);
          const originalUrl = new URL(intent.original.url);
          const urls = [createdUrl, originalUrl];
          if (
            urls.some(
              (url) =>
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password ||
                url.hash ||
                url.search ||
                url.pathname.endsWith("/"),
            ) ||
            createdUrl.origin !== originalUrl.origin
          )
            throw new TypeError("Invalid legacy event URLs");
          const inPod = urls.map((url) =>
            Boolean(podScopedUrl(this.storageUrl, url.href, { allowRoot: false })),
          );
          if (!inPod.every(Boolean)) {
            // A valid operation belonging wholly to another pod must remain available there.
            if (inPod.every((inside) => !inside)) remaining.push(record);
            continue;
          }
        } catch {
          continue; // Invalid legacy data must never become pod writes.
        }
        const checkpoint = existing.get(intent.id) ?? intent;
        if (!super.put(checkpoint)) {
          // Memory alone cannot authorize retiring a durable source or replaying it twice.
          super.remove(checkpoint);
          throw new Error("Calendar recovery migration needs durable storage.");
        }
        existing.set(intent.id, checkpoint);
      }
      if (remaining.length !== records.length || !records.length) {
        if (remaining.length)
          storage.setItem(
            legacyKey(this.webId),
            JSON.stringify({ v: 1, webId: this.webId, intents: remaining }),
          );
        else storage.removeItem(legacyKey(this.webId));
      }
      legacyHandoffs.delete(legacyKey(this.webId));
    });
  }
}
export interface SeriesRecovery {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  warn(message: string): void;
  notice(message: string): void;
  journalStorage?: () => IntentStorage;
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
  send: (write: EventWrite) => Promise<unknown>,
  allowed: (write: EventWrite) => void,
  recovery: SeriesRecovery,
) {
  const journal = new SeriesJournal(
    webId,
    recovery.storageUrl,
    recovery.warn,
    recovery.journalStorage,
  );
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
    return !warn;
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
    return stop(intent);
  }
  async function replay(intent: SeriesIntent, reconcile = true): Promise<boolean> {
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
    return stop(intent);
  }
  async function recover() {
    let entries: SeriesIntent[];
    try {
      await journal.migrateLegacy();
      entries = journal.list();
    } catch {
      recovery.warn(
        "Calendar recovery data could not be read. Existing events were kept; recovery needs attention.",
      );
      return false;
    }
    for (const intent of entries) {
      try {
        if (await replay(intent)) recovery.notice("An unfinished calendar edit was recovered.");
      } catch {
        recovery.warn(pendingWarning);
      }
    }
    return journal.list().length === 0;
  }
  return {
    lock: <T>(work: () => Promise<T>) => journal.lock(work),
    recover: () => journal.lock(recover),
    recoverLocked: recover,
    assertAvailable(url: string) {
      if (journal.list().some((entry) => entry.created.url === url || entry.original.url === url))
        throw new Error(
          "Reconnect to recover the unfinished calendar edit before changing this event.",
        );
    },
    async run(
      created: Create,
      original: Change,
      replacement: SeriesReplacement,
      operation: SeriesOperation = { mode: "this", action: "edit" },
    ): Promise<boolean> {
      await journal.migrateLegacy();
      const pending = journal.list().find((entry) => entry.original.url === original.url);
      if (pending) {
        replacement.current = {
          url: pending.created.url,
          etag: pending.replacementEtag ?? null,
          durable: true,
        };
        throw new Error("Reconnect to retry cleanup before editing this series.");
      }
      const intent: SeriesIntent = {
        v: 1,
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        webId,
        storageUrl: new URL(recovery.storageUrl).href,
        operation,
        created,
        original,
      };
      allowed(created);
      allowed(original);
      // Flushing recovery may have just completed an earlier edit of this master.
      // Refuse its stale editor plan before it can create a second replacement.
      const master = await read(original.url);
      if (!master || master.etag !== original.etag)
        throw new Error("Reload this series before saving; it changed while recovery finished.");
      journal.put(intent);
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
        // A rejected create never owned the occupied destination, even when its RDF
        // happens to match. Only an uncertain create may be adopted for compensation.
        if (
          error instanceof CalendarHttpError &&
          error.status === 412 &&
          intent.replacementEtag === undefined
        ) {
          stop(intent, true);
          throw error;
        }
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
