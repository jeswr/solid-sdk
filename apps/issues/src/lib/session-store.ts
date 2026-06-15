// AUTHORED-BY Claude Opus 4.8
/**
 * session-store.ts — IndexedDB persistence of the data needed to silently
 * restore a Solid DPoP session on reopen (pss-203m): the refresh token, the
 * issuer + client registration, and the DPoP key pair. Scoped to ONE WebID at a
 * time (single-record store), cleared on logout.
 *
 * Why IndexedDB, not localStorage:
 *  - A refresh token is a long-lived bearer-of-possession secret. IndexedDB is
 *    origin-scoped like localStorage, but lets us store the DPoP key as a
 *    NON-EXTRACTABLE `CryptoKeyPair` (structured-clone preserves CryptoKey
 *    objects), so the private key never serialises to disk as exportable JWK and
 *    never sits in the readily-dumped localStorage namespace. The token binds to
 *    that key (DPoP), so a token leak without the key is useless.
 *  - We keep at most ONE session record, keyed by WebID, and refuse to read a
 *    record for a different WebID — a stored session can never restore the wrong
 *    identity.
 *
 * All operations are best-effort: any IndexedDB failure (private mode, blocked
 * upgrade, quota) degrades to "no stored session", never an exception that
 * blocks login. This is browser-only; on the server every call resolves to a
 * no-op / null.
 */
import type { PersistedSessionMeta } from "./silent-restore";

const DB_NAME = "solid-issues-auth";
const DB_VERSION = 1;
const STORE = "session";
/** Single-record store — exactly one active session is persisted at a time. */
const RECORD_KEY = "current";

/** The full persisted session: restore metadata + the live crypto material. */
export interface StoredSession extends PersistedSessionMeta {
  /** OIDC client registration (static client-id doc, or a dynamic registration). */
  client: Record<string, unknown>;
  /** The refresh token (present iff `hasRefreshToken`). */
  refreshToken?: string;
  /** The non-extractable DPoP key pair the tokens are bound to. */
  dpopKey: CryptoKeyPair;
}

function hasIndexedDB(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

/** Persist (replacing any previous) the current restorable session. Best-effort. */
export async function saveSession(session: StoredSession): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    await tx("readwrite", (store) => store.put(session, RECORD_KEY));
  } catch {
    // A failure to persist only costs the user a fresh login next time — never fatal.
  }
}

/**
 * Read the stored session IF it belongs to `expectedWebId`. A record for a
 * different WebID is ignored (returns null) — a stored session can never be used
 * to silently restore a different identity. With no `expectedWebId`, returns
 * whatever is stored (used to discover the last WebID on a cold open).
 */
export async function loadSession(expectedWebId?: string): Promise<StoredSession | null> {
  if (!hasIndexedDB()) return null;
  try {
    const session = await tx<StoredSession | undefined>("readonly", (store) => store.get(RECORD_KEY));
    if (!session) return null;
    if (expectedWebId !== undefined && session.webId !== expectedWebId) return null;
    return session;
  } catch {
    return null;
  }
}

/** The restore metadata only (no secrets), for the silent-restore decision. */
export async function loadSessionMeta(): Promise<PersistedSessionMeta | null> {
  const session = await loadSession();
  if (!session) return null;
  const { webId, issuer, storageUrl, hasRefreshToken, refreshExpiresAt } = session;
  return { webId, issuer, storageUrl, hasRefreshToken, refreshExpiresAt };
}

/** Delete the stored session (logout, or a dead refresh token). Best-effort. */
export async function clearSession(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    await tx("readwrite", (store) => store.delete(RECORD_KEY));
  } catch {
    /* best-effort */
  }
}
