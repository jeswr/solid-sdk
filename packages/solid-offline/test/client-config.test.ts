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
    const posted = active.postMessage.mock.calls[0]![0];
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
