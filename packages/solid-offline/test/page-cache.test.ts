// AUTHORED-BY Codex GPT-6

import type { NotificationsClient, Subscription } from '@jeswr/pod-notifications';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheProvenance,
  classifyResponse,
  computeVaryKey,
  isNeverCacheEndpoint,
  isPodCacheRequest,
  keyRequest,
} from '../src/cache-policy.js';
import { MetadataStore } from '../src/metadata-store.js';
import { createPageCache, type PageCache } from '../src/page-cache.js';
import { dbNameForWebId, scopeHash } from '../src/scope.js';
import type { OfflineEvent } from '../src/types.js';

vi.mock('@jeswr/storage-client', async (original) => ({
  ...(await original<typeof import('@jeswr/storage-client')>()),
  createPodClient: vi.fn(async (options: { storage: string; fetch: typeof globalThis.fetch }) => ({
    storage: createSolidBackend({ root: options.storage, fetch: options.fetch }),
  })),
}));

const root = 'https://pod.example/alice/';
const url = `${root}doc`;
const webId = `${root}profile#me`;
const cleanups: PageCache[] = [];
afterEach(() => {
  for (const cache of cleanups.splice(0)) cache.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(idb = new IDBFactory(), identity = webId) {
  let online = true;
  let live = true;
  let at = 100;
  const events: OfflineEvent[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response('body', { headers: { etag: 'v1', 'content-type': 'text/turtle' } }),
  );
  const make = () => {
    const cache = createPageCache({
      webId: identity,
      storageRoot: root,
      fetch,
      usable: () => live,
      indexedDB: idb,
      isOnline: () => online,
      now: () => at,
      onEvent: (event) => events.push(event),
    });
    cleanups.push(cache);
    return cache;
  };
  return {
    idb,
    fetch,
    events,
    make,
    cache: make(),
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    depart: () => {
      live = false;
    },
    advance: () => {
      at += 40_000;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('persists across adapter restarts, serves marked offline bytes, and never consults another account', async () => {
  const a = fixture();
  expect(cacheProvenance(await a.cache.fetch(url))).toBe('miss');
  a.cache.close();
  a.offline();
  const restored = a.make();
  const cached = await restored.fetch(url);
  expect(await cached.text()).toBe('body');
  expect(cacheProvenance(cached)).toBe('stale');
  expect(cached.headers.get('x-offline')).toBe('stale');
  expect(a.fetch).toHaveBeenCalledOnce();
  const b = fixture(a.idb, 'https://bob.example/#me');
  b.offline();
  b.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(b.cache.fetch(url)).rejects.toThrow('Offline');
});

it('has no offline hit without matching metadata and respects negative-cache expiry', async () => {
  const h = fixture();
  const store = await MetadataStore.open(webId, h.idb);
  await store.bytes.put(keyRequest(url, 'accept=text/turtle'), new Response('orphan'));
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
  h.online();
  h.fetch.mockResolvedValue(new Response('denied', { status: 403 }));
  await h.cache.fetch(url);
  h.offline();
  expect((await h.cache.fetch(url)).status).toBe(403);
  h.advance();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
  store.close();
});

it('awaits conditional validation online, replaces changed bytes and falls back only on transport failure', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  const next = deferred<Response>();
  h.fetch.mockImplementationOnce(() => next.promise);
  let served = false;
  const pending = h.cache.fetch(url).then((response) => {
    served = true;
    return response;
  });
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
  expect(served).toBe(false);
  expect(new Request(h.fetch.mock.calls[1]?.[0] as Request).headers.get('if-none-match')).toBe(
    'v1',
  );
  next.resolve(new Response(null, { status: 304 }));
  expect(cacheProvenance(await pending)).toBe('hit');
  h.fetch.mockResolvedValueOnce(new Response('new', { headers: { etag: 'v2' } }));
  expect(await (await h.cache.fetch(url)).text()).toBe('new');
  h.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  expect(await (await h.cache.fetch(url)).text()).toBe('new');
  h.fetch.mockRejectedValue(new Error('Sign in to continue'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Sign in');
});

it.each([
  401, 403, 404, 500,
])('does not substitute positive cached data for HTTP %s', async (status) => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockResolvedValue(new Response('error', { status }));
  expect((await h.cache.fetch(url)).status).toBe(status);
});

it.each([
  'no-store',
  'private',
])('evicts previous bytes when a response becomes %s', async (policy) => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockResolvedValueOnce(new Response('fresh', { headers: { 'cache-control': policy } }));
  await h.cache.fetch(url);
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
});

it.each([
  { cache: 'no-store' },
  { headers: { 'cache-control': 'no-store' } },
  { cache: 'no-cache' },
  { cache: 'reload' },
  { headers: { 'cache-control': 'no-cache' } },
] satisfies RequestInit[])('never turns explicit freshness or no-store into stale success: %j', async (init) => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url, init)).rejects.toThrow();
  h.offline();
  await expect(h.cache.fetch(url, init)).rejects.toThrow();
});

it('does not store request secrets or credential-bearing Vary, and strips sensitive response headers', async () => {
  const h = fixture();
  h.fetch.mockResolvedValue(
    new Response('safe', {
      headers: { Authorization: 'response-secret', DPoP: 'proof', 'Set-Cookie': 'session' },
    }),
  );
  await h.cache.fetch(url, { headers: { Authorization: 'request-secret', DPoP: 'request-proof' } });
  const store = await MetadataStore.open(webId, h.idb);
  expect(JSON.stringify(await store.getAll())).not.toMatch(/secret|proof/);
  const bytes = await store.bytes.match(keyRequest(url, 'accept=text/turtle'));
  expect([...(bytes?.headers ?? [])]).not.toEqual(
    expect.arrayContaining([expect.arrayContaining(['authorization'])]),
  );
  expect(bytes?.headers.has('dpop')).toBe(false);
  expect(bytes?.headers.has('set-cookie')).toBe(false);
  h.fetch.mockResolvedValue(new Response('secret', { headers: { Vary: 'Authorization' } }));
  await h.cache.fetch(url);
  expect(await store.getAll()).toEqual([]);
  store.close();
});

it.each([
  `${root}token`,
  `${root}%74oken`,
  `${root}credentials`,
  `${root}doc?access_token=secret`,
  `${root}doc?code=secret`,
  'https://pod.example/bob/doc',
  'https://other.example/doc',
])('passes %s through without a cache or provenance', async (target) => {
  const h = fixture();
  const response = await h.cache.fetch(target);
  expect(cacheProvenance(response)).toBeNull();
  expect(await h.idb.databases()).toEqual([]);
});

it('passes mutations, HEAD, range and upgrade reads through without caching', async () => {
  const h = fixture();
  for (const init of [
    { method: 'POST', body: 'write' },
    { method: 'HEAD' },
    { headers: { range: 'bytes=0-1' } },
    { headers: { upgrade: 'websocket' } },
  ] as RequestInit[])
    expect(cacheProvenance(await h.cache.fetch(url, init))).toBeNull();
  const store = await MetadataStore.open(webId, h.idb);
  expect(await store.getAll()).toEqual([]);
  store.close();
});

it('purges the shared database on logout, fences immediately, and cannot repopulate from a late read', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  const late = deferred<Response>();
  h.fetch.mockImplementationOnce(() => late.promise);
  const pending = h.cache.fetch(url);
  const rejected = expect(pending).rejects.toThrow('Sign in');
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
  const purged = h.cache.logout();
  await expect(h.cache.fetch(url)).rejects.toThrow('Sign in');
  expect((await purged).dbDeleted).toBe(true);
  late.resolve(new Response('late private body'));
  await rejected;
  expect(await h.idb.databases()).toEqual([]);
});

it('checks the live account after an IndexedDB lookup, including an uncommitted switch', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  h.offline();
  const original = MetadataStore.prototype.getByUrl;
  const waiting = deferred<void>();
  const entered = deferred<void>();
  vi.spyOn(MetadataStore.prototype, 'getByUrl').mockImplementation(async function (
    this: MetadataStore,
    value,
  ) {
    const rows = await original.call(this, value);
    entered.resolve();
    await waiting.promise;
    return rows;
  });
  const pending = h.cache.fetch(url);
  const rejected = expect(pending).rejects.toThrow('Sign in');
  await entered.promise;
  h.depart();
  waiting.resolve();
  await rejected;
});

it('checks live account fences on network success, network failure, and aborted reads', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockImplementationOnce(async () => {
    h.depart();
    throw new TypeError('Offline');
  });
  await expect(h.cache.fetch(url)).rejects.toThrow('Sign in');
  const a = fixture();
  a.fetch.mockImplementationOnce(async () => {
    a.depart();
    return new Response('late');
  });
  await expect(a.cache.fetch(url)).rejects.toThrow('Sign in');
  const b = fixture();
  await b.cache.fetch(url);
  const aborted = AbortSignal.abort();
  await expect(b.cache.fetch(url, { signal: aborted })).rejects.toThrow();
});

it('shares deletion, change, membership and resync invalidation with the worker pipeline', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  await h.cache.notify({ type: 'Update', object: url, state: 'v1' });
  expect(h.fetch).toHaveBeenCalledOnce();
  await h.cache.notify({ type: 'Delete', object: 'https://foreign.example/doc' });
  await h.cache.notify({ type: 'Delete', object: url });
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
});

it('closes late subscriptions and wires change/resync callbacks without another auth session', async () => {
  const listeners = new Map<string, (event: never) => void>();
  const closed = vi.fn(async () => {});
  const subscription = {
    on: (event: string, callback: (event: never) => void) => {
      listeners.set(event, callback);
      return () => {};
    },
    close: closed,
  } as unknown as Subscription;
  const client = { subscribe: vi.fn(async () => subscription) } as unknown as NotificationsClient;
  const h = fixture();
  const cache = createPageCache({
    webId,
    storageRoot: root,
    usable: () => true,
    fetch: h.fetch,
    indexedDB: h.idb,
    notificationsClient: client,
  });
  cleanups.push(cache);
  await cache.start();
  expect(client.subscribe).toHaveBeenCalledOnce();
  const notify = vi.spyOn(cache, 'notify').mockResolvedValue();
  const resync = vi.spyOn(cache, 'resync').mockResolvedValue();
  listeners.get('change')?.({ type: 'Delete', object: url } as never);
  listeners.get('resync')?.(new Date() as never);
  listeners.get('state')?.('live' as never);
  expect(notify).toHaveBeenCalledOnce();
  expect(resync).toHaveBeenCalledTimes(2);
  cache.close();
  expect(closed).toHaveBeenCalledOnce();
  const late = deferred<Subscription>();
  vi.mocked(client.subscribe).mockReturnValueOnce(late.promise);
  const other = createPageCache({
    webId,
    storageRoot: root,
    usable: () => true,
    fetch: h.fetch,
    notificationsClient: client,
  });
  const starting = other.start();
  other.close();
  late.resolve(subscription);
  await starting;
  expect(closed).toHaveBeenCalledTimes(2);
});

it('degrades to authenticated network when IndexedDB is unavailable', async () => {
  const h = fixture();
  vi.spyOn(h.idb, 'open').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  expect(await (await h.cache.fetch(url)).text()).toBe('body');
});

describe('shared policy adversarial inputs', () => {
  it.each([
    'file:///doc',
    'https://user:secret@pod.example/doc',
    `${url}?refresh_token=secret`,
    `${root}%ZZ`,
  ])('rejects unsafe URL %s', (target) => expect(isNeverCacheEndpoint(target)).toBe(true));
  it.each([
    'Authorization',
    'Cookie',
    'DPoP',
    'proxy-authorization',
    'Set-Cookie',
  ])('never keys on %s', (field) => {
    const request = new Request(url, { headers: { [field]: 'secret' } });
    const response = new Response('body', { headers: { vary: field } });
    expect(classifyResponse(request, response).cacheable).toBe(false);
    expect(computeVaryKey(request, response)).not.toContain('secret');
  });
  it('rejects redirected and partial responses and uses the storage boundary', () => {
    const request = new Request(url);
    expect(
      classifyResponse(request, { status: 200, headers: new Headers(), redirected: true })
        .cacheable,
    ).toBe(false);
    expect(classifyResponse(request, new Response('part', { status: 206 })).cacheable).toBe(false);
    const storage = createSolidBackend({ root, fetch: globalThis.fetch });
    expect(isPodCacheRequest(new Request(`${root}../bob/doc`), storage.isWithinStorage)).toBe(
      false,
    );
  });
  it('keeps distinct identities isolated even across a known FNV-1a collision', () => {
    const first = 'https://pod.example/#549599';
    const second = 'https://pod.example/#712382';
    expect(scopeHash(first)).toBe(scopeHash(second));
    expect(dbNameForWebId(first)).not.toBe(dbNameForWebId(second));
  });
});

it('replaces changed reads and listings and reconciles with conditional observations', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  await h.cache.fetch(root);
  h.fetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    return new Response(request.method === 'HEAD' ? null : 'changed', {
      headers: { etag: 'v2', 'content-type': 'text/turtle' },
    });
  });
  await h.cache.notify({ type: 'Update', object: url, state: 'v2' });
  await h.cache.notify({ type: 'Add', object: url, target: root });
  await h.cache.resync();
  h.offline();
  expect(await (await h.cache.fetch(url)).text()).toBe('changed');
  expect(await (await h.cache.fetch(root)).text()).toBe('changed');
});

it('fences an old online read after a notification while it waits for the network', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  const late = deferred<Response>();
  h.fetch.mockImplementationOnce(() => late.promise);
  const pending = h.cache.fetch(url);
  const rejected = expect(pending).rejects.toThrow('cache changed');
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
  await h.cache.notify({ type: 'Delete', object: url });
  late.resolve(new Response('obsolete'));
  await rejected;
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
});

it('cannot overwrite newer validated bytes when an obsolete body finishes buffering', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  const buffering = deferred<void>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  h.fetch.mockResolvedValueOnce(
    new Response(
      new ReadableStream<Uint8Array>(
        {
          start(controller) {
            stream = controller;
          },
          pull() {
            buffering.resolve();
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { etag: 'obsolete' } },
    ),
  );
  const pending = h.cache.fetch(url);
  const rejected = expect(pending).rejects.toThrow('cache changed');
  await buffering.promise;
  await h.cache.notify({ type: 'Delete', object: url });
  h.fetch.mockResolvedValueOnce(new Response('new bytes', { headers: { etag: 'v2' } }));
  expect(await (await h.cache.fetch(url)).text()).toBe('new bytes');
  stream.enqueue(new TextEncoder().encode('obsolete bytes'));
  stream.close();
  await rejected;
  h.fetch.mockImplementationOnce(async (input, init) => {
    expect(new Request(input, init).headers.get('if-none-match')).toBe('v2');
    return new Response(null, { status: 304 });
  });
  const confirmed = await h.cache.fetch(url);
  expect(cacheProvenance(confirmed)).toBe('hit');
  expect(await confirmed.text()).toBe('new bytes');
});

it.each([
  undefined,
  'v1',
])('emits changes only for a changed cached representation (ETag %s)', async (etag) => {
  const h = fixture();
  const respond = (body: string, validator = etag) =>
    new Response(body, { headers: validator ? { etag: validator } : {} });
  h.fetch.mockImplementation(async () => respond('same'));
  await h.cache.fetch(url);
  await h.cache.fetch(url);
  expect(h.events.filter((event) => event.event === 'updated')).toEqual([]);
  h.fetch.mockImplementation(async () => respond('changed'));
  await h.cache.fetch(url);
  expect(h.events.filter((event) => event.event === 'updated')).toHaveLength(1);
  await h.cache.fetch(url);
  expect(h.events.filter((event) => event.event === 'updated')).toHaveLength(1);
  h.fetch.mockImplementation(async () => respond('changed', 'v2'));
  await h.cache.fetch(url);
  expect(h.events.filter((event) => event.event === 'updated')).toHaveLength(2);
});

it('evicts prior bytes even when comparing a fresh body exceeds the cache budget', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockResolvedValueOnce(
    new Response('fresh', {
      headers: {
        etag: 'v1',
        'content-type': 'text/turtle',
        'content-length': String(26 * 1024 * 1024),
      },
    }),
  );
  expect(await (await h.cache.fetch(url)).text()).toBe('fresh');
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
});

it.each([
  { type: 'Update', object: `${root}unrelated`, state: 'v2' },
  { type: 'Delete', object: `${root}unrelated` },
  { type: 'Update', object: url, state: 'v1' },
  { type: 'Delete', object: 'https://foreign.example/doc' },
] as const)('keeps a pending read valid during an unrelated or no-op notification: %j', async (frame) => {
  const h = fixture();
  await h.cache.fetch(url);
  await h.cache.fetch(`${root}unrelated`);
  const late = deferred<Response>();
  h.fetch.mockImplementationOnce(() => late.promise);
  const pending = h.cache.fetch(url);
  const settled = pending.then((response) => response.text());
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(3));
  await h.cache.notify(frame);
  late.resolve(new Response('current bytes', { headers: { etag: 'v2' } }));
  await expect(settled).resolves.toBe('current bytes');
});

it.each([
  'Add',
  'Remove',
  'Create',
  'Delete',
  'Move',
] as const)('fences a pending membership read on %s even when the member is uncached', async (type) => {
  const h = fixture();
  await h.cache.fetch(root);
  const late = deferred<Response>();
  h.fetch.mockImplementationOnce(() => late.promise);
  const pending = h.cache.fetch(root);
  const rejected = expect(pending).rejects.toThrow('cache changed');
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
  await h.cache.notify({ type, object: url, target: root, origin: root });
  late.resolve(new Response('obsolete listing'));
  await rejected;
});

it('preserves the network answer when body persistence fails and rejects a missing account', async () => {
  const h = fixture();
  const replace = vi
    .spyOn(MetadataStore.prototype, 'replace')
    .mockRejectedValueOnce(new Error('Quota'));
  expect(await (await h.cache.fetch(url)).text()).toBe('body');
  expect(replace).toHaveBeenCalledOnce();
  const store = await MetadataStore.open(webId, h.idb);
  expect(await store.getAll()).toEqual([]);
  store.close();
  expect(() =>
    createPageCache({ webId: '', storageRoot: root, fetch: h.fetch, usable: () => true }),
  ).toThrow('account');
});

it('does not turn a cache failure during a 304 into an unvalidated success', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockResolvedValue(new Response(null, { status: 304 }));
  vi.spyOn(MetadataStore.prototype, 'touch').mockRejectedValue(new Error('Disk'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Disk');
});

it('retains language variants and non-body status responses in IndexedDB', async () => {
  const h = fixture();
  h.fetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    return new Response(request.headers.get('accept-language'), {
      headers: { vary: 'Accept-Language' },
    });
  });
  await h.cache.fetch(url, { headers: { 'accept-language': 'en' } });
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url, { headers: { 'accept-language': 'fr' } })).rejects.toThrow();
  expect(await (await h.cache.fetch(url, { headers: { 'accept-language': 'en' } })).text()).toBe(
    'en',
  );
  h.online();
  h.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  await h.cache.fetch(url);
  h.offline();
  expect((await h.cache.fetch(url)).status).toBe(204);
});

it('skips subscription setup offline and retries setup errors on a later start', async () => {
  const h = fixture();
  h.offline();
  const client = {
    subscribe: vi.fn().mockRejectedValue(new Error('Offline')),
  } as unknown as NotificationsClient;
  const cache = createPageCache({
    webId,
    storageRoot: root,
    fetch: h.fetch,
    usable: () => true,
    indexedDB: h.idb,
    isOnline: () => false,
    notificationsClient: client,
  });
  cleanups.push(cache);
  await cache.start();
  expect(client.subscribe).not.toHaveBeenCalled();
  const other = createPageCache({
    webId,
    storageRoot: root,
    fetch: h.fetch,
    usable: () => true,
    indexedDB: h.idb,
    notificationsClient: client,
  });
  cleanups.push(other);
  await other.start();
  await other.start();
  expect(client.subscribe).toHaveBeenCalledTimes(2);
});

it('watches cached and newly read resources, bounds duplicate topics, and closes hot subscriptions', async () => {
  const h = fixture();
  await h.cache.fetch(url);
  h.cache.close();
  const close = vi.fn(async () => {});
  const listeners: ((frame: never) => void)[] = [];
  const subscribe = vi.fn(
    async () =>
      ({
        on: (_event: string, callback: (frame: never) => void) => {
          listeners.push(callback);
          return () => {};
        },
        close,
      }) as unknown as Subscription,
  );
  const client = { subscribe } as unknown as NotificationsClient;
  const cache = createPageCache({
    webId,
    storageRoot: root,
    fetch: h.fetch,
    usable: () => true,
    indexedDB: h.idb,
    notificationsClient: client,
    onEvent: () => {
      throw new Error('Broken observer');
    },
  });
  cleanups.push(cache);
  await cache.start();
  await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
  await cache.fetch(`${root}other`);
  await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(3));
  await cache.fetch(`${root}other`);
  expect(subscribe).toHaveBeenCalledTimes(3);
  cache.close();
  expect(close).toHaveBeenCalledTimes(3);
});

it('shares worker-written IndexedDB bytes with the page adapter', async () => {
  vi.resetModules();
  const idb = new IDBFactory();
  const handlers = new Map<string, (event: unknown) => void>();
  vi.stubGlobal('indexedDB', idb);
  vi.stubGlobal('self', {
    addEventListener: (type: string, callback: (event: unknown) => void) =>
      handlers.set(type, callback),
    navigator: { onLine: true },
    fetch: async () => new Response('worker bytes', { headers: { etag: 'w1' } }),
  });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage() {}
      close() {}
    },
  );
  await import('../src/worker.js');
  handlers.get('message')?.({
    data: { type: 'config', config: { webId, storageRoot: root } },
    source: { postMessage() {} },
  });
  let response!: Promise<Response>;
  handlers.get('fetch')?.({
    request: new Request(url),
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(await (await response).text()).toBe('worker bytes');
  const page = createPageCache({
    webId,
    storageRoot: root,
    usable: () => true,
    indexedDB: idb,
    isOnline: () => false,
    fetch: vi.fn(async () => {
      throw new TypeError('Offline');
    }),
  });
  cleanups.push(page);
  expect(await (await page.fetch(url)).text()).toBe('worker bytes');
  await page.logout();
  // A same-account login must also reopen the worker handle closed by logout.
  handlers.get('message')?.({
    data: { type: 'config', config: { webId, storageRoot: root } },
    source: { postMessage() {} },
  });
  handlers.get('fetch')?.({
    request: new Request(url),
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(await (await response).text()).toBe('worker bytes');
  const reopened = await MetadataStore.open(webId, idb);
  expect(await reopened.getByUrl(url)).toHaveLength(1);
  reopened.close();
  handlers.get('message')?.({ data: { type: 'config', config: {} }, source: { postMessage() {} } });
});

it('cannot repopulate IndexedDB when logout happens while response bytes are still buffering', async () => {
  const h = fixture();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const entered = deferred<void>();
  h.fetch.mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          entered.resolve();
        },
      }),
    ),
  );
  const pending = h.cache.fetch(url);
  const rejected = expect(pending).rejects.toThrow('Sign in');
  await entered.promise;
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
  const purged = await h.cache.logout();
  expect(purged.dbDeleted).toBe(true);
  stream.enqueue(new TextEncoder().encode('late body'));
  stream.close();
  await rejected;
  expect(await h.idb.databases()).toEqual([]);
});

it('treats private field directives as uncacheable and evicts cached bytes after 401', async () => {
  const request = new Request(url);
  expect(
    classifyResponse(
      request,
      new Response('body', { headers: { 'cache-control': 'private="Authorization"' } }),
    ).cacheable,
  ).toBe(false);
  const h = fixture();
  await h.cache.fetch(url);
  h.fetch.mockResolvedValue(new Response('sign in', { status: 401 }));
  await h.cache.fetch(url);
  h.offline();
  h.fetch.mockRejectedValue(new TypeError('Offline'));
  await expect(h.cache.fetch(url)).rejects.toThrow('Offline');
});

it('removes old hash-only databases and byte caches as part of logout', async () => {
  const h = fixture();
  const { DB_PREFIX, CACHE_PREFIX } = await import('../src/scope.js');
  const legacyName = `${DB_PREFIX}${scopeHash(webId)}`;
  const legacy = await MetadataStore.openNamed(legacyName, h.idb);
  legacy.close();
  const remove = vi.fn(async () => true);
  vi.stubGlobal('caches', { delete: remove });
  await h.cache.fetch(url);
  await h.cache.logout();
  expect(remove).toHaveBeenCalledWith(`${CACHE_PREFIX}${scopeHash(webId)}`);
  expect(await h.idb.databases()).toEqual([]);
});

it('skips oversized declared bodies before reading, without blocking the caller stream', async () => {
  const h = fixture();
  let pulls = 0;
  h.fetch.mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array([42]));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-length': String(26 * 1024 * 1024) } },
    ),
  );
  const response = await h.cache.fetch(url);
  expect(pulls).toBeLessThanOrEqual(1);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([42]);
  const store = await MetadataStore.open(webId, h.idb);
  expect(await store.getAll()).toEqual([]);
  store.close();
});

it('bounds actual cached bytes even when Content-Length is absent or dishonest', async () => {
  const h = fixture();
  let count = 0;
  h.fetch.mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (count++ < 26) controller.enqueue(new Uint8Array(1024 * 1024));
            else controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-length': '1' } },
    ),
  );
  const response = await h.cache.fetch(url);
  expect(response.status).toBe(200);
  // The bounded branch never writes a metadata record for the oversized body.
  const store = await MetadataStore.open(webId, h.idb);
  expect(await store.getAll()).toEqual([]);
  store.close();
  await response.arrayBuffer();
});
