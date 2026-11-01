// AUTHORED-BY Codex
import { DriveAccessError } from "./access";
import type { PolicyIdentity } from "./commit";

export interface ProtectionRequirement {
  readonly acl: string;
  readonly from: string;
  readonly turtle: string;
  /** A repair of an existing representation may never change a replacement's ACL. */
  readonly etag?: string;
  /** Captured own ACL or absence; Retry cannot adopt a replacement or revive a revocation. */
  readonly ownAcl?: PolicyIdentity;
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
  /** Validator used by this DELETE; older records may not have captured it. */
  readonly etag?: string;
}

export interface DeletionRequest {
  readonly id: string;
  readonly source: string;
  /** Absent only for legacy guards that did not capture a validator. */
  readonly etag?: string;
  readonly recovery?: string;
}

// Migration uses its own lock, never a source/ancestor lock held by its caller.
let migration: Promise<unknown> = Promise.resolve();

/** Independent request records; the endpoint view also reads older Drive ledgers. */
export function deletionLedger(http: typeof fetch) {
  const legacy = durableLedger<DeletionRequirement>(http, "delete:");
  const requests = durableLedger<DeletionRequest>(http, "delete-request:");
  const migrate = async () => {
    const keys = await legacy.keys();
    const old = new Map<string, DeletionRequirement>();
    for (const key of keys) {
      const record = await legacy.get(key);
      if (record) old.set(key, record);
    }
    for (const [url, record] of old) {
      for (const source of record.sources) {
        const etag = old.get(source)?.etag;
        const recovery = url === source ? record.recovery : url;
        const id = `legacy:${JSON.stringify([source, recovery])}`;
        // A reload may follow a partial legacy cleanup. Keep the captured validator.
        if (await requests.get(id)) continue;
        await requests.set(id, {
          id,
          source,
          ...(etag ? { etag } : {}),
          ...(recovery ? { recovery } : {}),
        });
      }
    }
    // Commit every independent record before retiring either old endpoint.
    for (const url of old.keys()) await legacy.clear(url);
  };
  const records = async (): Promise<DeletionRequest[]> => {
    if ((await legacy.keys()).length) {
      const current = migration
        .catch(() => {})
        .then(async () => {
          const locks = globalThis.navigator?.locks;
          if (locks) await locks.request("solid-drive:deletion-migration", migrate);
          else await migrate();
        });
      migration = current;
      await current;
    }
    const result: DeletionRequest[] = [];
    for (const id of await requests.keys()) {
      const record = await requests.get(id);
      if (record) result.push(record);
    }
    return result;
  };
  return {
    records,
    add: (record: DeletionRequest) => requests.set(record.id, record),
    retire: (record: DeletionRequest) => requests.clear(record.id),
    // Compatibility for old ledgers and callers inspecting endpoint protection.
    set: legacy.set,
    async keys(): Promise<string[]> {
      return [
        ...new Set(
          (await records()).flatMap((record) =>
            record.recovery ? [record.source, record.recovery] : [record.source],
          ),
        ),
      ];
    },
    async get(url: string): Promise<DeletionRequirement | undefined> {
      const linked = (await records()).filter(
        (record) => record.source === url || record.recovery === url,
      );
      if (!linked.length) return undefined;
      const own = linked.find((record) => record.source === url);
      return {
        sources: [...new Set(linked.map((record) => record.source))],
        ...(own?.etag ? { etag: own.etag } : {}),
        ...(own?.recovery ? { recovery: own.recovery } : {}),
      };
    },
  };
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
    async keys(): Promise<string[]> {
      const keys =
        typeof indexedDB === "undefined"
          ? [...local().keys()]
          : await transact("readonly", (store) => store.getAllKeys());
      return keys
        .filter((key): key is string => typeof key === "string" && key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
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
