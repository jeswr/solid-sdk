// AUTHORED-BY Codex GPT-6.1-Sol
import { abortable } from "./oauth/abortable.js";

const nodeLocks = new Map<string, Promise<void>>();

/**
 * Runs `callback` while holding a Web Lock, or a keyed local lock in Node without Web Locks.
 *
 * Web Locks coordinate every tab and worker of an origin's storage partition, which is what makes
 * rotating refresh tokens safe to share through persistent storage. They do not coordinate separate
 * browsers, devices or server processes. The Node fallback serializes shared and exclusive requests
 * in FIFO order within this realm, preserving fence ordering without cross-worker coordination.
 */
export async function withLock<T>(
  name: string,
  callback: () => Promise<T>,
  options: { mode?: LockMode; signal?: AbortSignal } = {},
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) {
    if (typeof process !== "undefined" && process.versions?.node !== undefined) {
      options.signal?.throwIfAborted();
      const previous = nodeLocks.get(name) ?? Promise.resolve();
      const { promise: current, resolve: release } = Promise.withResolvers<void>();
      nodeLocks.set(name, current);
      try {
        await (options.signal === undefined ? previous : abortable(previous, options.signal));
        options.signal?.throwIfAborted();
        return await callback();
      } finally {
        // An aborted waiter must not release its successors before the holder finishes.
        void previous.then(() => {
          release();
          if (nodeLocks.get(name) === current) nodeLocks.delete(name);
        });
      }
    }
    throw new Error("The Web Locks API is required in browsers and workers");
  }

  const lockOptions: LockOptions = { mode: options.mode ?? "exclusive" };
  if (options.signal !== undefined) lockOptions.signal = options.signal;
  return await locks.request(name, lockOptions, async () => await callback());
}

/**
 * A stable, secret-free key for caches and lock names, derived from the parts of a credential context.
 *
 * Parts are length-prefixed before hashing so `["a:b", "c"]` and `["a", "b:c"]` differ.
 */
export async function contextKey(
  kind: string,
  parts: readonly (string | undefined)[],
): Promise<string> {
  const text = parts.map((p) => (p === undefined ? "-" : `${p.length}:${p}`)).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hex}`;
}
