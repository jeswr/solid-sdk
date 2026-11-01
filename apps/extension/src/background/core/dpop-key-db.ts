// AUTHORED-BY Claude Sonnet 5
/**
 * The DPoP session keypair's durable home — a NON-EXTRACTABLE Web Crypto `CryptoKeyPair`
 * persisted directly in IndexedDB, never exported to JWK / `chrome.storage.local`.
 *
 * SECURITY MIGRATION (design roborev round-1, the F3 keystore-advantage finding): the
 * private DPoP key used to be generated `extractable: true` and exported to a JWK stored in
 * `chrome.storage.local` because an MV3 service worker is killed/restarted aggressively and
 * a non-extractable `CryptoKey` was assumed lost on suspension. That assumption conflated
 * two different things: the KEY OBJECT's lifetime (tied to the SW's JS heap, always lost on
 * suspension regardless of extractability) and whether the underlying key MATERIAL can be
 * durably persisted. The WebCrypto spec makes `CryptoKey` structured-cloneable — including
 * non-extractable keys (https://w3c.github.io/webcrypto/#cryptokey-interface,
 * `[Serializable]`) — and IndexedDB persists values via the structured-clone algorithm. So a
 * non-extractable `CryptoKey` written to an IndexedDB object store survives a
 * put/close/reopen round-trip as a LIVE, usable key (`crypto.subtle.sign` still works on the
 * reloaded object) while `crypto.subtle.exportKey('jwk', …)` on it correctly REJECTS. The
 * private scalar therefore never serialises to disk as extractable material; only the
 * PUBLIC JWK (safe — it's exactly what every DPoP proof header already broadcasts, see
 * `dpop.ts` `createDpopProof`) is stored alongside for convenience.
 *
 * One record (`RECORD_ID`) per database: the extension mints a FRESH keypair per login (see
 * `auth-flow.ts` `completeLogin` via `dpop-key-store.ts`), so this store always holds at most
 * the CURRENT session's key — overwritten on the next login, cleared on logout/teardown
 * (`service-worker.ts` `teardownSession`).
 */

/** The persisted DPoP keypair record — the live `CryptoKey`s, not a JWK export. */
export interface StoredDpopKeyRecord {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  /** The public JWK (kty/crv/x/y only) — never the private `d`; safe to persist at rest. */
  readonly publicJwk: JsonWebKey;
}

const DB_NAME = 'solid-ext-dpop-key';
const DB_VERSION = 1;
const STORE = 'dpop-keypair';
const RECORD_ID = 'active';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Open (or upgrade) the DPoP key DB. The caller may inject an `indexedDB` factory (the test
 * suite injects a fake); defaults to the global (present in the SW context).
 */
export function openDpopKeyDb(factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('[solid-ext] no IndexedDB available in this context'));
  }
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A promise-based handle over the DPoP keypair's single IndexedDB record. */
export class DpopKeyDb {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<DpopKeyDb> {
    return new DpopKeyDb(await openDpopKeyDb(factory));
  }

  /** The persisted keypair, or `undefined` if none is stored (fresh state / post-migration). */
  async get(): Promise<StoredDpopKeyRecord | undefined> {
    const tx = this.db.transaction(STORE, 'readonly');
    return promisify<StoredDpopKeyRecord | undefined>(tx.objectStore(STORE).get(RECORD_ID));
  }

  /** Persist (overwrite) the active keypair record. */
  async put(record: StoredDpopKeyRecord): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await promisify(tx.objectStore(STORE).put(record, RECORD_ID));
    await txDone(tx);
  }

  /** Drop the persisted keypair (logout/teardown — the key is bound to the departing session). */
  async clear(): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await promisify(tx.objectStore(STORE).clear());
    await txDone(tx);
  }

  close(): void {
    this.db.close();
  }
}
