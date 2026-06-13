/**
 * IndexedDB metadata store — the client analogue of QLever: it makes the cache
 * queryable + revalidatable offline. Holds {@link CacheMetadata} records keyed
 * by the composite (url, varyKey). Response *bytes* live in the Cache API, not
 * here.
 *
 * The store is scoped per identity (`solid-offline:<webId-hash>`, §7) so logout
 * purge can drop exactly one DB. P0/P1 build the read/write path; logout-purge
 * wiring is P5.
 */

import type { CacheMetadata } from './types.js';

const STORE = 'metadata';
const DB_VERSION = 1;

/** Default (un-scoped) DB name when no WebID is supplied (e.g. anonymous reads). */
export const DEFAULT_DB_NAME = 'solid-offline:anonymous';

/**
 * Derive the per-identity DB name. Uses a short, stable, NON-cryptographic hash
 * of the WebID — this is only a namespacing discriminator, not a security
 * boundary (origin-scoping is the real boundary per §7).
 */
export function dbNameForWebId(webId: string | undefined): string {
  if (!webId) return DEFAULT_DB_NAME;
  return `solid-offline:${shortHash(webId)}`;
}

function shortHash(input: string): string {
  // FNV-1a 32-bit — deterministic, dependency-free, collision-tolerant for this use.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A thin, promise-based handle over the metadata object store. */
export class MetadataStore {
  private constructor(private readonly db: IDBDatabase) {}

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
    const tx = this.db.transaction(STORE, 'readonly');
    const result = await promisifyRequest<CacheMetadata | undefined>(
      tx.objectStore(STORE).get(key),
    );
    return result;
  }

  async put(record: CacheMetadata): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).put(record));
    await txDone(tx);
  }

  async delete(key: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).delete(key));
    await txDone(tx);
  }

  /** All metadata entries for a given URL (across varyKeys). */
  async getByUrl(url: string): Promise<CacheMetadata[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('byUrl');
    return promisifyRequest<CacheMetadata[]>(index.getAll(url));
  }

  /**
   * All metadata entries (every (url, varyKey)). Used by P3's reconnect
   * ETag-resync sweep and disconnected `If-None-Match` polling to enumerate the
   * warmed set. Cheap relative to the network it saves; the warm budget bounds it.
   */
  async getAll(): Promise<CacheMetadata[]> {
    const tx = this.db.transaction(STORE, 'readonly');
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
    const tx = this.db.transaction(STORE, 'readwrite');
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
