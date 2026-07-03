// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * A tiny async key/value store abstraction — the durable client cache substrate
 * (UX invariant #3: instant offline paint) and the optimistic-write outbox (UX
 * invariant #2). An {@link IdbKv} backs it with IndexedDB in the browser; a
 * {@link MemoryKv} backs it in tests, so all cache/outbox logic is unit-testable
 * with no browser storage. Values must be structured-cloneable (we store plain
 * serialisable records — dates as ISO strings).
 */
export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** In-memory Kv (tests, and the SSR/no-IndexedDB fallback). */
export class MemoryKv implements Kv {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    // Deep-clone so callers can't mutate a stored record by reference.
    this.map.set(key, structuredClone(value));
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.map.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
}

const DB_NAME = "coeliac-diary";
const STORE = "kv";

/** Open (and upgrade) the IndexedDB database once. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB-backed Kv (browser). Lazily opens the DB. */
export class IdbKv implements Kv {
  private dbPromise?: Promise<IDBDatabase>;
  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.db();
    return (await tx<T>(db, "readonly", (s) => s.get(key))) ?? undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.db();
    await tx(db, "readwrite", (s) => s.put(value, key));
  }
  async del(key: string): Promise<void> {
    const db = await this.db();
    await tx(db, "readwrite", (s) => s.delete(key));
  }
  async keys(prefix?: string): Promise<string[]> {
    const db = await this.db();
    const all = (await tx<IDBValidKey[]>(db, "readonly", (s) => s.getAllKeys())).map(String);
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
}

/** The best Kv for the current runtime (IndexedDB when present, else in-memory). */
export function defaultKv(): Kv {
  return typeof indexedDB !== "undefined" ? new IdbKv() : new MemoryKv();
}
