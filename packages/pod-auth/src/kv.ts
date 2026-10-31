// AUTHORED-BY Codex GPT-6.1-Sol
import type { KvStore } from "./types.js";

/** Namespace without clear(): a caller's store can contain unrelated application data. */
export function scopedStore<T extends {}>(store: KvStore, prefix: string): KvStore<T> {
  return {
    getItem: async (key) => (await store.getItem(JSON.stringify([prefix, key]))) as T | null,
    setItem: async (key, value) => await store.setItem(JSON.stringify([prefix, key]), value),
    removeItem: async (key) => await store.removeItem(JSON.stringify([prefix, key])),
  };
}

/** Classify failures at either storage seam before restore handles protocol failures. */
export function protectStore<T extends {}>(store: KvStore<T>): KvStore<T> {
  const protect = async <R>(operation: () => Promise<R>): Promise<R> => {
    try {
      return await operation();
    } catch (cause) {
      throw new StorageFailure(cause);
    }
  };
  return {
    getItem: async (key) => await protect(() => store.getItem(key)),
    setItem: async (key, value) => await protect(() => store.setItem(key, value)),
    removeItem: async (key) => await protect(() => store.removeItem(key)),
  };
}

/** Distinguish storage faults from network/protocol failures without exposing their values. */
export class StorageFailure extends Error {
  constructor(cause: unknown) {
    super("Session storage failed", { cause });
  }
}
