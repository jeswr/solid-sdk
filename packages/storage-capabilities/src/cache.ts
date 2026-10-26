// AUTHORED-BY GPT-6.1-Sol
import { longestPrefix, type Prefix, prefixUrl, sameDescription } from "./prefix.js";
import type { DescriptionCache } from "./types.js";

type CacheRecord = NonNullable<Awaited<ReturnType<DescriptionCache["get"]>>>;

/** Create an isolated in-memory cache. Reads and writes copy public metadata. */
export function createMemoryCache(): DescriptionCache {
  const descriptions = new Map<string, CacheRecord>();
  const prefixes = new Map<string, Prefix>();
  return {
    async get(storageId) {
      return structuredClone(descriptions.get(storageId));
    },
    async set(storageId, value) {
      descriptions.set(storageId, structuredClone(value));
    },
    async delete(storageId) {
      descriptions.delete(storageId);
    },
    async attachProbe(storageId, description, probe) {
      // Synchronous check-and-set: no other cache operation can interleave.
      const current = descriptions.get(storageId);
      if (
        !current ||
        current.probe !== undefined ||
        !sameDescription(current.description, description)
      ) {
        return false;
      }
      descriptions.set(storageId, structuredClone({ ...current, probe }));
      return true;
    },
    async rememberPrefix(root, storageId) {
      const normalised = prefixUrl(root).href;
      // A storage has one root: a moved root must not keep routing its old prefix here.
      for (const [key, prefix] of prefixes) {
        if (prefix.storageId === storageId && key !== normalised) prefixes.delete(key);
      }
      prefixes.set(normalised, { root: normalised, storageId });
    },
    async lookupPrefix(url) {
      return longestPrefix(url, prefixes.values());
    },
  };
}

/** Options for the public-metadata-only IndexedDB cache. */
export interface IndexedDbCacheOptions {
  dbName?: string;
}

/**
 * Persist descriptions, probes and prefix mappings using raw IndexedDB (no idb dependency).
 * Connections close after each transaction, so logout/deletion and version upgrades do not
 * leave a long-lived connection behind. IndexedDB errors reject the requested operation.
 */
export function createIndexedDbCache({
  dbName = "jeswr-storage-capabilities",
}: IndexedDbCacheOptions = {}): DescriptionCache {
  async function transact<T>(
    store: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("descriptions");
        request.result.createObjectStore("prefixes", { keyPath: "root" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<T>((resolve, reject) => {
      try {
        const transaction = db.transaction(store, mode);
        const request = operation(transaction.objectStore(store));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    });
  }

  return {
    get: (storageId) =>
      transact<CacheRecord | undefined>("descriptions", "readonly", (store) =>
        store.get(storageId),
      ),
    async set(storageId, value) {
      await transact("descriptions", "readwrite", (store) => store.put(value, storageId));
    },
    async delete(storageId) {
      await transact("descriptions", "readwrite", (store) => store.delete(storageId));
    },
    async attachProbe(storageId, description, probe) {
      let attached = false;
      // One readwrite transaction: the get and the put cannot be split by another writer.
      await transact("descriptions", "readwrite", (store) => {
        const request = store.get(storageId);
        request.onsuccess = () => {
          const current = request.result as CacheRecord | undefined;
          if (
            current &&
            current.probe === undefined &&
            sameDescription(current.description, description)
          ) {
            store.put({ ...current, probe }, storageId);
            attached = true;
          }
        };
        return request;
      });
      return attached;
    },
    async rememberPrefix(root, storageId) {
      const normalised = prefixUrl(root).href;
      await transact("prefixes", "readwrite", (store) => {
        // Same transaction: a moved root replaces, never coexists with, the old mapping.
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) {
            store.put({ root: normalised, storageId });
            return;
          }
          const prefix = current.value as Prefix;
          if (prefix.storageId === storageId && prefix.root !== normalised) current.delete();
          current.continue();
        };
        return cursor;
      });
    },
    async lookupPrefix(url) {
      const prefixes = await transact<Prefix[]>("prefixes", "readonly", (store) => store.getAll());
      return longestPrefix(url, prefixes);
    },
  };
}
