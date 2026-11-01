// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { DomainItem } from "../../lib/model/discovery";
import { linkedProtectedDocument, protectedDocument } from "../../state/protected-document";
import type { HomeSession } from "../../state/use-domain-items";
import { isContainer, readItem } from "./data";

export const UNDO_MS = 8_000;
/** What survives a reload. Item content is never copied into browser storage. */
interface Tombstone {
  url: string;
  etag: string;
  deleteAt: number;
}
interface PendingDelete {
  tombstone: Tombstone;
  /** This page's captured copy; a resumed entry has none because nothing was removed yet. */
  restore?: { body: string | Uint8Array<ArrayBuffer>; contentType: string };
  /** Whether the tombstone reached browser storage, so other tabs can cancel it. */
  durable: boolean;
  timer: ReturnType<typeof setTimeout>;
  committing: boolean;
}
const same = (a: Tombstone, b: Tombstone) =>
  a.url === b.url && a.etag === b.etag && a.deleteAt === b.deleteAt;

/** Pending deletions keyed by account and storage; unavailable storage reads as empty. */
function tombstoneQueue(session: HomeSession) {
  const key = `suite.home.pending-deletes:${session.webId}\u0000${session.storageUrl}`;
  const read = (): Tombstone[] => {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Tombstone =>
        typeof entry?.url === "string" &&
        typeof entry.etag === "string" &&
        Number.isFinite(entry.deleteAt),
    );
  };
  return {
    entries(): Tombstone[] | undefined {
      try {
        return read();
      } catch {
        return undefined;
      }
    },
    /** Read-modify-write so another tab's tombstones are kept. */
    update(change: (entries: Tombstone[]) => Tombstone[]): boolean {
      try {
        const next = change(read());
        if (next.length) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Session-scoped tombstones fence live/focus refreshes. They are also kept in
 * browser storage for this account, so a reload or closed tab during the undo
 * window finishes the deletion on the next load instead of silently cancelling it.
 */
export function createDeleteController(
  session: HomeSession,
  refresh: () => Promise<void>,
  resumedError: () => void = () => {},
) {
  let hidden: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const reading = new Set<string>();
  const pending = new Map<string, PendingDelete>();
  const queue = tombstoneQueue(session);
  const profileUrl = session.webId.split("#")[0] as string;
  const publish = (url: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(url);
    else next.delete(url);
    hidden = next;
    for (const listener of listeners) listener();
  };
  const forget = (entry: PendingDelete) => {
    pending.delete(entry.tombstone.url);
    queue.update((entries) => entries.filter((other) => !same(other, entry.tombstone)));
    publish(entry.tombstone.url, false);
  };
  const commit = async (entry: PendingDelete, resumed: boolean) => {
    const { url, etag } = entry.tombstone;
    // Undo in another tab removes the shared tombstone; respect it.
    const queued = entry.durable ? queue.entries() : undefined;
    if (queued && !queued.some((other) => same(other, entry.tombstone))) return;
    if (resumed) {
      // Re-check protection: browser storage is not a trusted source of targets.
      const read = await readItem(session, url);
      if (
        isContainer(read.item) ||
        protectedDocument(read.item, session.storageUrl, session.webId) ||
        (await linkedProtectedDocument(session, url))
      )
        throw new Error("This item can't be deleted");
    }
    const response = await session.fetch(url, {
      method: "DELETE",
      redirect: "error",
      headers: { "if-match": etag },
    });
    if (!response.ok && response.status !== 404) throw new Error("Delete failed");
    await refresh();
  };
  const schedule = (
    tombstone: Tombstone,
    onError: () => void,
    restore?: PendingDelete["restore"],
  ): PendingDelete => {
    const entry: PendingDelete = {
      tombstone,
      ...(restore ? { restore } : {}),
      durable: !restore,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      committing: false,
    };
    pending.set(tombstone.url, entry);
    publish(tombstone.url, true);
    entry.timer = setTimeout(
      () => {
        entry.committing = true;
        void commit(entry, !restore)
          .catch(onError)
          .finally(() => forget(entry));
      },
      Math.max(0, tombstone.deleteAt - Date.now()),
    );
    return entry;
  };
  if (typeof localStorage !== "undefined")
    for (const tombstone of queue.entries() ?? []) {
      try {
        const url = assertWithinPodScope(session.storageUrl, tombstone.url);
        if (url !== tombstone.url || url === profileUrl || pending.has(url)) continue;
      } catch {
        continue;
      }
      schedule(tombstone, resumedError);
    }
  return {
    getSnapshot: () => hidden,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async remove(item: DomainItem, onError: () => void): Promise<boolean> {
      if (
        pending.has(item.url) ||
        reading.has(item.url) ||
        isContainer(item) ||
        protectedDocument(item, session.storageUrl, session.webId)
      )
        return false;
      reading.add(item.url);
      try {
        const read = await readItem(session, item.url, item.subject);
        if (
          !read.writable ||
          isContainer(read.item) ||
          !read.item.etag ||
          protectedDocument(read.item, session.storageUrl, session.webId) ||
          (await linkedProtectedDocument(session, item.url))
        )
          return false;
        const target = assertWithinPodScope(session.storageUrl, item.url);
        const tombstone = { url: target, etag: read.item.etag, deleteAt: Date.now() + UNDO_MS };
        const entry = schedule(tombstone, onError, {
          body: read.body,
          contentType: read.contentType,
        });
        // Without browser storage the deletion still runs from this page's timer.
        entry.durable = queue.update((entries) => [
          ...entries.filter((other) => other.url !== target),
          tombstone,
        ]);
        return true;
      } finally {
        reading.delete(item.url);
      }
    },
    async undo(url: string): Promise<boolean> {
      const entry = pending.get(url);
      if (!entry || entry.committing) return false;
      clearTimeout(entry.timer);
      try {
        // A resumed entry was never removed: cancelling its tombstone is the undo.
        if (entry.restore) {
          const { body, contentType } = entry.restore;
          // Normally the delayed DELETE has not run. The create-only PUT also safely restores
          // a resource removed elsewhere during the undo window, without overwriting a new one.
          const response = await session.fetch(url, {
            method: "PUT",
            redirect: "error",
            headers: { "content-type": contentType, "if-none-match": "*" },
            body,
          });
          if (!response.ok && response.status !== 412) throw new Error("Restore failed");
          if (response.status === 412) {
            // The original is still in place. Re-write it only while its captured validator
            // still matches, so Undo has a fresh version without replacing a concurrent edit.
            const restored = await session.fetch(url, {
              method: "PUT",
              redirect: "error",
              headers: { "content-type": contentType, "if-match": entry.tombstone.etag },
              body,
            });
            if (!restored.ok && restored.status !== 412) throw new Error("Restore failed");
          }
        }
        await refresh();
        return true;
      } finally {
        forget(entry);
      }
    },
    /** Stop this page's timers while keeping the durable queue for the next load. */
    dispose() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
    },
  };
}
