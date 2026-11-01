// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { DomainItem } from "../../lib/model/discovery";
import { linkedProtectedDocument, protectedDocument } from "../../state/protected-document";
import type { HomeSession } from "../../state/use-domain-items";
import { ItemReadError, isContainer, readItem } from "./data";

export const UNDO_MS = 8_000;
/**
 * While a toast holds a deletion (its timer pauses on hover and focus), this page's own
 * timer waits this much longer before committing anyway, e.g. when no toast is shown.
 */
export const HOLD_GRACE_MS = 30_000;
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
  /** Undo has started; a late toast close must not commit. */
  undoing: boolean;
  onError: () => void;
  /** Called once when the DELETE starts, so an Undo toast can be dismissed. */
  onStart?: () => void;
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
  /** The item is already gone (e.g. another tab finished this deletion). */
  const gone = async (url: string) =>
    (await session.fetch(url, { method: "HEAD", redirect: "error" })).status === 404;
  /** False once another tab undid or finished this deletion and removed its shared tombstone. */
  const stillQueued = (entry: PendingDelete) => {
    const queued = entry.durable ? queue.entries() : undefined;
    return !queued || queued.some((other) => same(other, entry.tombstone));
  };
  const commit = async (entry: PendingDelete, resumed: boolean) => {
    const { url, etag } = entry.tombstone;
    // Undo in another tab removes the shared tombstone; respect it.
    // Refresh so the card doesn't reappear when it was deleted (or restored) elsewhere.
    if (!stillQueued(entry)) {
      await refresh();
      return;
    }
    if (resumed) {
      // Re-check protection: browser storage is not a trusted source of targets.
      let read: Awaited<ReturnType<typeof readItem>>;
      try {
        read = await readItem(session, url);
      } catch (error) {
        // Another tab already finished it: that is the outcome this tombstone asked for.
        if (error instanceof ItemReadError && error.status === 404) {
          await refresh();
          return;
        }
        throw error;
      }
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
    // 412 with the item missing means it was deleted elsewhere meanwhile: also success.
    if (!response.ok && response.status !== 404 && !(response.status === 412 && (await gone(url))))
      throw new Error("Delete failed");
    await refresh();
  };
  /** Start the DELETE now (once), unless Undo has started. */
  const start = (entry: PendingDelete) => {
    if (entry.committing || entry.undoing) return;
    clearTimeout(entry.timer);
    entry.committing = true;
    entry.onStart?.();
    void commit(entry, !entry.restore)
      .catch(entry.onError)
      .finally(() => forget(entry));
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
      undoing: false,
      onError,
    };
    pending.set(tombstone.url, entry);
    publish(tombstone.url, true);
    entry.timer = setTimeout(() => start(entry), Math.max(0, tombstone.deleteAt - Date.now()));
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
    /** Deletions waiting for their undo window: those resumed from an earlier page have no copy. */
    pendingDeletes(): { url: string; deleteAt: number; resumed: boolean }[] {
      return [...pending.values()]
        .filter((entry) => !entry.committing && !entry.undoing)
        .map((entry) => ({
          url: entry.tombstone.url,
          deleteAt: entry.tombstone.deleteAt,
          resumed: !entry.restore,
        }));
    },
    /**
     * Let a UI element (an Undo toast) decide when the deletion runs: this page's timer
     * waits {@link HOLD_GRACE_MS} past the undo window, and the holder calls `release`
     * when it closes. `onStart` runs when the DELETE starts, however it was started.
     */
    hold(url: string, onStart?: () => void): boolean {
      const entry = pending.get(url);
      if (!entry || entry.committing || entry.undoing) return false;
      clearTimeout(entry.timer);
      if (onStart) entry.onStart = onStart;
      entry.timer = setTimeout(
        () => start(entry),
        Math.max(0, entry.tombstone.deleteAt - Date.now()) + HOLD_GRACE_MS,
      );
      return true;
    },
    /** The holder closed without Undo: delete now. */
    release(url: string): void {
      const entry = pending.get(url);
      if (entry) start(entry);
    },
    async undo(url: string): Promise<boolean> {
      const entry = pending.get(url);
      if (!entry || entry.committing || entry.undoing) return false;
      entry.undoing = true;
      clearTimeout(entry.timer);
      try {
        // A resumed entry has no copy, so cancelling its tombstone is the undo, but only while
        // the deletion is still pending. Another tab removes the shared tombstone once its
        // DELETE finished (or once it undid it, when saying "too late" is the safe answer), and
        // a DELETE that finished just before a reload leaves the tombstone behind.
        if (
          !entry.restore &&
          // An unreachable server can't show the item is gone; cancelling is then still safe.
          (!stillQueued(entry) || (await gone(url).catch(() => false)))
        ) {
          await refresh();
          return false;
        }
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
