// AUTHORED-BY Codex GPT-6.1-Sol

import type { ChangeType, NotificationsClient } from '@jeswr/pod-notifications';
import type { StorageClient } from '@jeswr/storage-client';

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
 * and the topic cap and polling cadence. When `notifications: true`, topics
 * are derived from the warmer (the warmed containers); pass this to override.
 */
export interface NotificationsClientConfig {
  /** Containers to subscribe to; auto-derived from the warmer if omitted. */
  containers?: string[];
  /** Hot resources to subscribe to individually (e.g. the currently-open doc). */
  resources?: string[];
  /** Maximum distinct subscribed topics. Default: 50. */
  maxChannels?: number;
  /** Polling fallback interval (ms). Default: 60 seconds; zero disables polling. */
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
  /** Page-side storage client, created with the authenticated page fetch. */
  storage?: StorageClient;
  /** Optional shared notification client; otherwise created from storage + fetch. */
  notificationsClient?: NotificationsClient;
  /** Serialized storage root used by the credential-free worker for invalidation. */
  storageRoot?: string;
  /** Cloneable backend identity; the page supplies this to avoid credential-free root discovery. */
  storageBackend?: { protocol: 'solid' } | { protocol: 'lws'; id: string };
  /** The logged-in user's WebID. Scopes the cache (DB name) per identity. */
  webId?: string;
  /**
   * Warmer config (P2). `false` disables warming; `true` / a {@link WarmConfig}
   * enables the page-driven warmer with defaults. Requires `webId` and `storage`.
   */
  warm?: WarmConfig | boolean;
  /** Authenticated transport for notification discovery/subscription; defaults to global fetch.
   * Warming uses the transport already injected into `storage`.
   */
  fetch?: typeof fetch;
  /**
   * Notification-driven invalidation (P3). `false`/omitted disables; `true`
   * enables with auto-derived topics (the warmed containers); a
   * {@link NotificationsClientConfig} customizes containers/hot resources/caps.
   * Subscriptions live in the page; transport selection and reconnect are owned by pod-notifications.
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
export type NotificationActivityType = ChangeType;

/**
 * A normalized pod-notifications change forwarded from the page to the worker.
 * `object`/`target` are flattened to plain URL strings (the wire form allows
 * either a bare IRI or `{ id }`). `state` is the changed resource's ETag.
 */
export interface NotificationFrame {
  type: NotificationActivityType;
  /** The resource the change is about (Create/Update/Delete) or the member (Add/Remove). */
  object: string;
  /** The container (Add/Remove only). */
  target?: string;
  /** Previous container for Move/Delete changes. */
  origin?: string;
  /** The changed resource's ETag (Create/Update/Delete). The short-circuit key. */
  state?: string;
}

/** Page→SW control messages (extended in later phases). */
export type PageToWorkerMessage =
  | { type: 'config'; config: OfflineClientConfig }
  | { type: 'ping' }
  /** A change notification received on the page's notification transport, forwarded for invalidation (P3). */
  | { type: 'notification'; frame: NotificationFrame }
  /** Run the reconnect ETag-resync sweep over the whole warmed set (P3). */
  | { type: 'resync' }
  /** Run one disconnected slow-poll pass over the warmed set (P3). */
  | { type: 'poll' };

/** SW→Page messages. */
export type WorkerToPageMessage = { type: 'pong' } | { type: 'ready' };
