// AUTHORED-BY Codex GPT-6.1-Sol
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
export interface WarmBudget {
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
export interface WarmConfig {
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
export interface NotificationsClientConfig {
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
export interface AppShellConfig {
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
export interface OfflineClientConfig {
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
  /** BroadcastChannel name for revalidation events. Default: 'solid-offline'. */
  channelName?: string;
}

/** The handle returned by `createOfflineClient`. */
export interface OfflineClient {
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
  warm(): Promise<import('./warmer.js').WarmResult | undefined>;
  /** Tears down listeners + the BroadcastChannel + warmer (does not unregister the SW). */
  close(): void;
  /**
   * MANDATORY logout-purge (§7): delete the Cache API cache + IndexedDB metadata
   * store for this client's WebID, then tear the client down (`close()`). Call
   * this on sign-out so nothing the departing user read survives for the next
   * user of the same browser. Returns what was purged.
   */
  logout(): Promise<import('./logout.js').PurgeResult>;
  /** The resolved config (with defaults applied). */
  readonly config: Readonly<
    Required<Pick<OfflineClientConfig, 'workerUrl' | 'scope' | 'channelName'>> & OfflineClientConfig
  >;
}

/**
 * Metadata record persisted in IndexedDB, one per (url, varyKey).
 * The Cache API holds the *bytes*; this holds what makes the cache queryable
 * offline and revalidatable (the client analogue of QLever).
 */
export interface CacheMetadata {
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

export type AclStatus = 'ok' | 'forbidden' | 'not-found';

/** Message shape broadcast to all tabs when a cached entry is replaced. */
export interface UpdatedEvent {
  url: string;
  event: 'updated';
  /** Opaque lifecycle identifier; optional for compatibility with older senders. */
  attemptId?: string;
  /** Optional legacy field; current worker messages omit response metadata. */
  etag?: string;
}

/** Progress messages; never include response bytes, headers or credentials. */
export interface RevalidationEvent {
  url: string;
  event: 'revalidating' | 'revalidated' | 'revalidate-failed';
  /** Opaque lifecycle identifier; optional for compatibility with older senders. */
  attemptId?: string;
}

/** All messages on the offline BroadcastChannel. UpdatedEvent remains source-compatible. */
export type OfflineEvent = UpdatedEvent | RevalidationEvent;

/**
 * The Solid Notifications Protocol change types we react to. They mirror the
 * server's ActivityStreams activity types (prod-solid-server
 * `src/notifications/events.ts`):
 *   - `Create`/`Update`/`Delete` — the `object` resource changed; `state` carries
 *     its new ETag.
 *   - `Add`/`Remove` — a member (`object`) was added to / removed from a container
 *     (`target`); the *container listing* is what must be re-fetched.
 */
export type NotificationActivityType = 'Create' | 'Update' | 'Delete' | 'Add' | 'Remove';

/**
 * A parsed Solid notification frame as delivered over WebSocketChannel2023 (the
 * page parses the raw JSON; this is the normalized shape it forwards to the SW).
 * `object`/`target` are flattened to plain URL strings (the wire form allows
 * either a bare IRI or `{ id }`). `state` is the changed resource's ETag.
 */
export interface NotificationFrame {
  type: NotificationActivityType;
  /** The resource the change is about (Create/Update/Delete) or the member (Add/Remove). */
  object: string;
  /** The container (Add/Remove only). */
  target?: string;
  /** The changed resource's ETag (Create/Update/Delete). The short-circuit key. */
  state?: string;
}

/** Page→SW control messages (extended in later phases). */
export type PageToWorkerMessage =
  | { type: 'config'; config: OfflineClientConfig }
  | { type: 'ping' }
  /** A change notification received on the page's WebSocket, forwarded for invalidation (P3). */
  | { type: 'notification'; frame: NotificationFrame }
  /** Run the reconnect ETag-resync sweep over the whole warmed set (P3). */
  | { type: 'resync' }
  /** Run one disconnected slow-poll pass over the warmed set (P3). */
  | { type: 'poll' };

/** SW→Page messages. */
export type WorkerToPageMessage = { type: 'pong' } | { type: 'ready' };
