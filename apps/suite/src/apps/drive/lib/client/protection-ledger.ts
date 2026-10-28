// AUTHORED-BY Codex
import { DriveAccessError } from "./access";

export interface ProtectionRequirement {
  readonly acl: string;
  readonly from: string;
  readonly turtle: string;
}

// Non-browser transports have no durable store. Keep their independent pods isolated.
const memory = new WeakMap<typeof fetch, Map<string, unknown>>();
const DATABASE = "solid-drive-protection";
const STORE = "requirements";

/** A committed requirement must precede creation; failed/ambiguous cleanup never clears it. */
export function protectionLedger(http: typeof fetch) {
  return durableLedger<ProtectionRequirement>(http, "");
}

export interface DeletionRequirement {
  readonly sources: readonly string[];
  readonly recovery?: string;
}

/** Separate keys in the same durable store, committed before sending DELETE. */
export function deletionLedger(http: typeof fetch) {
  return durableLedger<DeletionRequirement>(http, "delete:");
}

function durableLedger<T>(http: typeof fetch, prefix: string) {
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
    async get(url: string): Promise<T | undefined> {
      const key = prefix + url;
      return typeof indexedDB === "undefined"
        ? (local().get(key) as T | undefined)
        : transact("readonly", (store) => store.get(key));
    },
    async set(url: string, requirement: T): Promise<void> {
      const key = prefix + url;
      if (typeof indexedDB === "undefined") {
        local().set(key, requirement);
      } else await transact("readwrite", (store) => store.put(requirement, key));
    },
    async clear(url: string): Promise<void> {
      const key = prefix + url;
      if (typeof indexedDB === "undefined") local().delete(key);
      else await transact("readwrite", (store) => store.delete(key));
    },
  };
}
