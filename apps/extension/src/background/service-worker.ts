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
 * The MV3 worker is killed aggressively; profile credentials live in IndexedDB and settings in chrome.storage,
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
  ProfileRequest,
  ProfilesResponse,
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
  sanitiseGrants,
} from './core/class-grant';
import { normaliseAccessRequest } from './core/class-request';
import { resolveClassTargets } from './core/class-resolve';
import { buildPendingConsent, consentDecisionToGrants, type PendingConsent } from './core/consent';
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
import { profileAuthority } from './profile-authority';
import {
  loadClientIds,
  loadRecentAccounts,
  rememberAccount,
  type StoredSession,
  saveClientId,
} from './session-store';
import { registerSidePanel } from './side-panel';

const ALLOW_INSECURE_LOOPBACK = true; // dev CSS over http://localhost; harmless for https issuers.
const EXPIRY_BUFFER_MS = 30_000;

/** The Cache API bucket holding the shared replica's bytes (one physical store, see replica.ts). */
const REPLICA_CACHE_NAME = 'solid-ext-replica-bytes';

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
async function pruneAndPurgeExpiredGrants(profileId: string, now: number): Promise<ClassGrant[]> {
  const store = await getProfiles();
  let live: ClassGrant[] = [];
  let expired: ClassGrant[] = [];
  await store.capabilities(profileId, (record) => {
    const all = sanitiseGrants(record.classGrants);
    live = pruneExpiredGrants(all, now);
    expired = all.filter((g) => !live.includes(g));
    record.classGrants = live;
  });
  await purgeGrantSlices(expired, live);
  return live;
}

const getProfiles = profileAuthority(async (webId) => {
  const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
  await purgeReplica(cache, db, webId);
});

/** Serialize only lifecycle changes and short replica commits, never network/body reads. */
const profileTasks = new Map<string, Promise<unknown>>();
function withProfileTask<T>(id: string, task: () => Promise<T>): Promise<T> {
  const run = (profileTasks.get(id) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => {});
  profileTasks.set(id, tail);
  void tail.then(() => {
    if (profileTasks.get(id) === tail) profileTasks.delete(id);
  });
  return run;
}

/** Concurrent requests retain their own cancellation scope; lifecycle changes cancel all of them. */
const profileOperations = new Map<string, Set<AbortController>>();

async function cancellable<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, task()]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function withProfileOperation<T>(
  id: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController();
  const operations = profileOperations.get(id) ?? new Set<AbortController>();
  operations.add(controller);
  profileOperations.set(id, operations);
  try {
    await profileTasks.get(id);
    return await cancellable(controller.signal, () => task(controller.signal));
  } catch (error) {
    if (controller.signal.aborted) return null;
    throw error;
  } finally {
    operations.delete(controller);
    if (operations.size === 0) profileOperations.delete(id);
  }
}

function cancelProfileOperations(id: string): void {
  for (const operation of profileOperations.get(id) ?? []) operation.abort();
}

function withProfileLifecycle<T>(id: string, task: () => Promise<T>): Promise<T> {
  return withProfileTask(id, async () => {
    cancelProfileOperations(id);
    return task();
  });
}

const refreshes = new Map<string, SingleFlight<StoredSession | null>>();
function refreshOnce(id: string): Promise<StoredSession | null> {
  let flight = refreshes.get(id);
  if (!flight) {
    flight = new SingleFlight<StoredSession | null>();
    refreshes.set(id, flight);
  }
  return flight.run(async () => {
    const store = await getProfiles();
    // A delayed reader can enter after the previous flight committed rotated tokens.
    // Only the credentials read INSIDE this flight may be redeemed or signed out.
    const ctx = await store.session(id);
    if (!ctx) return null;
    if (ctx.session.expiresAt >= Date.now() + EXPIRY_BUFFER_MS) return ctx.session;
    try {
      const updated = await refreshSession(ctx.session, ctx.keyPair);
      await store.updateSession(id, updated);
      return updated;
    } catch {
      return withProfileTask(id, async () => {
        // Read and compare under the same lifecycle lock as re-login. A stale failure
        // must neither sign out replacement credentials nor cancel their requests.
        const current = await store.session(id);
        if (
          current?.session.accessToken === ctx.session.accessToken &&
          current.session.refreshToken === ctx.session.refreshToken &&
          current.session.dpopJkt === ctx.session.dpopJkt
        ) {
          cancelProfileOperations(id);
          try {
            await store.signOut(id);
          } finally {
            // Revocation commits before replica cleanup, which may fail and need a retry.
            // A toolbar update may await this refresh; schedule its guarded repaint.
            void updateDefaultIconAndBroadcast().catch(() => {});
          }
        } else if (current && current.session.expiresAt >= Date.now() + EXPIRY_BUFFER_MS) {
          return current.session;
        }
        return null;
      });
    }
  });
}

type SessionContext = { profileId: string; session: StoredSession; keyPair: CryptoKeyPair };

/** Resolve the default once per request. Never re-select it after an await. */
async function ensureSession(profileId?: string): Promise<SessionContext | null> {
  const store = await getProfiles();
  const id = profileId ?? (await store.getDefault())?.profile.id;
  if (!id) return null;
  let ctx = await store.session(id);
  if (!ctx) return null;
  if (ctx.session.expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
    if (!(await refreshOnce(id))) return null;
    ctx = await store.session(id);
  }
  return ctx ? { ...ctx, profileId: id } : null;
}

async function teardownSession(): Promise<void> {
  const store = await getProfiles();
  const record = await store.getDefault();
  if (record) await withProfileLifecycle(record.profile.id, () => store.signOut(record.profile.id));
  else if ((await store.list()).profiles.length === 0) {
    const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
    await purgeReplica(cache, db, null);
  }
}

/** Build the per-request fetch session (the credential boundary) from the stored session. */
async function buildFetchSession(
  session: StoredSession,
  keyPair: CryptoKeyPair,
  profileId: string,
): Promise<FetchSession> {
  const { podOrigins } = await (await getProfiles()).get(profileId);
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
  profileId: string,
): Promise<{ grantScope: string } | { deny: Response }> {
  const now = Date.now();
  const { grantedOrigins: explicitGrants } = await (await getProfiles()).get(profileId);
  // Opportunistically prune expired grants on the fetch path (design item 3: expired → pruned) AND
  // purge each expired grant's replica slice (residual b — no bytes linger past expiry).
  const liveGrants = await pruneAndPurgeExpiredGrants(profileId, now);
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

  const selected = await (await getProfiles()).getDefault();
  if (selected) {
    let egressStarted = false;
    const result = await withProfileOperation(selected.profile.id, async (signal) => {
      const ctx = await ensureSession(selected.profile.id);
      signal.throwIfAborted();
      return handleProfileFetch(message, sender, requestingOrigin, ctx, signal, () => {
        egressStarted = true;
      });
    });
    if (result) return result;
    // Native fallback would replay a request the pod may already have processed.
    if (egressStarted) return { requestId: message.requestId, error: 'Fetch cancelled' };
  }
  return handleProfileFetch(message, sender, requestingOrigin, null);
}

async function handleProfileFetch(
  message: FetchRequest,
  sender: MessageSender | undefined,
  requestingOrigin: string,
  ctx: SessionContext | null,
  signal = new AbortController().signal,
  onEgress = () => {},
): Promise<FetchResponse> {
  if (!ctx) {
    // No session: the explicit path reports "Not authenticated"; an autoDivert request gets the
    // passthrough sentinel so the page does the plain native fetch it would have done itself (no
    // credential exists to attach anyway, and the SW performs no network).
    if (message.autoDivert) return passthroughSentinel(message);
    return { requestId: message.requestId, error: 'Not authenticated' };
  }

  try {
    const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair, ctx.profileId);

    // The INJECTED gate the replica runs as the FIRST step on EVERY read AND write — including
    // on a CACHE HIT (design §5.4 point 3). It re-runs the SAME audited `gateRequestingOrigin`
    // decision (idempotent) and returns the verified grant-scope on ALLOW; the replica never
    // touches the cache or the pod before this resolves to ALLOW, so a warm cache can never
    // bypass the per-origin gate.
    const gate = async (): Promise<{ grantScope: string } | { deny: Response }> => {
      signal.throwIfAborted();
      const decision = await gateAccess(
        message,
        requestingOrigin,
        sender,
        fetchSession.allowedOrigins,
        ctx.session.webId,
        ctx.profileId,
      );
      signal.throwIfAborted();
      return decision;
    };

    // Decide passthrough before opening replica stores, independently of other requests.
    const decision = await gate();
    if ('deny' in decision) {
      if (message.autoDivert) return passthroughSentinel(message);
      return {
        requestId: message.requestId,
        status: decision.deny.status,
        error: await decision.deny.text(),
      };
    }

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
          fetchImpl: (input, init) =>
            cancellable(signal, () => {
              onEgress();
              return fetch(input, { ...init, signal });
            }),
        });
        // Consume network bodies outside the lifecycle queue, including cache.put's body.
        const responseBody = result.response.body
          ? await cancellable(signal, () => result.response.arrayBuffer())
          : null;
        const response = new Response(responseBody, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: result.response.headers,
        });
        return { response, nonce: result.nonce };
      },
    };

    // Commit bytes and metadata together before a lifecycle purge can enter the queue.
    // Aborted work cannot persist anything after that purge.
    const persist = <T>(task: () => Promise<T>): Promise<T> =>
      withProfileTask(ctx.profileId, async () => {
        signal.throwIfAborted();
        return task();
      });
    const replica = new SharedReplica({
      gate,
      egress,
      cache,
      db,
      commit: persist,
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
    const serverNonce = result.nonce;
    if (origin && serverNonce) await persist(() => db.setNonce(origin, serverNonce));

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
      body: isHead ? undefined : await cancellable(signal, () => result.response.text()),
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

/** Best-effort display refresh; it never changes a user-assigned label or another profile. */
async function refreshProfile(profileId: string, webId: string): Promise<void> {
  try {
    const response = await fetch(webId, { headers: { Accept: 'text/turtle' } });
    if (!response.ok) return;
    const { photoUrl } = parseWebIdProfile(webId, await response.text());
    await (await getProfiles()).capabilities(profileId, (record) => {
      record.profile = { ...record.profile, avatar: photoUrl ?? undefined };
    });
  } catch {
    // Cosmetic.
  }
}

/**
 * Broadcast an auth-state change. The WebID (PII) is sent to a tab ONLY when that tab's
 * origin holds a grant — a non-granted page is told the WebID is `null` (it learns nothing
 * about who is signed in), closing the design §4.3 PII-broadcast over-exposure. A logout
 * (`webId === null`) is sent to every tab so granted apps clear their state. The popup/side
 * panel (extension contexts) always get the real value via the runtime broadcast.
 */
let stateChangeVersion = 0;

async function broadcastStateChange(ctx: SessionContext | null, version: number): Promise<void> {
  const webId = ctx?.session.webId ?? null;
  let granted: ReadonlySet<string> = new Set();
  if (ctx) {
    const { grantedOrigins: explicitGrants } = await (await getProfiles()).get(ctx.profileId);
    granted = computeGrantedOrigins({
      explicitGrants,
      credentialOrigins: await sessionCredentialOrigins(ctx.session, ctx.keyPair, ctx.profileId),
    });
  }

  const tabs = await chrome.tabs.query({});
  // Tab discovery and grant reads can overlap a default switch. Discard the whole stale
  // notification, including its trusted-context copy, before sending any captured identity.
  const current = await (await getProfiles()).getDefault();
  if (version !== stateChangeVersion) return;
  if (ctx) {
    if (
      current?.profile.id !== ctx.profileId ||
      current.profile.sessionState !== 'active' ||
      current.profile.webId !== webId
    )
      return;
  } else if (current?.profile.sessionState === 'active') return;
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

// The legacy PKCE params slot admits one interactive auth flow at a time.
let loginTail: Promise<unknown> = Promise.resolve();
function handleLogin(
  message: LoginRequest,
  sender: MessageSender | undefined,
  makeDefault = true,
): Promise<ActionResult> {
  const run = loginTail.then(async () => {
    try {
      const store = await getProfiles();
      const { profiles } = await store.list();
      if (profiles.length >= 8 && !profiles.some((p) => p.webId === message.webId)) {
        throw new Error('At most 8 profiles.');
      }
      const requestingOrigin = resolveRequestingOrigin(sender, message.origin);
      const clientIds = await loadClientIds();
      const candidate =
        message.clientId || (requestingOrigin ? clientIds[requestingOrigin] : undefined);
      const clientId = candidate && isValidClientIdUrl(candidate) ? candidate : undefined;
      const { session, keyPair, name, photoUrl } = await initiateLogin({
        webId: message.webId,
        clientId,
      });
      const existing = profiles.find((p) => p.webId === session.webId);
      const commit = async () => {
        const profile = await store.login(session, keyPair, {
          webId: session.webId,
          name,
          photoUrl,
        });
        if (requestingOrigin !== null)
          await store.capabilities(profile.id, (record) => {
            if (!record.grantedOrigins.includes(requestingOrigin))
              record.grantedOrigins.push(requestingOrigin);
          });
        if (makeDefault) await store.setDefault(profile.id);
        await rememberAccount({ webId: session.webId, name, photoUrl });
        void refreshProfile(profile.id, session.webId);
      };
      if (existing) await withProfileLifecycle(existing.id, commit);
      else await commit();
      await updateDefaultIconAndBroadcast();
      return { ok: true, webId: session.webId };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Login failed' };
    }
  });
  loginTail = run.catch(() => {});
  return run;
}

async function updateDefaultIconAndBroadcast(): Promise<void> {
  const version = ++stateChangeVersion;
  const isCurrent = () => version === stateChangeVersion;
  const ctx = await ensureSession();
  const record = ctx ? await (await getProfiles()).get(ctx.profileId) : null;
  const webId = ctx?.session.webId ?? null;
  if (!isCurrent()) return;
  if (webId && record)
    await setSignedInIcon(
      {
        webId,
        name: record.profile.label,
        photoUrl: record.profile.avatar ?? null,
      },
      isCurrent,
    );
  else await setSignedOutIcon(isCurrent);
  await broadcastStateChange(ctx, version);
}

async function handleProfiles(
  message: ProfileRequest,
  sender: MessageSender | undefined,
): Promise<ProfilesResponse> {
  if (!isExtensionContext(sender))
    return { error: 'Profile management requires extension context.' };
  try {
    const store = await getProfiles();
    switch (message.type) {
      case 'SOLID_PROFILE_ADD': {
        const result = await handleLogin(
          { type: 'SOLID_LOGIN', webId: message.webId },
          sender,
          false,
        );
        if (result.error) return { error: result.error };
        break;
      }
      case 'SOLID_PROFILE_RENAME':
        await store.rename(message.profileId, message.label);
        break;
      case 'SOLID_PROFILE_REMOVE':
        await withProfileLifecycle(message.profileId, () => store.remove(message.profileId));
        break;
      case 'SOLID_PROFILE_SET_DEFAULT':
        await store.setDefault(message.profileId);
        break;
      case 'SOLID_PROFILES_LIST':
        return { ok: true, ...(await store.list()) };
    }
    await updateDefaultIconAndBroadcast();
    return { ok: true, ...(await store.list()) };
  } catch (err) {
    // Removal persists revocation before purging bytes. Both account surfaces must re-read
    // that state even when cleanup fails; a repaint failure must not hide the original error.
    if (message.type === 'SOLID_PROFILE_REMOVE')
      await updateDefaultIconAndBroadcast().catch(() => {});
    return { error: err instanceof Error ? err.message : 'Profile operation failed' };
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
  if (sender?.origin)
    return (
      sender.origin === extensionOrigin &&
      (!sender.url || sender.url.startsWith(`${extensionOrigin}/`))
    );
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
  const profile = ctx ? (await (await getProfiles()).get(ctx.profileId)).profile : null;

  if (isExtensionContext(sender)) {
    const recentAccounts = await loadRecentAccounts();
    return {
      webId: ctx?.session.webId ?? null,
      isActive: ctx !== null,
      name: profile?.label ?? null,
      photoUrl: profile?.avatar ?? null,
      recentAccounts,
    };
  }

  // Web page: scope identity exposure to opt-in/granted origins only.
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  let mayExpose = false;
  if (requestingOrigin !== null && ctx) {
    const { grantedOrigins: explicitGrants } = await (await getProfiles()).get(ctx.profileId);
    const granted = computeGrantedOrigins({
      explicitGrants,
      credentialOrigins: await sessionCredentialOrigins(ctx.session, ctx.keyPair, ctx.profileId),
    });
    mayExpose = isRequestingOriginGranted(granted, requestingOrigin);
  }

  return {
    webId: mayExpose ? (ctx?.session.webId ?? null) : null,
    isActive: mayExpose && ctx !== null,
    name: mayExpose ? (profile?.label ?? null) : null,
    photoUrl: mayExpose ? (profile?.avatar ?? null) : null,
    // Never leak the cross-pod recent-accounts list to a web page.
    recentAccounts: [],
  };
}

/** The session's credential (pod/WebID/issuer) origins — the auto-granted requester set. */
async function sessionCredentialOrigins(
  session: StoredSession,
  keyPair: CryptoKeyPair,
  profileId: string,
): Promise<ReadonlySet<string>> {
  const fetchSession = await buildFetchSession(session, keyPair, profileId);
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
    const store = await getProfiles();
    const record = await store.getDefault();
    if (record?.profile.sessionState === 'active')
      await store.capabilities(record.profile.id, (r) => {
        if (!r.grantedOrigins.includes(requestingOrigin)) r.grantedOrigins.push(requestingOrigin);
      });
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
async function podOriginsFor(
  session: StoredSession,
  profileId: string,
): Promise<ReadonlySet<string>> {
  const { podOrigins } = await (await getProfiles()).get(profileId);
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
  const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair, ctx.profileId);
  const resolveFetch = makeResolveFetch(fetchSession);
  const podOrigins = await podOriginsFor(ctx.session, ctx.profileId);
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
  try {
    await (await getProfiles()).capabilities(ctx.profileId, (record) => {
      if (record.session?.dpopJkt !== ctx.session.dpopJkt)
        throw new Error('Profile session changed.');
      record.classGrants.push(...grants);
    });
  } catch {
    return { requestId, error: 'Profile session changed.' };
  }
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
  const live = await pruneAndPurgeExpiredGrants(ctx.profileId, now);
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
  const ctx = await ensureSession();
  if (!ctx) return { requestId, ok: false };
  const removed: ClassGrant[] = [];
  let survivors: ClassGrant[] = [];
  await (await getProfiles()).capabilities(ctx.profileId, (record) => {
    removed.push(
      ...record.classGrants.filter(
        (g) => g.grantId === message.grantId && g.origin === requestingOrigin,
      ),
    );
    record.classGrants = record.classGrants.filter((g) => !removed.includes(g));
    survivors = pruneExpiredGrants(record.classGrants, Date.now());
  });
  await purgeGrantSlices(removed, survivors);
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

  const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair, ctx.profileId);
  // Only a GRANTED origin (full OR class) may introspect — never leak the pod's type-index
  // layout to an arbitrary, un-opted-in page.
  const now = Date.now();
  const { grantedOrigins: explicitGrants } = await (await getProfiles()).get(ctx.profileId);
  const live = await pruneAndPurgeExpiredGrants(ctx.profileId, now);
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
    allowedOrigins: await podOriginsFor(ctx.session, ctx.profileId),
  });
  return { requestId, shape: null, targets: targets.map((t) => ({ url: t.url, kind: t.kind })) };
}

chrome.runtime.onMessage.addListener(
  (message: WorkerRequest, sender, sendResponse: (r: unknown) => void) => {
    const respond = (task: Promise<unknown>) => {
      task.then(sendResponse).catch(() =>
        sendResponse({
          ...('requestId' in message ? { requestId: message.requestId } : {}),
          error: 'Profile storage unavailable.',
        }),
      );
    };
    switch (message.type) {
      case 'SOLID_PROFILES_LIST':
      case 'SOLID_PROFILE_ADD':
      case 'SOLID_PROFILE_RENAME':
      case 'SOLID_PROFILE_REMOVE':
      case 'SOLID_PROFILE_SET_DEFAULT':
        respond(handleProfiles(message, sender));
        return true;
      case 'SOLID_FETCH_REQUEST':
        // Pass the browser-ATTESTED sender (origin/url set by Chrome, not the page) so the
        // per-requesting-origin gate can cross-check it against the page-supplied stamp.
        respond(handleFetch(message, sender));
        return true;
      case 'SOLID_LOGIN':
        respond(handleLogin(message, sender));
        return true;
      case 'SOLID_LOGOUT':
        teardownSession()
          .then(() => updateDefaultIconAndBroadcast())
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      case 'SOLID_GET_STATE':
        respond(handleGetState(message, sender));
        return true;
      case 'SOLID_SET_CLIENT_ID':
        respond(handleSetClientId(message, sender));
        return true;
      case 'SOLID_REQUEST_ACCESS':
        respond(handleRequestAccess(message, sender));
        return true;
      case 'SOLID_LIST_GRANTS':
        respond(handleListGrants(message, sender));
        return true;
      case 'SOLID_REVOKE_GRANT':
        respond(handleRevokeGrant(message, sender));
        return true;
      case 'SOLID_RESOLVE_CLASS':
        respond(handleResolveClass(message, sender));
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
void updateDefaultIconAndBroadcast().catch(() => {});
