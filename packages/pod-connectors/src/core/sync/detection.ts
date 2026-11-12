// AUTHORED-BY Codex GPT-6.1-Sol

import { MAX_SYNC_LINKS } from "./link-store.js";
import type { SyncNotificationSource, SyncPodWriter } from "./types.js";

/** Complete bounded scan first, so a partial/failed listing can never trigger remote deletes. */
export async function scanWriteBack(
  writer: SyncPodWriter,
  containers: readonly string[],
  maxResources: number,
  signal?: AbortSignal,
  notifications?: SyncNotificationSource,
): Promise<ReadonlyMap<string, string | null | undefined>> {
  if (!Number.isSafeInteger(maxResources) || maxResources < 1 || maxResources > MAX_SYNC_LINKS)
    throw new RangeError("Invalid sync scan cap.");
  const urls = containers.map((c) => writer.resolve(c));
  const hinted = new Set<string>();
  const within = (value: string) => {
    if (value.length > 2048 || /\.(?:acl|acr)$/i.test(value)) return false;
    const url = new URL(value);
    return (
      url.href === value &&
      !url.hash &&
      !url.search &&
      urls.some((c) => value.startsWith(c) && !value.slice(c.length).includes("/"))
    );
  };
  if (notifications) {
    let count = 0;
    const iterator = notifications.changes(urls, signal)[Symbol.asyncIterator]();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await iterator.next();
        if (next.done) break;
        if (++count > maxResources || !within(next.value))
          throw new Error("Invalid or excessive sync notifications.");
        hinted.add(next.value);
      }
    } finally {
      await iterator.return?.();
    }
  }
  const result = new Map<string, string | null | undefined>();
  let count = 0;
  for (const container of containers) {
    const iterator = writer.list(container)[Symbol.asyncIterator]();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await iterator.next();
        if (next.done) break;
        if (++count > maxResources || !within(next.value.url) || result.has(next.value.url))
          throw new Error("Invalid or excessive sync listing.");
        // A change hint invalidates the listing's validator, which may lag a resource
        // update. The executor then reads and hashes the current representation.
        result.set(next.value.url, hinted.has(next.value.url) ? undefined : next.value.etag);
      }
    } finally {
      await iterator.return?.();
    }
  }
  signal?.throwIfAborted();
  return result;
}
