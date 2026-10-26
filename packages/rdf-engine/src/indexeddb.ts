import type { IndexPersistence } from "./types.js";

/** Isolate snapshots by database and key; factory injection supports embedded browser contexts. */
export interface IndexedDbPersistenceOptions {
  databaseName?: string;
  key?: string;
  indexedDB?: IDBFactory;
}

/** Open only for each operation, await transaction commit, then close the database. */
export function createIndexedDbPersistence(
  opts: IndexedDbPersistenceOptions = {},
): IndexPersistence {
  async function open(): Promise<IDBDatabase> {
    const factory = opts.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDB is unavailable");
    return new Promise((resolve, reject) => {
      const request = factory.open(opts.databaseName ?? "jeswr-rdf-engine", 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("snapshots");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("IndexedDB open is blocked"));
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
    });
  }
  async function transaction(bytes?: Uint8Array): Promise<Uint8Array | null> {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("snapshots", bytes ? "readwrite" : "readonly");
        const store = tx.objectStore("snapshots");
        const key = opts.key ?? "index";
        const request = bytes ? store.put(bytes, key) : store.get(key);
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.oncomplete = () => {
          if (bytes || request.result === undefined) resolve(null);
          else if (request.result instanceof Uint8Array) resolve(new Uint8Array(request.result));
          else reject(new TypeError("Invalid IndexedDB snapshot"));
        };
      });
    } finally {
      db.close();
    }
  }
  return {
    load() {
      return transaction();
    },
    async save(bytes) {
      await transaction(new Uint8Array(bytes));
    },
  };
}
