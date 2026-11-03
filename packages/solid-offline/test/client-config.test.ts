// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationsClient, Subscription } from '@jeswr/pod-notifications';
import { createLwsBackend } from '@jeswr/storage-client/lws';
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
  const active: FakeSW = {
    postMessage: vi.fn((message, ports?: MessagePort[]) => {
      if (message.type !== 'warm-start') return;
      const port = ports?.[0];
      if (!port) return;
      port.onmessage = ({ data }) => {
        port.postMessage({ id: data.id, snapshot: { bytes: 0, budgetHit: false } });
        if (data.type === 'close') port.close();
      };
      port.postMessage({ id: 0, snapshot: { bytes: 0, budgetHit: false } });
    }),
  };
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
  vi.useRealTimers();
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

describe('first-install automatic warming', () => {
  it.each([
    'solid',
    'lws',
  ] as const)('waits for a configured %s controller, then warms children and derives topics once', async (protocol) => {
    const { active, swContainer, controllerListeners } = stubBrowser();
    const installing = makeInstallingWorker();
    installing.postMessage = active.postMessage;
    swContainer.register.mockResolvedValue({
      active: null,
      installing,
      waiting: null,
    } as unknown as ServiceWorkerRegistration);
    (swContainer as { controller: unknown }).controller = null;
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (task: () => void) => idle.push(task));
    const storage = createMemoryStorage({ protocol, root: 'https://alice.example/' });
    const child = (await storage.create(storage.root, 'child bytes', { contentType: 'text/plain' }))
      .url;
    const read = vi.spyOn(storage, 'read');
    const { notificationsClient } = notificationHarness();
    const client = createOfflineClient({
      storage,
      webId: `${storage.root}profile#me`,
      warm: { seeds: [storage.root] },
      notifications: true,
      notificationsClient,
    });
    try {
      await client.register();
      expect(idle).toHaveLength(0);
      expect(read).not.toHaveBeenCalled();
      // Activation alone does not make page fetches interceptable.
      installing.state = 'activated';
      installing.fireStateChange();
      await vi.waitFor(() => expect(active.postMessage).toHaveBeenCalled());
      expect(idle).toHaveLength(0);

      swContainer.controller = installing;
      const changed = () => {
        for (const listener of controllerListeners.get('controllerchange') ?? []) listener();
      };
      changed();
      await vi.waitFor(() => expect(idle).toHaveLength(1));
      changed();
      await Promise.resolve();
      await Promise.resolve();
      expect(idle).toHaveLength(1);
      expect(read).not.toHaveBeenCalled();
      expect(active.postMessage.mock.calls.every(([message]) => message.type === 'config')).toBe(
        true,
      );
      idle[0]?.();
      await vi.waitFor(() => expect(notificationsClient.subscribe).toHaveBeenCalledOnce());
      expect(read.mock.calls.filter(([url]) => url === child)).toHaveLength(1);
      expect(notificationsClient.subscribe).toHaveBeenCalledWith([storage.root], expect.anything());
    } finally {
      client.close();
    }
  });

  it('keeps automatic warming disabled when control arrives with warmOnLogin false', async () => {
    const { active, swContainer, controllerListeners } = stubBrowser();
    (swContainer as { controller: unknown }).controller = null;
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    const storage = createMemoryStorage({ protocol: 'solid', root: 'https://alice.example/' });
    const read = vi.spyOn(storage, 'read');
    const client = createOfflineClient({
      storage,
      webId: `${storage.root}profile#me`,
      warm: { seeds: [storage.root], warmOnLogin: false },
    });
    try {
      await client.register();
      swContainer.controller = active;
      for (const listener of controllerListeners.get('controllerchange') ?? []) listener();
      await Promise.resolve();
      await Promise.resolve();
      expect(idle).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect((await client.warm())?.warmed).toBe(1);
    } finally {
      client.close();
    }
  });

  it.each([
    false,
    true,
  ])('waits for controller configuration (closed during discovery: %s)', async (closeDuringDiscovery) => {
    const { active, swContainer, controllerListeners } = stubBrowser();
    (swContainer as { controller: unknown }).controller = null;
    swContainer.register.mockResolvedValue({ active: null } as ServiceWorkerRegistration);
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    const storage = createMemoryStorage({ protocol: 'lws', root: 'https://alice.example/' });
    let finish: (() => void) | undefined;
    const head = storage.head.bind(storage);
    vi.spyOn(storage, 'head').mockImplementation(async (url, opts) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return head(url, opts);
    });
    const read = vi.spyOn(storage, 'read');
    const client = createOfflineClient({
      storage,
      webId: `${storage.root}profile#me`,
      warm: { seeds: [storage.root] },
    });
    try {
      await client.register();
      const listener = [...(controllerListeners.get('controllerchange') ?? [])][0];
      swContainer.controller = active;
      listener?.();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(idle).not.toHaveBeenCalled();
      expect(active.postMessage).not.toHaveBeenCalled();
      if (closeDuringDiscovery) client.close();
      finish?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (closeDuringDiscovery) {
        listener?.(); // A queued lifecycle callback must also respect close().
        expect(idle).not.toHaveBeenCalled();
        expect(active.postMessage).not.toHaveBeenCalled();
      } else {
        expect(idle).toHaveBeenCalledOnce();
        expect(active.postMessage).toHaveBeenCalledOnce();
        expect(active.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'config' }),
        );
      }
      expect(read).not.toHaveBeenCalled();
    } finally {
      client.close();
    }
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
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(3));
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
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(3));
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
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(3));
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
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(3));
    expect(notificationsClient.subscribe).toHaveBeenCalledWith([storage.root], expect.anything());
    expect(read.mock.calls.filter(([url]) => url === storage.root)).toHaveLength(1);
    client.close();
  });

  it('sweeps while push connects or degrades, stops while live, and releases its timer on close', async () => {
    vi.useFakeTimers();
    const { active } = stubBrowser();
    const { storage, notificationsClient, subscription, emit } = notificationHarness();
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { containers: [storage.root], pollIntervalMs: 100 },
    });
    await client.register();
    expect(subscription.on).toHaveBeenCalledTimes(3);
    active.postMessage.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(active.postMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'poll' }]);
    emit('state', 'degraded');
    emit('state', 'degraded');
    await vi.advanceTimersByTimeAsync(100);
    expect(active.postMessage).toHaveBeenCalledTimes(2);
    emit('state', 'live');
    expect(active.postMessage).toHaveBeenLastCalledWith({ type: 'resync' });
    active.postMessage.mockClear();
    await vi.advanceTimersByTimeAsync(300);
    expect(active.postMessage).not.toHaveBeenCalled();
    emit('state', 'degraded');
    await vi.advanceTimersByTimeAsync(100);
    expect(active.postMessage).toHaveBeenCalledOnce();
    expect(active.postMessage).toHaveBeenLastCalledWith({ type: 'poll' });
    client.close();
    emit('state', 'degraded');
    await vi.advanceTimersByTimeAsync(300);
    expect(active.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'connecting',
    'live',
  ] as const)('sweeps on first live even when subscribe resolves %s', async (initial) => {
    const { active } = stubBrowser();
    const { storage, notificationsClient, subscription, emit } = notificationHarness();
    Object.assign(subscription, { state: initial });
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { resources: [`${storage.root}doc`] },
    });
    await client.register();
    await vi.waitFor(() => expect(subscription.on).toHaveBeenCalledTimes(3));
    if (initial === 'connecting') {
      expect(
        active.postMessage.mock.calls.filter(([message]) => message.type === 'resync'),
      ).toHaveLength(0);
      emit('state', 'live');
    }
    expect(
      active.postMessage.mock.calls.filter(([message]) => message.type === 'resync'),
    ).toHaveLength(1);
    emit('state', 'degraded');
    emit('state', 'live');
    emit('resync', new Date());
    expect(
      active.postMessage.mock.calls.filter(([message]) => message.type === 'resync'),
    ).toHaveLength(2);
    client.close();
  });

  it('honors disabled polling and stops polling when a subscription closes', async () => {
    vi.useFakeTimers();
    const { active } = stubBrowser();
    const { storage, notificationsClient, emit } = notificationHarness();
    const client = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { containers: [storage.root], pollIntervalMs: 0 },
    });
    await client.register();
    active.postMessage.mockClear();
    emit('state', 'degraded');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(active.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    client.close();

    const fallback = createOfflineClient({
      storage,
      notificationsClient,
      notifications: { containers: [storage.root] },
    });
    await fallback.register();
    emit('state', 'degraded');
    expect(vi.getTimerCount()).toBe(1);
    emit('state', 'closed');
    expect(vi.getTimerCount()).toBe(0);
    fallback.close();
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
    state: 'connecting',
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
    emit: (name: string, value: unknown) => {
      if (name === 'state') Object.assign(subscription, { state: value });
      handlers.get(name)?.(value);
    },
  };
}

it('sends cloneable LWS backend identity using authenticated page evidence', async () => {
  const { active } = stubBrowser();
  const root = 'https://alice.example/';
  const id = `${root}description`;
  const pageFetch = vi.fn(
    async () =>
      new Response(null, {
        headers: {
          link: `<${id}>; rel="https://www.w3.org/ns/lws#storage"`,
        },
      }),
  );
  const client = createOfflineClient({
    storage: createLwsBackend({ root, storage: id, fetch: pageFetch }),
  });
  await client.register();
  const posted = active.postMessage.mock.calls[0]?.[0];
  expect(posted.config.storageBackend).toEqual({ protocol: 'lws', id });
  expect(() => structuredClone(posted)).not.toThrow();
  expect(posted.config.storage).toBeUndefined();
  expect(pageFetch).toHaveBeenCalledOnce();
  client.close();
});

it('does not attach lifecycle listeners if closed during backend metadata resolution', async () => {
  const { active, controllerListeners } = stubBrowser();
  let finish: ((response: Response) => void) | undefined;
  const root = 'https://alice.example/';
  const storage = createLwsBackend({
    root,
    fetch: async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  });
  const client = createOfflineClient({ storage });
  const registering = client.register();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  client.close();
  finish?.(new Response(null));
  await registering;
  expect(active.postMessage).not.toHaveBeenCalled();
  expect(controllerListeners.size).toBe(0);
});

it('serializes a known Solid backend without probing the storage root', async () => {
  const { active } = stubBrowser();
  const storage = createMemoryStorage({ protocol: 'solid', root: 'https://alice.example/' });
  const head = vi.spyOn(storage, 'head');
  const client = createOfflineClient({ storage });
  await client.register();
  expect(active.postMessage.mock.calls[0]?.[0].config.storageBackend).toEqual({
    protocol: 'solid',
  });
  expect(head).not.toHaveBeenCalled();
  client.close();
});

it('keeps LWS identity unknown when the page supplies no identity evidence', async () => {
  const { active } = stubBrowser();
  const storage = createMemoryStorage({ protocol: 'lws', root: 'https://alice.example/' });
  const client = createOfflineClient({ storage });
  await client.register();
  expect(active.postMessage.mock.calls[0]?.[0].config.storageBackend).toBeUndefined();
  client.close();
});
