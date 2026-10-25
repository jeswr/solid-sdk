// AUTHORED-BY Claude Opus 4.8
/**
 * The extension's durable auth state, backed by `chrome.storage.local`.
 *
 * What lives here, and why this store and not the page:
 *   - The active session (access + refresh token, the DPoP keypair as JWK, issuer/token
 *     endpoint, expiry). `chrome.storage.local` is reachable ONLY from the extension's own
 *     contexts (service worker / popup) — NEVER from a web page or the injected MAIN-world
 *     script. The refresh token therefore stays page-unreachable, satisfying the suite's
 *     "DPoP refresh token in extension-appropriate secure storage (not page-reachable)"
 *     invariant. The MAIN-world `window.solid` only ever sees the WebID + a proxied fetch.
 *   - The display profile (name + avatar) for the popup + the action icon.
 *   - The credential-free recent-accounts list (WebID + display, survives logout) for the
 *     returning-user affordance — the suite's recent-accounts UX.
 *   - Per-origin client-id mappings + extra pod origins (the credential boundary inputs).
 *
 * The refresh token is never logged; only the WebID/display is ever surfaced to a page.
 */

import { type ClassGrant, pruneExpiredGrants, sanitiseGrants } from './core/class-grant';

const KEYS = {
  session: 'solid:session',
  profile: 'solid:profile',
  recentAccounts: 'solid:recent-accounts',
  clientIds: 'solid:client-ids',
  podOrigins: 'solid:pod-origins',
  grantedOrigins: 'solid:granted-origins',
  classGrants: 'solid:class-grants',
  authParams: 'solid:auth-params',
} as const;

/**
 * The persisted active session. The DPoP keypair is NOT stored here — it lives as a
 * non-extractable `CryptoKeyPair` in IndexedDB (`core/dpop-key-db.ts` / `dpop-key-store.ts`),
 * never as JWK material in `chrome.storage.local`. See {@link loadSession} for the one-time
 * migration off the pre-hardening shape, which DID carry an inline extractable JWK pair.
 */
export interface StoredSession {
  readonly webId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /**
   * RFC 7638 thumbprint of the DPoP public key this session's tokens are bound to, recorded
   * at mint time. Absent ONLY for a session created before this hardening shipped (the
   * pre-hardening shape never tracked it) — `dpop-key-store.ts` `loadSessionDpopKeyPair` uses
   * its absence as the one-time legacy-migration signal, and its presence to detect an
   * unexpected key loss/replacement rather than silently using the wrong key.
   */
  readonly dpopJkt?: string;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

/** The credential-free display profile shown in the popup + the action icon. */
export interface StoredProfile {
  readonly webId: string;
  readonly name: string | null;
  readonly photoUrl: string | null;
}

/** A previously-used account, for the returning-user affordance (no credential). */
export interface RecentAccount {
  readonly webId: string;
  readonly name: string | null;
  readonly photoUrl: string | null;
}

async function get<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? null;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// --- Active session -------------------------------------------------------------------

/**
 * The pre-hardening on-disk session shape: the DPoP private key stored inline as an
 * **extractable** JWK pair. Only used here, to DETECT + strip a legacy record — the value
 * itself is never read for its key material (we don't import it; see `dpop-key-store.ts`
 * `loadOrRotateDpopKeyPair` for why a fresh key is minted instead).
 */
interface LegacySessionShape {
  readonly dpopKeyPair?: unknown;
}

/**
 * Load the active session, migrating a pre-hardening record on the way out: if the raw
 * stored value still carries the legacy inline `dpopKeyPair` (an extractable JWK pair), it
 * is stripped and the cleaned record is written back immediately — so extractable private
 * key material never lingers in `chrome.storage.local` beyond the very first read after this
 * change ships. `service-worker.ts#ensureSession` detects the resulting absence of a
 * persisted IndexedDB key and mints a replacement (see `dpop-key-store.ts`).
 */
export async function loadSession(): Promise<StoredSession | null> {
  const raw = await get<StoredSession & LegacySessionShape>(KEYS.session);
  if (!raw) return null;
  if ('dpopKeyPair' in raw) {
    const { dpopKeyPair: _legacyExtractableKey, ...clean } = raw;
    await set(KEYS.session, clean);
    return clean;
  }
  return raw;
}

export function saveSession(session: StoredSession): Promise<void> {
  return set(KEYS.session, session);
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(KEYS.session);
}

// --- Display profile + recent accounts ------------------------------------------------

export function loadProfile(): Promise<StoredProfile | null> {
  return get<StoredProfile>(KEYS.profile);
}

export async function saveProfile(profile: StoredProfile): Promise<void> {
  await set(KEYS.profile, profile);
  await rememberAccount(profile);
}

export async function clearProfile(): Promise<void> {
  await chrome.storage.local.remove(KEYS.profile);
}

/** The recent-accounts list (most-recent-first, deduped by WebID). Survives logout. */
export async function loadRecentAccounts(): Promise<RecentAccount[]> {
  return (await get<RecentAccount[]>(KEYS.recentAccounts)) ?? [];
}

/** Promote/insert an account at the front of the recent list (logout-surviving memory). */
async function rememberAccount(profile: StoredProfile): Promise<void> {
  const list = await loadRecentAccounts();
  const next: RecentAccount[] = [
    { webId: profile.webId, name: profile.name, photoUrl: profile.photoUrl },
    ...list.filter((a) => a.webId !== profile.webId),
  ].slice(0, 8);
  await set(KEYS.recentAccounts, next);
}

// --- Per-origin client IDs + pod origins (credential-boundary inputs) ------------------

export async function loadClientIds(): Promise<Record<string, string>> {
  return (await get<Record<string, string>>(KEYS.clientIds)) ?? {};
}

export async function saveClientId(origin: string, clientId: string): Promise<void> {
  const map = await loadClientIds();
  map[origin] = clientId;
  await set(KEYS.clientIds, map);
}

/** User-configured pod origins (pods served from a host other than the WebID origin). */
export async function loadPodOrigins(): Promise<string[]> {
  return (await get<string[]>(KEYS.podOrigins)) ?? [];
}

export async function savePodOrigins(origins: string[]): Promise<void> {
  await set(KEYS.podOrigins, origins);
}

// --- Granted requesting origins (the per-REQUESTING-origin access gate) ----------------
//
// The set of APP origins the owner has authorised to drive `window.solid.fetch`. This is
// the Phase-0 grant store: default-deny means an origin not in this set (and not a
// credential/pod origin) cannot read or write the pod through the extension. The owner
// opts an app in by a deliberate, browser-attested action FROM that app's origin (login /
// setClientId); the extension's own popup/side-panel flows do not add a web origin.
//
// NOTE: this store holds only origin strings (no credential). It is the single-user
// owner-only grant model; the per-data-class grant store (tt6) is a later phase.

/** The app origins explicitly granted access (most-recent-first not required; a set). */
export async function loadGrantedOrigins(): Promise<string[]> {
  return (await get<string[]>(KEYS.grantedOrigins)) ?? [];
}

/**
 * Grant an app origin access (idempotent). Only a well-formed http(s) origin is stored;
 * an opaque/invalid value is ignored (fail-closed — we never persist a "null" grant).
 */
export async function grantOrigin(origin: string): Promise<void> {
  let canonical: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    canonical = u.origin;
    if (canonical === 'null' || canonical === '') return;
  } catch {
    return;
  }
  const list = await loadGrantedOrigins();
  if (list.includes(canonical)) return;
  await set(KEYS.grantedOrigins, [...list, canonical]);
}

/** Revoke an app origin's access. */
export async function revokeOrigin(origin: string): Promise<void> {
  const list = await loadGrantedOrigins();
  const next = list.filter((o) => o !== origin);
  if (next.length !== list.length) await set(KEYS.grantedOrigins, next);
}

// --- Per-data-class grants (the Phase-2 grant store, design §4) ------------------------
//
// The NARROWER, class-scoped capability layered ON TOP of the per-origin grant above: a grant
// keyed by (origin, dataClass, modes, purpose, expiry) whose enforceable substance is a PINNED,
// resolved target set (class-grant.ts / class-resolve.ts). Stored as a plain array; every read
// runs `sanitiseGrants` so a corrupt/tampered record authorises nothing (fail-closed). A grant
// is bound to the WebID it was minted under (the session boundary) — see ClassGrant.webId.

/**
 * A single-writer SERIALISER for the class-grant array. `chrome.storage.local` offers no
 * compare-and-set, and every mutation is a read-modify-write of ONE array; without
 * serialisation two interleaved async mutations race — e.g. a `saveClassGrant` that read the
 * array BEFORE a concurrent `revokeClassGrant` would write back a stale array that RESURRECTS
 * the just-revoked grant, breaking the "revocation effective next request" invariant. This
 * promise-chain mutex makes every read-modify-write critical section run to completion before
 * the next starts, so each re-reads the freshest array. (The SW event loop is single-threaded,
 * but `await`s still interleave — this closes that window.)
 */
let classGrantMutex: Promise<unknown> = Promise.resolve();
function withClassGrantLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = classGrantMutex.then(fn, fn);
  // Keep the chain alive regardless of this mutation's outcome (never reject the shared chain).
  classGrantMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Load every stored class grant, dropping any structurally-invalid (tampered) record. */
export async function loadClassGrants(): Promise<ClassGrant[]> {
  return sanitiseGrants(await get<unknown[]>(KEYS.classGrants));
}

/** Persist a new class grant (append). The caller mints a unique `grantId`. Serialised. */
export function saveClassGrant(grant: ClassGrant): Promise<void> {
  return withClassGrantLock(async () => {
    const list = await loadClassGrants();
    await set(KEYS.classGrants, [...list, grant]);
  });
}

/**
 * Revoke a class grant by id, but ONLY when it belongs to `origin` (a page may revoke its OWN
 * grants, never another origin's). Removes EVERY row matching `(grantId, origin)` — so a store that
 * somehow holds a duplicate id can never leave a matching grant live after a "successful" revoke —
 * and returns ALL removed grants (so the caller can purge each one's replica slice — residual b).
 * An empty array ⇒ nothing matched. Effect is immediate on the NEXT request — the SW re-reads the
 * store per request (no in-memory grant cache), so a removed grant is gone from the very next gate
 * decision (design item 3 — propagation bound). Serialised against the other mutations so a
 * concurrent save cannot resurrect the revoked grant.
 *
 * FAIL-CLOSED ORDERING: this REMOVAL is the authoritative deny. The caller purges the revoked
 * grant's replica bytes AFTER (and best-effort) — so a byte-purge failure can never leave access
 * live; it only means the (now un-servable, grant-less) bytes linger until logout.
 */
export function revokeClassGrant(grantId: string, origin: string): Promise<ClassGrant[]> {
  return withClassGrantLock(async () => {
    const list = await loadClassGrants();
    const matches = (g: ClassGrant): boolean => g.grantId === grantId && g.origin === origin;
    const removed = list.filter(matches);
    if (removed.length === 0) return [];
    await set(
      KEYS.classGrants,
      list.filter((g) => !matches(g)),
    );
    return removed;
  });
}

/**
 * Prune expired grants from the store at `now`, persisting the pruned list only when it
 * changed. Returns BOTH the LIVE grants and the EXPIRED ones removed (so the caller can purge each
 * expired grant's replica slice — access-management residual b). Called opportunistically on the
 * fetch path so an expired grant is denied (by the gate), garbage-collected (design item 3), AND
 * its replicated bytes purged. Serialised so a prune cannot clobber a concurrent save/revoke (it
 * re-reads inside the critical section).
 */
export function pruneExpiredClassGrants(
  now: number,
): Promise<{ live: ClassGrant[]; expired: ClassGrant[] }> {
  return withClassGrantLock(async () => {
    const list = await loadClassGrants();
    const live = pruneExpiredGrants(list, now);
    if (live.length !== list.length) await set(KEYS.classGrants, live);
    const liveSet = new Set(live);
    const expired = list.filter((g) => !liveSet.has(g));
    return { live, expired };
  });
}

/**
 * Drop ALL class grants (called on logout — grants are bound to the departing session).
 * Serialised through the SAME mutex as the other mutations so a logout cannot interleave a
 * concurrent `saveClassGrant`/`pruneExpiredClassGrants` read-modify-write and leave a grant
 * persisted after sign-out (roborev round-2 Medium).
 */
export function clearClassGrants(): Promise<void> {
  return withClassGrantLock(async () => {
    await chrome.storage.local.remove(KEYS.classGrants);
  });
}

// --- Transient auth params (PKCE/state across the redirect) ----------------------------

export interface AuthParams {
  readonly codeVerifier: string;
  readonly state: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly redirectUri: string;
}

export function loadAuthParams(): Promise<AuthParams | null> {
  return get<AuthParams>(KEYS.authParams);
}

export function saveAuthParams(params: AuthParams): Promise<void> {
  return set(KEYS.authParams, params);
}

export async function clearAuthParams(): Promise<void> {
  await chrome.storage.local.remove(KEYS.authParams);
}
