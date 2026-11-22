// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { MAX_SYNC_LINKS } from "./link-store.js";
import type { SyncNotificationSource, SyncPodWriter } from "./types.js";

/**
 * Complete bounded scan first, so a partial/failed listing can never trigger remote deletes.
 * Direct sub-containers and members the listing types as non-RDF are not sync items: they are
 * reported through `onSkip` and left out of the result instead of failing the scan.
 */
export async function scanWriteBack(
  writer: SyncPodWriter,
  containers: readonly string[],
  maxResources: number,
  signal?: AbortSignal,
  notifications?: SyncNotificationSource,
  onSkip?: (url: string) => void,
): Promise<ReadonlyMap<string, string | null | undefined>> {
  if (!Number.isSafeInteger(maxResources) || maxResources < 1 || maxResources > MAX_SYNC_LINKS)
    throw new RangeError("Invalid sync scan cap.");
  const urls = containers.map((c) => writer.resolve(c));
  const hinted = new Set<string>();
  const parsed = (value: string) => {
    if (typeof value !== "string" || value.length > 2048) return undefined;
    const url = new URL(value);
    return url.href === value && !url.hash && !url.search ? value : undefined;
  };
  const within = (value: string) => {
    if (!parsed(value) || /\.(?:acl|acr)$/i.test(value)) return false;
    return urls.some((c) => value.startsWith(c) && !value.slice(c.length).includes("/"));
  };
  /** A direct child container of a write-back container: skipped, never recursed into. */
  const subContainer = (value: string) =>
    !!parsed(value) &&
    urls.some((c) => value.startsWith(c) && /^[^/]+\/$/.test(value.slice(c.length)));
  if (notifications) {
    let count = 0;
    const iterator = notifications.changes(urls, signal)[Symbol.asyncIterator]();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await iterator.next();
        if (next.done) break;
        if (++count > maxResources) throw new Error("Invalid or excessive sync notifications.");
        if (subContainer(next.value)) continue;
        if (!within(next.value)) throw new Error("Invalid or excessive sync notifications.");
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
        if (++count > maxResources) throw new Error("Invalid or excessive sync listing.");
        if (
          subContainer(next.value.url) ||
          (next.value.nonRdf === true && within(next.value.url))
        ) {
          onSkip?.(next.value.url);
          continue;
        }
        if (!within(next.value.url) || result.has(next.value.url))
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
