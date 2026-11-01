// AUTHORED-BY Claude Sonnet 5
/**
 * Orchestrates the durable, non-extractable DPoP session keypair: mint-and-persist at
 * login, reload-from-IndexedDB on every SW wake, and the one-time legacy migration off the
 * old extractable-JWK-in-`chrome.storage.local` shape (security hardening — see
 * `dpop-key-db.ts` for the full rationale, `session-store.ts#loadSession` for where the
 * legacy shape is detected + stripped).
 */

import { dpopThumbprint, generateDpopKeyPair } from './dpop';
import type { DpopKeyDb } from './dpop-key-db';

/** Export ONLY the public JWK — always safe, regardless of the private key's extractability. */
async function publicJwkOf(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

/**
 * Persist an ALREADY-MINTED keypair as the session's active key. Split out from
 * {@link mintAndPersistDpopKeyPair} so a caller can generate a key EARLY (needed to sign the
 * token-exchange DPoP proof itself) but defer the destructive overwrite of this single-record
 * store until it knows the mint was actually USED for a token set — see `auth-flow.ts`
 * `completeLogin`, which persists only after the token exchange succeeds (roborev round-1
 * Medium: persisting before success let a failed/retried login clobber an existing session's
 * still-valid key).
 */
export async function persistDpopKeyPair(db: DpopKeyDb, keyPair: CryptoKeyPair): Promise<void> {
  await db.put({
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicJwk: await publicJwkOf(keyPair),
  });
}

/** Mint a fresh non-extractable keypair and persist it as the session's active key. */
export async function mintAndPersistDpopKeyPair(db: DpopKeyDb): Promise<CryptoKeyPair> {
  const keyPair = await generateDpopKeyPair();
  await persistDpopKeyPair(db, keyPair);
  return keyPair;
}

/**
 * Thrown by {@link loadSessionDpopKeyPair} when the persisted key does NOT usably back a
 * CURRENT-shape session (one that recorded a `dpopJkt` at mint time) — either it is gone
 * entirely, or the persisted key doesn't match what this session expects. Callers MUST treat
 * this as a broken, unrecoverable-in-place session (teardown + re-login), the same as a
 * refresh-grant failure — never catch it and silently proceed with an unrelated key (roborev
 * round-1 Medium: a silently-rotated key for a still-token-bearing session just produces
 * confusing 401s instead of a clean re-login prompt).
 */
export class DpopKeyUnavailableError extends Error {
  constructor(reason: 'missing' | 'mismatch') {
    super(
      reason === 'missing'
        ? 'The persisted DPoP key is missing for a session that expects one.'
        : 'The persisted DPoP key does not match this session (dpopJkt mismatch).',
    );
    this.name = 'DpopKeyUnavailableError';
  }
}

/** The minimal session shape this module needs — just the recorded key thumbprint, if any. */
export interface DpopBoundSession {
  readonly dpopJkt?: string;
}

/**
 * Load the keypair backing `session`, verifying it against the session's recorded `dpopJkt`
 * when present, or mint+persist a fresh one ONLY for the one-time legacy migration.
 *
 * Three cases:
 *   1. A persisted key exists AND (the session has no recorded `dpopJkt` yet, OR the key's
 *      thumbprint matches it) — return it. This is the overwhelmingly common case: every
 *      normal SW wake after a real login.
 *   2. A persisted key exists but its thumbprint does NOT match `session.dpopJkt` — the store
 *      was overwritten by something else (e.g. a later login) while this session object is
 *      stale. Throws {@link DpopKeyUnavailableError}: using the wrong key would just produce
 *      confusing 401s, not a functioning session.
 *   3. No persisted key exists:
 *      - if `session.dpopJkt` is set, this is a CURRENT-shape session whose key was
 *        unexpectedly lost (IndexedDB eviction, browser bug) — throws
 *        {@link DpopKeyUnavailableError}, since minting a replacement would silently swap in a
 *        key this session's tokens were never bound to.
 *      - if `session.dpopJkt` is undefined, this is the ONE-TIME legacy migration:
 *        `session-store.ts#loadSession` strips a pre-hardening inline extractable JWK the
 *        moment it sees one, which leaves THIS store empty on the very next read. We
 *        deliberately do NOT attempt to import the stripped JWK as a new non-extractable key
 *        (that would still mean the private scalar touched JS as extractable material) — we
 *        mint a REPLACEMENT key instead, per the instructed rotation. A legacy session's
 *        refresh token was RFC 9449 DPoP-bound (`cnf.jkt`) to the OLD key, so it will fail the
 *        next refresh grant; the existing refresh-failure teardown in `service-worker.ts`'s
 *        `ensureSession()` already turns that into a clean logout rather than a crash.
 *
 * Callers (both `auth-flow.ts` `refreshSession` and `service-worker.ts` `ensureSession`) treat
 * a thrown `DpopKeyUnavailableError` exactly like a refresh-grant failure: tear the session
 * down for a clean re-login, never retry with a substitute key.
 */
export async function loadSessionDpopKeyPair(
  db: DpopKeyDb,
  session: DpopBoundSession,
): Promise<CryptoKeyPair> {
  const record = await db.get();
  if (record) {
    if (session.dpopJkt !== undefined) {
      const jkt = await dpopThumbprint(record.publicKey);
      if (jkt !== session.dpopJkt) throw new DpopKeyUnavailableError('mismatch');
    }
    return { privateKey: record.privateKey, publicKey: record.publicKey };
  }
  if (session.dpopJkt !== undefined) throw new DpopKeyUnavailableError('missing');
  return mintAndPersistDpopKeyPair(db);
}
