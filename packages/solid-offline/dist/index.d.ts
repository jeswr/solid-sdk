import { O as OfflineStatusSurface } from './status-BJ2JvoOx.js';
export { a as OfflineStatusSnapshot, R as ResourceFreshness, b as StatusListener, S as StatusSurfaceOptions, c as createStatusSurface } from './status-BJ2JvoOx.js';

/**
 * MANDATORY LOGOUT-PURGE (§7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §7: "Logout → mandatory purge of Cache API + IndexedDB for that WebID
 * (parallels the existing credential wipe on sign-out)."
 *
 *   When the user signs out we MUST remove every byte and every metadata record
 *   the offline layer cached for that identity, so nothing the now-departed user
 *   read is recoverable by the next user of the same browser/origin. Because both
 *   stores are namespaced by the WebID hash (`scope.ts`), purge is exact: we drop
 *   precisely one Cache API cache and one IndexedDB database, leaving other
 *   identities' caches (and the anonymous cache) untouched.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Written against the injectable platform surfaces (a `CacheStorage`-like
 * `caches` and an `IDBFactory`) so it is fully unit-testable headlessly
 * (fake-indexeddb + an in-memory caches stub) — no real browser.
 *
 * Purge is best-effort but TOTAL: a failure deleting one store does not stop the
 * other, and a missing store is a success (nothing to purge). The function never
 * throws for "store absent"; it only rejects if the underlying platform call
 * itself fails irrecoverably (e.g. a blocked DB deletion), and even then it
 * reports which half succeeded so the caller can decide.
 */
/** Minimal `CacheStorage` surface we need to purge the bytes cache. */
interface CacheStorageLike {
    delete(cacheName: string): Promise<boolean>;
}
/** What a purge actually did, for tests + observability. */
interface PurgeResult {
    /** The WebID-scoped Cache API cache name we targeted. */
    cacheName: string;
    /** The WebID-scoped IndexedDB database name we targeted. */
    dbName: string;
    /** True if the Cache API cache existed and was deleted. */
    cacheDeleted: boolean;
    /**
     * True ONLY once the IndexedDB `deleteDatabase` request fired `onsuccess` (#5).
     * A `blocked` deletion does NOT set this — see {@link dbBlocked}.
     */
    dbDeleted: boolean;
    /**
     * True if the IndexedDB deletion was BLOCKED by another open connection
     * (another tab / a live SW handle still holds the DB open). The deletion is
     * queued and will complete once those connections close, but at the moment
     * logout returns the metadata is NOT yet gone — callers MUST surface this and
     * coordinate closing other handles rather than assume the purge is complete.
     */
    dbBlocked: boolean;
    /** Any error encountered (purge is best-effort; this surfaces the cause). */
    errors: unknown[];
}
interface PurgeDeps {
    /** Injectable `CacheStorage` (tests). Falls back to the global `caches`. */
    caches?: CacheStorageLike;
    /** Injectable `IDBFactory` (tests inject fake-indexeddb). Falls back to global `indexedDB`. */
    indexedDB?: IDBFactory;
}
/**
 * Purge BOTH stores (Cache API bytes + IndexedDB metadata) for a single WebID.
 * Anonymous (`webId` undefined) purges the anonymous scope. Best-effort and
 * total: it always attempts both halves and reports the outcome.
 */
declare function purgeForWebId(webId: string | undefined, deps?: PurgeDeps): Promise<PurgeResult>;

/**
 * Pure RDF helpers for the proactive warmer (P2, §3).
 *
 * Everything here is a deterministic function over a Turtle string (parsed with
 * N3.js) — no network, no Cache API, no SW lifecycle — so the warmer's seed
 * derivation and child enumeration are fully unit-testable headlessly.
 *
 * The warmer ONLY parses Turtle. The SWR cache normalizes all RDF reads to
 * `Accept: text/turtle` (see `cache-policy.ts#canonicalAccept`), so the warm
 * `fetch`es ask for Turtle and we parse exactly that — no JSON-LD on this path.
 */

/**
 * The warmer's seeds, in spec priority order (§3 + decision 6 "Type-Index-first"):
 *   WebID profile → pim:storage root → Type Index (public + private) → ACLs → inbox.
 *
 * `kind` lets the BFS order Type-Index entries ahead of plain storage roots and
 * decide what to enumerate (a Type Index lists registrations, not ldp:contains).
 */
type SeedKind = 'profile' | 'typeIndex' | 'storage' | 'inbox' | 'acl';
interface Seed {
    url: string;
    kind: SeedKind;
}
/**
 * Derive seeds from a WebID profile document.
 *
 * `webId` is the profile-card URL we fetched (the document); `profileTurtle` is
 * its body. We read pim:storage, public/privateTypeIndex, and ldp:inbox.
 * Type indexes are emitted BEFORE storage roots so the BFS warms the index-named
 * resources first (decision 6).
 */
declare function deriveSeeds(webId: string, profileTurtle: string): Seed[];
/**
 * Children to enqueue from a fetched container listing.
 *
 * Returns absolute `ldp:contains` member IRIs. The container's own ACL document
 * (if known) is handled separately by the BFS via `aclUrlFor`.
 */
declare function containerChildren(containerUrl: string, listingTurtle: string): string[];
/**
 * Resources named by a Type Index document (the registrations'
 * solid:instance / solid:instanceContainer objects). These are warmed before
 * generic BFS frontier expansion (decision 6, Type-Index-first).
 */
declare function typeIndexTargets(typeIndexUrl: string, indexTurtle: string): string[];
/**
 * Parse a `WAC-Allow` header into the modes granted to `user` / `public`.
 *
 * Example: `WAC-Allow: user="read write", public="read"`.
 * The warmer reads this on listings to decide whether a child subtree is worth
 * descending into (no read ⇒ prune without even attempting a 403).
 */
interface WacAllow {
    user: Set<string>;
    public: Set<string>;
}
declare function parseWacAllow(header?: string | null): WacAllow;
/** True if the (authenticated) user is granted read on a resource per WAC-Allow. */
declare function userCanRead(header?: string | null): boolean;

/**
 * Proactive cache warmer (P2, §3 + decisions 1 & 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE-DRIVEN — the SW is NEVER authenticated (decision 1):
 *   The warmer runs in the PAGE. It issues every fetch through the page's normal
 *   (already-DPoP-decorated) global `fetch`, so the service worker (P1) merely
 *   intercepts and caches the responses. We never put a key or token in the SW,
 *   and we never ask the SW to authenticate. The warmer's only job is to *cause*
 *   the right authenticated reads to flow through the SW.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Strategy: a bounded BFS from seeds (WebID profile → pim:storage root →
 * Type Index public+private → ACLs → inbox) over `ldp:contains`, Type-Index-first
 * (decision 6). ACL-aware: a 403 on a child is caught, negative-cached, and its
 * subtree pruned — never surfaced as an error. Budget-bounded (decision 6):
 * `maxResources`, `maxBytes`, `maxDepth`, `concurrency`. Large binaries are
 * listed/metadata-warmed only (bytes fetched lazily on demand).
 *
 * The engine is written against a small injected dependency set (a `fetch`, a
 * negative-cache sink, a clock) so the full traversal is unit-testable with
 * mocks — no browser, no SW lifecycle. Browser-only triggers (idle scheduling,
 * reconnect listeners) live at the bottom and are excluded from coverage.
 */

/** Fully-resolved warmer budget (decision 6 defaults). */
interface ResolvedWarmBudget {
    maxResources: number;
    maxBytes: number;
    maxDepth: number;
    concurrency: number;
}
/** Decision 6 defaults: 500 resources / 50 MB / depth 6 / concurrency 4. */
declare const DEFAULT_WARM_BUDGET: ResolvedWarmBudget;
interface WarmDeps {
    /**
     * The PAGE's fetch (already DPoP-decorated). The warmer ALWAYS uses this so the
     * SW intercepts + caches; the warmer itself never authenticates.
     */
    fetch: typeof fetch;
    /**
     * Record a negative-cache entry for a pruned/forbidden URL. In production this
     * is a no-op when the SW already negative-cached the 403/404 it observed; the
     * sink exists so the page can also remember pruned subtrees for re-warm
     * decisions and so tests can assert pruning.
     */
    negativeCache?(url: string, status: number): void;
    /** Current epoch ms (injected for deterministic tests). */
    now?(): number;
    /** Optional sink for observability of each visited resource. */
    onVisit?(event: WarmVisit): void;
}
interface WarmVisit {
    url: string;
    kind: SeedKind | 'child';
    depth: number;
    status: number;
    bytes: number;
    /** Why a resource was not byte-warmed (still counts listings/metadata). */
    skipped?: 'large-binary' | 'large-resource' | 'forbidden' | 'not-found' | 'fetch-error';
}
interface WarmResult {
    /** Resources whose bytes were warmed through the SW. */
    warmed: number;
    /** Resources visited (fetched) including those skipped for size. */
    visited: number;
    /** Total bytes pulled through the page fetch. */
    bytes: number;
    /** URLs negatively cached (403/404) and pruned. */
    pruned: string[];
    /** True if a budget limit stopped the crawl early. */
    budgetHit: boolean;
    /** Per-resource trace (when `onVisit` not supplied, this is the collected log). */
    visits: WarmVisit[];
}
/**
 * Warm the cache by fetching the user's documents through the page fetch.
 *
 * @param webId        the logged-in user's WebID (profile-card URL).
 * @param profileTurtle the already-fetched profile body (the caller fetches the
 *                      profile once; we reuse it to derive seeds). If omitted,
 *                      the warmer fetches the WebID itself first.
 * @param budget       resolved budget (defaults applied by the caller or here).
 * @param opts.seeds   explicit seed URLs (#16). When provided, these are crawled
 *                     IN ADDITION to the auto-derived profile seeds (treated as
 *                     storage-kind roots → enumerated as container listings).
 *                     Lets a caller warm specific subtrees `WarmConfig.seeds`
 *                     names without relying solely on profile derivation.
 */
declare function warm(webId: string, deps: WarmDeps, budget?: ResolvedWarmBudget, profileTurtle?: string, opts?: {
    seeds?: string[];
}): Promise<WarmResult>;
/** Resolve a partial budget (from config) against decision-6 defaults. */
declare function resolveBudget(partial?: {
    maxResources?: number;
    resources?: number;
    maxBytes?: number;
    bytes?: number;
    maxDepth?: number;
    depth?: number;
    concurrency?: number;
}): ResolvedWarmBudget;
/**
 * Schedule `task` for the next idle period (post-login warm), with a timeout
 * fallback where `requestIdleCallback` is unavailable (Safari/SW-less contexts).
 * Returns a cancel function.
 */
declare function onIdle(task: () => void, timeoutMs?: number): () => void;
/**
 * A warm controller: runs the initial warm post-login (on idle), and on
 * reconnect runs a dedicated ETag-RESYNC SWEEP (NOT a full re-warm).
 *
 * P3 REFACTOR (the gap P2 flagged): P2 re-issued the entire BFS on `online` and
 * relied on the SWR layer to make it cheap. That re-did discovery/traversal for
 * no new information. P3 replaces it: on reconnect we invoke `onReconnect` — a
 * dedicated flat ETag-resync sweep of the already-warmed set (`invalidation.resyncSweep`,
 * driven through the SW by the notifications client) — and do NOT re-crawl. A
 * full re-warm only happens on an explicit `run()`.
 */
interface WarmController {
    /** Run (or re-run) the FULL warm now (BFS). Resolves with the result. */
    run(): Promise<WarmResult>;
    /**
     * Resolve with the result of the next warm to COMPLETE — without forcing a new
     * crawl. If a warm is already in flight (e.g. the post-login idle warm),
     * resolves with that; if one is scheduled (idle) it resolves once it runs.
     * Used by notification topic-derivation so it reuses the scheduled warm rather
     * than triggering a duplicate full crawl (#13).
     */
    result(): Promise<WarmResult>;
    /** Stop listening for reconnect events and cancel any pending idle task. */
    stop(): void;
}
interface WarmControllerOptions {
    webId: string;
    deps: WarmDeps;
    budget?: ResolvedWarmBudget;
    /** Reuse an already-fetched profile body (avoids a refetch on first run). */
    profileTurtle?: string;
    /** Explicit custom seed URLs (#16, `WarmConfig.seeds`), crawled alongside derived seeds. */
    seeds?: string[];
    /** Run the first warm on idle after construction (default true). */
    warmOnLogin?: boolean;
    /** React to reconnect (default true). */
    rewarmOnReconnect?: boolean;
    /**
     * P3: the reconnect handler. When supplied, reconnect invokes THIS dedicated
     * ETag-resync sweep instead of re-running the full BFS — the P2-gap refactor.
     * `index.ts` wires this to the SW's `resyncSweep` via the notifications client.
     * When omitted (back-compat / no notifications), reconnect falls back to a
     * full `run()` as in P2.
     */
    onReconnect?: () => void;
}
declare function createWarmController(opts: WarmControllerOptions): WarmController;

/**
 * Public + internal types for solid-offline (P0/P1).
 *
 * INVARIANT — "the cache is never authoritative":
 * Every value served from the local cache is *provisional*. It is only trusted
 * once a conditional revalidation against the origin confirms its ETag. This
 * mirrors the server-side rule in prod-solid-server (`CLAUDE.md`):
 * "QLever is the source of truth; the cache is never authoritative; cache by
 * (key, etag); validate against the ETag." See `swr.ts` for enforcement.
 */
/**
 * Warmer budget (decision 6). Both the spec field names (`maxResources`,
 * `maxBytes`, `maxDepth`) and the short P0 aliases (`resources`, `bytes`,
 * `depth`) are accepted; `resolveBudget` (warmer.ts) prefers the spec names.
 * Defaults: 500 resources / 50 MB / depth 6 / concurrency 4.
 */
interface WarmBudget {
    /** Max number of resources to byte-warm. Default: 500. */
    maxResources?: number;
    /** Max total bytes to pull through the page fetch. Default: 50 MB. */
    maxBytes?: number;
    /** Max BFS depth over ldp:contains. Default: 6. */
    maxDepth?: number;
    /** Max concurrent warm fetches. Default: 4. */
    concurrency?: number;
    /** @deprecated alias for {@link WarmBudget.maxResources}. */
    resources?: number;
    /** @deprecated alias for {@link WarmBudget.maxBytes}. */
    bytes?: number;
    /** @deprecated alias for {@link WarmBudget.maxDepth}. */
    depth?: number;
}
/** Warmer config (P2). `warm: false` disables; `warm: {...}` configures. */
interface WarmConfig {
    /** Seed strategy. "auto" = WebID profile → storage → Type Index → ACLs → inbox. */
    seeds?: 'auto' | string[];
    budget?: WarmBudget;
    /** Run the first warm on idle after `register()` (default true). */
    warmOnLogin?: boolean;
    /** Re-warm (ETag sweep) when the browser reconnects (default true). */
    rewarmOnReconnect?: boolean;
}
/**
 * Notification client config (P3). The list of containers/resources to subscribe
 * to + the channel cap + backoff/poll knobs. When `notifications: true`, topics
 * are derived from the warmer (the warmed containers); pass this to override.
 */
interface NotificationsClientConfig {
    /** Containers to subscribe to (one one-shot channel each). Auto-derived if omitted. */
    containers?: string[];
    /** Hot resources to subscribe to individually (e.g. the currently-open doc). */
    resources?: string[];
    /** Max channels (capped by the warm budget; channels are pricier than cache entries). */
    maxChannels?: number;
    /** Reconnect backoff base (ms). */
    backoffBaseMs?: number;
    /** Reconnect backoff cap (ms). */
    backoffMaxMs?: number;
    /** Disconnected slow-poll interval (ms). */
    pollIntervalMs?: number;
}
/**
 * App-shell precache config (P4). The list of static URLs (HTML + hashed JS/CSS)
 * to precache at SW install so the app BOOTS with no network after the first
 * visit, plus a navigation fallback document and a cache-busting version tag.
 *
 * The build tool emits `precache` (vite-plugin-pwa / a workbox manifest / a tiny
 * `dist/` or `out/` glob). The shell lives in its OWN, identity-independent Cache
 * bucket (it's the app's public static assets) — NOT the WebID-scoped pod-data
 * cache — so it is not purged on logout. See `app-shell.ts`.
 */
interface AppShellConfig {
    /** Same-origin URLs to precache: the HTML document(s) + every static JS/CSS asset. */
    precache: string[];
    /**
     * HTML to serve for a navigation that misses the precache (unknown client route,
     * or any navigation while offline). Defaults to the first `.html`/`/` entry in
     * `precache`. Must be one of `precache`.
     */
    fallback?: string;
    /**
     * Cache-busting version for the precache bucket (`solid-offline-shell-<version>`).
     * Bump per deploy (or derive from the build hash) so a new deploy gets a fresh
     * precache and the old bucket is cleaned up at activate. Default `'v1'`.
     */
    version?: string;
}
/** Page-client config. `webId`, `warm`, `notifications` per spec "Package shape". */
interface OfflineClientConfig {
    /** The logged-in user's WebID. Scopes the cache (DB name) per identity. */
    webId?: string;
    /**
     * Warmer config (P2). `false` disables warming; `true` / a {@link WarmConfig}
     * enables the page-driven warmer with defaults. Requires `webId`.
     */
    warm?: WarmConfig | boolean;
    /**
     * The page's fetch the warmer should use (P2). Pass your DPoP-decorated /
     * authenticated fetch here so the warmed reads are authenticated; the SW still
     * never authenticates (decision 1). Defaults to the global `fetch`.
     */
    fetch?: typeof fetch;
    /**
     * Notification-driven invalidation (P3). `false`/omitted disables; `true`
     * enables with auto-derived topics (the warmed containers); a
     * {@link NotificationsClientConfig} customizes containers/hot resources/caps.
     * The WebSocket lives in the PAGE (decision 5); requires a `fetch` (the page's
     * authenticated fetch) for the subscribe POSTs.
     */
    notifications?: boolean | NotificationsClientConfig;
    /**
     * App-shell precache (P4). Provide the static URLs (HTML + hashed JS/CSS) to
     * precache at SW install so the app boots offline after the first visit. Omit to
     * disable shell precaching (the SW still caches pod data per P1–P3). The shell is
     * identity-independent and survives logout (it's the app's own public assets).
     */
    appShell?: AppShellConfig;
    /** Path to the service worker script. Default: '/solid-offline-worker.js'. */
    workerUrl?: string;
    /** Service-worker registration scope. Default: '/'. */
    scope?: string;
    /** BroadcastChannel name for 'updated' events. Default: 'solid-offline'. */
    channelName?: string;
}
/** The handle returned by `createOfflineClient`. */
interface OfflineClient {
    /**
     * Registers the service worker, wires page↔SW messaging + BroadcastChannel,
     * and (P2) starts the page-driven warmer if `warm` is configured.
     */
    register(): Promise<ServiceWorkerRegistration | undefined>;
    /**
     * Run (or re-run) the page-driven warmer now, returning its result. Resolves to
     * `undefined` if warming is disabled / no `webId` / no fetch available. The
     * warmer also runs automatically on idle after `register()` unless
     * `warm.warmOnLogin` is false.
     */
    warm(): Promise<WarmResult | undefined>;
    /** Tears down listeners + the BroadcastChannel + warmer (does not unregister the SW). */
    close(): void;
    /**
     * MANDATORY logout-purge (§7): delete the Cache API cache + IndexedDB metadata
     * store for this client's WebID, then tear the client down (`close()`). Call
     * this on sign-out so nothing the departing user read survives for the next
     * user of the same browser. Returns what was purged.
     */
    logout(): Promise<PurgeResult>;
    /** The resolved config (with defaults applied). */
    readonly config: Readonly<Required<Pick<OfflineClientConfig, 'workerUrl' | 'scope' | 'channelName'>> & OfflineClientConfig>;
}
/**
 * Metadata record persisted in IndexedDB, one per (url, varyKey).
 * The Cache API holds the *bytes*; this holds what makes the cache queryable
 * offline and revalidatable (the client analogue of QLever).
 */
interface CacheMetadata {
    /** Composite primary key: `${url} ${varyKey}`. */
    key: string;
    /** The request URL (without the varyKey discriminator). */
    url: string;
    /** The Vary discriminator computed from response Vary vs request headers. */
    varyKey: string;
    /** The response ETag (drives conditional revalidation). May be undefined for HEAD-less. */
    etag?: string;
    /** Response Content-Type. */
    contentType?: string;
    /** Epoch ms when this entry was last confirmed fresh (set on 200 and touched on 304). */
    fetchedAt: number;
    /** The response `Vary` header value, verbatim. */
    vary?: string;
    /**
     * ACL outcome marker for no-leak parity:
     * 'ok' (2xx) | 'forbidden' (403) | 'not-found' (404).
     */
    aclStatus: AclStatus;
    /**
     * The last known notification `state` for this resource (ETag carried in the
     * change frame). Used by P3 for the ETag short-circuit. Unset in P1.
     */
    lastState?: string;
    /** HTTP status of the cached response (200, 403, 404, ...). */
    status: number;
    /**
     * Negative-cache expiry (epoch ms). Set only for 403/404 short-TTL entries.
     * After this instant the entry must be re-validated against the network.
     */
    negativeUntil?: number;
}
type AclStatus = 'ok' | 'forbidden' | 'not-found';
/** Message shape broadcast to all tabs when a cached entry is replaced. */
interface UpdatedEvent {
    url: string;
    event: 'updated';
    /** The new ETag after revalidation. */
    etag?: string;
}
/**
 * The Solid Notifications Protocol change types we react to. They mirror the
 * server's ActivityStreams activity types (prod-solid-server
 * `src/notifications/events.ts`):
 *   - `Create`/`Update`/`Delete` — the `object` resource changed; `state` carries
 *     its new ETag.
 *   - `Add`/`Remove` — a member (`object`) was added to / removed from a container
 *     (`target`); the *container listing* is what must be re-fetched.
 */
type NotificationActivityType = 'Create' | 'Update' | 'Delete' | 'Add' | 'Remove';
/**
 * A parsed Solid notification frame as delivered over WebSocketChannel2023 (the
 * page parses the raw JSON; this is the normalized shape it forwards to the SW).
 * `object`/`target` are flattened to plain URL strings (the wire form allows
 * either a bare IRI or `{ id }`). `state` is the changed resource's ETag.
 */
interface NotificationFrame {
    type: NotificationActivityType;
    /** The resource the change is about (Create/Update/Delete) or the member (Add/Remove). */
    object: string;
    /** The container (Add/Remove only). */
    target?: string;
    /** The changed resource's ETag (Create/Update/Delete). The short-circuit key. */
    state?: string;
}
/** Page→SW control messages (extended in later phases). */
type PageToWorkerMessage = {
    type: 'config';
    config: OfflineClientConfig;
} | {
    type: 'ping';
}
/** A change notification received on the page's WebSocket, forwarded for invalidation (P3). */
 | {
    type: 'notification';
    frame: NotificationFrame;
}
/** Run the reconnect ETag-resync sweep over the whole warmed set (P3). */
 | {
    type: 'resync';
}
/** Run one disconnected slow-poll pass over the warmed set (P3). */
 | {
    type: 'poll';
};

/**
 * App-shell precache (P4 — the missing half of "works COMPLETELY offline").
 *
 * The P1–P3 layer (swr.ts / warmer.ts / invalidation.ts) makes the user's *pod
 * data* available offline. But an app that can read its data offline still can't
 * *boot* offline unless its STATIC SHELL — the HTML document the browser loads
 * plus the JS/CSS bundles it pulls — is served without the network. This module
 * is that half: it precaches the app shell at SW `install` and serves it on a
 * navigation request when the network is unavailable, so the app paints from the
 * SW cache after the first visit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DESIGN — framework-agnostic, two app shapes (the GOAL's "Next out/ + vite dist/"):
 *   - A **vite** SPA emits `dist/index.html` + hashed `dist/assets/*.js|css`. There
 *     is ONE HTML document; every client route resolves to it. The navigation
 *     fallback therefore serves the single precached `index.html`.
 *   - A **Next static export** emits `out/` with PER-ROUTE HTML (`out/index.html`,
 *     `out/files/index.html`, …) + hashed `out/_next/static/**`. A navigation to a
 *     known route can serve that route's own HTML; an unknown route falls back to
 *     a configured `appShellFallback` (typically `/index.html` or `/404.html`).
 *   So the precache is just a LIST OF URLS the app passes in (its build tool emits
 *   them — `vite-plugin-pwa`/`workbox manifest`/a tiny glob), plus a fallback URL.
 *   This module does NOT know or care which framework produced them.
 *
 * SEPARATION FROM THE DATA CACHE (decisive, prevents the two layers fighting):
 *   The app shell lives in its OWN Cache API bucket (`solid-offline-shell-<ver>`),
 *   NOT the WebID-scoped pod-data cache. The shell is identity-independent + public
 *   (it's the app's own static assets), so it is NOT purged on logout and NOT
 *   re-fetched per identity. The pod-data SWR engine (swr.ts) owns same-origin pod
 *   reads; this module owns ONLY navigations + precached static assets. A request
 *   is routed to exactly one of them (see `isPrecachedAsset` / navigation check in
 *   worker.ts) so they never double-handle a request.
 *
 * NEVER-AUTHORITATIVE, BUT NETWORK-FIRST FOR THE SHELL:
 *   The shell is served network-first (so a deploy ships immediately when online)
 *   with a cache fallback (so it boots offline). Precached *assets* are
 *   cache-first (they are content-hashed and immutable — a new deploy emits new
 *   filenames, which miss the cache and fetch fresh). This mirrors the standard
 *   PWA app-shell model and composes with — does not duplicate — the in-app
 *   durable-cache/SWR that renders the data model.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Minimal Cache-API surface this module depends on (mockable in tests). */
interface ShellCache {
    match(request: Request | string): Promise<Response | undefined>;
    put(request: Request | string, response: Response): Promise<void>;
    addAll(requests: string[]): Promise<void>;
}
/** Minimal CacheStorage surface (open named caches + enumerate for cleanup). */
interface ShellCacheStorage {
    open(name: string): Promise<ShellCache>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
}
declare function shellCacheName(version: string): string;
/** Resolve the config's defaults (fallback = first .html in precache; version = v1). */
interface ResolvedAppShellConfig {
    precache: string[];
    fallback: string | undefined;
    version: string;
}
declare function resolveAppShellConfig(config: AppShellConfig): ResolvedAppShellConfig;
/**
 * True if two resolved shell configs are equivalent (same version + fallback +
 * ordered precache set). The SW uses this to decide whether a `config` message
 * carries a NEW deploy's manifest (→ replace + re-precache) or just re-sends the
 * current one (→ no-op), so a long-lived active worker doesn't pin the old shell.
 */
declare function sameShellConfig(a: ResolvedAppShellConfig, b: ResolvedAppShellConfig): boolean;
/**
 * INSTALL: open the versioned precache bucket and add every shell URL.
 *
 * Returns the resolved config so the worker can stash the fallback for the fetch
 * handler. A precache failure (one bad URL) must NOT abort install — the app still
 * works online, and a navigation simply falls through to the network. We therefore
 * add entries individually and swallow per-URL errors (logging via `onError`),
 * rather than `addAll` which rejects atomically on any single 404.
 */
declare function precacheAppShell(caches: ShellCacheStorage, config: ResolvedAppShellConfig, onError?: (url: string, error: unknown) => void): Promise<{
    cached: string[];
    failed: string[];
}>;
/**
 * ACTIVATE: delete every shell precache bucket that is NOT the current version, so
 * an old deploy's shell can't be served after an update. Only touches buckets with
 * our `solid-offline-shell-` prefix — never the pod-data caches or another app's.
 */
declare function cleanupOldShellCaches(caches: ShellCacheStorage, currentVersion: string): Promise<string[]>;
/**
 * Is this request for one of the precached static assets (NOT a navigation)?
 *
 * We match on the request URL's pathname against the precache list's pathnames, so
 * a precached `/_next/static/abc.js` (or `/assets/index-abc.js`) is served from the
 * shell cache cache-first. The navigation document itself is handled separately
 * (`handleNavigation`) — this is only for the JS/CSS/font assets the shell pulls.
 */
declare function isPrecachedAsset(requestUrl: string, config: ResolvedAppShellConfig): boolean;
/** Outcome classifier for tests + observability. */
type ShellServeSource = 'shell-network' | 'shell-network-cached' | 'shell-cache-offline' | 'shell-cache-fallback' | 'asset-cache-first' | 'asset-network' | 'shell-miss';
interface ShellResult {
    response: Response;
    source: ShellServeSource;
}
/** Dependencies for the shell fetch handlers (all injectable for headless tests). */
interface ShellDeps {
    caches: ShellCacheStorage;
    fetch: typeof fetch;
    /** Whether the browser believes it is online (navigator.onLine in the SW). */
    isOnline(): boolean;
    config: ResolvedAppShellConfig;
}
/**
 * NAVIGATION HANDLER — the load-bearing piece for "the app boots offline".
 *
 * A navigation request (`request.mode === 'navigate'`, i.e. the browser loading a
 * document) is served NETWORK-FIRST so a fresh deploy ships immediately; on a
 * network failure (offline, or the server is down) it falls back to:
 *   1. the cached HTML for THIS route — keyed by its CANONICAL configured shell URL
 *      (a Next per-route export), else
 *   2. the configured `fallback` HTML (the vite SPA single document, or Next's
 *      index/404), which boots the app and lets client routing take over.
 * Only if NOTHING is cached does the network error surface (first-ever visit while
 * offline — unavoidable, the shell was never fetched).
 *
 * SECURITY (roborev): the shell cache holds — and serves — ONLY the app's declared
 * public shell documents:
 *   - WRITE is gated on an EXACT configured-URL match (`isExactConfiguredShellUrl`,
 *     path+query): a personalizing query variant (`/index.html?user=alice`) or any
 *     unconfigured route is NEVER stored, so a private/server-rendered page can't
 *     enter the identity-independent, logout-surviving cache.
 *   - READ (offline) is keyed by the CANONICAL configured URL (`canonicalShellUrl`),
 *     never the live request, so client routes still boot AND a poisoned/unconfigured
 *     cache entry is never served (an unknown route skips straight to the fallback).
 * When online + the network succeeds for an exact shell doc, we refresh its cached
 * copy so the offline fallback tracks the latest deploy (best-effort; a put failure
 * never affects the response).
 */
declare function handleNavigation(request: Request, deps: ShellDeps): Promise<ShellResult>;
/**
 * PRECACHED-ASSET HANDLER — cache-first for the immutable, content-hashed JS/CSS/
 * fonts the shell pulls. They never change under a fixed URL (a deploy emits new
 * hashed filenames), so a cache hit is authoritative and avoids the network. A miss
 * (e.g. precache failed for this one) goes to the network and is opportunistically
 * cached.
 */
declare function handlePrecachedAsset(request: Request, deps: ShellDeps): Promise<ShellResult>;

/**
 * Page-side notifications client (P3, §5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE WEBSOCKET LIVES IN THE PAGE (decision 5), NEVER THE SW:
 *   The service worker is event-driven and terminated at will, so it cannot hold
 *   a long-lived socket. The PAGE owns the WebSocket (and the auth that the
 *   subscribe POST needs); on every change frame it `postMessage`s the SW, which
 *   runs the (unauthenticated) invalidation pipeline (`invalidation.ts`). This is
 *   consistent with P2: the page holds the socket + auth; the SW only invalidates.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * FLOW (§5):
 *   discovery (storage-description / `/.well-known/solid`) → subscribe PER
 *   CONTAINER (capped by the warm budget) + per-resource for hot resources →
 *   open the `receiveFrom` socket → forward frames to the SW.
 *
 *   Reconnect = exponential backoff + RE-SUBSCRIBE (channels are one-shot). While
 *   disconnected we slow-poll the warmed set with `If-None-Match`; on reconnect we
 *   run ONE ETag-resync sweep (see `invalidation.resyncSweep`, driven via the SW).
 *
 * The client is written against injected `fetch` + a `WebSocket` factory + a
 * timer set + an SW-postMessage sink, so the whole lifecycle is unit-testable
 * with a fake socket and fake fetch — no real network. Browser wiring (binding to
 * the real `WebSocket`, `navigator.onLine`, the active SW) is done by the caller
 * (`index.ts`).
 */

/** The minimal WebSocket surface we depend on (so tests can supply a fake). */
interface SocketLike {
    send?(data: string): void;
    close(): void;
    addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: unknown) => void): void;
}
/** A factory that opens a socket for a `receiveFrom` URL. */
type SocketFactory = (url: string) => SocketLike;
/** Timer surface (injected so tests drive backoff deterministically). */
interface Timers {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}
interface NotificationsDeps {
    /** The page's (DPoP-decorated) fetch — used for discovery, subscribe POSTs, and slow-poll GETs. */
    fetch: typeof fetch;
    /** Opens a WebSocket for a `receiveFrom` URL. */
    socketFactory: SocketFactory;
    /** Forward a parsed frame to the service worker (which runs the invalidation pipeline). */
    postToWorker(frame: NotificationFrame): void;
    /** Ask the SW to run the reconnect ETag-resync sweep (it owns the cache/meta). */
    requestResync(): void;
    /** Ask the SW to run one disconnected slow-poll pass over the warmed set. */
    requestPoll(): void;
    /** Whether the browser believes it is online (defaults to navigator.onLine via the caller). */
    isOnline?(): boolean;
    timers?: Timers;
    now?(): number;
}
interface NotificationsConfig {
    /** Containers to subscribe to (one channel each). Capped by {@link maxChannels}. */
    containers: string[];
    /** Hot resources to subscribe to individually (e.g. the currently-open doc). */
    resources?: string[];
    /** Max channels (≈ the warm budget's resource cap, but channels are pricier). Default 50. */
    maxChannels?: number;
    /** Backoff base (ms). Default 1000. */
    backoffBaseMs?: number;
    /** Backoff cap (ms). Default 30_000. */
    backoffMaxMs?: number;
    /** Disconnected slow-poll interval (ms). Default 60_000. */
    pollIntervalMs?: number;
}
/**
 * Discover the subscription-service endpoint for a resource on its server.
 *
 * Strategy (§5 / prod-solid-server `src/http/discovery.ts`):
 *  1. Follow the `storageDescription` Link rel on the resource (or `/.well-known/solid`)
 *     to the storage-description document.
 *  2. Read `notify:subscription` from the (Turtle) storage description.
 * Returns the subscription POST URL, or undefined if discovery fails.
 */
declare function discoverSubscriptionUrl(resourceUrl: string, fetchImpl: typeof fetch): Promise<string | undefined>;
/** Extract a `rel="…storageDescription"` (or `rel="storageDescription"`) target from a Link header. */
declare function storageDescriptionFromLink(base: string, linkHeader: string | null | undefined): string | undefined;
/**
 * Subscribe to a topic via a WebSocketChannel2023 subscription POST, returning
 * the `receiveFrom` ws(s) URL. Channels are ONE-SHOT — a reconnect must re-subscribe.
 */
declare function subscribe(subscriptionUrl: string, topic: string, fetchImpl: typeof fetch): Promise<string | undefined>;
/** Parse a raw WebSocket message payload into a normalized {@link NotificationFrame}. */
declare function parseFrame(data: unknown): NotificationFrame | undefined;
/** Exponential backoff with a cap. Attempt 0 → base; doubles each attempt; capped. */
declare function backoffDelay(attempt: number, baseMs: number, maxMs: number): number;
interface NotificationsClient {
    /** Discover + subscribe + open sockets for every configured topic. */
    start(): Promise<void>;
    /** Close all sockets + cancel timers (does not unsubscribe server-side; channels expire). */
    stop(): void;
    /** True while at least one socket is open. */
    readonly connected: boolean;
}
/**
 * Create the page-side notifications client. Page-driven and unauthenticated-SW
 * consistent (decision 1 & 5): the page's fetch carries auth; the SW only
 * invalidates via the forwarded frames + the resync/poll requests.
 */
declare function createNotificationsClient(deps: NotificationsDeps, config: NotificationsConfig): NotificationsClient;

/** Prefix for the IndexedDB metadata DB name (generation-scoped). */
declare const DB_PREFIX = "solid-offline-v2:";
/** Prefix for the Cache API cache name (generation-scoped). */
declare const CACHE_PREFIX = "solid-offline-cache-v2:";
/** The discriminator used for anonymous (no-WebID) reads. */
declare const ANONYMOUS_SCOPE = "anonymous";
/** Default (un-scoped) DB name when no WebID is supplied (e.g. anonymous reads). */
declare const DEFAULT_DB_NAME = "solid-offline-v2:anonymous";
/** Default (un-scoped) Cache name when no WebID is supplied. */
declare const DEFAULT_CACHE_NAME = "solid-offline-cache-v2:anonymous";
/**
 * Short, stable, NON-cryptographic hash of a WebID (FNV-1a 32-bit). Deterministic
 * and dependency-free; collision-tolerant for this use. NOT a security primitive
 * — see the module note: origin isolation is the boundary, this is namespacing.
 */
declare function scopeHash(webId: string): string;
/** The per-identity scope discriminator (`anonymous` or the WebID hash). */
declare function scopeFor(webId: string | undefined): string;
/** The per-identity IndexedDB metadata DB name (`solid-offline:<hash>`). */
declare function dbNameForWebId(webId: string | undefined): string;
/** The per-identity Cache API cache name (`solid-offline-cache:<hash>`). */
declare function cacheNameForWebId(webId: string | undefined): string;
/**
 * Decide whether an incoming config webId is a SCOPE CHANGE the SW must act on
 * (#4). Crucially, `undefined` is a VALID scope (the anonymous scope): after a
 * logged-in user, an anonymous client (`webId === undefined`) MUST be able to
 * clear the previous identity. So the very first config message is always a
 * change, and thereafter ANY difference — including a transition TO `undefined` —
 * is a change. (The old worker only reacted to a truthy webId, so an anonymous
 * client kept reading/writing the departed user's scoped cache.)
 *
 * @param configured  whether a config message has been applied before.
 * @param current     the currently-configured webId (meaningful only if `configured`).
 * @param next        the webId from the new config (may be undefined).
 */
declare function isScopeChange(configured: boolean, current: string | undefined, next: string | undefined): boolean;

/**
 * IndexedDB metadata store — the client analogue of QLever: it makes the cache
 * queryable + revalidatable offline. Holds {@link CacheMetadata} records keyed
 * by the composite (url, varyKey). Response *bytes* live in the Cache API, not
 * here.
 *
 * The store is scoped per identity (`solid-offline:<webId-hash>`, §7) via the
 * shared {@link dbNameForWebId} (see `scope.ts`) so logout-purge (P5) can drop
 * exactly one identity's DB.
 */

/** A thin, promise-based handle over the metadata object store. */
declare class MetadataStore {
    private readonly db;
    private constructor();
    static open(webId: string | undefined, factory?: IDBFactory): Promise<MetadataStore>;
    /** For tests / advanced callers: open against an explicit DB name. */
    static openNamed(dbName: string, factory?: IDBFactory): Promise<MetadataStore>;
    get(key: string): Promise<CacheMetadata | undefined>;
    put(record: CacheMetadata): Promise<void>;
    delete(key: string): Promise<void>;
    /** All metadata entries for a given URL (across varyKeys). */
    getByUrl(url: string): Promise<CacheMetadata[]>;
    /**
     * All metadata entries (every (url, varyKey)). Used by P3's reconnect
     * ETag-resync sweep and disconnected `If-None-Match` polling to enumerate the
     * warmed set. Cheap relative to the network it saves; the warm budget bounds it.
     */
    getAll(): Promise<CacheMetadata[]>;
    /**
     * Record the last notification `state` (ETag carried in a change frame) for a
     * resource, across every cached variant of that URL. Lets the SW short-circuit
     * a self-caused change (`frame.state === lastState`) without a network round-trip.
     */
    setLastState(url: string, state: string): Promise<void>;
    /** Touch fetchedAt (used on a 304 — confirms provisional bytes are still fresh). */
    touch(key: string, at?: number): Promise<void>;
    clear(): Promise<void>;
    close(): void;
}

/**
 * Stale-while-revalidate engine for §2.
 *
 * This is the heart of P1 and is written against small injected interfaces
 * (a Cache-API-like store, a fetch function, a clock, an online flag and a
 * BroadcastChannel-like notifier) so the full decision tree is unit-testable
 * with mocks — no real ServiceWorker, no real browser.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NEVER-AUTHORITATIVE INVARIANT (mirrors prod-solid-server `CLAUDE.md`):
 *   A value served from cache is ALWAYS provisional. We only treat it as
 *   confirmed once a conditional revalidation (`If-None-Match: <etag>`) returns
 *   304 (ETag matches → touch fetchedAt) or 200 (replace entry + broadcast).
 *   On a cache hit we therefore ALWAYS kick a revalidation (online) and we tag
 *   offline hits with `X-Offline: stale` so the consumer knows the value is
 *   unconfirmed. The cache is never the source of truth.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Minimal Cache-API surface we depend on (Cache stores Response bytes by Request). */
interface ByteCache {
    match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
    delete(request: Request, options?: CacheQueryOptions): Promise<boolean>;
}
/** Minimal BroadcastChannel surface. */
interface Broadcaster {
    postMessage(message: UpdatedEvent): void;
}

/**
 * Notification-driven invalidation pipeline (P3, §5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE THIS RUNS — the SW side (decision 1 & 5):
 *   The WebSocket lives in the PAGE (`notifications.ts`); the page `postMessage`s
 *   each change frame here, into the (unauthenticated) service worker. This
 *   module owns the *invalidation* half: look the resource up in the P1 metadata
 *   store, decide whether anything changed, revalidate (or re-fetch a container
 *   listing) and broadcast `{url, event:'updated'}` to every tab. It NEVER signs
 *   or authenticates — for a private resource its conditional GET will simply
 *   404/401 and the page's own warm/read re-populates the cache; the SW only
 *   ever issues unauthenticated conditional GETs (consistent with P1/P2).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE ETAG SHORT-CIRCUIT (the join with the server, §5):
 *   The server's change frame carries the resource's new ETag in `state`
 *   (prod-solid-server `src/notifications/notification.ts`). If that equals the
 *   ETag we already hold, the change is one WE caused (our own write, already
 *   reflected in the cache) — so it is a free no-op: no fetch, no broadcast.
 *   This is what makes a self-caused change cost nothing.
 *
 * The pipeline is written against the same small injected interfaces as `swr.ts`
 * (a Cache-API-like store, a `fetch`, a clock, a BroadcastChannel-like notifier)
 * plus the P1 {@link MetadataStore}, so the whole decision tree is unit-testable
 * with mocks — no real ServiceWorker, no real WebSocket, no real network.
 */

/** Dependencies for the invalidation pipeline (all mockable). */
interface InvalidateDeps {
    cache: ByteCache;
    meta: MetadataStore;
    /** Unauthenticated conditional GET (the SW's own fetch). See module note. */
    fetch: typeof fetch;
    broadcast: Broadcaster;
    now(): number;
}
/** Outcome of handling a single notification frame — returned for tests + observability. */
type InvalidateOutcome = {
    kind: 'short-circuit';
} | {
    kind: 'not-cached';
} | {
    kind: '304-confirmed';
} | {
    kind: 'updated';
    etag?: string;
} | {
    kind: 'deleted';
} | {
    kind: 'listing-refreshed';
} | {
    kind: 'skipped';
} | {
    kind: 'error';
    error: unknown;
};
/**
 * Handle one change notification frame. The single entry point the SW message
 * handler calls; tests call it directly with mocked deps.
 *
 *  - `Create`/`Update`/`Delete` → look up the `object`; ETag short-circuit, else
 *    revalidate (`If-None-Match`) and update Cache+metadata, then broadcast.
 *  - `Add`/`Remove` → re-fetch the `target` *container listing* (membership
 *    changed; a bare ETag can't tell us the new member set), then broadcast.
 */
declare function handleNotification(frame: NotificationFrame, deps: InvalidateDeps): Promise<InvalidateOutcome>;
/**
 * The reconnect ETag-resync sweep (§5). After the socket reconnects (we missed
 * frames while down) revalidate the ENTIRE warmed set with conditional GETs —
 * mostly cheap 304s. This REPLACES P2's "re-issue the full BFS" re-warm: it does
 * no discovery/traversal, just a flat conditional revalidation of what we hold.
 *
 * Also used as the body of the disconnected slow-poll (one pass at a time).
 */
interface SweepResult {
    /** Entries examined. */
    checked: number;
    /** Entries the server confirmed unchanged (304). */
    confirmed: number;
    /** Entries whose bytes were replaced (200). */
    replaced: number;
    /** Entries purged (403/404). */
    purged: number;
    /** Entries with no ETag to revalidate against (skipped). */
    skipped: number;
}
declare function resyncSweep(deps: InvalidateDeps): Promise<SweepResult>;

/**
 * `solid-offline` — framework-agnostic page client (P0–P2).
 *
 * `createOfflineClient(config)` returns a handle whose `register()`:
 *   1. registers the service worker (`navigator.serviceWorker.register`),
 *   2. opens a `BroadcastChannel` for `{url, event:'updated'}` invalidation events,
 *   3. sets up page↔SW `postMessage` and hands the SW its config,
 *   4. (P2) starts the PAGE-DRIVEN warmer if `warm` is configured.
 *
 * PAGE-DRIVEN WARMER (P2, decision 1): the warmer runs in the page and issues its
 * fetches through the page's own (DPoP-decorated) `fetch`, so the SW merely
 * intercepts + caches them. The SW is NEVER authenticated. Notifications (P3) are
 * still config-only.
 *
 * NO React. (The `solid-offline/react` entry is P5.)
 */

/** Listener for `updated` invalidation events broadcast by the SW. */
type UpdatedListener = (event: UpdatedEvent) => void;
/**
 * Create an offline client. Does not touch the network or register anything
 * until you call `register()` — safe to construct during render.
 */
declare function createOfflineClient(config?: OfflineClientConfig): OfflineClient & {
    onUpdated(listener: UpdatedListener): () => void;
    /** The offline/stale/pending status surface for this client (lazily created). */
    readonly status: OfflineStatusSurface;
};

export { ANONYMOUS_SCOPE, type AppShellConfig, CACHE_PREFIX, type CacheMetadata, type CacheStorageLike, DB_PREFIX, DEFAULT_CACHE_NAME, DEFAULT_DB_NAME, DEFAULT_WARM_BUDGET, type InvalidateDeps, type InvalidateOutcome, type NotificationActivityType, type NotificationFrame, type NotificationsClient, type NotificationsClientConfig, type NotificationsConfig, type NotificationsDeps, type OfflineClient, type OfflineClientConfig, OfflineStatusSurface, type PageToWorkerMessage, type PurgeDeps, type PurgeResult, type ResolvedAppShellConfig, type ResolvedWarmBudget, type ShellCache, type ShellCacheStorage, type ShellDeps, type ShellResult, type ShellServeSource, type SocketFactory, type SocketLike, type SweepResult, type UpdatedEvent, type UpdatedListener, type WarmBudget, type WarmConfig, type WarmController, type WarmDeps, type WarmResult, type WarmVisit, backoffDelay, cacheNameForWebId, cleanupOldShellCaches, containerChildren, createNotificationsClient, createOfflineClient, createWarmController, dbNameForWebId, deriveSeeds, discoverSubscriptionUrl, handleNavigation, handleNotification, handlePrecachedAsset, isPrecachedAsset, isScopeChange, onIdle, parseFrame, parseWacAllow, precacheAppShell, purgeForWebId, resolveAppShellConfig, resolveBudget, resyncSweep, sameShellConfig, scopeFor, scopeHash, shellCacheName, storageDescriptionFromLink, subscribe, typeIndexTargets, userCanRead, warm };
