// AUTHORED-BY Claude Opus 4.8
/**
 * The MV3 background service worker — the session manager + message router + the one
 * holder of the access token. It:
 *   - restores/refreshes the session (DPoP refresh grant, proactive 30s-before-expiry),
 *   - routes the page/popup message protocol (login / logout / fetch / get-state /
 *     set-client-id),
 *   - performs every authenticated fetch behind the core credential boundary
 *     (origin-gated, token-endpoint-guarded, §8 nonce retry), and
 *   - drives the toolbar action icon (the signed-in avatar) + state broadcasts.
 *
 * RE-ENTRANCY: discovery / token / refresh / profile fetches use the RAW `fetch`, never
 * the authenticatedFetch path — so a SW-internal request can never recurse into the
 * token-attaching path, and the access token is only ever sent to a vetted resource
 * origin.
 *
 * The MV3 worker is killed aggressively; all durable state lives in chrome.storage and is
 * re-hydrated on wake (the in-memory caches below are best-effort accelerators only).
 */

import type {
  AccessResponse,
  ActionResult,
  ConsentDecisionMessage,
  FetchRequest,
  FetchResponse,
  GetPendingConsentRequest,
  GetStateRequest,
  GrantSummary,
  ListGrantsRequest,
  LoginRequest,
  PendingConsentView,
  RequestAccessRequest,
  ResolveClassRequest,
  RevokeGrantRequest,
  SessionState,
  SetClientIdRequest,
  WorkerRequest,
} from '../shared/messages';
import { setSignedInIcon, setSignedOutIcon } from './action-icon';
import { initiateLogin, refreshSession } from './auth-flow';
import { authenticatedFetch, type FetchSession } from './core/authenticated-fetch';
import {
  type ClassGrant,
  decideClassAccess,
  grantsForSession,
  liveGrantOrigins,
  modeSatisfies,
  type PinnedTarget,
  pruneExpiredGrants,
} from './core/class-grant';
import { normaliseAccessRequest } from './core/class-request';
import { resolveClassTargets } from './core/class-resolve';
import { buildPendingConsent, consentDecisionToGrants, type PendingConsent } from './core/consent';
import { DpopKeyDb } from './core/dpop-key-db';
import { DpopKeyUnavailableError, loadSessionDpopKeyPair } from './core/dpop-key-store';
import { computeAllowedOrigins, isValidClientIdUrl } from './core/origin-policy';
import {
  type EgressPort,
  purgeReplica,
  purgeReplicaSlice,
  type ReplicaByteCache,
  SharedReplica,
} from './core/replica';
import { ReplicaDb } from './core/replica-db';
import {
  decideRequestAccess,
  type RequestAccessDenyReason,
  type ThrottleState,
} from './core/request-access-throttle';
import {
  computeGrantedOrigins,
  decideRequestingOrigin,
  isRequestingOriginGranted,
  type MessageSender,
  resolveRequestingOrigin,
} from './core/requesting-origin';
import { filterResponseHeaders } from './core/response-headers';
import { SingleFlight } from './core/single-flight';
import { parseWebIdProfile } from './core/webid';
import { registerGlobalFetchInjection } from './global-fetch-register';
import {
  clearClassGrants,
  clearProfile,
  clearSession,
  grantOrigin,
  loadClassGrants,
  loadClientIds,
  loadGrantedOrigins,
  loadPodOrigins,
  loadProfile,
  loadRecentAccounts,
  loadSession,
  pruneExpiredClassGrants,
  revokeClassGrant,
  type StoredSession,
  saveClassGrant,
  saveClientId,
  saveProfile,
} from './session-store';
import { registerSidePanel } from './side-panel';

const ALLOW_INSECURE_LOOPBACK = true; // dev CSS over http://localhost; harmless for https issuers.
const EXPIRY_BUFFER_MS = 30_000;

/** The Cache API bucket holding the shared replica's bytes (one physical store, see replica.ts). */
const REPLICA_CACHE_NAME = 'solid-ext-replica-bytes';

/** Best-effort in-memory caches (re-hydrated from storage on SW wake). */
let cachedSession: StoredSession | null = null;
let cachedKeyPair: CryptoKeyPair | null = null;

/**
 * The replica IndexedDB handle (metadata + the DPoP nonce cache). Re-derivable on every SW
 * wake — a best-effort accelerator, never load-bearing in-memory state (MV3 invariant). The
 * DPoP nonce cache lives in IndexedDB (NOT an in-memory Map) so a cold wake does not pay the
 * RFC 9449 §8 nonce round-trip on its first request (design §2.1, §5.2).
 */
let replicaDbHandle: ReplicaDb | null = null;

/** Lazily open (once per wake) the replica DB. */
async function getReplicaDb(): Promise<ReplicaDb> {
  if (!replicaDbHandle) replicaDbHandle = await ReplicaDb.open();
  return replicaDbHandle;
}

/**
 * The DPoP keypair IndexedDB handle — the non-extractable `CryptoKeyPair`'s durable home
 * (see `core/dpop-key-db.ts`). Re-derivable on every SW wake, same as the replica DB above.
 */
let dpopKeyDbHandle: DpopKeyDb | null = null;

/** Lazily open (once per wake) the DPoP key DB. */
async function getDpopKeyDb(): Promise<DpopKeyDb> {
  if (!dpopKeyDbHandle) dpopKeyDbHandle = await DpopKeyDb.open();
  return dpopKeyDbHandle;
}

/** The named Cache bucket for replica bytes (re-opened lazily; available in the SW context). */
function getReplicaCache(): Promise<ReplicaByteCache> {
  return caches.open(REPLICA_CACHE_NAME) as Promise<ReplicaByteCache>;
}

/**
 * Purge the replica slice of each GONE (revoked / expired) class grant (access-management residual
 * b). `retainPool` are the grants that SURVIVE — a resource still covered by a surviving grant of
 * the SAME `(webId, origin)` is KEPT, so revoking/expiring one of two overlapping grants never
 * evicts data the survivor still authorises. Best-effort (a failure only leaves now grant-less
 * bytes to the logout purge); the replica stores are opened only when something is actually gone.
 *
 * The replica caches only GET (READ) representations, and this codebase treats `write` as NOT
 * implying `read` (see `modeSatisfies`). So ONLY a surviving grant that satisfies READ justifies
 * retaining cached bytes — a surviving write-only / append-only grant does NOT authorise reading
 * them, so its overlap must NOT keep readable bytes resident after the read grant is gone.
 */
async function purgeGrantSlices(gone: readonly ClassGrant[], retainPool: readonly ClassGrant[]) {
  if (gone.length === 0) return;
  try {
    const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
    for (const g of gone) {
      const retainTargets = retainPool
        .filter(
          (r) => r.webId === g.webId && r.origin === g.origin && modeSatisfies(r.modes, 'read'),
        )
        .flatMap((r) => r.targets);
      await purgeReplicaSlice(cache, db, {
        webId: g.webId,
        grantScope: g.origin,
        targets: g.targets,
        retainTargets,
      });
    }
  } catch {
    // Best-effort: the grants are already gone (denied); their un-servable bytes are swept by the
    // synchronous logout purge if this failed.
  }
}

/**
 * Prune expired class grants AND purge each expired grant's replica slice (access-management
 * residual b). Returns the LIVE grants (the same value the callers previously got from
 * `pruneExpiredClassGrants`). The store prune is the authoritative deny; the byte purge is
 * best-effort. The surviving `live` grants are the retain-pool so an expiring grant that overlaps a
 * still-live one does not evict the survivor's data.
 */
async function pruneAndPurgeExpiredGrants(now: number): Promise<ClassGrant[]> {
  const { live, expired } = await pruneExpiredClassGrants(now);
  await purgeGrantSlices(expired, live);
  return live;
}
/**
 * Single-flight refresh: concurrent near-expiry requests must NOT each start a refresh
 * with the same (rotation-bound) refresh token — that races, so one grant succeeds and the
 * others fail with invalid_grant and would wrongly tear down the freshly-refreshed session.
 * All callers await the one in-flight refresh instead.
 */
const refreshGate = new SingleFlight<StoredSession>();

/** Refresh `session` exactly once even under concurrency; rejects on a genuine failure. */
function refreshOnce(session: StoredSession): Promise<StoredSession> {
  return refreshGate.run(async () => {
    const updated = await refreshSession(session);
    cachedSession = updated;
    cachedKeyPair = null;
    return updated;
  });
}

/** Load + refresh-if-needed the active session and its (imported) keypair. */
async function ensureSession(): Promise<{ session: StoredSession; keyPair: CryptoKeyPair } | null> {
  if (!cachedSession) cachedSession = await loadSession();
  if (!cachedSession) return null;

  if (cachedSession.expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
    const toRefresh = cachedSession;
    try {
      await refreshOnce(toRefresh);
    } catch {
      // Only tear down if nothing newer has landed: a concurrent single-flight refresh (or
      // a fresh login) may already have replaced the session this caller tried to refresh.
      if (cachedSession === toRefresh) {
        await teardownSession();
        return null;
      }
    }
  }

  if (!cachedSession) return null;
  if (!cachedKeyPair) {
    try {
      cachedKeyPair = await loadSessionDpopKeyPair(await getDpopKeyDb(), cachedSession);
    } catch (err) {
      if (err instanceof DpopKeyUnavailableError) {
        // The persisted DPoP key is missing or doesn't match THIS session specifically
        // (IndexedDB eviction, a browser bug, or a stale in-memory session object) —
        // unrecoverable in place. Tear down for a clean re-login rather than silently
        // signing with the wrong (or a freshly-minted, orphaned) key, which would just
        // produce confusing 401s.
        await teardownSession();
      }
      // Either the confirmed-broken-session teardown above, or a TRANSIENT/unexpected
      // failure (IndexedDB open error, a bug) — in the transient case we deliberately do
      // NOT tear down (the stored session/tokens are left intact), we just fail THIS one
      // call soft, matching every caller's existing "no ctx ⇒ not authenticated" handling.
      // `cachedKeyPair` stays null either way, so the very next call retries cleanly.
      return null;
    }
  }
  return { session: cachedSession, keyPair: cachedKeyPair };
}

/**
 * Tear down the session AND SYNCHRONOUSLY purge the shared replica BEFORE returning, so no
 * subsequent (returning / different-user) read can be served a single departed-identity byte
 * (design §4.3 "Cross-USER stale bytes", §5.4 point 5). The logout handler AWAITS this; the
 * purge (replica bytes + metadata + cached DPoP nonces) completes before any further serve.
 * `priorWebId` scopes the purge to exactly that identity's rows; a missing prior WebID purges
 * everything (fail-closed). The WebID-in-key already makes a cross-user collision impossible;
 * this removes the prior rows entirely so even a same-key re-provision cannot collide.
 */
async function teardownSession(): Promise<void> {
  const priorWebId = (cachedSession ?? (await loadSession()))?.webId ?? null;
  cachedSession = null;
  cachedKeyPair = null;

  // SYNCHRONOUS-BEFORE-SERVE replica purge. Best-effort on the stores (a missing DB must not
  // block sign-out), but AWAITED so it precedes any new serve.
  try {
    const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
    await purgeReplica(cache, db, priorWebId);
  } catch {
    // If the replica stores are unavailable, sign-out still proceeds (no bytes to leak when
    // the store never opened). The WebID-scoped key means a future session cannot read them.
  }

  // Class grants are bound to the departing session's WebID (ClassGrant.webId) and its resolved,
  // pinned pod targets — they MUST NOT survive into a different identity's session. Clear them on
  // logout (fail-closed; the WebID binding already prevents cross-identity use, this removes them
  // entirely). The coarse per-origin grant store (login opt-ins) intentionally survives logout.
  // The persisted DPoP keypair is likewise session-bound (a fresh one is minted per login /
  // legacy-migration rotation) — drop it too so no departed session's key lingers in IndexedDB.
  await Promise.all([
    clearSession(),
    clearProfile(),
    clearClassGrants(),
    getDpopKeyDb().then((db) => db.clear()),
  ]);
  await setSignedOutIcon();
}

/** Build the per-request fetch session (the credential boundary) from the stored session. */
async function buildFetchSession(
  session: StoredSession,
  keyPair: CryptoKeyPair,
): Promise<FetchSession> {
  const podOrigins = await loadPodOrigins();
  const allowedOrigins = computeAllowedOrigins({
    webId: session.webId,
    issuer: session.issuer,
    podOrigins,
    allowInsecureLoopback: ALLOW_INSECURE_LOOPBACK,
  });
  return {
    accessToken: session.accessToken,
    dpopKeyPair: keyPair,
    allowedOrigins,
    tokenEndpoint: session.tokenEndpoint,
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const DENY_MESSAGE = {
  'forbidden-origin': 'Forbidden origin',
  'origin-not-granted': 'Origin not granted access',
  'cross-origin-foreign': 'Cross-origin fetch denied',
} as const;

/**
 * The per-data-class deny messages — DISTINGUISHABLE strings the page can surface (design
 * item 2), separate from the coarse per-origin deny reasons above. A class-scoped origin whose
 * request falls outside its pinned target set (wrong resource / wrong mode / no live grant)
 * gets one of these, so the app can tell "you were denied because this is outside your grant"
 * from a plain forbidden-origin.
 */
const CLASS_DENY_MESSAGE = {
  'out-of-grant-scope': 'Out of grant scope',
  'no-class-grant': 'No access grant for this data',
} as const;

/** Whether a request URL's origin is one of the session's credential (pod) origins. */
function originInSet(allowed: ReadonlySet<string>, url: string): boolean {
  const o = originOf(url);
  return o !== null && allowed.has(o);
}

/**
 * The FULL access gate — re-run BEFORE any pod egress or cache read (incl. on a cache hit, via
 * the replica's injected gate). Two layers, both fail-closed, both re-reading durable storage on
 * EVERY request (no load-bearing in-memory gate state → a cold SW wake is fail-CLOSED):
 *
 *   1. The Phase-0/1 PER-ORIGIN gate (`decideRequestingOrigin`): dual-origin agreement, opaque
 *      → deny, default-deny per-origin grant, same-origin-or-deny foreign fetch. The granted set
 *      is the login/`setClientId` grants ∪ the session credential origins ∪ the origins holding a
 *      live class grant for the ACTIVE WebID (so a class-only origin passes this layer and is then
 *      confined by layer 2). A DENY here is unchanged from Phase-0.
 *   2. The Phase-2 PER-DATA-CLASS gate (`decideClassAccess`): runs ONLY for a pod (credential)
 *      target AND ONLY for an origin that is present solely because it holds class grants (a
 *      FULL-grant origin — a login/credential origin — BYPASSES it, preserving the legacy
 *      whole-pod behaviour → backwards compatibility, design item 5). The request URL + method
 *      must fall within a non-expired grant's PINNED resolved target set with a satisfying mode,
 *      else DENY with a distinguishable class reason.
 *
 * `webId` is the active session WebID (the grant session boundary). Fail-closed on DENY.
 */
async function gateAccess(
  message: FetchRequest,
  requestingOrigin: string,
  sender: MessageSender | undefined,
  allowedTargetOrigins: ReadonlySet<string>,
  webId: string,
): Promise<{ grantScope: string } | { deny: Response }> {
  const now = Date.now();
  const explicitGrants = await loadGrantedOrigins();
  // Opportunistically prune expired grants on the fetch path (design item 3: expired → pruned) AND
  // purge each expired grant's replica slice (residual b — no bytes linger past expiry).
  const liveGrants = await pruneAndPurgeExpiredGrants(now);
  const classOrigins = [...liveGrantOrigins(liveGrants, now, webId)];

  const decision = decideRequestingOrigin(sender, message.stampedOrigin, message.url, {
    explicitGrants: [...explicitGrants, ...classOrigins],
    credentialOrigins: allowedTargetOrigins,
  });
  // Defence-in-depth: the re-resolved origin must match the one resolved earlier this request.
  if (decision.deny !== null || decision.requestingOrigin !== requestingOrigin) {
    return {
      deny: denyResponse(
        decision.deny ? DENY_MESSAGE[decision.deny] : DENY_MESSAGE['forbidden-origin'],
      ),
    };
  }

  // Layer 2 — the per-class gate. Only pod (credential) targets are class-scoped; a same-origin
  // foreign target carries no pod token and is governed by the foreign-fetch policy above.
  if (originInSet(allowedTargetOrigins, message.url)) {
    // A FULL-grant origin (explicit login/setClientId grant OR a credential/pod origin) keeps
    // whole-pod access — the legacy behaviour. Only a CLASS-ONLY origin is confined to its pins.
    // NB the full-grant set is built via computeGrantedOrigins so the login-grant strings are
    // NORMALISED (host-lowercased) to match the browser-attested `requestingOrigin` — and it
    // DELIBERATELY excludes the class-grant origins (they are the ones we mean to confine).
    const fullGrant = computeGrantedOrigins({
      explicitGrants,
      credentialOrigins: allowedTargetOrigins,
    });
    if (!fullGrant.has(requestingOrigin)) {
      const forSession = grantsForSession(liveGrants, requestingOrigin, webId);
      const reason = decideClassAccess(forSession, message.url, message.method, now);
      if (reason !== null) {
        return { deny: denyResponse(CLASS_DENY_MESSAGE[reason]) };
      }
    }
  }

  return { grantScope: requestingOrigin };
}

const READ_METHODS = new Set(['GET', 'HEAD']);

async function handleFetch(
  message: FetchRequest,
  sender: MessageSender | undefined,
): Promise<FetchResponse> {
  // FIRST, before ANY session work (which may trigger a token refresh): the cheap,
  // session-independent half of the gate — dual-origin agreement + opaque/null rejection. A
  // forged/opaque origin is denied here so it cannot even cause a session-refresh side
  // effect (refresh-token amplification). The browser-attested sender is the authority.
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) {
    // Round-2 HIGH #1: a forged/opaque origin on the EXPLICIT path is a 403. An `autoDivert`
    // request (the global-fetch patch) must never hard-fail the page — but the SW must NOT do
    // the fallback fetch itself (that would make the extension a cross-origin read proxy). It
    // returns a PASSTHROUGH SENTINEL (no network) and the page-side inject does the native
    // fetch in the page's own origin context.
    if (message.autoDivert) return passthroughSentinel(message);
    return {
      requestId: message.requestId,
      status: 403,
      error: DENY_MESSAGE['forbidden-origin'],
    };
  }

  const ctx = await ensureSession();
  if (!ctx) {
    // No session: the explicit path reports "Not authenticated"; an autoDivert request gets the
    // passthrough sentinel so the page does the plain native fetch it would have done itself (no
    // credential exists to attach anyway, and the SW performs no network).
    if (message.autoDivert) return passthroughSentinel(message);
    return { requestId: message.requestId, error: 'Not authenticated' };
  }

  try {
    const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair);

    // The INJECTED gate the replica runs as the FIRST step on EVERY read AND write — including
    // on a CACHE HIT (design §5.4 point 3). It re-runs the SAME audited `gateRequestingOrigin`
    // decision (idempotent) and returns the verified grant-scope on ALLOW; the replica never
    // touches the cache or the pod before this resolves to ALLOW, so a warm cache can never
    // bypass the per-origin gate.
    const gate = (): Promise<{ grantScope: string } | { deny: Response }> =>
      gateAccess(message, requestingOrigin, sender, fetchSession.allowedOrigins, ctx.session.webId);

    const origin = originOf(message.url);
    const db = await getReplicaDb();
    const cache = await getReplicaCache();
    const nonce = origin ? await db.getNonce(origin) : undefined;

    // The SW's sole DPoP egress (authenticated-fetch.ts), wrapped as the replica's egress
    // port. The DPoP-bound, origin-gated, §8-nonce-retry egress is PRESERVED VERBATIM — the
    // replica only chooses WHEN to call it (revalidate vs write-through) and adds the
    // conditional header; it never re-implements the credential path.
    const egress: EgressPort = {
      fetch: async (url, method, headers, body, n) => {
        const result = await authenticatedFetch(fetchSession, {
          url,
          method,
          headers,
          body,
          nonce: n,
        });
        return { response: result.response, nonce: result.nonce };
      },
    };

    const replica = new SharedReplica({
      gate,
      egress,
      cache,
      db,
      webId: ctx.session.webId,
    });

    const isRead = READ_METHODS.has(message.method.toUpperCase());
    const result = isRead
      ? await replica.read(message.url, message.method, message.headers, nonce)
      : await replica.write(message.url, message.method, message.headers, message.body, nonce);

    if ('deny' in result) {
      // The gate denied (incl. on a would-be cache hit). The replica touched NEITHER the pod
      // NOR the cache before denying, so nothing leaked.
      //
      // Round-2 HIGH #1 — page-compat invariant: a request that came from the BEST-EFFORT
      // global-fetch transparency patch (`autoDivert`) must NEVER be hard-failed. The patch
      // routes EVERY cross-origin request, so a DENY here is the common case for an app's NORMAL
      // traffic to a third-party API/CDN (a non-pod target) or from an un-granted origin. For
      // those the SW returns a PASSTHROUGH SENTINEL — NO token, NO replica, NO 403, and crucially
      // NO NETWORK FROM THE SW. The page-side inject then completes the request with its OWN
      // native `fetch` (PRISTINE_FETCH) in the page's origin context, so the page behaves exactly
      // as if the extension were not installed (CORS, credentials, headers all preserved). This
      // closes the round-2 hole where the SW (with <all_urls> host perms) doing the fallback
      // fetch turned the extension into an open cross-origin read proxy. The SW does ZERO egress
      // on this path, so it can never read cross-origin bytes a page's own CORS would block. An
      // EXPLICIT `window.solid.fetch` (autoDivert false) keeps the 403: the caller deliberately
      // asked for the gated path.
      if (message.autoDivert) {
        return passthroughSentinel(message);
      }
      return {
        requestId: message.requestId,
        status: result.deny.status,
        error: await result.deny.text(),
      };
    }

    // Persist the freshest server nonce to IndexedDB so it survives an SW restart.
    if (origin && result.nonce) await db.setNonce(origin, result.nonce);

    // Defense-in-depth: relay only the allowlisted, app-relevant response headers back to
    // the page rather than every header the server emitted (see response-headers.ts).
    const headers = filterResponseHeaders(result.response.headers);
    // A HEAD response carries NO body (Low #5) — the replica already strips it; relay no body.
    const isHead = message.method.toUpperCase() === 'HEAD';
    return {
      requestId: message.requestId,
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
      body: isHead ? undefined : await result.response.text(),
    };
  } catch (err) {
    return {
      requestId: message.requestId,
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}

/** A small Response carrying a gate-deny reason, for the replica's injected gate port. */
function denyResponse(error: string): Response {
  return new Response(error, { status: 403 });
}

/**
 * Round-2 HIGH #1 + Medium fix: the PASSTHROUGH SENTINEL the SW returns for an `autoDivert`
 * request the gate did NOT ALLOW. The SW performs ZERO network here — no token, no DPoP proof,
 * no replica, and crucially NO fetch at all. It returns only `{ requestId, passthrough: true }`
 * (no status, no headers, no fetched bytes). The page-side inject (MAIN world) completes the
 * request by calling its OWN native `fetch` (the captured PRISTINE_FETCH) with the request's
 * ORIGINAL input/init, in the page's origin context.
 *
 * WHY (the round-2 finding): doing the fallback fetch FROM THE SW — which holds `<all_urls>`
 * host permissions — turned the extension into an OPEN CROSS-ORIGIN READ PROXY: any page could
 * `postMessage` an `autoDivert` request and read back cross-origin bytes that CORS would
 * normally block. Returning a sentinel and letting the PAGE do the fetch restores EXACT native
 * semantics (CORS, credentials, headers) and means the SW never reads bytes a page could not
 * read itself. It also removes the header-stripping / `credentials:'omit'` divergence (Medium):
 * the page's native fetch applies the page's real headers + credentials policy, unchanged.
 */
function passthroughSentinel(message: FetchRequest): FetchResponse {
  return { requestId: message.requestId, passthrough: true };
}

/** Best-effort: fetch + parse the WebID profile (name/photo) and persist it. */
async function refreshProfile(webId: string): Promise<void> {
  try {
    const response = await fetch(webId, { headers: { Accept: 'text/turtle' } });
    if (!response.ok) return;
    const { name, photoUrl } = parseWebIdProfile(webId, await response.text());
    await saveProfile({ webId, name, photoUrl });
    await setSignedInIcon({ webId, name, photoUrl });
  } catch {
    // cosmetic — leave whatever profile/icon we have.
  }
}

/**
 * Broadcast an auth-state change. The WebID (PII) is sent to a tab ONLY when that tab's
 * origin holds a grant — a non-granted page is told the WebID is `null` (it learns nothing
 * about who is signed in), closing the design §4.3 PII-broadcast over-exposure. A logout
 * (`webId === null`) is sent to every tab so granted apps clear their state. The popup/side
 * panel (extension contexts) always get the real value via the runtime broadcast.
 */
async function broadcastStateChange(webId: string | null): Promise<void> {
  let granted: ReadonlySet<string> = new Set();
  if (webId !== null) {
    const ctx = await ensureSession();
    if (ctx) {
      const explicitGrants = await loadGrantedOrigins();
      granted = computeGrantedOrigins({
        explicitGrants,
        credentialOrigins: await sessionCredentialOrigins(ctx.session, ctx.keyPair),
      });
    }
  }

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const tabOrigin = tab.url ? originOf(tab.url) : null;
    // A signed-in WebID is only revealed to a granted tab; everyone else (and every tab on
    // logout) gets null. Fail-closed: an unparseable tab URL never receives the WebID.
    const tabWebId = webId !== null && tabOrigin !== null && granted.has(tabOrigin) ? webId : null;
    chrome.tabs
      .sendMessage(tab.id, { type: 'SOLID_STATE_CHANGED', webId: tabWebId })
      .catch(() => {});
  }
  // The popup/side panel are trusted extension contexts — give them the real value.
  chrome.runtime.sendMessage({ type: 'SOLID_STATE_CHANGED', webId }).catch(() => {});
}

async function handleLogin(
  message: LoginRequest,
  sender: MessageSender | undefined,
): Promise<ActionResult> {
  try {
    // A login driven FROM a web page is a deliberate owner opt-in. Resolve + REMEMBER the
    // verified requesting origin now (to bind the flow), but do NOT grant it yet — verify the
    // origin via the same dual-origin agreement (browser-attested ∧ page stamp) and never trust
    // the page-supplied field alone. A popup/side-panel login has no web sender → nothing to grant.
    //
    // SECURITY (privilege-escalation guard): the grant is persisted ONLY AFTER initiateLogin
    // succeeds (the success path below). Granting BEFORE login would let any page send
    // SOLID_LOGIN, have its origin persisted as granted even if the auth flow is cancelled or
    // fails, and then — if a session already existed — read the existing credentials via
    // SOLID_FETCH_REQUEST. A failed/cancelled login must leave the grant store UNCHANGED.
    const requestingOrigin = resolveRequestingOrigin(sender, message.origin);

    const clientIds = await loadClientIds();
    const candidate =
      message.clientId || (message.origin ? clientIds[message.origin] : undefined) || undefined;
    // A page-declared client-id is only honoured if it is a valid (https / loopback) URL;
    // an invalid one is ignored (fall back to the extension's own client / dynamic reg)
    // rather than passing a tamperable plaintext client-id into the auth flow.
    const clientId = candidate && isValidClientIdUrl(candidate) ? candidate : undefined;

    const { session, name, photoUrl } = await initiateLogin({
      webId: message.webId,
      clientId,
    });
    // Login succeeded (owner-approved): NOW grant the verified requesting origin so its
    // subsequent window.solid.fetch calls pass the per-origin gate.
    if (requestingOrigin !== null) await grantOrigin(requestingOrigin);
    cachedSession = session;
    cachedKeyPair = null;
    await saveProfile({ webId: session.webId, name, photoUrl });
    await setSignedInIcon({ webId: session.webId, name, photoUrl });
    // best-effort fresher profile from the post-auth WebID (handles webid != input).
    void refreshProfile(session.webId);
    await broadcastStateChange(session.webId);
    return { ok: true, webId: session.webId };
  } catch (err) {
    // A cancelled / failed login persists NO grant — the grant store is untouched above.
    return { error: err instanceof Error ? err.message : 'Login failed' };
  }
}

/**
 * Whether a message sender is one of the extension's OWN trusted contexts (popup, side
 * panel, options) rather than a web page. Chrome stamps these with the extension's own
 * origin/URL; a web content script is stamped with the page origin. The owner UI is fully
 * trusted; a web page is not. Fail-closed: an unknown/opaque sender is treated as NOT the
 * extension (a web page), so it gets the scoped (PII-free) view.
 */
function isExtensionContext(sender: MessageSender | undefined): boolean {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  if (sender?.origin && sender.origin === extensionOrigin) return true;
  if (sender?.url?.startsWith(`${extensionOrigin}/`)) return true;
  return false;
}

/**
 * Answer `SOLID_GET_STATE`. The extension's OWN contexts (popup/side panel) get the full
 * session view. A WEB PAGE gets identity (WebID + profile) ONLY if its verified+granted
 * origin holds a grant — otherwise the PII is withheld (design §4.3 "PII broadcast"): a page
 * the owner never opted in learns nothing about who is signed in.
 */
async function handleGetState(
  message: GetStateRequest,
  sender: MessageSender | undefined,
): Promise<SessionState> {
  const ctx = await ensureSession();
  const profile = await loadProfile();

  if (isExtensionContext(sender)) {
    const recentAccounts = await loadRecentAccounts();
    return {
      webId: ctx?.session.webId ?? null,
      isActive: ctx !== null,
      name: profile?.name ?? null,
      photoUrl: profile?.photoUrl ?? null,
      recentAccounts,
    };
  }

  // Web page: scope identity exposure to opt-in/granted origins only.
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  let mayExpose = false;
  if (requestingOrigin !== null && ctx) {
    const explicitGrants = await loadGrantedOrigins();
    const granted = computeGrantedOrigins({
      explicitGrants,
      credentialOrigins: await sessionCredentialOrigins(ctx.session, ctx.keyPair),
    });
    mayExpose = isRequestingOriginGranted(granted, requestingOrigin);
  }

  return {
    webId: mayExpose ? (ctx?.session.webId ?? null) : null,
    isActive: mayExpose && ctx !== null,
    name: mayExpose ? (profile?.name ?? null) : null,
    photoUrl: mayExpose ? (profile?.photoUrl ?? null) : null,
    // Never leak the cross-pod recent-accounts list to a web page.
    recentAccounts: [],
  };
}

/** The session's credential (pod/WebID/issuer) origins — the auto-granted requester set. */
async function sessionCredentialOrigins(
  session: StoredSession,
  keyPair: CryptoKeyPair,
): Promise<ReadonlySet<string>> {
  const fetchSession = await buildFetchSession(session, keyPair);
  return fetchSession.allowedOrigins;
}

async function handleSetClientId(
  message: SetClientIdRequest,
  sender: MessageSender | undefined,
): Promise<ActionResult> {
  try {
    // A Client Identifier Document is a dereferenceable URL. Require HTTPS so it cannot be
    // tampered with in transit; allow http: ONLY for a loopback host (dev CSS). A remote
    // plaintext client-id doc could be rewritten by a network attacker.
    if (!isValidClientIdUrl(message.clientId)) {
      throw new Error('Client identifier must be an https: URL (http: allowed for loopback only).');
    }
    // Cross-check the page-supplied origin against the browser-attested sender; store the
    // client-id (and grant the app) only under the VERIFIED origin, so a renderer cannot
    // map another origin's client-id or self-grant a foreign origin.
    const requestingOrigin = resolveRequestingOrigin(sender, message.origin);
    if (requestingOrigin === null) {
      throw new Error('Could not verify the requesting origin.');
    }
    await saveClientId(requestingOrigin, message.clientId);
    // Declaring a client-id is a deliberate owner opt-in from this app → grant it access.
    await grantOrigin(requestingOrigin);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid client identifier' };
  }
}

// --- Per-data-class access management (Phase 2, design §4) ----------------------------
//
// The consent flow is orchestrated here: `requestAccess` resolves each class to targets,
// opens the UNSPOOFABLE consent window (extension chrome), and awaits the user's decision;
// the window posts `SOLID_CONSENT_DECISION` back, which mints + persists the approved grants.
// The pending state lives in module-level maps (best-effort, MV3-appropriate): if the SW is
// killed while the window is open, the window reads `null` and denies (fail-closed) and the
// `requestAccess` promise times out — no grant is minted without a live approval.

/** Pending consent requests awaiting a decision (consentId → record). */
const pendingConsents = new Map<string, PendingConsent>();
/** Resolvers for the awaiting `requestAccess` calls (consentId → resolve(approvedClasses)). */
const consentResolvers = new Map<string, (approved: string[]) => void>();
const CONSENT_TIMEOUT_MS = 5 * 60_000;

/**
 * Per-origin `requestAccess` throttle state (residual c). Best-effort module state (re-derived —
 * i.e. reset — on an MV3 SW restart, which merely refreshes the window; acceptable for an
 * annoyance/DoS mitigation, never a security boundary). Keyed by the browser-attested requesting
 * origin so an origin cannot evade its own limit by lying about its identity.
 */
const requestAccessThrottle = new Map<string, ThrottleState>();

/** Distinguishable page-surfaced messages for a throttled `requestAccess` (residual c). */
const REQUEST_ACCESS_DENY_MESSAGE: Record<RequestAccessDenyReason, string> = {
  'user-gesture-required': 'requestAccess requires a user action (click) — it cannot be automated.',
  'rate-limited': 'Too many access requests from this app — please wait a moment and try again.',
};

/** A token-free public summary of a grant (design §4.2 return shape). */
function grantSummary(g: ClassGrant): GrantSummary {
  return {
    grantId: g.grantId,
    dataClass: g.dataClass,
    modes: g.modes,
    purpose: g.purpose,
    expiresAt: g.expiresAt,
    targets: g.targets.map((t) => ({ url: t.url, kind: t.kind })),
  };
}

function isHttpIri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The POD-ONLY origin set for class resolution — the WebID origin ∪ configured pod origins. It
 * confines both the type-index REF fetches and the resolved TARGETS: the full credential set
 * (`buildFetchSession().allowedOrigins`) ALSO includes the ISSUER origin, and a hostile WebID
 * profile pointing a type-index ref at the issuer would otherwise trigger an authenticated SW
 * fetch to an issuer *path* (token-to-issuer-path leak, roborev round-2 Medium).
 *
 * The exclusion is `includeIssuerOrigin: false` — the issuer is not added as a SEPARATE candidate.
 * It is DELIBERATELY *not* an unconditional `delete(issuerOrigin)` (roborev round-3): in the
 * ubiquitous CSS single-origin deployment the pod IS served from the issuer origin
 * (`webId origin === issuer origin`), and unconditionally removing that origin would drop EVERY
 * legitimate pod ref/target and break class resolution entirely there. So the issuer origin is
 * allowed ONLY when it coincides with a genuine pod origin (the WebID origin, or an origin the
 * user explicitly configured as a pod) — where sending the token to that origin is already normal
 * pod access (and the token *endpoint* itself stays protected by `isTokenEndpoint` in
 * authenticated-fetch). A issuer origin DISTINCT from every pod origin is excluded, which is the
 * profile-controlled attack this guards. (Verified by the CSS-single-origin + distinct-issuer tests.)
 */
async function podOriginsFor(session: StoredSession): Promise<ReadonlySet<string>> {
  const podOrigins = await loadPodOrigins();
  return computeAllowedOrigins({
    webId: session.webId,
    podOrigins,
    includeIssuerOrigin: false,
    allowInsecureLoopback: ALLOW_INSECURE_LOOPBACK,
  });
}

/** The class resolver's authed fetch — the SW's DPoP egress, surfaced as `{ ok, text }`. */
function makeResolveFetch(
  session: FetchSession,
): (url: string) => Promise<{ ok: boolean; text: string }> {
  return async (url: string) => {
    try {
      const { response } = await authenticatedFetch(session, {
        url,
        method: 'GET',
        headers: { Accept: 'text/turtle' },
        body: null,
        nonce: undefined,
      });
      return { ok: response.ok, text: response.ok ? await response.text() : '' };
    } catch {
      return { ok: false, text: '' };
    }
  };
}

/** Open the consent window and resolve with the approved class IRIs (or [] on deny/timeout). */
function openConsentAndAwait(consentId: string): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (approved: string[]): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(approved);
    };
    consentResolvers.set(consentId, finish);
    timer = setTimeout(() => finish([]), CONSENT_TIMEOUT_MS);
    const url = chrome.runtime.getURL(
      `consent/consent.html?consentId=${encodeURIComponent(consentId)}`,
    );
    try {
      chrome.windows.create({ url, type: 'popup', width: 460, height: 640 }, () => {
        if (chrome.runtime.lastError) finish([]);
      });
    } catch {
      finish([]);
    }
  });
}

async function handleRequestAccess(
  message: RequestAccessRequest,
  sender: MessageSender | undefined,
): Promise<AccessResponse> {
  const requestId = message.requestId;
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) {
    return { requestId, error: 'Could not verify the requesting origin.' };
  }

  // (residual c) Anti-spam gate — BEFORE any session work, class resolution (pod fetches), or the
  // consent window: require a genuine user gesture (browser-attested via the ISOLATED content
  // script's `navigator.userActivation`, page-unforgeable) AND rate-limit consecutive prompts per
  // origin. A blocked call does NO pod fetch and opens NO consent window.
  const throttleDecision = decideRequestAccess(
    requestAccessThrottle.get(requestingOrigin),
    Date.now(),
    message.userActivated === true,
  );
  requestAccessThrottle.set(requestingOrigin, throttleDecision.nextState);
  if (!throttleDecision.allow) {
    // `reason` is always present on a deny; fall back defensively.
    const reason = throttleDecision.reason ?? 'rate-limited';
    return { requestId, error: REQUEST_ACCESS_DENY_MESSAGE[reason] };
  }

  const ctx = await ensureSession();
  if (!ctx) return { requestId, error: 'Not authenticated' };

  const now = Date.now();
  const spec = normaliseAccessRequest(
    {
      classes: message.classes,
      modes: message.modes,
      purpose: message.purpose,
      duration: message.duration,
    },
    now,
  );
  if ('error' in spec) return { requestId, error: spec.error };

  // Resolve each requested class to its concrete, pinned targets (confined to POD origins —
  // excludes the issuer, so a hostile profile can't steer resolution at the issuer).
  const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair);
  const resolveFetch = makeResolveFetch(fetchSession);
  const podOrigins = await podOriginsFor(ctx.session);
  const resolved = new Map<string, { targets: readonly PinnedTarget[]; shape: string | null }>();
  for (const cls of spec.classes) {
    const targets = await resolveClassTargets(cls, {
      webId: ctx.session.webId,
      fetch: resolveFetch,
      allowedOrigins: podOrigins,
    });
    resolved.set(cls, { targets, shape: null });
  }

  const consentId = crypto.randomUUID();
  const pending = buildPendingConsent(
    consentId,
    requestingOrigin,
    ctx.session.webId,
    spec,
    resolved,
    now,
  );
  pendingConsents.set(consentId, pending);

  let approvedClasses: string[];
  try {
    approvedClasses = await openConsentAndAwait(consentId);
  } finally {
    pendingConsents.delete(consentId);
    consentResolvers.delete(consentId);
  }

  const grants = consentDecisionToGrants(pending, approvedClasses, () => crypto.randomUUID());
  for (const g of grants) await saveClassGrant(g);
  return { requestId, ok: grants.length > 0, grants: grants.map(grantSummary) };
}

/** The consent window (extension chrome only) asks for the pending record to render. */
function handleGetPendingConsent(
  message: GetPendingConsentRequest,
  sender: MessageSender | undefined,
): PendingConsentView | null {
  if (!isExtensionContext(sender)) return null; // only the extension's own window may read it.
  const pending = pendingConsents.get(message.consentId);
  if (!pending) return null;
  return {
    consentId: pending.consentId,
    origin: pending.origin,
    webId: pending.webId,
    classes: pending.classes.map((c) => ({
      dataClass: c.dataClass,
      modes: c.modes,
      purpose: c.purpose,
      expiresAt: c.expiresAt,
      targets: c.targets.map((t) => ({ url: t.url, kind: t.kind })),
      shape: c.shape,
    })),
  };
}

/** The consent window's decision. ONLY the extension's own window may decide (fail-closed). */
function handleConsentDecision(
  message: ConsentDecisionMessage,
  sender: MessageSender | undefined,
): void {
  if (!isExtensionContext(sender)) return;
  const resolver = consentResolvers.get(message.consentId);
  if (!resolver) return;
  consentResolvers.delete(message.consentId);
  const pending = pendingConsents.get(message.consentId);
  // Defence in depth: only classes actually shown in this pending request can be approved.
  const requested = new Set(pending?.classes.map((c) => c.dataClass) ?? []);
  const approved = message.approvedClasses.filter((c) => requested.has(c));
  resolver(approved);
}

async function handleListGrants(
  message: ListGrantsRequest,
  sender: MessageSender | undefined,
): Promise<AccessResponse> {
  const requestId = message.requestId;
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) return { requestId, grants: [] };
  const ctx = await ensureSession();
  if (!ctx) return { requestId, grants: [] };
  const now = Date.now();
  const live = await pruneAndPurgeExpiredGrants(now);
  const mine = grantsForSession(live, requestingOrigin, ctx.session.webId);
  return { requestId, grants: mine.map(grantSummary) };
}

async function handleRevokeGrant(
  message: RevokeGrantRequest,
  sender: MessageSender | undefined,
): Promise<AccessResponse> {
  const requestId = message.requestId;
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) {
    return { requestId, ok: false, error: 'Could not verify the requesting origin.' };
  }
  // A page may revoke only its OWN origin's grant (revokeClassGrant enforces the origin match).
  // The REMOVAL is the authoritative deny (fail-closed) and happens FIRST; the replica-slice purge
  // below is best-effort AFTER it — so a purge failure can never leave access live (residual b).
  const removed = await revokeClassGrant(message.grantId, requestingOrigin);
  if (removed.length > 0) {
    // Synchronously purge exactly the revoked class's replicated bytes + metadata (the resources it
    // resolved to), leaving every other class/origin intact — and RETAINING any resource still
    // covered by another live grant of the same origin (the surviving grants are the retain-pool).
    // Access is already revoked above, so a failure here only leaves now-grant-less bytes for the
    // logout purge — never live access.
    const now = Date.now();
    const survivors = pruneExpiredGrants(await loadClassGrants(), now);
    await purgeGrantSlices(removed, survivors);
  }
  return { requestId, ok: removed.length > 0 };
}

async function handleResolveClass(
  message: ResolveClassRequest,
  sender: MessageSender | undefined,
): Promise<AccessResponse> {
  const requestId = message.requestId;
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) {
    return { requestId, error: 'Could not verify the requesting origin.' };
  }
  if (!isHttpIri(message.classIRI)) {
    return { requestId, error: 'resolveClass: an https: class IRI is required.' };
  }
  const ctx = await ensureSession();
  if (!ctx) return { requestId, error: 'Not authenticated' };

  const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair);
  // Only a GRANTED origin (full OR class) may introspect — never leak the pod's type-index
  // layout to an arbitrary, un-opted-in page.
  const now = Date.now();
  const explicitGrants = await loadGrantedOrigins();
  const live = await pruneAndPurgeExpiredGrants(now);
  const classOrigins = [...liveGrantOrigins(live, now, ctx.session.webId)];
  const granted = computeGrantedOrigins({
    explicitGrants: [...explicitGrants, ...classOrigins],
    credentialOrigins: fetchSession.allowedOrigins,
  });
  if (!isRequestingOriginGranted(granted, requestingOrigin)) {
    return { requestId, error: 'Origin not granted access' };
  }
  // CLASS-SCOPED introspection: a FULL-grant origin (login/credential) may resolve any class, but
  // a CLASS-ONLY origin may resolve ONLY a class it actually holds a live grant for — otherwise a
  // narrow "finance" grant could enumerate the pod's "health" target URLs (private-structure leak,
  // roborev Medium). Fail-closed.
  const fullGrant = computeGrantedOrigins({
    explicitGrants,
    credentialOrigins: fetchSession.allowedOrigins,
  });
  if (!fullGrant.has(requestingOrigin)) {
    const mine = grantsForSession(live, requestingOrigin, ctx.session.webId);
    if (!mine.some((g) => g.dataClass === message.classIRI)) {
      return { requestId, error: 'No access grant for this data class' };
    }
  }

  const targets = await resolveClassTargets(message.classIRI, {
    webId: ctx.session.webId,
    fetch: makeResolveFetch(fetchSession),
    allowedOrigins: await podOriginsFor(ctx.session),
  });
  return { requestId, shape: null, targets: targets.map((t) => ({ url: t.url, kind: t.kind })) };
}

chrome.runtime.onMessage.addListener(
  (message: WorkerRequest, sender, sendResponse: (r: unknown) => void) => {
    switch (message.type) {
      case 'SOLID_FETCH_REQUEST':
        // Pass the browser-ATTESTED sender (origin/url set by Chrome, not the page) so the
        // per-requesting-origin gate can cross-check it against the page-supplied stamp.
        handleFetch(message, sender).then(sendResponse);
        return true;
      case 'SOLID_LOGIN':
        handleLogin(message, sender).then(sendResponse);
        return true;
      case 'SOLID_LOGOUT':
        teardownSession()
          .then(() => broadcastStateChange(null))
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      case 'SOLID_GET_STATE':
        handleGetState(message, sender).then(sendResponse);
        return true;
      case 'SOLID_SET_CLIENT_ID':
        handleSetClientId(message, sender).then(sendResponse);
        return true;
      case 'SOLID_REQUEST_ACCESS':
        handleRequestAccess(message, sender).then(sendResponse);
        return true;
      case 'SOLID_LIST_GRANTS':
        handleListGrants(message, sender).then(sendResponse);
        return true;
      case 'SOLID_REVOKE_GRANT':
        handleRevokeGrant(message, sender).then(sendResponse);
        return true;
      case 'SOLID_RESOLVE_CLASS':
        handleResolveClass(message, sender).then(sendResponse);
        return true;
      case 'SOLID_GET_PENDING_CONSENT':
        sendResponse(handleGetPendingConsent(message, sender));
        return false;
      case 'SOLID_CONSENT_DECISION':
        handleConsentDecision(message, sender);
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  },
);

/** First-run onboarding: prompt the user to PIN the toolbar action (extensions can't self-pin). */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ 'solid:show-pin-nudge': true }).catch(() => {});
  }
  // (Re-)register the MAIN-world global-fetch-patch injection on install/update — the most
  // reliable MAIN injection (design §5.1). Belt-and-braces with the manifest content script;
  // non-fatal if unavailable (the SW gate is the sole security boundary regardless).
  void registerGlobalFetchInjection();
});

// Wire the persistent side panel: a right-click "Open Solid side panel" action-menu entry
// + its open handler. The toolbar action keeps its existing popup unchanged.
registerSidePanel();

// Re-hydrate the session + icon on every SW wake.
ensureSession().then(async (ctx) => {
  if (ctx) {
    const profile = await loadProfile();
    await setSignedInIcon({
      webId: ctx.session.webId,
      name: profile?.name ?? null,
      photoUrl: profile?.photoUrl ?? null,
    });
    await broadcastStateChange(ctx.session.webId);
  } else {
    await setSignedOutIcon();
  }
});
