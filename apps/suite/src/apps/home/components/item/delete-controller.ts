// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { DomainItem } from "../../lib/model/discovery";
import type { HomeSession } from "../../state/use-domain-items";
import { type ItemRead, isContainer, readItem } from "./data";

export const UNDO_MS = 8_000;
/** Session-scoped tombstones survive route changes and fence live/focus refreshes. */
export function createDeleteController(session: HomeSession, refresh: () => Promise<void>) {
  let hidden: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const reading = new Set<string>();
  const pending = new Map<
    string,
    { read: ItemRead; timer: ReturnType<typeof setTimeout>; committing: boolean }
  >();
  const publish = (url: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(url);
    else next.delete(url);
    hidden = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => hidden,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async remove(item: DomainItem, onError: () => void): Promise<boolean> {
      if (pending.has(item.url) || reading.has(item.url) || isContainer(item)) return false;
      reading.add(item.url);
      let read: ItemRead;
      try {
        read = await readItem(session, item.url, item.subject.value);
      } finally {
        reading.delete(item.url);
      }
      if (!read.writable || isContainer(read.item) || !read.item.etag) return false;
      const target = assertWithinPodScope(session.storageUrl, item.url);
      const entry = {
        read,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        committing: false,
      };
      pending.set(target, entry);
      publish(target, true);
      entry.timer = setTimeout(() => {
        entry.committing = true;
        void (async () => {
          try {
            const response = await session.fetch(target, {
              method: "DELETE",
              redirect: "error",
              headers: { "if-match": read.item.etag as string },
            });
            if (!response.ok && response.status !== 404) throw new Error("Delete failed");
            await refresh();
          } catch {
            onError();
          } finally {
            pending.delete(target);
            publish(target, false);
          }
        })();
      }, UNDO_MS);
      return true;
    },
    async undo(url: string): Promise<boolean> {
      const entry = pending.get(url);
      if (!entry || entry.committing) return false;
      clearTimeout(entry.timer);
      // Normally the delayed DELETE has not run. The create-only PUT also safely restores
      // a resource removed elsewhere during the undo window, without overwriting a new one.
      try {
        const response = await session.fetch(url, {
          method: "PUT",
          redirect: "error",
          headers: { "content-type": entry.read.contentType, "if-none-match": "*" },
          body: entry.read.body,
        });
        if (!response.ok && response.status !== 412) throw new Error("Restore failed");
        if (response.status === 412) {
          // The delayed delete leaves the original in place. Re-write it only while
          // its captured validator still matches, so Undo has a fresh version without
          // replacing a concurrent edit. A newer existing version is left untouched.
          const restored = await session.fetch(url, {
            method: "PUT",
            redirect: "error",
            headers: {
              "content-type": entry.read.contentType,
              "if-match": entry.read.item.etag as string,
            },
            body: entry.read.body,
          });
          if (!restored.ok && restored.status !== 412) throw new Error("Restore failed");
        }
        await refresh();
        return true;
      } finally {
        pending.delete(url);
        publish(url, false);
      }
    },
  };
}
