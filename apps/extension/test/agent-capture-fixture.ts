// AUTHORED-BY Codex GPT-6.1-Sol
import type { NativeResult } from '@jeswr/agent-vault/browser';
import { vi } from 'vitest';
import { installNativeVaultBridge } from '../src/background/agent-vault';
import type { CaptureIntent, CaptureView, VaultRequest } from '../src/shared/agent-capture';
import { CAPTURE_PERMISSION_PORT } from '../src/shared/agent-capture-permissions';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function event<T, Rest extends unknown[] = []>() {
  const listeners: ((input: T, ...rest: Rest) => void)[] = [];
  return {
    addListener: vi.fn((listener: (input: T, ...rest: Rest) => void) => {
      listeners.push(listener);
    }),
    emit: (input: T, ...rest: Rest) => {
      for (const listener of listeners) listener(input, ...rest);
    },
    clear: () => listeners.splice(0),
  };
}
function storageArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, structuredClone(values));
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
  };
}
export const site = 'https://shop.test';
export const cookie = (): chrome.cookies.Cookie => ({
  name: 'sid',
  value: 'fixture-cookie-secret',
  domain: 'shop.test',
  path: '/',
  hostOnly: true,
  httpOnly: true,
  secure: true,
  session: true,
  storeId: '0',
  sameSite: 'lax',
});
export function captureHarness(asynchronous = false) {
  const state = {
    cookies: false,
    origins: ['https://shop.test:443/*', 'https://other.test:443/*'],
  };
  const before = structuredClone(state);
  const native = vi.fn(async (request: VaultRequest): Promise<NativeResult> => {
    if (request.type === 'list')
      return {
        type: 'list',
        profiles: [{ id: 'personal', label: 'Personal' }],
        personas: [{ id: 'alex', profile: 'personal', label: 'Alex Example' }],
        cookieDomains: [],
      };
    if (request.type === 'beginLogin')
      return { type: 'beginLogin', token: '00000000-0000-4000-8000-000000000001' };
    return { type: 'capture' };
  });
  const nativePort = {
    onMessage: event<unknown>(),
    onDisconnect: event<undefined>(),
    disconnect: vi.fn(),
    postMessage: vi.fn((input: VaultRequest & { id: number }) => {
      void native(input).then(
        (result) => nativePort.onMessage.emit({ id: input.id, ok: true, result }),
        () => nativePort.onMessage.emit({ id: input.id, ok: false }),
      );
    }),
  };
  const permissions = {
    contains: vi.fn(async (input: chrome.permissions.Permissions) =>
      input.origins ? input.origins.every((o) => state.origins.includes(o)) : state.cookies,
    ),
    request: vi.fn(async (_input: chrome.permissions.Permissions) => {
      if (asynchronous) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      state.cookies = true;
      permissions.onAdded.emit({ permissions: ['cookies'] });
      return true;
    }),
    remove: vi.fn(async (_input: chrome.permissions.Permissions) => {
      state.cookies = false;
      return true;
    }),
    onAdded: event<chrome.permissions.Permissions>(),
    onRemoved: event<chrome.permissions.Permissions>(),
  };
  const runtime = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    getURL: (path: string) => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${path}`,
    onConnect: event<chrome.runtime.Port>(),
    onStartup: event<undefined>(),
    onInstalled: event<undefined>(),
    onMessage: { addListener: vi.fn() },
    connectNative: vi.fn(() => nativePort),
    lastError: undefined,
  };
  const browser = {
    runtime,
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: `${site}/account`, incognito: false }]),
      onActivated: event<{ tabId: number; windowId: number }>(),
      onUpdated: event<number, [{ url?: string }]>(),
    },
    windows: { onFocusChanged: event<number>() },
    storage: { session: storageArea(), local: storageArea() },
    permissions,
    cookies: { getAll: vi.fn(async () => [cookie()]) },
    action: { setBadgeText: vi.fn(async (_input: { text: string }) => {}) },
  };
  installNativeVaultBridge(browser as unknown as typeof chrome);
  const terminated: (() => void)[] = [];
  const popup = (sender = { id: runtime.id, url: runtime.getURL('popup/popup.html') }) => {
    let closed = false;
    const states: CaptureView[] = [];
    type Delivery = {
      direction: 'toWorker' | 'toPopup';
      message: CaptureIntent | CaptureView;
      deliver(): void;
    };
    const deliveries: Delivery[] = [];
    const held = new Map<Delivery['direction'], (message: Delivery['message']) => boolean>();
    const schedule = (delivery: Delivery) => {
      setTimeout(() => {
        if (!held.get(delivery.direction)?.(delivery.message)) delivery.deliver();
      }, 0);
    };
    const post = (
      direction: Delivery['direction'],
      message: Delivery['message'],
      receive: () => void,
    ) => {
      if (!asynchronous) {
        receive();
        return;
      }
      const delivery: Delivery = {
        direction,
        message: structuredClone(message),
        deliver: () => {
          const index = deliveries.indexOf(delivery);
          if (index < 0) return;
          deliveries.splice(index, 1);
          if (!closed) receive();
        },
      };
      deliveries.push(delivery);
      schedule(delivery);
    };
    const worker = {
      name: CAPTURE_PERMISSION_PORT,
      sender,
      onMessage: event<unknown>(),
      onDisconnect: event<undefined>(),
      postMessage: vi.fn((view: CaptureView) => {
        const snapshot = structuredClone(view);
        post('toPopup', snapshot, () => {
          states.push(snapshot);
          client.onMessage.emit(snapshot);
        });
      }),
      disconnect: vi.fn(() => {
        closed = true;
      }),
    };
    const client = {
      onMessage: event<CaptureView>(),
      onDisconnect: event<undefined>(),
      postMessage: vi.fn((intent: CaptureIntent) => {
        const snapshot = structuredClone(intent);
        if (!closed) post('toWorker', snapshot, () => worker.onMessage.emit(snapshot));
      }),
      disconnect: vi.fn(() => {
        if (closed) return;
        closed = true;
        worker.onDisconnect.emit(undefined);
        client.onDisconnect.emit(undefined);
      }),
    };
    runtime.onConnect.emit(worker as unknown as chrome.runtime.Port);
    terminated.push(() => {
      closed = true;
      // Worker termination discards ports/listeners without executing worker cleanup.
      worker.onMessage.clear();
      worker.onDisconnect.clear();
      client.onDisconnect.emit(undefined);
    });
    const popupBrowser = { ...browser, runtime: { ...runtime, connect: vi.fn(() => client) } };
    return {
      client,
      worker,
      states,
      browser: popupBrowser as unknown as typeof chrome,
      messages: {
        pending: deliveries,
        hold: (
          direction: Delivery['direction'],
          predicate: (message: Delivery['message']) => boolean = () => true,
        ) => held.set(direction, predicate),
        release: (direction: Delivery['direction']) => {
          held.delete(direction);
          for (const delivery of deliveries)
            if (delivery.direction === direction) schedule(delivery);
        },
        deliver: (index: number) => deliveries[index]?.deliver(),
      },
      get view() {
        return states.at(-1)!;
      },
      send: (intent: CaptureIntent) => client.postMessage(intent),
      load: () => client.postMessage({ type: 'load' }),
      start: () => client.postMessage({ type: 'start', profile: 'personal', persona: 'alex' }),
      allow: async () => {
        const lease = states.at(-1)!.lease!;
        if (
          states.at(-1)?.phase !== 'permission' ||
          states.at(-1)?.armedLease !== lease ||
          Date.now() >= states.at(-1)!.expiresAt!
        )
          return;
        client.postMessage({ type: 'requesting', lease });
        if (states.at(-1)?.phase !== 'permission' || states.at(-1)?.armedLease !== lease) return;
        try {
          client.postMessage({
            type: 'permission',
            lease,
            granted: await permissions.request({ permissions: ['cookies'] }),
          });
        } catch {
          client.postMessage({ type: 'permission', lease, granted: false });
        }
      },
      confirm: () => client.postMessage({ type: 'confirm', lease: states.at(-1)!.lease! }),
      cancel: () => client.postMessage({ type: 'cancel', lease: states.at(-1)!.lease! }),
    };
  };
  const restart = () => {
    // Restart tests use fake timers to discard the terminated worker's lease/native timers.
    vi.clearAllTimers();
    for (const terminate of terminated.splice(0)) terminate();
    runtime.onConnect.clear();
    runtime.onStartup.clear();
    runtime.onInstalled.clear();
    runtime.onMessage.addListener.mockClear();
    nativePort.onMessage.clear();
    nativePort.onDisconnect.clear();
    permissions.onAdded.clear();
    permissions.onRemoved.clear();
    browser.tabs.onActivated.clear();
    browser.tabs.onUpdated.clear();
    browser.windows.onFocusChanged.clear();
    installNativeVaultBridge(browser as unknown as typeof chrome);
  };
  return { browser, state, before, native, nativePort, popup, restart };
}
export type Harness = ReturnType<typeof captureHarness>;
export type Popup = ReturnType<Harness['popup']>;
export async function phase(popup: Popup, expected: CaptureView['phase']) {
  await vi.waitFor(
    () => {
      if (popup.view?.phase !== expected)
        throw new Error(`Expected ${expected}, got ${popup.view?.phase}: ${popup.view?.message}`);
    },
    { interval: 10, timeout: 2500 },
  );
}
export async function reviewing(h: Harness, popup = h.popup()) {
  popup.load();
  await phase(popup, 'ready');
  popup.start();
  await phase(popup, 'permission');
  return popup;
}
export async function confirming(h: Harness, popup?: Popup) {
  const owner = await reviewing(h, popup);
  await owner.allow();
  await phase(owner, 'confirming');
  return owner;
}
