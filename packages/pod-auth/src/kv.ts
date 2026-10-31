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
