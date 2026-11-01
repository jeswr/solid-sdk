// AUTHORED-BY Codex GPT-6.1-Sol
/** Worker event adapter coverage; real-browser lifecycle smoke remains a separate check. */
import { createPodClient, type PodClient } from '@jeswr/storage-client';
import { createLwsBackend } from '@jeswr/storage-client/lws';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { afterEach, expect, it, vi } from 'vitest';
import { keyRequest } from '../src/cache-policy.js';
import { MetadataStore } from '../src/metadata-store.js';
import { cacheNameForWebId } from '../src/scope.js';
import type { PageToWorkerMessage } from '../src/types.js';
import { MockByteCache, turtleResponse } from './mocks.js';

vi.mock('@jeswr/storage-client', async (original) => ({
  ...(await original<typeof import('@jeswr/storage-client')>()),
  createPodClient: vi.fn(),
}));

const stores: MetadataStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('routes notification/resync messages through credential-free storage and the configured WebID stores', async () => {
  const root = 'https://alice.example/';
  const url = `${root}doc`;
  const alice = `https://alice.example/profile#${Math.random()}`;
  const bob = `https://bob.example/profile#${Math.random()}`;
  const buckets = new Map<string, MockByteCache>();
  const messages: unknown[] = [];
  const requests: Request[] = [];
  const handlers = new Map<
    string,
    (event: {
      data: PageToWorkerMessage;
      source: { postMessage: ReturnType<typeof vi.fn> };
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void
  >();
  const self = {
    addEventListener: (
      type: string,
      callback: (event: {
        data: PageToWorkerMessage;
        source: { postMessage: ReturnType<typeof vi.fn> };
        waitUntil: (promise: Promise<unknown>) => void;
      }) => void,
    ) => handlers.set(type, callback),
    caches: {
      open: vi.fn(async (name: string) => {
        let cache = buckets.get(name);
        if (!cache) {
          cache = new MockByteCache();
          buckets.set(name, cache);
        }
        return cache;
      }),
    },
    navigator: { onLine: true },
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return turtleResponse(request.method === 'HEAD' ? '' : 'fresh', {
        etag: request.method === 'HEAD' ? 'v1' : 'v2',
      });
    }),
  };
  vi.stubGlobal('self', self);
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage(message: unknown) {
        messages.push(message);
      }
      close() {}
    },
  );
  vi.mocked(createPodClient).mockImplementation(
    async (opts) =>
      ({ storage: createSolidBackend({ fetch: opts.fetch, root: opts.storage }) }) as PodClient,
  );
  await import('../src/worker.js');

  async function send(data: PageToWorkerMessage) {
    const work: Promise<unknown>[] = [];
    handlers.get('message')?.({
      data,
      source: { postMessage: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => work.push(promise),
    });
    await Promise.all(work);
  }
  async function seed(webId: string, body: string) {
    const meta = await MetadataStore.open(webId);
    stores.push(meta);
    await meta.put({
      key: `${url} accept=text/turtle`,
      url,
      varyKey: 'accept=text/turtle',
      etag: 'v1',
      fetchedAt: 0,
      status: 200,
      aclStatus: 'ok',
    });
    const cache = new MockByteCache();
    cache.seed(keyRequest(url, 'accept=text/turtle'), turtleResponse(body, { etag: 'v1' }));
    buckets.set(cacheNameForWebId(webId), cache);
    return { meta, cache };
  }
  const a = await seed(alice, 'alice');
  const b = await seed(bob, 'bob');
  await send({ type: 'config', config: { webId: alice, storageRoot: root } });
  await send({ type: 'resync' });
  expect(requests.map((request) => request.method)).toEqual(['HEAD']);
  expect((await a.meta.getByUrl(url))[0]?.fetchedAt).toBeGreaterThan(0);
  expect((await b.meta.getByUrl(url))[0]?.fetchedAt).toBe(0);

  await send({ type: 'config', config: { webId: bob, storageRoot: root } });
  await send({ type: 'notification', frame: { type: 'Update', object: url } });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe('fresh');
  expect(await (await a.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe('alice');
  expect(messages).toEqual([{ url, event: 'updated', etag: 'v2' }]);
  for (const request of requests) expect(request.headers.get('authorization')).toBeNull();
  expect(createPodClient).toHaveBeenCalledWith({ storage: root, fetch: expect.any(Function) });
  // A late read from the previous identity must not populate either cache.
  let resolveRead: ((response: Response) => void) | undefined;
  self.fetch.mockImplementationOnce(
    async () =>
      new Promise<Response>((resolve) => {
        resolveRead = resolve;
      }),
  );
  const pending = send({ type: 'notification', frame: { type: 'Update', object: url } });
  await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
  await send({ type: 'config', config: { webId: alice, storageRoot: root } });
  resolveRead?.(turtleResponse('late private data', { etag: 'v3' }));
  await pending;
  expect(await (await a.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe('alice');
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe('fresh');
  expect(messages).toHaveLength(1);

  // Local eviction must succeed even when no unauthenticated request can succeed.
  vi.mocked(createPodClient)
    .mockReset()
    .mockRejectedValue(new Error('Discovery requires authentication'));
  self.fetch.mockRejectedValue(new Error('Offline'));
  const requestCount = self.fetch.mock.calls.length;
  await send({ type: 'notification', frame: { type: 'Delete', object: url } });
  expect(a.cache.size).toBe(0);
  expect(await a.meta.getByUrl(url)).toEqual([]);
  expect(b.cache.size).toBe(1);
  expect(self.fetch).toHaveBeenCalledTimes(requestCount);
  expect(createPodClient).not.toHaveBeenCalled();

  // A forged notification cannot evict another storage's cached entry.
  await send({ type: 'config', config: { webId: bob, storageRoot: 'https://other.example/' } });
  await send({ type: 'notification', frame: { type: 'Delete', object: url } });
  expect(b.cache.size).toBe(1);

  // Network reads retain discovery's LWS identity, which need not equal the root.
  const storageId = `${root}description`;
  vi.mocked(createPodClient).mockImplementation(
    async (opts) =>
      ({
        storage: createLwsBackend({ fetch: opts.fetch, root: opts.storage, storage: storageId }),
      }) as PodClient,
  );
  self.fetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.headers.get('accept')).toBe('*/*');
    const response = turtleResponse('lws fresh', { etag: 'v4' });
    response.headers.set('link', `<${storageId}>; rel="https://www.w3.org/ns/lws#storage"`);
    return response;
  });
  await send({ type: 'config', config: { webId: bob, storageRoot: root } });
  await send({ type: 'notification', frame: { type: 'Update', object: url } });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe(
    'lws fresh',
  );

  // Page-supplied backend metadata avoids root/description discovery. The root
  // is private, but its publicly readable child must still reconcile.
  vi.mocked(createPodClient).mockReset().mockRejectedValue(new Error('Private root'));
  self.fetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(url);
    return turtleResponse(request.method === 'HEAD' ? '' : 'public update', { etag: 'v5' });
  });
  await send({
    type: 'config',
    config: { webId: bob, storageRoot: root, storageBackend: { protocol: 'solid' } },
  });
  await send({ type: 'notification', frame: { type: 'Update', object: url } });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe(
    'public update',
  );
  self.fetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(url);
    return turtleResponse(request.method === 'HEAD' ? '' : 'public resync', { etag: 'v6' });
  });
  await send({ type: 'resync' });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe(
    'public resync',
  );
  expect(createPodClient).not.toHaveBeenCalled();

  // LWS keeps its discovered identity without root rediscovery, and still
  // rejects responses advertising a different storage.
  await send({
    type: 'config',
    config: { webId: bob, storageRoot: root, storageBackend: { protocol: 'lws', id: storageId } },
  });
  self.fetch.mockImplementation(async () => {
    const response = turtleResponse('public lws', { etag: 'v7' });
    response.headers.set('link', `<${storageId}>; rel="https://www.w3.org/ns/lws#storage"`);
    return response;
  });
  await send({ type: 'notification', frame: { type: 'Update', object: url } });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe(
    'public lws',
  );
  self.fetch.mockImplementation(async () => {
    const response = turtleResponse('foreign', { etag: 'v8' });
    response.headers.set(
      'link',
      '<https://other.example/description>; rel="https://www.w3.org/ns/lws#storage"',
    );
    return response;
  });
  await send({ type: 'notification', frame: { type: 'Update', object: url } });
  expect(await (await b.cache.match(keyRequest(url, 'accept=text/turtle')))?.text()).toBe(
    'public lws',
  );
  expect(createPodClient).not.toHaveBeenCalled();

  // Close the worker's own scoped DB handle before restoring globals.
  await send({ type: 'config', config: {} });
});
