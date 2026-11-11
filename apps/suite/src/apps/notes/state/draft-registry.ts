// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import type { NotesStore, StoredNote } from "../lib/model/store";
import { createPendingDrafts, type PendingDraft } from "./pending-drafts";

const draft = z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()) });
const optionalText = z.string().optional();
const stored = draft.extend({
  url: z.url(),
  etag: z.string().nullable(),
  location: z.enum(["active", "archived", "trashed"]),
  previous: z.enum(["active", "archived"]).optional(),
  trashedAt: optionalText,
  reminder: optionalText,
  format: z.string(),
  created: optionalText,
  modified: optionalText,
  creator: optionalText,
  revisions: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      format: z.string(),
      generatedAt: z.string(),
      label: optionalText,
      attributedTo: optionalText,
      wasRevisionOf: optionalText,
    }),
  ),
});
const snapshot = z.object({
  note: stored,
  draft,
  status: z.enum(["saving", "failed", "conflict"]),
});
type RegistryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
interface RegistrySeams {
  storage: RegistryStorage;
  tabId?: string;
  now: () => number;
}

const TAB_KEY = "suite.notes.tab-id";
export const HEARTBEAT_TTL = 30_000;
export const heartbeatKey = (id: string) => `suite.notes.heartbeat:${id}`;

/** A heartbeat younger than the TTL means a live page owns that tab id. */
export function heartbeatLive(storage: Pick<Storage, "getItem">, id: string, now: number) {
  const last = storage.getItem(heartbeatKey(id));
  return last !== null && Number.isFinite(Number(last)) && now - Number(last) <= HEARTBEAT_TTL;
}

let pageTabId: string | undefined;
/**
 * The tab id lives in sessionStorage so a reload keeps its own drafts. A page
 * clears its heartbeat on pagehide, so a reload finds no live heartbeat and
 * reuses the id; a duplicated tab copies sessionStorage while the original is
 * still live, so it sees a fresh heartbeat and takes a new id.
 */
function getTabId(): string {
  if (pageTabId) return pageTabId;
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    pageTabId =
      saved && !heartbeatLive(localStorage, saved, Date.now()) ? saved : crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, pageTabId);
  } catch {
    pageTabId ??= crypto.randomUUID();
  }
  return pageTabId;
}

/** Independent tabs own independent durable snapshots, including for the same note. */
export function createDraftRegistry(webId: string, seams: RegistrySeams) {
  const { storage, now, tabId = getTabId() } = seams;
  const key = `suite.notes.pending-drafts.${webId}`;
  const prefix = `${key}:`;
  const heartbeat = () => {
    try {
      storage.setItem(heartbeatKey(tabId), String(now()));
    } catch {
      // Storage failure must not prevent editing or the unload prompt.
    }
  };
  /** On pagehide: this page no longer owns its tab id, so a reload may reuse it. */
  const release = () => {
    try {
      storage.removeItem(heartbeatKey(tabId));
    } catch {
      // Without storage the heartbeat simply goes stale.
    }
  };
  heartbeat();
  const envelope = z.object({
    version: z.literal(3),
    webId: z.literal(webId),
    tabId: z.string().min(1),
    updatedAt: z.number().finite(),
    revision: z.string().min(1),
    snapshot,
    claims: z.array(z.object({ key: z.string(), revision: z.string() })).optional(),
  });
  const oldEnvelope = envelope
    .omit({ tabId: true, updatedAt: true })
    .extend({ version: z.literal(2) });
  const storageKeys = () =>
    Array.from({ length: storage.length }, (_, index) => storage.key(index) as string);
  const noteKey = (url: string) => `${prefix}${url}:${tabId}`;
  const initial = new Map<string, PendingDraft>();
  const persisted = new Map<string, { entry: PendingDraft; revision: string }>();
  const claimed = new Map<string, Map<string, string>>();
  const removeExact = (storageKey: string, text: string) => {
    try {
      if (storage.getItem(storageKey) === text) storage.removeItem(storageKey);
    } catch {
      // Retain recovery whenever storage ownership cannot be checked.
    }
  };
  const write = (entry: PendingDraft) => {
    const revision = crypto.randomUUID();
    storage.setItem(
      noteKey(entry.note.url),
      JSON.stringify({
        version: 3,
        webId,
        tabId,
        updatedAt: now(),
        revision,
        snapshot: entry,
        claims: [...(claimed.get(entry.note.url) ?? [])].map(([key, revision]) => ({
          key,
          revision,
        })),
      }),
    );
    persisted.set(entry.note.url, { entry, revision });
  };
  try {
    // Own snapshots survive reload regardless of the heartbeat's age.
    for (const storageKey of storageKeys()) {
      if (!storageKey.startsWith(prefix)) continue;
      try {
        const record = envelope.parse(JSON.parse(storage.getItem(storageKey) ?? "null"));
        if (record.tabId !== tabId || storageKey !== noteKey(record.snapshot.note.url)) continue;
        initial.set(record.snapshot.note.url, record.snapshot);
        claimed.set(
          record.snapshot.note.url,
          new Map(
            (record.claims ?? [])
              .filter((claim) => claim.key.startsWith(`${prefix}${record.snapshot.note.url}:`))
              .map((claim) => [claim.key, claim.revision]),
          ),
        );
        persisted.set(record.snapshot.note.url, {
          entry: record.snapshot,
          revision: record.revision,
        });
      } catch {
        // One invalid record does not hide other drafts.
      }
    }
    const legacyText = storage.getItem(key);
    const legacy = z.object({
      version: z.literal(1),
      webId: z.literal(webId),
      drafts: z.array(snapshot),
    });
    let parsed = legacy.safeParse(undefined);
    try {
      parsed = legacy.safeParse(JSON.parse(legacyText ?? "null"));
    } catch {
      // Damaged aggregate recovery must not hide valid round-2 per-note records.
    }
    const old = new Map<string, PendingDraft>(
      parsed.success ? parsed.data.drafts.map((entry) => [entry.note.url, entry]) : [],
    );
    const oldKeys = new Map<string, string>();
    for (const storageKey of storageKeys()) {
      if (!storageKey.startsWith(prefix)) continue;
      try {
        const text = storage.getItem(storageKey) as string;
        const record = oldEnvelope.parse(JSON.parse(text));
        if (storageKey !== `${prefix}${record.snapshot.note.url}`) continue;
        old.set(record.snapshot.note.url, record.snapshot);
        oldKeys.set(storageKey, text);
      } catch {
        // A damaged legacy record cannot replace valid recovery.
      }
    }
    for (const entry of old.values()) {
      if (initial.has(entry.note.url)) continue;
      initial.set(entry.note.url, entry);
      write(entry);
    }
    for (const [storageKey, text] of oldKeys) removeExact(storageKey, text);
    if (parsed.success) removeExact(key, legacyText as string);
  } catch {
    // Migration failure keeps both in-memory and original durable recovery.
  }
  const pending = createPendingDrafts({
    initial: [...initial.values()],
    saved(url) {
      for (const [storageKey, revision] of claimed.get(url) ?? []) {
        try {
          const text = storage.getItem(storageKey) as string;
          if (envelope.parse(JSON.parse(text)).revision === revision) removeExact(storageKey, text);
        } catch {
          // Leave changed or damaged source records alone.
        }
      }
      claimed.delete(url);
    },
    persist(entries) {
      const urls = new Set(entries.map((entry) => entry.note.url));
      for (const entry of entries) {
        if (persisted.get(entry.note.url)?.entry === entry) continue;
        try {
          write(entry);
        } catch {
          // Keep the in-memory draft and prompt until its save succeeds.
        }
      }
      for (const [url, { revision }] of persisted) {
        if (urls.has(url)) continue;
        try {
          const storageKey = noteKey(url);
          const record = envelope.parse(JSON.parse(storage.getItem(storageKey) ?? "null"));
          if (record.revision === revision) storage.removeItem(storageKey);
          persisted.delete(url);
        } catch {
          // Do not remove a key whose ownership cannot be established.
        }
      }
    },
  });
  const recovering = new Map<string, Promise<void>>();
  const recover = (note: StoredNote, create: NotesStore["create"]): Promise<void> => {
    const running = recovering.get(note.url);
    if (running) return running;
    const work = async () => {
      const orphans: { storageKey: string; text: string; record: z.infer<typeof envelope> }[] = [];
      const sources = new Set<string>();
      try {
        for (const storageKey of storageKeys()) {
          if (!storageKey.startsWith(prefix)) continue;
          try {
            const text = storage.getItem(storageKey) as string;
            const record = envelope.parse(JSON.parse(text));
            if (
              record.tabId === tabId ||
              claimed.get(note.url)?.get(storageKey) === record.revision ||
              record.snapshot.note.url !== note.url ||
              storageKey !== `${prefix}${note.url}:${record.tabId}`
            )
              continue;
            for (const claim of record.claims ?? [])
              sources.add(`${claim.key}\u0000${claim.revision}`);
            if (heartbeatLive(storage, record.tabId, now())) continue;
            orphans.push({ storageKey, text, record });
          } catch {
            // Ignore invalid and foreign records.
          }
        }
      } catch {
        return;
      }
      orphans.sort((a, b) => b.record.updatedAt - a.record.updatedAt);
      // A recovered snapshot can itself become orphaned on reload. Its sources
      // are the same edits, not extra drafts to turn into separate notes.
      const independent = orphans.filter(
        ({ storageKey, record }) => !sources.has(`${storageKey}\u0000${record.revision}`),
      );
      if (!pending.get(note.url) && independent.length) {
        const newest = independent.shift() as (typeof orphans)[number];
        claimed.set(
          note.url,
          new Map([
            ...(newest.record.claims ?? [])
              .filter((claim) => claim.key.startsWith(`${prefix}${note.url}:`))
              .map(({ key, revision }) => [key, revision] as const),
            [newest.storageKey, newest.record.revision],
          ]),
        );
        pending.restore(newest.record.snapshot);
      }
      for (const orphan of independent) {
        try {
          const { draft } = orphan.record.snapshot;
          await create({ ...draft, title: `${draft.title} (recovered)` });
          for (const claim of orphan.record.claims ?? []) {
            if (!claim.key.startsWith(`${prefix}${note.url}:`)) continue;
            try {
              const text = storage.getItem(claim.key);
              if (text && envelope.parse(JSON.parse(text)).revision === claim.revision)
                removeExact(claim.key, text);
            } catch {
              // Damaged sources must not make a successful creation run twice.
            }
          }
          removeExact(orphan.storageKey, orphan.text);
        } catch {
          // Leave failed recoveries durable for the next open/retry.
        }
      }
    };
    const promise = work();
    recovering.set(note.url, promise);
    void promise.finally(() => recovering.delete(note.url));
    return promise;
  };
  return { ...pending, tabId, heartbeat, release, recover };
}
export type DraftRegistry = ReturnType<typeof createDraftRegistry>;
const registries = new Map<string, DraftRegistry>();

/** One registry per browser document; storage survives reload even if its PUT is cancelled. */
export function getPendingDrafts(webId: string): DraftRegistry {
  const existing = registries.get(webId);
  if (existing) return existing;
  // Defer storage access through methods so unavailable browser storage remains recoverable in memory.
  const storage: RegistryStorage = {
    get length() {
      return localStorage.length;
    },
    key: (index) => localStorage.key(index),
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
  const pending = createDraftRegistry(webId, {
    storage,
    now: Date.now,
  });
  const retry = () => void pending.retry();
  if (typeof window !== "undefined") {
    setInterval(pending.heartbeat, 10_000);
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", (event) => {
      retry();
      // A page entering the back/forward cache is still alive: keep its heartbeat.
      if (!event.persisted) pending.release();
    });
    window.addEventListener("pageshow", (event) => {
      // Restored from the back/forward cache: this page is live again.
      if (event.persisted) pending.heartbeat();
    });
    window.addEventListener("beforeunload", (event) => {
      pending.beforeUnload(event);
      retry();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") retry();
    });
  }
  registries.set(webId, pending);
  return pending;
}
