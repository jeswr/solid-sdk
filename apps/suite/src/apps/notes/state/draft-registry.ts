// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { createPendingDrafts, type PendingDraft, type PendingDrafts } from "./pending-drafts";

const draft = z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()) });
const optionalText = z.string().optional();
const stored = draft.extend({
  url: z.url(),
  etag: z.string().nullable(),
  location: z.enum(["active", "archived", "trashed"]),
  previous: z.enum(["active", "archived"]).optional(),
  trashedAt: optionalText,
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
const registries = new Map<string, PendingDrafts>();

/** One registry per browser document; storage survives reload even if its PUT is cancelled. */
export function getPendingDrafts(webId: string): PendingDrafts {
  const registry = registries.get(webId);
  if (registry) return registry;
  const key = `suite.notes.pending-drafts.${webId}`;
  const prefix = `${key}:`;
  const envelope = z.object({
    version: z.literal(2),
    webId: z.literal(webId),
    revision: z.string().min(1),
    snapshot,
  });
  const initial = new Map<string, PendingDraft>();
  const persisted = new Map<string, { entry: PendingDraft; revision: string }>();
  const write = (entry: PendingDraft) => {
    const revision = crypto.randomUUID();
    localStorage.setItem(
      `${prefix}${entry.note.url}`,
      JSON.stringify({ version: 2, webId, revision, snapshot: entry }),
    );
    persisted.set(entry.note.url, { entry, revision });
  };
  try {
    const legacyText = localStorage.getItem(key);
    const legacy = z.object({
      version: z.literal(1),
      webId: z.literal(webId),
      drafts: z.array(snapshot),
    });
    const parsed = legacy.safeParse(JSON.parse(legacyText ?? "null"));
    if (parsed.success) {
      // Never replace a newer per-note draft; retain the envelope if migration
      // cannot finish, so a storage failure cannot discard legacy recovery.
      for (const entry of parsed.data.drafts) initial.set(entry.note.url, entry);
      for (const entry of parsed.data.drafts) {
        const text = localStorage.getItem(`${prefix}${entry.note.url}`);
        let migrated = false;
        try {
          const record = envelope.parse(JSON.parse(text ?? "null"));
          migrated = record.snapshot.note.url === entry.note.url;
        } catch {
          // A damaged per-note record cannot replace valid legacy recovery.
        }
        if (!migrated) write(entry);
      }
      if (localStorage.getItem(key) === legacyText) localStorage.removeItem(key);
    }
  } catch {
    // Unavailable or damaged legacy storage must not prevent per-note recovery.
  }
  try {
    for (const storageKey of Object.keys(localStorage)) {
      if (!storageKey.startsWith(prefix)) continue;
      try {
        const record = envelope.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
        const entry = record.snapshot;
        if (storageKey !== `${prefix}${entry.note.url}`) continue;
        initial.set(entry.note.url, entry);
        persisted.set(entry.note.url, { entry, revision: record.revision });
      } catch {
        // One damaged or foreign record does not hide other recoverable drafts.
      }
    }
  } catch {
    // In-memory recovery and the unload prompt still work without storage.
  }
  const pending = createPendingDrafts({
    initial: [...initial.values()],
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
          const storageKey = `${prefix}${url}`;
          const record = envelope.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
          // Another tab may own a newer recovery snapshot for the same note.
          if (record.revision === revision) localStorage.removeItem(storageKey);
          persisted.delete(url);
        } catch {
          // Do not remove a key whose ownership cannot be established.
        }
      }
    },
  });
  const retry = () => void pending.retry();
  if (typeof window !== "undefined") {
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", retry);
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
