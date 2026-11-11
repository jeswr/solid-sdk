// AUTHORED-BY Codex GPT-6
/**
 * IndexedDB metadata store — the client analogue of QLever: it makes the cache
 * queryable + revalidatable offline. Holds {@link CacheMetadata} records keyed
 * by the composite (url, varyKey). Response bytes live in the companion `responses` store in this same database.
 *
 * The store is scoped per identity (`solid-offline:<webId-hash>`, §7) via the
 * shared {@link dbNameForWebId} (see `scope.ts`) so logout-purge (P5) can drop
 * exactly one identity's DB.
 */

import { DEFAULT_DB_NAME, dbNameForWebId } from './scope.js';
import type { ByteCache } from './swr.js';
import type { CacheMetadata } from './types.js';

// Re-export the scoping helpers from their canonical home so existing importers
// (and the public API surface) keep working unchanged.
export { DEFAULT_DB_NAME, dbNameForWebId };

const STORE = 'metadata';
const DB_VERSION = 2;
const BYTES = 'responses';
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** Bound the cache's tee branch; leave the caller's network stream available. */
export async function responseBytes(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new RangeError('Offline cache body budget exceeded');
  }
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new RangeError('Offline cache body budget exceeded');
      chunks.push(value);
    }
  } catch (error) {
    // Awaiting cancellation of a tee branch waits for the caller's body too.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Open (or upgrade) the metadata DB. The caller may inject an `indexedDB`
 * factory (the test suite injects `fake-indexeddb`); defaults to the global.
 */
export async function openMetadataDb(
  dbName: string,
  factory: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!factory) {
    throw new Error('[solid-offline] no IndexedDB available in this context');
  }
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('byUrl', 'url', { unique: false });
      }
      if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

/** A thin, promise-based handle over the metadata object store. */
export class MetadataStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly check: () => void = () => {},
  ) {}

  /** Share the connection with a live session/resource fence checked at each commit. */
  withFence(check: () => void): MetadataStore {
    return new MetadataStore(this.db, () => {
      this.check();
      check();
    });
  }

  private transaction(stores: string | string[], mode: IDBTransactionMode): IDBTransaction {
    this.check();
    return this.db.transaction(stores, mode);
  }

  /** Buffer within the body budget, then atomically replace bytes and their metadata. */
  async replace(request: Request, response: Response, record: CacheMetadata): Promise<void> {
    const body = await responseBytes(response);
    const tx = this.transaction([BYTES, STORE], 'readwrite');
    const done = txDone(tx);
    try {
      tx.objectStore(BYTES).put(this.byteRecord(response, body), request.url);
      tx.objectStore(STORE).put(record);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  private byteRecord(response: Response, body: ArrayBuffer) {
    return {
      body,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    };
  }

  /** Shared pod-body store. No Request or request headers are persisted. */
  get bytes(): ByteCache & { replace?: MetadataStore['replace'] } {
    return this.byteCache;
  }

  private readonly byteCache = {
    replace: (request: Request, response: Response, record: CacheMetadata): Promise<void> =>
      this.replace(request, response, record),
    match: async (request: Request): Promise<Response | undefined> => {
      const tx = this.transaction(BYTES, 'readonly');
      const row = await promisifyRequest<
        | {
            body: ArrayBuffer;
            status: number;
            statusText: string;
            headers: [string, string][];
          }
        | undefined
      >(tx.objectStore(BYTES).get(request.url));
      return row && new Response(row.status === 204 || row.status === 205 ? null : row.body, row);
    },
    put: async (request: Request, response: Response): Promise<void> => {
      const body = await responseBytes(response);
      const tx = this.transaction(BYTES, 'readwrite');
      tx.objectStore(BYTES).put(this.byteRecord(response, body), request.url);
      await txDone(tx);
    },
    delete: async (request: Request): Promise<boolean> => {
      const tx = this.transaction(BYTES, 'readwrite');
      const store = tx.objectStore(BYTES);
      const existed = await promisifyRequest(store.count(request.url));
      store.delete(request.url);
      await txDone(tx);
      return existed > 0;
    },
  };

  static async open(webId: string | undefined, factory?: IDBFactory): Promise<MetadataStore> {
    const db = await openMetadataDb(dbNameForWebId(webId), factory);
    return new MetadataStore(db);
  }

  /** For tests / advanced callers: open against an explicit DB name. */
  static async openNamed(dbName: string, factory?: IDBFactory): Promise<MetadataStore> {
    const db = await openMetadataDb(dbName, factory);
    return new MetadataStore(db);
  }

  async get(key: string): Promise<CacheMetadata | undefined> {
    const tx = this.transaction(STORE, 'readonly');
    const result = await promisifyRequest<CacheMetadata | undefined>(
      tx.objectStore(STORE).get(key),
    );
    return result;
  }

  async put(record: CacheMetadata): Promise<void> {
    const tx = this.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).put(record));
    await txDone(tx);
  }

  async delete(key: string): Promise<void> {
    const tx = this.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).delete(key));
    await txDone(tx);
  }

  /** All metadata entries for a given URL (across varyKeys). */
  async getByUrl(url: string): Promise<CacheMetadata[]> {
    const tx = this.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('byUrl');
    return promisifyRequest<CacheMetadata[]>(index.getAll(url));
  }

  /**
   * All metadata entries (every (url, varyKey)). Used by P3's reconnect
   * ETag-resync sweep and disconnected `If-None-Match` polling to enumerate the
   * warmed set. Cheap relative to the network it saves; the warm budget bounds it.
   */
  async getAll(): Promise<CacheMetadata[]> {
    const tx = this.transaction(STORE, 'readonly');
    return promisifyRequest<CacheMetadata[]>(tx.objectStore(STORE).getAll());
  }

  /**
   * Record the last notification `state` (ETag carried in a change frame) for a
   * resource, across every cached variant of that URL. Lets the SW short-circuit
   * a self-caused change (`frame.state === lastState`) without a network round-trip.
   */
  async setLastState(url: string, state: string): Promise<void> {
    const records = await this.getByUrl(url);
    for (const record of records) {
      record.lastState = state;
      await this.put(record);
    }
  }

  /** Touch fetchedAt (used on a 304 — confirms provisional bytes are still fresh). */
  async touch(key: string, at: number = Date.now()): Promise<void> {
    const existing = await this.get(key);
    if (!existing) return;
    existing.fetchedAt = at;
    await this.put(existing);
  }

  async clear(): Promise<void> {
    const tx = this.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).clear());
    await txDone(tx);
  }

  close(): void {
    this.db.close();
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
