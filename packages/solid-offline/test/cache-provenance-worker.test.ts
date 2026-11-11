// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cacheProvenance } from '../src/cache-policy.js';
import { MockByteCache, turtleResponse } from './mocks.js';

const root = 'https://pod.example/alice/';
const url = `${root}doc`;
let dispose: (() => void) | undefined;
beforeEach(() => vi.resetModules());
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const cache = new MockByteCache();
  const open = vi.fn(async () => cache);
  const fetch = vi.fn(async () => turtleResponse('network', { etag: '"v1"' }));
  const navigator = { onLine: true };
  vi.stubGlobal('self', {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    caches: { open },
    navigator,
    fetch,
  });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage() {}
      close() {}
    },
  );
  await import('../src/worker.js');
  const send = (config: unknown) =>
    handlers.get('message')?.({
      data: { type: 'config', config },
      source: { postMessage() {} },
    });
  dispose = () => send({});
  const configure = () =>
    send({
      webId: `https://pod.example/profile#${Math.random()}`,
      storageRoot: root,
      storageBackend: { protocol: 'solid' },
    });
  const request = (target: string, init?: RequestInit) => {
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.get('fetch')?.({
      request: new Request(target, init),
      respondWith: (result: Promise<Response>) => {
        response = result;
      },
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    });
    return { response, settled: () => Promise.all(pending) };
  };
  return { configure, request, fetch, cache, open, navigator };
}

it('tags in-scope GETs and preserves provenance through the worker adapter', async () => {
  const h = await worker();
  h.configure();
  const online = await h.request(url).response;
  expect(cacheProvenance(online as Response)).toBe('miss');
  expect(await online?.text()).toBe('network');
  h.navigator.onLine = false;
  const offline = await h.request(url).response;
  expect(cacheProvenance(offline as Response)).toBe('stale');
  expect(await offline?.text()).toBe('network');
  expect(h.fetch).toHaveBeenCalledOnce();
});

it.each([
  'https://other.example/alice/doc',
  'https://pod.example/alice-other/doc',
  'https://pod.example/bob/doc',
  'https://pod.example/alice/%2e%2e/bob/doc',
])('does not intercept, cache, or tag out-of-scope %s', async (target) => {
  const h = await worker();
  h.configure();
  const result = h.request(target);
  expect(result.response).toBeUndefined();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled();
});

it('does not intercept pod data before storage configuration', async () => {
  const h = await worker();
  expect(h.request(url).response).toBeUndefined();
  expect(h.open).not.toHaveBeenCalled();
});

it('tags a network fallback when cache storage cannot open', async () => {
  const h = await worker();
  h.configure();
  h.open.mockRejectedValue(new Error('Cache storage unavailable'));
  const response = await h.request(url).response;
  expect(cacheProvenance(response as Response)).toBe('miss');
  expect(await response?.text()).toBe('network');
  expect(h.fetch).toHaveBeenCalledOnce();
});

it('keeps forced freshness failures from falling back to stale bytes', async () => {
  const h = await worker();
  h.configure();
  await h.request(url).response;
  h.fetch.mockRejectedValue(new Error('Network unavailable'));
  await expect(h.request(url, { cache: 'no-cache' }).response).rejects.toThrow(
    'Network unavailable',
  );
});

it('leaves an in-scope HEAD response untouched', async () => {
  const h = await worker();
  h.configure();
  const response = await h.request(url, { method: 'HEAD' }).response;
  expect(cacheProvenance(response as Response)).toBeNull();
});
