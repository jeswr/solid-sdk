// AUTHORED-BY Codex GPT-6
/** Page driver for the same policy, IndexedDB and invalidation used by the worker. */
import {
  createNotifications,
  type NotificationsClient,
  type Subscription,
} from '@jeswr/pod-notifications';
import { createPodClient } from '@jeswr/storage-client';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { isPodCacheRequest, withCacheProvenance } from './cache-policy.js';
import { handleNotification, resyncSweep } from './invalidation.js';
import { type PurgeResult, purgeForWebId } from './logout.js';
import { MetadataStore } from './metadata-store.js';
import { createPolicyStorage } from './storage.js';
import { handleFetch } from './swr.js';
import type { NotificationFrame, OfflineEvent } from './types.js';

export interface PageCacheOptions {
  webId: string;
  storageRoot: string;
  fetch: typeof fetch;
  /** The session's live account/generation check, including uncommitted sign-out. */
  usable(): boolean;
  indexedDB?: IDBFactory;
  isOnline?(): boolean;
  now?(): number;
  notificationsClient?: NotificationsClient;
  onEvent?(event: OfflineEvent): void;
}

export interface PageCache {
  fetch: typeof fetch;
  /** Start change subscriptions; optional for consumers supplying notifications themselves. */
  start(): Promise<void>;
  notify(frame: NotificationFrame): Promise<void>;
  resync(): Promise<void>;
  /** Fence retained handles and release resources, retaining durable reads. */
  close(): void;
  /** Fence immediately, close handles, then run the shared per-WebID purge. */
  logout(): Promise<PurgeResult>;
}

export function createPageCache(options: PageCacheOptions): PageCache {
  if (!options.webId) throw new Error('Offline cache requires an account');
  let closed = false;
  let revision = 0;
  let opening: Promise<MetadataStore> | undefined;
  let subscription: Subscription | undefined;
  let starting: Promise<void> | undefined;
  let sweeping: Promise<void> | undefined;
  let notificationClient: NotificationsClient | undefined;
  const watched = new Set<string>();
  const resources = new Set<Subscription>();
  const controller = new AbortController();
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const now = options.now ?? Date.now;
  const wire = (opened: Subscription) => {
    opened.on('change', (frame) => {
      void adapter.notify(frame).catch(() => {});
    });
    opened.on('resync', () => {
      void adapter.resync().catch(() => {});
    });
    opened.on('state', (state) => {
      if (state === 'live') void adapter.resync().catch(() => {});
    });
  };
  const watch = async (url: string) => {
    if (!notificationClient || watched.has(url) || watched.size >= 49 || !isOnline()) return;
    watched.add(url);
    try {
      const opened = await notificationClient.subscribe([url], {
        depth: 'resource',
        signal: controller.signal,
      });
      if (closed || !options.usable()) {
        await opened.close();
        return;
      }
      resources.add(opened);
      wire(opened);
      await adapter.resync().catch(() => {});
    } catch {
      watched.delete(url);
    }
  };
  const check = () => {
    if (closed || !options.usable()) throw new Error('Sign in to continue');
  };
  const transport: typeof fetch = async (input, init) => {
    check();
    const request = new Request(input, init);
    const response = await options.fetch(
      new Request(request, {
        signal: AbortSignal.any([request.signal, controller.signal]),
      }),
    );
    check();
    return response;
  };
  const boundary = createSolidBackend({ root: options.storageRoot, fetch: transport });
  const meta = async () => {
    check();
    opening ??= MetadataStore.open(options.webId, options.indexedDB);
    const store = await opening;
    check();
    return store;
  };
  const broadcast = {
    postMessage: (event: OfflineEvent) => {
      if (!closed && options.usable()) {
        try {
          options.onEvent?.(event);
        } catch {
          /* Observers cannot interrupt reads. */
        }
      }
    },
  };
  const storage = () =>
    createPolicyStorage(
      async (fetch) =>
        (await createPodClient({ storage: options.storageRoot, fetch, signal: controller.signal }))
          .storage,
      transport,
    );
  const invalidationDeps = async () => {
    const store = await meta();
    const client = await storage();
    check();
    return { cache: store.bytes, meta: store, storage: client, broadcast, now };
  };
  const adapter: PageCache = {
    fetch: async (input, init) => {
      check();
      const request = new Request(input, init);
      request.signal.throwIfAborted();
      if (!isPodCacheRequest(request, boundary.isWithinStorage)) return transport(request);
      const captured = revision;
      const current = () => {
        check();
        request.signal.throwIfAborted();
        if (captured !== revision) throw new Error('Offline cache changed during read');
      };
      let store: MetadataStore;
      try {
        store = await meta();
      } catch {
        current();
        const response = await transport(request);
        return request.method === 'GET' ? withCacheProvenance(response, 'miss') : response;
      }
      // Every operation checks after awaiting: disk and network replies are as
      // untrusted as a late authenticated response after a live account switch.
      const guardedMeta = new Proxy(store, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          return async (...args: unknown[]) => {
            current();
            const result = await value.apply(target, args);
            current();
            return result;
          };
        },
      });
      let network: Response | undefined;
      let response: Response;
      try {
        const result = await handleFetch(request, {
          cache: store.bytes,
          meta: guardedMeta,
          fetch: async (input, init) => {
            current();
            const response = await transport(input, init);
            current();
            network = response;
            return response;
          },
          broadcast,
          now,
          isOnline,
          strategy: 'network-first',
        });
        response = result.response;
      } catch (error) {
        current();
        // Cache failures cannot discard a complete authoritative network answer.
        // A 304 requires intact bytes and cannot use this escape path.
        if (!network || network.status === 304) throw error;
        response = withCacheProvenance(network, 'miss');
      }
      current();
      void watch(request.url);
      return response;
    },
    notify: async (frame) => {
      check();
      ++revision;
      // Local Delete eviction must work without discovery or a network.
      const store = await meta();
      let discovered: ReturnType<typeof storage> | undefined;
      const deps = {
        cache: store.bytes,
        meta: store,
        broadcast,
        now,
        storage: {
          ...boundary,
          read: async (...args: Parameters<typeof boundary.read>) => {
            discovered ??= storage();
            return (await discovered).read(...args);
          },
        },
      };
      await handleNotification(frame, deps);
      check();
    },
    resync: () => {
      check();
      if (sweeping) return sweeping;
      sweeping = (async () => {
        await resyncSweep(await invalidationDeps());
        check();
      })().finally(() => {
        sweeping = undefined;
      });
      return sweeping;
    },
    start: () => {
      check();
      if (!isOnline()) return Promise.resolve();
      if (starting) return starting;
      starting = (async () => {
        const client =
          options.notificationsClient ??
          createNotifications({
            storage: await storage(),
            fetch: transport,
          });
        check();
        notificationClient = client;
        const opened = await client.subscribe([options.storageRoot], {
          depth: 'recursive',
          signal: controller.signal,
        });
        if (closed || !options.usable()) {
          await opened.close();
          return;
        }
        subscription = opened;
        wire(opened);
        for (const row of await (await meta()).getAll()) void watch(row.url);
        await adapter.resync().catch(() => {});
      })().catch(() => {
        starting = undefined;
      });
      return starting;
    },
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
      void subscription?.close().catch(() => {});
      for (const resource of resources) void resource.close().catch(() => {});
      void opening?.then((store) => store.close()).catch(() => {});
    },
    logout: async () => {
      adapter.close();
      await opening?.then((store) => store.close()).catch(() => {});
      return purgeForWebId(options.webId, { indexedDB: options.indexedDB });
    },
  };
  return adapter;
}
