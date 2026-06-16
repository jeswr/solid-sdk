// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-persistence.ts — durable, WebID-scoped storage for a returning user's
// DPoP-bound refresh-token session, so REOPENING A CLOSED TAB restores the
// session via a refresh_token grant (a plain token-endpoint FETCH) instead of
// bouncing to the login screen. This is the Pod Mail half of the suite-wide
// cross-app UX invariant #1 (silent session restore on load).
//
// Ported from solid-pod-manager's proven `session-persistence.ts` (the reference
// implementation), trimmed to what this host needs. Pod Mail held tokens in
// MEMORY ONLY before this module — closing the tab logged the user out — which is
// the parity gap this closes.
//
// ─── Why this is the modern best practice ────────────────────────────────────
// OAuth 2.0 for Browser-Based Apps (BCP) recommends refresh-token rotation for
// SPAs over the legacy hidden-iframe silent-renew. We persist the rotated,
// DPoP-sender-constrained refresh token and the DPoP key that constrains it, and
// restore with a `refresh_token` grant. No window, no iframe.
//
// ─── Threat model (this module persists a credential — read before changing) ──
// What we persist per issuer: the refresh token (string) + the DPoP CryptoKeyPair
// + WebID + issuer (+ optional clientId / expiresAt). We DO NOT persist the
// access token (it is short-lived and re-minted by the refresh grant on restore).
//
//   • The DPoP private key is stored in IndexedDB as a `CryptoKey` with
//     `extractable: false`. IndexedDB can structured-clone a non-extractable
//     CryptoKey: the raw private-key BYTES never enter JS and never hit disk in a
//     readable form — only an opaque handle the browser can sign with. This is
//     the property that makes persisting the refresh token acceptable. (The popup
//     login path in webid-token-provider.ts generates `extractable: false` keys,
//     so the persisted key keeps that protection. The autologin REDIRECT path uses
//     an extractable key because a full-page redirect erases the closure that
//     would otherwise hold it — that one is the documented exception, and its key
//     lives only in sessionStorage for one round-trip, not here.)
//
//   • The refresh token IS readable by any script on this origin (it is a plain
//     string in IndexedDB). An XSS that can run on the origin could read it.
//     BUT the token is DPoP sender-constrained (RFC 9449): redeeming it at the
//     token endpoint requires a DPoP proof signed by the matching private key,
//     and that key is non-extractable. A stolen refresh token is therefore
//     useless off-origin — the attacker cannot mint the proof. This matches the
//     DPoP refresh-token security model: sender-constraining downgrades a
//     bearer-credential exfiltration to an on-origin-only capability. (Same-origin
//     XSS that can also sign with the key is a strictly worse compromise than
//     refresh-token theft and is out of scope for token-storage hardening; the
//     mitigations there are CSP / dependency hygiene, not storage choice.)
//
//   • IndexedDB is origin-scoped: another origin cannot read this store
//     (cross-origin isolation is enforced by the browser, not by us).
//
//   • The refresh token is NEVER logged. We clear the persisted entry on explicit
//     logout, on a WebID/account change, and whenever the token endpoint answers
//     `invalid_grant` (expired / revoked / rotation-reuse), so a dead token does
//     not linger.
//
// The store is an injectable interface so unit tests can supply an in-memory
// double; production wires {@link IndexedDbSessionStore}.

/**
 * One persisted session, keyed by issuer. The access token is deliberately
 * ABSENT — only the long-lived, key-bound refresh credential is durable.
 */
export interface PersistedSession {
  /** The OIDC issuer this session belongs to (the store key). */
  issuer: string;
  /** The authenticated WebID (ID-token `webid`/`sub`), for instant UI restore. */
  webId: string;
  /**
   * The DPoP-bound refresh token (RFC 6749 §6, RFC 9449). Readable on-origin but
   * unusable without {@link dpopKey} — see the module threat model.
   */
  refreshToken: string;
  /**
   * The DPoP key pair that sender-constrains {@link refreshToken}. Persisted as a
   * structured-cloneable CryptoKeyPair whose private key is `extractable: false`,
   * so the raw bytes never leave the browser's key store.
   */
  dpopKey: CryptoKeyPair;
  /** The Client Identifier Document URL used, when the session was static-client. */
  clientId?: string;
  /** Epoch ms the (now-discarded) access token would have expired — advisory. */
  expiresAt?: number;
}

/** The persistence contract the token provider depends on (injectable for tests). */
export interface SessionStore {
  get(issuer: string): Promise<PersistedSession | undefined>;
  put(session: PersistedSession): Promise<void>;
  delete(issuer: string): Promise<void>;
}

const DB_NAME = "pod-mail:sessions";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

/**
 * IndexedDB-backed {@link SessionStore}. One object store keyed by `issuer`,
 * holding the whole {@link PersistedSession} including the CryptoKeyPair (stored
 * directly — IndexedDB structured-clones non-extractable CryptoKeys).
 *
 * Origin-scoped by the platform. Construct only in the browser; guard with
 * {@link indexedDbAvailable} before use.
 */
export class IndexedDbSessionStore implements SessionStore {
  readonly #factory: IDBFactory;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.#factory = factory;
  }

  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.#factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "issuer" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Run one request inside a transaction and resolve when it is DURABLE.
   *
   * Writes (put/delete) resolve from `tx.oncomplete` — the transaction has
   * COMMITTED — so the caller never treats a credential as persisted/deleted
   * before it actually hit disk (roborev finding 4: resolving on `request.success`
   * alone races the commit). Reads (get) resolve from `request.onsuccess` with the
   * read value (a read has no durable mutation to await — its result IS the value,
   * and the readonly transaction completing carries no extra meaning). Either way a
   * `tx.onabort`/`tx.onerror` rejects, and the connection is closed in `finally`.
   */
  async #tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.#open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = run(tx.objectStore(STORE_NAME));
        if (mode === "readonly") {
          // A read: its result is available on success; no commit to await.
          request.onsuccess = () => resolve(request.result);
        } else {
          // A write: capture the request result, but only resolve once the
          // transaction has COMMITTED (oncomplete) so persistence is durable.
          let result: T;
          request.onsuccess = () => {
            result = request.result;
          };
          tx.oncomplete = () => resolve(result);
        }
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async get(issuer: string): Promise<PersistedSession | undefined> {
    const result = await this.#tx<PersistedSession | undefined>(
      "readonly",
      (store) => store.get(issuer) as IDBRequest<PersistedSession | undefined>,
    );
    return result ?? undefined;
  }

  async put(session: PersistedSession): Promise<void> {
    await this.#tx("readwrite", (store) => store.put(session));
  }

  async delete(issuer: string): Promise<void> {
    await this.#tx("readwrite", (store) => store.delete(issuer));
  }
}

/** Whether a usable IndexedDB exists (browser, non-SSR, not a locked-down env). */
export function indexedDbAvailable(): boolean {
  return typeof globalThis.indexedDB !== "undefined";
}
