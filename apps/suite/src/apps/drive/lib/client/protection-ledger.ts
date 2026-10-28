// AUTHORED-BY Codex
import { DriveAccessError } from "./access";

export interface ProtectionRequirement {
  readonly acl: string;
  readonly from: string;
  readonly turtle: string;
}

// Non-browser transports have no durable store. Keep their independent pods isolated.
const memory = new WeakMap<typeof fetch, Map<string, ProtectionRequirement>>();
const DATABASE = "solid-drive-protection";
const STORE = "requirements";

/** A committed requirement must precede creation; failed/ambiguous cleanup never clears it. */
export function protectionLedger(http: typeof fetch) {
  let fallback = memory.get(http);
  if (!fallback) {
    fallback = new Map();
    memory.set(http, fallback);
  }
  const local = () => {
    if (typeof window !== "undefined") throw new DriveAccessError("IndexedDB unavailable");
    return fallback;
  };
  const transact = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Protection ledger is blocked"));
      });
      try {
        return await new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          // Success means the transaction committed, not merely that put() was queued.
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } catch (cause) {
      throw new DriveAccessError(
        cause,
        "Drive could not read or save required resource protection in IndexedDB. Enable browser storage and retry.",
      );
    }
  };
  return {
    async get(url: string): Promise<ProtectionRequirement | undefined> {
      return typeof indexedDB === "undefined"
        ? local().get(url)
        : transact("readonly", (store) => store.get(url));
    },
    async set(url: string, requirement: ProtectionRequirement): Promise<void> {
      if (typeof indexedDB === "undefined") {
        local().set(url, requirement);
      } else await transact("readwrite", (store) => store.put(requirement, url));
    },
    async clear(url: string): Promise<void> {
      if (typeof indexedDB === "undefined") local().delete(url);
      else await transact("readwrite", (store) => store.delete(url));
    },
  };
}
