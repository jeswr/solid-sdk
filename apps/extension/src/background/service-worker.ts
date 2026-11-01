// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
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
  OriginGrantRequest,
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
  modeSatisfies,
  type PinnedTarget,
  pruneExpiredGrants,
} from './core/class-grant';
import { normaliseAccessRequest } from './core/class-request';
import { type ResolveFetch, resolveClassTargets } from './core/class-resolve';
import { buildPendingConsent, consentDecisionToGrants, type PendingConsent } from './core/consent';
import { fetchWithRedirects } from './core/manual-redirect';
import {
  canonicalOrigin,
  liveOriginGrant,
  type OriginGrant,
  OriginGrantStore,
} from './core/origin-grant';
import { computeAllowedOrigins, isTokenEndpoint, isValidClientIdUrl } from './core/origin-policy';
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
import { type MessageSender, resolveRequestingOrigin } from './core/requesting-origin';
import { filterResponseHeaders } from './core/response-headers';
import { SingleFlight } from './core/single-flight';
import { parseWebIdProfile } from './core/webid';
import { FormFillWorker, registerFormFillMenu } from './formfill';
import { loadFormFillData } from './formfill-data-loader';
import { syncOriginFetchInjection } from './global-fetch-register';
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
const originGrants = new OriginGrantStore({
  read: async () => (await chrome.storage.local.get('solid:origin-grants'))['solid:origin-grants'],
  write: async (grants) => chrome.storage.local.set({ 'solid:origin-grants': grants }),
});

async function originGrantFor(origin: string): Promise<OriginGrant | null> {
  return liveOriginGrant(await originGrants.list(), origin, Date.now());
}

async function pruneAndPurgeExpiredGrants(profileId: string, now: number): Promise<ClassGrant[]> {
  const expired: ClassGrant[] = [];
  const live: ClassGrant[] = [];
  await originGrants.update((grants) =>
    grants.map((g) => {
      if (g.profileId !== profileId || g.scope.classes === undefined) return g;
      const keep = pruneExpiredGrants(g.scope.classes, now);
      expired.push(...g.scope.classes.filter((c) => !keep.includes(c)));
      live.push(...keep);
      return { ...g, scope: { ...g.scope, classes: keep } };
    }),
  );
  await purgeGrantSlices(expired, live);
  return live;
}

/** Expiry alarms are advisory; every request independently checks durable grant expiry. */
let originSyncTail: Promise<void> = Promise.resolve();
function syncOriginGrants(): Promise<void> {
  const run = originSyncTail.then(reconcileOriginGrants);
  originSyncTail = run.catch(() => {});
  return run;
}
async function reconcileOriginGrants(): Promise<void> {
  const store = await getProfiles();
  const { profiles } = await store.list();
  const active = new Set(profiles.filter((p) => p.sessionState === 'active').map((p) => p.id));
  await formFill.reconcile(profiles);
  const gone: OriginGrant[] = [];
  await originGrants.update((grants) =>
    grants.filter((g) => {
      const keep =
        active.has(g.profileId) && (g.expiresAt === undefined || g.expiresAt > Date.now());
      if (!keep) gone.push(g);
      return keep;
    }),
  );
  for (const g of gone) {
    cancelProfileOperations(g.profileId);
    const profile = profiles.find((p) => p.id === g.profileId);
    // Signed-out/removing profiles retain metadata until their mandatory lifecycle purge succeeds.
    if (profile?.sessionState === 'active') await purgeOriginSlice(g, profile.webId);
  }
  const grants = await originGrants.list();
  await syncOriginFetchInjection(grants.map((g) => g.origin));
  const expiries = grants.flatMap((g) => (g.expiresAt === undefined ? [] : [g.expiresAt]));
  if (chrome.alarms) {
    await chrome.alarms.clear('solid-origin-expiry');
    if (expiries.length)
      await chrome.alarms.create('solid-origin-expiry', { when: Math.min(...expiries) });
  }
}

async function purgeOriginSlice(grant: OriginGrant, webId: string): Promise<void> {
  try {
    const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
    await purgeReplicaSlice(cache, db, {
      webId,
      grantScope: grant.origin,
      targets: grant.scope.pods.map((pod) => ({ url: `${pod}/`, kind: 'container' as const })),
      retainTargets: [],
    });
  } catch {
    // Best effort, as with class-slice purges: removed authority is the serving boundary.
  }
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
const profileOperations = new Map<string, Map<AbortController, string | undefined>>();

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
  origin?: string,
): Promise<T | null> {
  const controller = new AbortController();
  const operations = profileOperations.get(id) ?? new Map<AbortController, string | undefined>();
  operations.set(controller, origin);
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

function cancelProfileOperations(id: string, origin?: string): void {
  for (const [operation, requestingOrigin] of profileOperations.get(id) ?? []) {
    if (origin === undefined || origin === requestingOrigin) operation.abort();
  }
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
            try {
              await formFill.revokeProfile(id);
              await store.signOut(id);
            } finally {
              await syncOriginGrants();
            }
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

/** Recheck captured credentials after asynchronous work, including key replacement on re-login. */
async function checkProfileSession(ctx: SessionContext, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const current = await (await getProfiles()).session(ctx.profileId);
  signal.throwIfAborted();
  if (
    current?.session.dpopJkt !== ctx.session.dpopJkt ||
    current?.session.webId !== ctx.session.webId
  )
    throw new Error('Profile session changed.');
}

/** Read the live parent last, so expiry during a session lookup cannot disclose its contents. */
async function checkOriginAuthority(
  parent: OriginGrant,
  ctx: SessionContext,
  signal: AbortSignal,
): Promise<OriginGrant> {
  await checkProfileSession(ctx, signal);
  const current = await originGrantFor(parent.origin);
  signal.throwIfAborted();
  if (current?.profileId !== ctx.profileId || current?.createdAt !== parent.createdAt)
    throw new Error('Origin grant changed.');
  return current;
}

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

/** Statuses whose Response must have a null body (Fetch standard). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

async function teardownSession(sender?: MessageSender, stamp?: string): Promise<void> {
  const store = await getProfiles();
  const origin = resolveRequestingOrigin(sender, stamp);
  const grant = origin ? await originGrantFor(origin) : null;
  if (!isExtensionContext(sender) && !grant) throw new Error('Origin not granted access');
  const record = isExtensionContext(sender)
    ? await store.getDefault()
    : grant
      ? await store.get(grant.profileId)
      : null;
  await revokeThenPublish(async () => {
    if (record)
      await withProfileLifecycle(record.profile.id, async () => {
        try {
          await formFill.revokeProfile(record.profile.id);
          await store.signOut(record.profile.id);
        } finally {
          await syncOriginGrants();
        }
      });
    else if ((await store.list()).profiles.length === 0) {
      const [cache, db] = await Promise.all([getReplicaCache(), getReplicaDb()]);
      await purgeReplica(cache, db, null);
    }
  });
}

/**
 * Revocation is persisted before cleanup, so the revoked state is published even when a purge
 * fails and needs a wake-time retry. A cleanup error wins over a publication error. When cleanup
 * succeeded, a failed publication is retried once and still reported, so the caller never sees
 * success while open pages may hold a revoked identity.
 */
async function revokeThenPublish(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (err) {
    await updateDefaultIconAndBroadcast().catch(() => {});
    throw err;
  }
  try {
    await updateDefaultIconAndBroadcast();
  } catch (err) {
    await updateDefaultIconAndBroadcast().catch(() => {});
    throw err;
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

/** Re-read the explicit parent, then enforce its pod scope and nested pinned classes. */
async function gateAccess(
  message: FetchRequest,
  requestingOrigin: string,
  sender: MessageSender | undefined,
  allowedTargetOrigins: ReadonlySet<string>,
  webId: string,
  profileId: string,
): Promise<{ grantScope: string } | { deny: Response }> {
  const grant = await originGrantFor(requestingOrigin);
  if (resolveRequestingOrigin(sender, message.stampedOrigin) !== requestingOrigin)
    return { deny: denyResponse(DENY_MESSAGE['forbidden-origin']) };
  if (!grant || grant.profileId !== profileId)
    return { deny: denyResponse(DENY_MESSAGE['origin-not-granted']) };
  const target = originOf(message.url);
  if (!target || (!allowedTargetOrigins.has(target) && target !== requestingOrigin))
    return { deny: denyResponse(DENY_MESSAGE['cross-origin-foreign']) };
  if (allowedTargetOrigins.has(target)) {
    if (!grant.scope.pods.includes(target)) return { deny: denyResponse('Out of grant scope') };
    if (grant.scope.classes !== undefined) await pruneAndPurgeExpiredGrants(profileId, Date.now());
  }

  // Pruning, purging and even the storage read can span a deadline or scope change.
  // Decide from the live parent and its children at ONE fresh instant, with no more awaits.
  const parents = await originGrants.list();
  const now = Date.now();
  const current = liveOriginGrant(parents, requestingOrigin, now);
  if (!current || current.profileId !== profileId)
    return { deny: denyResponse(DENY_MESSAGE['origin-not-granted']) };
  if (allowedTargetOrigins.has(target)) {
    if (!current.scope.pods.includes(target)) return { deny: denyResponse('Out of grant scope') };
    if (current.scope.classes !== undefined) {
      const reason = decideClassAccess(
        grantsForSession(current.scope.classes, requestingOrigin, webId),
        message.url,
        message.method,
        now,
      );
      if (reason) return { deny: denyResponse(CLASS_DENY_MESSAGE[reason]) };
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

  const grant = await originGrantFor(requestingOrigin);
  if (!grant) {
    void syncOriginGrants().catch(() => {});
    return message.autoDivert
      ? passthroughSentinel(message)
      : { requestId: message.requestId, status: 403, error: DENY_MESSAGE['origin-not-granted'] };
  }
  const selected = await (await getProfiles()).get(grant.profileId);
  if (selected) {
    let egressStarted = false;
    const result = await withProfileOperation(
      selected.profile.id,
      async (signal) => {
        const ctx = await ensureSession(selected.profile.id);
        signal.throwIfAborted();
        return handleProfileFetch(message, sender, requestingOrigin, ctx, signal, () => {
          egressStarted = true;
        });
      },
      requestingOrigin,
    );
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
    const gate = async (
      url = message.url,
      method = message.method,
    ): Promise<{ grantScope: string } | { deny: Response }> => {
      signal.throwIfAborted();
      if (!isValidClientIdUrl(url) || isTokenEndpoint(url, fetchSession.tokenEndpoint))
        return { deny: denyResponse(DENY_MESSAGE['cross-origin-foreign']) };
      const decision = await gateAccess(
        { ...message, url, method },
        requestingOrigin,
        sender,
        fetchSession.allowedOrigins,
        ctx.session.webId,
        ctx.profileId,
      );
      signal.throwIfAborted();
      return decision;
    };
    // Re-check every URL/method that supplied this operation's bytes before committing or
    // relaying them. A redirect target's scope can be revoked while its body is in flight.
    const sent = new Map<string, { url: string; method: string }>();
    const gateAll = async () => {
      let decision = await gate();
      if ('deny' in decision) return decision;
      for (const hop of sent.values()) {
        decision = await gate(hop.url, hop.method);
        if ('deny' in decision) return decision;
      }
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
    // port. Each hop and nonce retry re-runs the full live URL/method gate after signing.
    // The replica adds conditional headers; it never re-implements the credential path.
    const egress: EgressPort = {
      fetch: async (url, method, headers, body, n) => {
        const decision = await gate(url, method);
        if ('deny' in decision) throw new Error(await decision.deny.text());
        const result = await authenticatedFetch(fetchSession, {
          url,
          method,
          headers,
          body,
          nonce: n,
          signal,
          authorize: async (hopUrl, hopMethod) => {
            const latest = await gate(hopUrl, hopMethod);
            if ('deny' in latest) throw new Error(await latest.deny.text());
          },
          fetchImpl: (input, init) =>
            cancellable(signal, async () => {
              const hopUrl = input.toString();
              // A probe discovers a GET/HEAD target, so check the original method's
              // grant. Its HEAD method does not grant it any additional authority.
              const probing = init!.redirect === 'follow';
              const hopMethod = probing ? method : init!.method!;
              const latest = await gate(hopUrl, hopMethod);
              if ('deny' in latest) throw new Error(await latest.deny.text());
              if (!probing) sent.set(`${hopMethod} ${hopUrl}`, { url: hopUrl, method: hopMethod });
              onEgress();
              return fetch(input, { ...init, signal });
            }),
        });
        // Consume network bodies outside the lifecycle queue, including cache.put's body.
        // Chrome exposes an empty body stream on a 304 revalidation, but the Response
        // constructor rejects any body for null-body statuses.
        const responseBody =
          result.response.body && !NULL_BODY_STATUSES.has(result.response.status)
            ? await cancellable(signal, () => result.response.arrayBuffer())
            : null;
        const response = new Response(responseBody, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: result.response.headers,
        });
        return { response, nonce: result.nonce, url: result.url };
      },
    };

    // Commit bytes and metadata together before a lifecycle purge can enter the queue.
    // Aborted work cannot persist anything after that purge.
    const persist = <T>(task: () => Promise<T>): Promise<T> =>
      withProfileTask(ctx.profileId, async () => {
        signal.throwIfAborted();
        const decision = await gateAll();
        if ('deny' in decision) throw new Error(await decision.deny.text());
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
    const nonceOrigin = originOf(result.url ?? message.url);
    if (nonceOrigin && serverNonce) await persist(() => db.setNonce(nonceOrigin, serverNonce));

    // Defense-in-depth: relay only the allowlisted, app-relevant response headers back to
    // the page rather than every header the server emitted (see response-headers.ts).
    const finalDecision = await gateAll();
    if ('deny' in finalDecision)
      return { requestId: message.requestId, status: 403, error: await finalDecision.deny.text() };
    const headers = filterResponseHeaders(result.response.headers);
    // A HEAD response carries NO body (Low #5) — the replica already strips it; relay no body.
    const isHead = message.method.toUpperCase() === 'HEAD';
    // Response.url identifies the fetched document and excludes any fragment.
    const finalUrl = new URL(result.url ?? message.url);
    finalUrl.hash = '';
    return {
      requestId: message.requestId,
      status: result.response.status,
      statusText: result.response.statusText,
      url: finalUrl.href,
      // Manual resource sends do not set Response.redirected. Distinct sent URLs record
      // actual redirect hops, including a return to the original URL; nonce retries dedupe.
      redirected: sent.size > 1,
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
    const tabId = tab.id;
    const tabOrigin = tab.url ? originOf(tab.url) : null;
    // A signed-in WebID is only revealed to a granted tab; everyone else (and every tab on
    // logout) gets null. Fail-closed: an unparseable tab URL never receives the WebID.
    const grant = tabOrigin ? await originGrantFor(tabOrigin) : null;
    const deliver = async (signal: AbortSignal) => {
      const bound = grant ? await (await getProfiles()).session(grant.profileId) : null;
      signal.throwIfAborted();
      // The bridge checks origin as well, closing navigation after this URL lookup.
      const currentTab = await chrome.tabs.get(tabId).catch(() => null);
      signal.throwIfAborted();
      if (!tabOrigin || !currentTab?.url || originOf(currentTab.url) !== tabOrigin) return;
      let tabWebId: string | null = null;
      if (grant && bound) {
        try {
          await checkOriginAuthority(grant, { ...bound, profileId: grant.profileId }, signal);
          tabWebId = bound.session.webId;
        } catch {
          signal.throwIfAborted();
        }
      }
      if (version !== stateChangeVersion) return;
      chrome.tabs
        .sendMessage(
          tabId,
          { type: 'SOLID_STATE_CHANGED', origin: tabOrigin, webId: tabWebId },
          { frameId: 0 },
        )
        .catch(() => {});
    };
    if (grant) await withProfileOperation(grant.profileId, deliver, tabOrigin ?? undefined);
    else await deliver(new AbortController().signal);
    if (version !== stateChangeVersion) return;
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
  await syncOriginGrants();
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
        // Keeps the removing marker/error if cleanup failed, but clears the displayed identity.
        await revokeThenPublish(() =>
          withProfileLifecycle(message.profileId, async () => {
            try {
              await formFill.revokeProfile(message.profileId);
              await store.remove(message.profileId);
            } finally {
              await syncOriginGrants();
            }
          }),
        );
        return { ok: true, ...(await store.list()) };
      case 'SOLID_PROFILE_SET_DEFAULT':
        await store.setDefault(message.profileId);
        break;
      case 'SOLID_PROFILES_LIST':
        return { ok: true, ...(await store.list()) };
    }
    await updateDefaultIconAndBroadcast();
    return { ok: true, ...(await store.list()) };
  } catch (err) {
    // A failed SOLID_PROFILE_REMOVE has already published through revokeThenPublish.
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
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  const grant = requestingOrigin ? await originGrantFor(requestingOrigin) : null;
  const ctx = isExtensionContext(sender)
    ? await ensureSession()
    : grant
      ? await ensureSession(grant.profileId)
      : null;
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

  const latest = requestingOrigin ? await originGrantFor(requestingOrigin) : null;
  const mayExpose = !!ctx && latest?.profileId === ctx.profileId;

  return {
    webId: mayExpose ? (ctx?.session.webId ?? null) : null,
    isActive: mayExpose && ctx !== null,
    name: mayExpose ? (profile?.label ?? null) : null,
    photoUrl: mayExpose ? (profile?.avatar ?? null) : null,
    // Never leak the cross-pod recent-accounts list to a web page.
    recentAccounts: [],
  };
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
    // client-id only under the VERIFIED origin, so a renderer cannot
    // map another origin's client-id or self-grant a foreign origin.
    const requestingOrigin = resolveRequestingOrigin(sender, message.origin);
    if (requestingOrigin === null) {
      throw new Error('Could not verify the requesting origin.');
    }
    await saveClientId(requestingOrigin, message.clientId);
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
type ProfileConsent = { pending: PendingConsent; ctx: SessionContext; label: string };
const pendingConsents = new Map<string, Map<string, ProfileConsent>>();
/** Resolvers for the awaiting `requestAccess` calls (consentId → resolve(approvedClasses)). */
type ConsentChoice = { approved: string[]; profileId?: string };
const consentResolvers = new Map<string, (choice: ConsentChoice) => void>();
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
 * confines authenticated private-index fetches and the resolved TARGETS: the full credential set
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

/** Public discovery never carries credentials; private indexes use scoped DPoP reads. */
function makeResolveFetch(
  session: FetchSession,
  webId: string,
  signal = new AbortController().signal,
  beforeRequest: (url: string, authenticated: boolean) => Promise<void> = async () => {},
): ResolveFetch {
  return async (url, useCredentials) => {
    try {
      const authenticated = useCredentials && url !== webId;
      const fetchImpl: typeof fetch = (input, init) =>
        cancellable(signal, async () => {
          await beforeRequest(input.toString(), authenticated);
          signal.throwIfAborted();
          if (isTokenEndpoint(input.toString(), session.tokenEndpoint))
            throw new Error('Token endpoint fetch denied');
          return fetch(input, { ...init, credentials: 'omit', signal });
        });
      const result = authenticated
        ? await authenticatedFetch(session, {
            url,
            method: 'GET',
            headers: { Accept: 'text/turtle' },
            body: null,
            nonce: undefined,
            fetchImpl,
            signal,
          })
        : await fetchWithRedirects(
            { url, method: 'GET', headers: { Accept: 'text/turtle' } },
            async ({ url, ...init }) => ({
              response: await fetchImpl(url, { ...init, redirect: 'manual' }),
            }),
            fetchImpl,
            signal,
          );
      const { response } = result;
      await beforeRequest(result.url, authenticated);
      const text = response.ok ? await cancellable(signal, () => response.text()) : '';
      await beforeRequest(result.url, authenticated);
      signal.throwIfAborted();
      return { ok: response.ok, text, url: result.url };
    } catch {
      return { ok: false, text: '', url };
    }
  };
}

/** Open the consent window and resolve with the approved class IRIs (or [] on deny/timeout). */
function openConsentAndAwait(consentId: string): Promise<ConsentChoice> {
  return new Promise<ConsentChoice>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (choice: ConsentChoice): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(choice);
    };
    consentResolvers.set(consentId, finish);
    timer = setTimeout(() => finish({ approved: [] }), CONSENT_TIMEOUT_MS);
    const url = chrome.runtime.getURL(
      `consent/consent.html?consentId=${encodeURIComponent(consentId)}`,
    );
    try {
      chrome.windows.create({ url, type: 'popup', width: 460, height: 640 }, () => {
        if (chrome.runtime.lastError) finish({ approved: [] });
      });
    } catch {
      finish({ approved: [] });
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

  const now = Date.now();
  const spec = normaliseAccessRequest(message, now);
  if ('error' in spec) return { requestId, error: spec.error };
  const store = await getProfiles();
  const { profiles, defaultProfileId } = await store.list();
  const parent = await originGrantFor(requestingOrigin);
  const consentId = crypto.randomUUID();
  const choices = new Map<string, ProfileConsent>();
  // Each profile's targets are independently resolved and shown before approval.
  const ordered = [...profiles].sort(
    (a, b) => Number(b.id === defaultProfileId) - Number(a.id === defaultProfileId),
  );
  for (const profile of ordered) {
    try {
      const choice = await withProfileOperation(
        profile.id,
        async (signal) => {
          const ctx = await ensureSession(profile.id);
          signal.throwIfAborted();
          if (!ctx) return null;
          const checkAuthority = async () => {
            await checkProfileSession(ctx, signal);
            const latest = await originGrantFor(requestingOrigin);
            signal.throwIfAborted();
            // Initial consent needs no parent. An existing binding must remain live and unchanged.
            if (latest?.profileId !== parent?.profileId || latest?.createdAt !== parent?.createdAt)
              throw new Error('Origin grant changed.');
          };
          const session = await buildFetchSession(ctx.session, ctx.keyPair, ctx.profileId);
          const allowedOrigins = await podOriginsFor(ctx.session, ctx.profileId);
          const resolved = new Map<string, { targets: readonly PinnedTarget[]; shape: null }>();
          for (const cls of spec.classes) {
            const targets = await resolveClassTargets(cls, {
              webId: ctx.session.webId,
              fetch: makeResolveFetch(
                { ...session, allowedOrigins },
                ctx.session.webId,
                signal,
                checkAuthority,
              ),
              authenticatedOrigins: allowedOrigins,
              allowedOrigins,
            });
            await checkAuthority();
            resolved.set(cls, { targets, shape: null });
          }
          return {
            ctx,
            label: profile.label,
            pending: buildPendingConsent(
              consentId,
              requestingOrigin,
              ctx.session.webId,
              spec,
              resolved,
              now,
            ),
          };
        },
        requestingOrigin,
      );
      if (choice) choices.set(profile.id, choice);
    } catch {
      // A signed-out, replaced or revoked session cannot contribute a consent choice.
    }
  }
  if (!choices.size) return { requestId, error: 'Not authenticated' };
  pendingConsents.set(consentId, choices);
  let decision: ConsentChoice;
  try {
    decision = await openConsentAndAwait(consentId);
  } finally {
    pendingConsents.delete(consentId);
    consentResolvers.delete(consentId);
  }
  const selected = decision.profileId ? choices.get(decision.profileId) : undefined;
  if (!selected || decision.approved.length === 0) return { requestId, ok: false, grants: [] };
  const { ctx, pending } = selected;
  const grants = consentDecisionToGrants(pending, decision.approved, () => crypto.randomUUID());
  if (!grants.length || spec.expiresAt <= Date.now()) return { requestId, ok: false, grants: [] };
  try {
    await withProfileLifecycle(ctx.profileId, async () => {
      const current = await store.session(ctx.profileId);
      if (current?.session.dpopJkt !== ctx.session.dpopJkt)
        throw new Error('Profile session changed.');
      const previous = await originGrantFor(requestingOrigin);
      if (previous) cancelProfileOperations(previous.profileId);
      await originGrants.update((all) => {
        const current = liveOriginGrant(all, requestingOrigin, Date.now());
        const nested =
          current?.profileId === ctx.profileId
            ? [
                ...(current.scope.classes ?? []).map((child) => ({
                  ...child,
                  // Fresh consent cannot extend an unrelated child's effective deadline.
                  expiresAt: Math.min(child.expiresAt, current.expiresAt ?? Infinity),
                })),
                ...grants,
              ]
            : grants;
        return [
          ...all.filter((g) => g.origin !== requestingOrigin),
          {
            origin: requestingOrigin,
            profileId: ctx.profileId,
            createdAt: now,
            expiresAt: spec.expiresAt,
            scope: {
              pods: [
                ...new Set(nested.flatMap((g) => g.targets.map((t) => new URL(t.url).origin))),
              ],
              classes: nested,
            },
          },
        ];
      });
      if (previous) {
        const old = await store.get(previous.profileId).catch(() => null);
        if (old) await purgeOriginSlice(previous, old.profile.webId);
      }
    });
    await updateDefaultIconAndBroadcast();
  } catch {
    return { requestId, error: 'Profile session changed.' };
  }
  const latest = await originGrantFor(requestingOrigin);
  if (latest?.profileId !== ctx.profileId) return { requestId, ok: false, grants: [] };
  return { requestId, ok: true, webId: ctx.session.webId, grants: grants.map(grantSummary) };
}

/** The consent window (extension chrome only) asks for the pending record to render. */
function handleGetPendingConsent(
  message: GetPendingConsentRequest,
  sender: MessageSender | undefined,
): PendingConsentView | null {
  if (!isExtensionContext(sender)) return null; // only the extension's own window may read it.
  const choices = pendingConsents.get(message.consentId);
  const profileId = message.profileId ?? choices?.keys().next().value;
  const selected = profileId ? choices?.get(profileId) : undefined;
  if (!selected) return null;
  const pending = selected.pending;

  return {
    consentId: pending.consentId,
    origin: pending.origin,
    webId: pending.webId,
    profileId: selected.ctx.profileId,
    profiles: [...(choices ?? [])].map(([id, value]) => ({
      id,
      label: value.label,
      webId: value.ctx.session.webId,
    })),
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
  const choices = pendingConsents.get(message.consentId);
  const selected = message.profileId ? choices?.get(message.profileId) : undefined;
  const requested = new Set(selected?.pending.classes.map((c) => c.dataClass) ?? []);
  const approved = Array.isArray(message.approvedClasses)
    ? message.approvedClasses.filter((c) => requested.has(c))
    : [];
  resolver({ approved, profileId: selected?.ctx.profileId });
}

async function handleListGrants(
  message: ListGrantsRequest,
  sender: MessageSender | undefined,
): Promise<AccessResponse> {
  const requestId = message.requestId;
  const requestingOrigin = resolveRequestingOrigin(sender, message.stampedOrigin);
  if (requestingOrigin === null) return { requestId, grants: [] };
  const parent = await originGrantFor(requestingOrigin);
  if (!parent) return { requestId, grants: [] };
  try {
    const result = await withProfileOperation(
      parent.profileId,
      async (signal) => {
        const ctx = await ensureSession(parent.profileId);
        signal.throwIfAborted();
        if (!ctx) return null;
        await pruneAndPurgeExpiredGrants(ctx.profileId, Date.now());
        const latest = await checkOriginAuthority(parent, ctx, signal);
        const mine = grantsForSession(
          pruneExpiredGrants(latest.scope.classes ?? [], Date.now()),
          requestingOrigin,
          ctx.session.webId,
        );
        return { requestId, grants: mine.map(grantSummary) };
      },
      requestingOrigin,
    );
    return result ?? { requestId, grants: [] };
  } catch {
    return { requestId, grants: [] };
  }
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
  const parent = await originGrantFor(requestingOrigin);
  const ctx = parent ? await ensureSession(parent.profileId) : null;
  if (!ctx) return { requestId, ok: false };
  const removed: ClassGrant[] = [];
  let survivors: ClassGrant[] = [];
  await originGrants.update((all) =>
    all.map((g) => {
      if (g.origin !== requestingOrigin || g.profileId !== ctx.profileId || !g.scope.classes)
        return g;
      removed.push(...g.scope.classes.filter((c) => c.grantId === message.grantId));
      survivors = pruneExpiredGrants(
        g.scope.classes.filter((c) => c.grantId !== message.grantId),
        Date.now(),
      );
      return { ...g, scope: { ...g.scope, classes: survivors } };
    }),
  );
  if (removed.length > 0) cancelProfileOperations(ctx.profileId, requestingOrigin);
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
  const parent = await originGrantFor(requestingOrigin);
  if (!parent) return { requestId, error: 'Not authenticated' };

  try {
    const result = await withProfileOperation(
      parent.profileId,
      async (signal) => {
        const ctx = await ensureSession(parent.profileId);
        signal.throwIfAborted();
        if (!ctx) return { requestId, error: 'Not authenticated' };
        const checkGrant = async () => {
          const current = await checkOriginAuthority(parent, ctx, signal);
          if (
            current.scope.classes !== undefined &&
            !grantsForSession(
              pruneExpiredGrants(current.scope.classes, Date.now()),
              requestingOrigin,
              ctx.session.webId,
            ).some((g) => g.dataClass === message.classIRI)
          )
            throw new Error('No access grant for this data class');
          return current;
        };
        const current = await checkGrant();
        const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair, ctx.profileId);
        const profilePods = await podOriginsFor(ctx.session, ctx.profileId);
        const allowedOrigins = new Set(
          [...profilePods].filter((pod) => current.scope.pods.includes(pod)),
        );
        const targets = await resolveClassTargets(message.classIRI, {
          webId: ctx.session.webId,
          fetch: makeResolveFetch(
            { ...fetchSession, allowedOrigins },
            ctx.session.webId,
            signal,
            async (url, authenticated) => {
              const latest = await checkGrant();
              if (!authenticated) return;
              const targetOrigin = originOf(url);
              if (
                !targetOrigin ||
                !allowedOrigins.has(targetOrigin) ||
                !latest.scope.pods.includes(targetOrigin)
              )
                throw new Error('Out of grant scope');
            },
          ),
          authenticatedOrigins: allowedOrigins,
          allowedOrigins,
        });
        const latest = await checkGrant();
        return {
          requestId,
          shape: null,
          targets: targets
            .filter((t) => latest.scope.pods.includes(new URL(t.url).origin))
            .map((t) => ({ url: t.url, kind: t.kind })),
        };
      },
      requestingOrigin,
    );
    return result ?? { requestId, error: 'Discovery cancelled' };
  } catch (error) {
    return { requestId, error: error instanceof Error ? error.message : 'Discovery failed' };
  }
}

async function handleOriginGrants(message: OriginGrantRequest, sender: MessageSender | undefined) {
  if (!isExtensionContext(sender))
    return { error: 'Origin grant management requires extension context.' };
  await syncOriginGrants();
  if (message.type !== 'SOLID_ORIGIN_GRANTS_LIST') {
    if (!canonicalOrigin(message.origin)) return { error: 'Invalid origin.' };
    const grant = await originGrantFor(message.origin);
    if (!grant) return { ok: false };
    if (
      message.type === 'SOLID_ORIGIN_GRANT_EXPIRY' &&
      (!Number.isFinite(message.expiresAt) ||
        message.expiresAt <= Date.now() ||
        (grant.expiresAt !== undefined && message.expiresAt > grant.expiresAt))
    )
      return { error: 'Expiry may only be shortened; request fresh consent to extend it.' };
    if (message.type === 'SOLID_ORIGIN_GRANT_PROFILE') {
      const target = await (await getProfiles()).get(message.profileId);
      if (target.profile.sessionState !== 'active') return { error: 'Profile is not active.' };
      cancelProfileOperations(message.profileId);
    }
    // Two managers can both pass the check above; recheck against the committed grant so
    // a later, longer expiry can never overwrite an earlier shortening.
    let extended = false;
    await withProfileLifecycle(grant.profileId, async () => {
      const shorten = (g: OriginGrant): OriginGrant => {
        if (
          message.type !== 'SOLID_ORIGIN_GRANT_EXPIRY' ||
          (g.expiresAt !== undefined && message.expiresAt > g.expiresAt)
        ) {
          extended = true;
          return g;
        }
        return { ...g, expiresAt: message.expiresAt };
      };
      await originGrants.update((all) =>
        message.type === 'SOLID_ORIGIN_GRANT_REVOKE'
          ? all.filter((g) => g.origin !== message.origin)
          : all.map((g) =>
              g.origin !== message.origin
                ? g
                : message.type === 'SOLID_ORIGIN_GRANT_PROFILE'
                  ? {
                      ...g,
                      profileId: message.profileId,
                      createdAt: Date.now(),
                      scope: { pods: [], classes: [] },
                    }
                  : shorten(g),
            ),
      );
      if (
        message.type === 'SOLID_ORIGIN_GRANT_REVOKE' ||
        message.type === 'SOLID_ORIGIN_GRANT_PROFILE'
      ) {
        const record = await (await getProfiles()).get(grant.profileId);
        await purgeOriginSlice(grant, record.profile.webId);
      }
    });
    if (extended)
      return { error: 'Expiry may only be shortened; request fresh consent to extend it.' };
    await updateDefaultIconAndBroadcast();
  }
  return { ok: true, grants: await originGrants.list() };
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
      case 'SOLID_FORMFILL_REQUEST':
        respond(formFill.request(message, sender));
        return true;
      case 'SOLID_FORMFILL_PREVIEW':
      case 'SOLID_FORMFILL_DECISION':
        respond(formFill.preview(message, sender));
        return true;
      case 'SOLID_FORMFILL_REPORT':
        // Counts only; deliberately no persistent page/form telemetry.
        sendResponse({ ok: true });
        return false;
      case 'SOLID_ORIGIN_GRANTS_LIST':
      case 'SOLID_ORIGIN_GRANT_REVOKE':
      case 'SOLID_ORIGIN_GRANT_PROFILE':
      case 'SOLID_ORIGIN_GRANT_EXPIRY':
        respond(handleOriginGrants(message, sender));
        return true;
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
        teardownSession(sender, message.stampedOrigin)
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

const formFill = new FormFillWorker({
  profiles: async () => (await getProfiles()).list(),
  load: async (profileId) => {
    const result = await withProfileOperation(profileId, async (signal) => {
      const ctx = await ensureSession(profileId);
      if (!ctx) throw new Error('Please sign in to this profile.');
      const current = () => checkProfileSession(ctx, signal);
      const pods = await podOriginsFor(ctx.session, profileId);
      const fetchSession = await buildFetchSession(ctx.session, ctx.keyPair, profileId);
      const read = makeResolveFetch(
        { ...fetchSession, allowedOrigins: pods },
        ctx.session.webId,
        signal,
        current,
      );
      const data = await loadFormFillData(ctx.session.webId, pods, read);
      await current();
      return { data, current };
    });
    if (!result) throw new Error('Profile is no longer available.');
    return result;
  },
  commit: withProfileTask,
});

/** First-run onboarding: prompt the user to PIN the toolbar action (extensions can't self-pin). */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ 'solid:show-pin-nudge': true }).catch(() => {});
  }
  // Remove the legacy all-origins registration and restore only current explicit grants.
  void syncOriginGrants().catch(() => {});
});

// Wire the persistent side panel: a right-click "Open Solid side panel" action-menu entry
// + its open handler. The toolbar action keeps its existing popup unchanged.
registerSidePanel();
registerFormFillMenu();
// Local settings/grants are worker-owned; content scripts only receive explicit responses.
void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

// Re-hydrate the session + icon on every SW wake.
void updateDefaultIconAndBroadcast().catch(() => {});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'solid-origin-expiry') void updateDefaultIconAndBroadcast().catch(() => {});
});
