// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationsClient, Subscription } from '@jeswr/pod-notifications';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Page-client config + lifecycle hardening (roborev, PM integration round 4):
 *  - the config posted to the SW is STRUCTURED-CLONEABLE: `fetch` (a function)
 *    is stripped, so `postMessage` never throws `DataCloneError`.
 *  - `close()` REMOVES the `controllerchange` listener, so a SW lifecycle event
 *    after logout/account-switch can't re-post the departed identity's config.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOfflineClient } from '../src/index.js';

interface FakeSW {
  postMessage: ReturnType<typeof vi.fn>;
}

function makeFakeRegistration(active: FakeSW) {
  return {
    active,
    installing: null,
    waiting: null,
  } as unknown as ServiceWorkerRegistration;
}

/** A fake "installing" worker that records its statechange listener + can fire it. */
function makeInstallingWorker() {
  const worker: {
    state: string;
    postMessage: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    fireStateChange: () => void;
  } = {
    state: 'installing',
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    fireStateChange: () => {},
  };
  worker.addEventListener = vi.fn((type: string, fn: () => void) => {
    if (type === 'statechange') worker.fireStateChange = fn;
  });
  return worker;
}

/** Stub the minimal browser globals `register()`/`close()` touch. */
function stubBrowser() {
  const active: FakeSW = { postMessage: vi.fn() };
  const controllerListeners = new Map<string, Set<() => void>>();
  const swContainer = {
    controller: active,
    register: vi.fn(async () => makeFakeRegistration(active)),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!controllerListeners.has(type)) controllerListeners.set(type, new Set());
      controllerListeners.get(type)?.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      controllerListeners.get(type)?.delete(fn);
    }),
  };
  vi.stubGlobal('navigator', { serviceWorker: swContainer });
  // BroadcastChannel: a tiny no-op stand-in so ensureChannel() doesn't throw.
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      addEventListener() {}
      close() {}
    },
  );
  return { active, swContainer, controllerListeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createOfflineClient config posting + lifecycle', () => {
  it('posts a STRUCTURED-CLONEABLE config to the SW (fetch stripped, no DataCloneError)', async () => {
    const { active } = stubBrowser();
    const client = createOfflineClient({
      webId: 'https://alice.example/profile/card#me',
      // A function in config would break postMessage if not stripped.
      fetch: (async () => new Response()) as typeof fetch,
      warm: { seeds: 'auto' },
      notifications: true,
    });
    await client.register();

    expect(active.postMessage).toHaveBeenCalled();
    const posted = active.postMessage.mock.calls[0]?.[0];
    expect(posted.type).toBe('config');
    // The posted config carries no function (fetch removed).
    expect(posted.config.fetch).toBeUndefined();
    expect('fetch' in posted.config).toBe(false);
    // And it must actually survive structured clone (the postMessage contract).
    expect(() => structuredClone(posted)).not.toThrow();
    expect(posted.config.webId).toBe('https://alice.example/profile/card#me');
    client.close();
  });

  it('close() removes the controllerchange listener (no re-post of departed config)', async () => {
    const { swContainer, controllerListeners } = stubBrowser();
    const client = createOfflineClient({ webId: 'https://alice.example/profile/card#me' });
    await client.register();
    // register() added a controllerchange listener.
    expect(controllerListeners.get('controllerchange')?.size).toBe(1);

    client.close();
    // close() removed it — a later controllerchange can't re-post old config.
    expect(swContainer.removeEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    );
    expect(controllerListeners.get('controllerchange')?.size ?? 0).toBe(0);
  });

  it('close() DURING a pending register() prevents listeners/warmer/config after it resolves (roborev High)', async () => {
    const { swContainer, controllerListeners } = stubBrowser();
    const active: FakeSW = { postMessage: vi.fn() };
    // Make register() hang until we resolve it, so we can close() mid-flight.
    let resolveRegister: (r: ServiceWorkerRegistration) => void = () => {};
    swContainer.register = vi.fn(
      () =>
        new Promise<ServiceWorkerRegistration>((res) => {
          resolveRegister = res;
        }),
    );

    const client = createOfflineClient({
      webId: 'https://alice.example/profile/card#me',
      warm: { seeds: 'auto' },
      notifications: true,
    });
    const registerPromise = client.register();
    // Tear down while register() is still awaiting the SW registration.
    client.close();
    // Now the registration finally resolves.
    resolveRegister(makeFakeRegistration(active));
    await registerPromise;

    // The post-await continuation bailed on `closed`: no config posted to the SW,
    // and no controllerchange listener added (so nothing can re-scope later).
    expect(active.postMessage).not.toHaveBeenCalled();
    expect(controllerListeners.get('controllerchange')?.size ?? 0).toBe(0);
  });

  it('a statechange firing AFTER close() does NOT re-post the departed config (roborev High)', async () => {
    const { swContainer } = stubBrowser();
    const installing = makeInstallingWorker();
    // Registration reports an INSTALLING worker (not yet active) so register()
    // wires the statechange→postConfig path.
    swContainer.register = vi.fn(
      async () =>
        ({ active: null, installing, waiting: null }) as unknown as ServiceWorkerRegistration,
    );
    // No controller yet either (the SW hasn't taken control).
    (swContainer as { controller: unknown }).controller = null;

    const client = createOfflineClient({ webId: 'https://alice.example/profile/card#me' });
    await client.register();
    installing.postMessage.mockClear();

    // Logout/account-switch tears the client down BEFORE the worker activates…
    client.close();
    // …then the worker finally activates and fires statechange.
    installing.state = 'activated';
    installing.fireStateChange();

    // The closed guard means NO config was posted to the departed identity's worker.
    expect(installing.postMessage).not.toHaveBeenCalled();
  });
});

describe('pod-notifications integration', () => {
  it('forwards normalized changes and resync, and strips page clients from worker config', async () => {
    const { active } = stubBrowser();
    const { storage, notificationsClient, subscription, emit } = notificationHarness();
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { resources: [`${storage.root}doc`] },
    });
    await client.register();
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(2));
    const posted = active.postMessage.mock.calls[0]?.[0];
    expect(posted.config.storageRoot).toBe(storage.root);
    expect(posted.config.storage).toBeUndefined();
    expect(posted.config.notificationsClient).toBeUndefined();
    expect(() => structuredClone(posted)).not.toThrow();
    emit('change', {
      type: 'Move',
      object: `${storage.root}doc`,
      target: storage.root,
      origin: storage.root,
      state: 'v2',
    });
    emit('resync', new Date());
    expect(active.postMessage).toHaveBeenCalledWith({
      type: 'notification',
      frame: {
        type: 'Move',
        object: `${storage.root}doc`,
        target: storage.root,
        origin: storage.root,
        state: 'v2',
      },
    });
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'resync' });
    client.close();
    const count = active.postMessage.mock.calls.length;
    emit('resync', new Date());
    expect(active.postMessage).toHaveBeenCalledTimes(count);
    expect(subscription.close).toHaveBeenCalledOnce();
  });

  it('closes a subscription that resolves after logout/close, without attaching observers', async () => {
    stubBrowser();
    const { storage, notificationsClient, subscription } = notificationHarness();
    let resolve!: (value: Subscription) => void;
    notificationsClient.subscribe = vi.fn(
      () =>
        new Promise<Subscription>((done) => {
          resolve = done;
        }),
    );
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { resources: [`${storage.root}doc`] },
    });
    await client.register();
    const signal = vi.mocked(notificationsClient.subscribe).mock.calls[0]?.[1]?.signal;
    client.close();
    expect(signal?.aborted).toBe(true);
    resolve(subscription);
    await vi.waitFor(() => expect(subscription.close).toHaveBeenCalledOnce());
    expect(subscription.on).not.toHaveBeenCalled();
  });

  it('subscribes once to deduplicated, scoped topics under the configured cap', async () => {
    stubBrowser();
    const { storage, notificationsClient, subscription } = notificationHarness();
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: {
        containers: [storage.root, storage.root, 'https://foreign.example/'],
        resources: [`${storage.root}doc`, `${storage.root}second`],
        maxChannels: 2,
        pollIntervalMs: 75,
      },
    });
    await client.register();
    await client.register();
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(2));
    expect(notificationsClient.subscribe).toHaveBeenCalledOnce();
    expect(notificationsClient.subscribe).toHaveBeenCalledWith(
      [storage.root, `${storage.root}doc`],
      { pollIntervalMs: 75, signal: expect.any(AbortSignal) },
    );
    client.close();
  });

  it('preserves the existing 50-topic cap and 60-second polling default', async () => {
    stubBrowser();
    const { storage, notificationsClient, subscription } = notificationHarness();
    const resources = Array.from({ length: 55 }, (_, index) => `${storage.root}doc-${index}`);
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { resources },
    });
    await client.register();
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(2));
    expect(notificationsClient.subscribe).toHaveBeenCalledWith(resources.slice(0, 50), {
      pollIntervalMs: 60_000,
      signal: expect.any(AbortSignal),
    });
    client.close();
  });

  it('derives opaque LWS container topics from a manual warm without a second crawl', async () => {
    stubBrowser();
    const storage = createMemoryStorage({
      protocol: 'lws',
      root: 'https://alice.example/',
      pageSize: 1,
    });
    const { notificationsClient, subscription } = notificationHarness();
    const read = vi.spyOn(storage, 'read');
    const client = createOfflineClient({
      webId: 'https://foreign.example/card#me',
      storage,
      notificationsClient,
      warm: { warmOnLogin: false, seeds: [storage.root] },
      notifications: true,
    });
    await client.register();
    expect(read).not.toHaveBeenCalled();
    await client.warm();
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(2));
    expect(notificationsClient.subscribe).toHaveBeenCalledWith([storage.root], expect.anything());
    expect(read.mock.calls.filter(([url]) => url === storage.root)).toHaveLength(1);
    client.close();
  });

  it('uses the shared polling client even when no browser push transport exists', async () => {
    stubBrowser();
    const storage = createMemoryStorage({ protocol: 'lws', root: 'https://alice.example/' });
    const client = createOfflineClient({
      storage,
      notifications: { containers: [storage.root], pollIntervalMs: 10 },
    });
    const head = vi.spyOn(storage, 'head');
    await client.register();
    await vi.waitFor(() => expect(head).toHaveBeenCalled());
    client.close();
  });
});

function notificationHarness() {
  const handlers = new Map<string, (value: unknown) => void>();
  const subscription = {
    on: vi.fn((name: string, handler: (value: unknown) => void) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }),
    close: vi.fn(async () => {}),
  } as unknown as Subscription & { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  const notificationsClient: NotificationsClient = {
    subscribe: vi.fn(async () => subscription),
    plan: () => ({ channel: 'poll', reason: 'test' }),
  };
  return {
    storage: createMemoryStorage({ protocol: 'lws', root: 'https://alice.example/' }),
    notificationsClient,
    subscription,
    emit: (name: string, value: unknown) => handlers.get(name)?.(value),
  };
}
