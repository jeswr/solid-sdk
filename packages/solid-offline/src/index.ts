// AUTHORED-BY Codex GPT-6.1-Sol
/** @jeswr/solid-offline — credential-free worker + authenticated page-side storage. */
import {
  createNotifications,
  type Subscription,
  type SubscriptionState,
} from '@jeswr/pod-notifications';
import { type PurgeResult, purgeForWebId } from './logout.js';
import { createStatusSurface, type OfflineStatusSurface } from './status.js';
import type {
  NotificationsClientConfig,
  OfflineClient,
  OfflineClientConfig,
  PageToWorkerMessage,
  UpdatedEvent,
  WarmConfig,
} from './types.js';
import {
  createWarmController,
  resolveBudget,
  type WarmController,
  type WarmResult,
} from './warmer.js';

export type {
  ResolvedAppShellConfig,
  ShellCache,
  ShellCacheStorage,
  ShellDeps,
  ShellResult,
  ShellServeSource,
} from './app-shell.js';
// P4 — app-shell precache pure logic (consumable by apps + the SW, unit-tested).
export {
  assetConfigCandidates,
  cleanupOldShellCaches,
  handleNavigation,
  handlePrecachedAsset,
  isPrecachedAsset,
  precacheAppShell,
  resolveAppShellConfig,
  resolveAssetShellConfig,
  resolveServingShellConfig,
  sameShellConfig,
  shellBucketComplete,
  shellCacheName,
} from './app-shell.js';
export type { InvalidateDeps, InvalidateOutcome, SweepResult } from './invalidation.js';
export { handleNotification, resyncSweep } from './invalidation.js';
export type { CacheStorageLike, PurgeDeps, PurgeResult } from './logout.js';
export { purgeForWebId } from './logout.js';
// P5 — WebID cache scoping (§7), logout-purge, and the status surface.
export {
  ANONYMOUS_SCOPE,
  CACHE_PREFIX,
  cacheNameForWebId,
  DB_PREFIX,
  DEFAULT_CACHE_NAME,
  DEFAULT_DB_NAME,
  dbNameForWebId,
  isScopeChange,
  scopeFor,
  scopeHash,
} from './scope.js';
export type {
  OfflineStatusSnapshot,
  OfflineStatusSurface,
  ResourceFreshness,
  StatusListener,
  StatusSurfaceOptions,
} from './status.js';
export { createStatusSurface } from './status.js';
export type {
  AppShellConfig,
  CacheMetadata,
  NotificationActivityType,
  NotificationFrame,
  NotificationsClientConfig,
  OfflineClient,
  OfflineClientConfig,
  OfflineEvent,
  PageToWorkerMessage,
  RevalidationEvent,
  UpdatedEvent,
  WarmBudget,
  WarmConfig,
} from './types.js';
export type {
  ResolvedWarmBudget,
  WarmController,
  WarmDeps,
  WarmResult,
  WarmVisit,
} from './warmer.js';
export {
  createWarmController,
  DEFAULT_WARM_BUDGET,
  onIdle,
  resolveBudget,
  warm,
} from './warmer.js';
export {
  containerChildren,
  deriveSeeds,
  parseWacAllow,
  typeIndexTargets,
  userCanRead,
} from './warmer-rdf.js';

const DEFAULTS = {
  workerUrl: '/solid-offline-worker.js',
  scope: '/',
  channelName: 'solid-offline',
} as const;

/** Listener for `updated` invalidation events broadcast by the SW. */
export type UpdatedListener = (event: UpdatedEvent) => void;

/**
 * Create an offline client. Does not touch the network or register anything
 * until you call `register()` — safe to construct during render.
 */
export function createOfflineClient(config: OfflineClientConfig = {}): OfflineClient & {
  onUpdated(listener: UpdatedListener): () => void;
  /** The offline/stale/pending status surface for this client (lazily created). */
  readonly status: OfflineStatusSurface;
} {
  const resolved = {
    ...config,
    workerUrl: config.workerUrl ?? DEFAULTS.workerUrl,
    scope: config.scope ?? DEFAULTS.scope,
    channelName: config.channelName ?? DEFAULTS.channelName,
  };

  let channel: BroadcastChannel | undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let warmer: WarmController | undefined;
  let notifications: Subscription | undefined;
  let startingNotifications = false;
  let notificationsAbort: AbortController | undefined;
  let notificationPoll: ReturnType<typeof setInterval> | undefined;
  let status: OfflineStatusSurface | undefined;
  // The `controllerchange` listener `register()` adds. Kept so `close()` can
  // remove it — otherwise a delayed controllerchange after logout/account-switch
  // would re-post this (departed) identity's config and re-scope the SW to it.
  let onControllerChange: (() => void) | undefined;
  // CLOSED GUARD: every async registration callback (statechange on an installing
  // worker, controllerchange) checks this before posting config. After close()
  // (logout / account-switch) a delayed lifecycle event must NOT re-post this
  // departed identity's config — removing the controllerchange listener isn't
  // enough on its own because the `statechange` listener on an installing worker
  // can still fire on activation. The guard covers every such path.
  let closed = false;
  const listeners = new Set<UpdatedListener>();

  /**
   * The page's fetch the warmer + notifications client should use: `config.fetch`
   * (typically the app's DPoP-decorated/authenticated fetch) if supplied, else the
   * global `fetch`, else undefined (no usable fetch in this context). The SW still
   * authenticates nothing (decision 1) — only these page-side reads carry auth.
   */
  function resolvePageFetch(): typeof fetch | undefined {
    return config.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  }

  /** The notifications config object (`{}` when `notifications: true`, else the given config). */
  function notificationsConfig(): NotificationsClientConfig {
    return config.notifications === true || !config.notifications ? {} : config.notifications;
  }

  /** True if the notifications config names explicit topics (containers and/or resources). */
  function hasExplicitNotificationTopics(nCfg: NotificationsClientConfig): boolean {
    return Boolean(nCfg.containers?.length) || Boolean(nCfg.resources?.length);
  }

  /** Post a control message to the active service worker (P3 invalidation path). */
  function postToWorker(message: PageToWorkerMessage): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const target = registration?.active ?? navigator.serviceWorker.controller;
    target?.postMessage(message);
  }

  function stopNotificationPoll(): void {
    if (notificationPoll !== undefined) clearInterval(notificationPoll);
    notificationPoll = undefined;
  }

  /** Shared pod-notifications owns discovery/transports; sweep while push is unavailable. */
  async function startNotifications(containers: string[]): Promise<void> {
    if (
      closed ||
      notifications ||
      startingNotifications ||
      !config.notifications ||
      !config.storage
    )
      return;
    const pageFetch = resolvePageFetch();
    if (!pageFetch && !config.notificationsClient) return;
    const nCfg = notificationsConfig();
    const topics = [...new Set([...(nCfg.containers ?? containers), ...(nCfg.resources ?? [])])]
      .filter((url) => config.storage?.isWithinStorage(url))
      .slice(0, nCfg.maxChannels ?? 50);
    if (!topics.length) return;
    startingNotifications = true;
    const abort = new AbortController();
    notificationsAbort = abort;
    try {
      const client =
        config.notificationsClient ??
        createNotifications({ storage: config.storage, fetch: pageFetch ?? fetch });
      const subscription = await client.subscribe(topics, {
        pollIntervalMs: nCfg.pollIntervalMs ?? 60_000,
        signal: abort.signal,
      });
      if (closed || abort.signal.aborted) {
        await subscription.close();
        return;
      }
      notifications = subscription;
      let firstLive = false;
      const observeState = (state: SubscriptionState) => {
        if (closed || abort.signal.aborted) return;
        if (state === 'live' || state === 'closed') stopNotificationPoll();
        else if (notificationPoll === undefined && (nCfg.pollIntervalMs ?? 60_000) > 0) {
          notificationPoll = setInterval(() => {
            if (!closed && !abort.signal.aborted) postToWorker({ type: 'poll' });
          }, nCfg.pollIntervalMs ?? 60_000);
        }
        if (state === 'live' && !firstLive) {
          firstLive = true;
          postToWorker({ type: 'resync' });
        }
      };
      subscription.on('change', (change) => {
        if (!closed && !abort.signal.aborted) {
          const { type, object, target, origin, state } = change;
          postToWorker({ type: 'notification', frame: { type, object, target, origin, state } });
        }
      });
      subscription.on('resync', () => {
        if (!closed && !abort.signal.aborted) postToWorker({ type: 'resync' });
      });
      subscription.on('state', observeState);
      observeState(subscription.state);
    } catch {
      // Registration and reads remain usable if notifications are unavailable.
    } finally {
      if (notificationsAbort === abort) startingNotifications = false;
    }
  }

  /** Warm through the authenticated page-side storage client. */
  function startWarmer(): WarmController | undefined {
    if (closed) return undefined; // closed during/after register() — don't start a crawl
    if (warmer) return warmer;
    if (config.warm === false || config.warm === undefined) return undefined;
    if (!config.storage) return undefined;
    if (!config.webId) return undefined; // no identity → nothing to warm
    const warmCfg = config.warm === true ? {} : config.warm;
    warmer = createWarmController({
      webId: config.webId,
      deps: {
        storage: config.storage,
        prepare: () =>
          postConfig(
            typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined,
          ),
      },
      budget: resolveBudget(warmCfg.budget),
      warmOnLogin: warmCfg.warmOnLogin,
      rewarmOnReconnect: warmCfg.rewarmOnReconnect,
      // #16: pass through custom seeds (WarmConfig.seeds) when an explicit array
      // is supplied ('auto' / undefined keep pure profile derivation).
      ...(Array.isArray(warmCfg.seeds) ? { seeds: warmCfg.seeds } : {}),
      // P3 (P2-gap refactor): on reconnect, run the dedicated ETag-resync sweep in
      // the SW instead of re-issuing the full BFS. Only wired when notifications
      // are enabled (otherwise the warmer keeps its P2 full re-warm fallback).
      ...(config.notifications ? { onReconnect: () => postToWorker({ type: 'resync' }) } : {}),
    });
    return warmer;
  }

  /** Defer the initial crawl until page reads can use the worker's listing guard. */
  function startAutomaticWarmer(): void {
    if (closed || warmer || !navigator.serviceWorker.controller) return;
    const w = startWarmer();
    const autoWarmOff =
      config.warm !== undefined &&
      config.warm !== true &&
      config.warm !== false &&
      (config.warm as WarmConfig).warmOnLogin === false;
    if (
      w &&
      !autoWarmOff &&
      config.notifications &&
      !hasExplicitNotificationTopics(notificationsConfig())
    ) {
      // Reuse the scheduled crawl for topic discovery, including on first install.
      void w
        .result()
        .then((result) => {
          void startNotifications(containersFromWarm(result));
        })
        .catch(() => {
          // A failed/stopped crawl can still be retried with a manual warm().
        });
    }
  }

  function ensureChannel(): BroadcastChannel | undefined {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') return undefined;
    channel = new BroadcastChannel(resolved.channelName);
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as UpdatedEvent | undefined;
      if (data && data.event === 'updated') {
        for (const listener of listeners) listener(data);
      }
    });
    return channel;
  }

  async function postConfig(target: ServiceWorker | null | undefined): Promise<void> {
    if (!target) return;
    // Closed guard (roborev): after close() a delayed registration callback
    // (statechange/controllerchange) must NOT re-post the departed config.
    if (closed) return;
    // Send the RESOLVED channelName (#15) so the worker's update + invalidation
    // BroadcastChannel matches the one the page client/status surface listens on —
    // a custom `channelName` otherwise never receives the SW's events.
    //
    // STRIP PAGE-ONLY, NON-CLONEABLE fields before posting: `config.fetch` is a
    // function and `postMessage` structured-clones its argument, so leaving it in
    // throws `DataCloneError` and the SW is never configured. The SW never uses
    // the page's fetch anyway (decision 1: it authenticates nothing) — only the
    // page-side warmer/notifications do. We drop `fetch` (and any other function
    // value, defensively) so the config is always cloneable.
    const {
      fetch: _pageFetch,
      storage: _storage,
      notificationsClient: _notificationsClient,
      ...cloneableConfig
    } = config;
    let backend = config.storageBackend;
    if (config.storage?.protocol === 'solid') backend = { protocol: 'solid' };
    else if (!backend && config.storage?.protocol === 'lws') {
      try {
        const head = await config.storage.head(config.storage.root);
        const id = head.links.get('https://www.w3.org/ns/lws#storage')?.[0]?.target;
        if (id) backend = { protocol: 'lws', id };
      } catch {
        // Without page-side evidence, retain the existing discovery path.
      }
    }
    if (closed) return;
    const message: PageToWorkerMessage = {
      type: 'config',
      config: {
        ...cloneableConfig,
        storageRoot: config.storage?.root ?? config.storageRoot,
        storageBackend: backend,
        channelName: resolved.channelName,
      },
    };
    target.postMessage(message);
  }

  async function configureController(alreadyConfigured?: ServiceWorker | null): Promise<void> {
    const controller = navigator.serviceWorker.controller;
    if (controller !== alreadyConfigured) await postConfig(controller);
    // Control may change again (or close() may run) during backend discovery.
    if (controller && controller === navigator.serviceWorker.controller) startAutomaticWarmer();
  }

  async function register(): Promise<ServiceWorkerRegistration | undefined> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      // Non-browser / unsupported context: no-op, the app still works online.
      return undefined;
    }

    // A (re-)register after a previous close() re-opens the client for posting.
    closed = false;

    ensureChannel();

    registration = await navigator.serviceWorker.register(resolved.workerUrl, {
      scope: resolved.scope,
    });

    // CLOSE-VS-REGISTER RACE (roborev High): if close() ran while we were awaiting
    // register(), bail NOW — before adding any listeners or starting the warmer/
    // notifications. Otherwise the continuation would attach listeners close()
    // already ran past (a leak it can't undo) and start departed-identity
    // background fetches. The `postConfig` closed-guard alone is not enough.
    if (closed) return registration;

    // Hand the SW its config (webId for cache scoping; warm/notifications for
    // later phases). Cover both "already active" and "installing" cases.
    const active = registration.active ?? navigator.serviceWorker.controller;
    if (active) {
      await postConfig(active);
    }
    if (closed) return registration;
    const installing = registration.installing ?? registration.waiting;
    if (installing) {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'activated') void postConfig(installing);
      });
    }

    // Re-send config whenever a new SW takes control (e.g. after an update).
    // Stored + de-duplicated so `close()` can remove it (a delayed controllerchange
    // after logout must NOT re-post the departed identity's config).
    if (!onControllerChange) {
      onControllerChange = () => {
        void configureController();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }

    // An active worker need not control this page yet on first installation.
    // controllerchange resumes automatic warming after configuring its controller.
    await configureController(active);

    // P3: start the page-side notifications client (decision 5: socket in the page).
    // If explicit containers are configured, start immediately; otherwise derive
    // the container set from a warm pass.
    if (config.notifications) {
      const nCfg = notificationsConfig();
      if (hasExplicitNotificationTopics(nCfg)) {
        // Explicit topics (containers AND/OR resources) → start immediately. Pass
        // whatever containers were configured (possibly none — `startNotifications`
        // + the client still subscribe the explicit `resources`). This is the fix
        // for a resources-only config, which previously never started when
        // auto-warm was off/unavailable.
        void startNotifications(nCfg.containers ?? []);
      }
    }

    return registration;
  }

  /** The container URLs a warm pass visited — the natural per-container subscription set. */
  function containersFromWarm(result: WarmResult): string[] {
    const seen = new Set<string>();
    for (const visit of result.visits) {
      try {
        if (visit.container) seen.add(visit.url);
      } catch {
        /* skip unparseable */
      }
    }
    return [...seen];
  }

  /** Run (or re-run) the warmer now. See {@link OfflineClient.warm}. */
  async function warm(): Promise<WarmResult | undefined> {
    const w = startWarmer();
    if (!w) return undefined;
    const result = await w.run();
    // If notifications are enabled with AUTO-derived topics and aren't already
    // running, start them from this warm's result (the re-review corrective for
    // manual-warm users: `register()` doesn't auto-warm when `warmOnLogin: false`,
    // so the only signal to derive topics is this manual `warm()`).
    if (config.notifications && !notifications) {
      if (!hasExplicitNotificationTopics(notificationsConfig())) {
        void startNotifications(containersFromWarm(result));
      }
    }
    return result;
  }

  function onUpdated(listener: UpdatedListener): () => void {
    listeners.add(listener);
    ensureChannel();
    return () => listeners.delete(listener);
  }

  /**
   * The offline status surface (offline/stale/pending) for this client. Lazily
   * created on first access; shares the client's `channelName` so it reflects
   * `updated` broadcasts. A vanilla app renders `status.getSnapshot()`; a React
   * app passes this to `useOfflineStatus` (`solid-offline/react`).
   */
  function getStatus(): OfflineStatusSurface {
    if (!status) {
      status = createStatusSurface({ channelName: resolved.channelName });
    }
    return status;
  }

  /**
   * MANDATORY logout-purge (§7): drop this WebID's Cache API cache + IndexedDB
   * metadata store, then tear the client down. Runs page-side (the `caches` /
   * `indexedDB` globals are same-origin) — no SW round-trip needed.
   */
  async function logout(): Promise<PurgeResult> {
    close();
    const result = await purgeForWebId(config.webId);
    return result;
  }

  function close(): void {
    // Mark closed FIRST so any in-flight registration callback (statechange/
    // controllerchange) that fires during/after teardown short-circuits in
    // postConfig and cannot re-scope the SW to this departed identity.
    closed = true;
    listeners.clear();
    channel?.close();
    channel = undefined;
    warmer?.stop();
    warmer = undefined;
    notificationsAbort?.abort();
    stopNotificationPoll();
    notificationsAbort = undefined;
    startingNotifications = false;
    void notifications?.close().catch(() => undefined);
    notifications = undefined;
    status?.close();
    status = undefined;
    // Remove the `controllerchange` listener so a SW lifecycle event arriving
    // AFTER close (logout / account-switch before the new SW activated) can't
    // re-post this (now departed) identity's config and re-scope the worker to it.
    if (onControllerChange && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }
    onControllerChange = undefined;
  }

  return {
    register,
    warm,
    close,
    logout,
    onUpdated,
    get status(): OfflineStatusSurface {
      return getStatus();
    },
    config: resolved,
  };
}
