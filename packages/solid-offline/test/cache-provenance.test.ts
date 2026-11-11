// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it } from 'vitest';
import { keyRequest, NEGATIVE_CACHE_TTL_MS } from '../src/cache-policy.js';
import { CACHE_PROVENANCE_HEADER, cacheProvenance } from '../src/index.js';
import { MetadataStore } from '../src/metadata-store.js';
import { handleFetch, type SwrDeps } from '../src/swr.js';
import {
  MockBroadcaster,
  MockByteCache,
  makeGet,
  notModifiedResponse,
  scriptedFetch,
  turtleResponse,
} from './mocks.js';

const url = 'https://pod.example/doc';
const stores: MetadataStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

async function harness(responders: Array<(request: Request) => Response | Promise<Response>>) {
  const meta = await MetadataStore.openNamed(`provenance-${Math.random()}`);
  stores.push(meta);
  const cache = new MockByteCache();
  const network = scriptedFetch(responders);
  let online = true;
  let now = 1000;
  const deps: SwrDeps = {
    cache,
    meta,
    ...network,
    broadcast: new MockBroadcaster(),
    isOnline: () => online,
    now: () => now,
  };
  return {
    deps,
    cache,
    calls: network.calls,
    offline: () => {
      online = false;
    },
    advance: (ms: number) => {
      now += ms;
    },
    cached: () => cache.match(keyRequest(url, 'accept=text/turtle')),
  };
}

describe('cache provenance consumer API', () => {
  it('exports the wire header name', () => {
    expect(CACHE_PROVENANCE_HEADER).toBe('X-Solid-Offline-Cache');
  });

  it.each([
    'hit',
    'miss',
    'stale',
  ] as const)('reads %s without consuming the body', async (value) => {
    const response = new Response('bytes', { headers: { 'x-solid-offline-cache': value } });
    expect(cacheProvenance(response)).toBe(value);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('bytes');
  });

  it.each([
    undefined,
    'unknown',
    'HIT',
    'hit, stale',
  ])('rejects an absent or invalid value: %s', (value) => {
    const response = new Response(null, {
      headers: value === undefined ? {} : { [CACHE_PROVENANCE_HEADER]: value },
    });
    expect(cacheProvenance(response)).toBeNull();
  });
});

describe('SWR response provenance', () => {
  it('labels a fresh network response miss without tagging the stored entry or network original', async () => {
    // Network responses have immutable headers in browsers.
    const original = await fetch('data:text/plain,fresh');
    const h = await harness([() => original]);
    const result = await handleFetch(makeGet(url), h.deps);
    expect(cacheProvenance(result.response)).toBe('miss');
    expect(await result.response.text()).toBe('fresh');
    expect(original.bodyUsed).toBe(false);
    expect(cacheProvenance(original)).toBeNull();
    expect(cacheProvenance((await h.cached()) as Response)).toBeNull();
  });

  it('labels synchronous 304-confirmed cached bytes hit and leaves cached headers untouched', async () => {
    const h = await harness([
      () => turtleResponse('cached', { etag: '"v1"' }),
      () => notModifiedResponse(),
    ]);
    await handleFetch(makeGet(url), h.deps);
    const result = await handleFetch(new Request(url, { cache: 'no-cache' }), h.deps);
    expect(cacheProvenance(result.response)).toBe('hit');
    expect(await result.response.text()).toBe('cached');
    expect(h.calls[1]?.headers.get('if-none-match')).toBe('"v1"');
    const cached = await h.cached();
    expect(cacheProvenance(cached as Response)).toBeNull();
    expect(await cached?.text()).toBe('cached');
  });

  it('labels synchronous replacement bytes miss', async () => {
    const h = await harness([
      () => turtleResponse('old', { etag: '"v1"' }),
      () => turtleResponse('new', { etag: '"v2"' }),
    ]);
    await handleFetch(makeGet(url), h.deps);
    const result = await handleFetch(new Request(url, { cache: 'no-cache' }), h.deps);
    expect(cacheProvenance(result.response)).toBe('miss');
    expect(await result.response.text()).toBe('new');
  });

  it('keeps an immediate SWR response stale after a background 304', async () => {
    const h = await harness([
      () => turtleResponse('cached', { etag: '"v1"' }),
      () => notModifiedResponse(),
    ]);
    await handleFetch(makeGet(url), h.deps);
    const result = await handleFetch(makeGet(url), h.deps);
    expect(cacheProvenance(result.response)).toBe('stale');
    expect(await result.revalidation).toEqual({ kind: '304-confirmed' });
    expect(cacheProvenance(result.response)).toBe('stale');
    expect(await result.response.text()).toBe('cached');
  });

  it('labels offline cached bytes stale and retains the legacy offline marker', async () => {
    const h = await harness([() => turtleResponse('cached', { etag: '"v1"' })]);
    await handleFetch(makeGet(url), h.deps);
    h.offline();
    const result = await handleFetch(makeGet(url), h.deps);
    expect(cacheProvenance(result.response)).toBe('stale');
    expect(result.response.headers.get('x-offline')).toBe('stale');
    expect(await result.response.text()).toBe('cached');
    expect(cacheProvenance((await h.cached()) as Response)).toBeNull();
    expect(h.calls).toHaveLength(1);
  });

  it('labels cached bytes stale when background revalidation fails', async () => {
    const h = await harness([
      () => turtleResponse('cached', { etag: '"v1"' }),
      () => Promise.reject(new Error('network failed')),
    ]);
    await handleFetch(makeGet(url), h.deps);
    const result = await handleFetch(makeGet(url), h.deps);
    expect(await result.revalidation).toMatchObject({ kind: 'error' });
    expect(cacheProvenance(result.response)).toBe('stale');
    expect(await result.response.text()).toBe('cached');
  });

  it('labels a bounded negative cache entry hit, including offline, then miss after expiry', async () => {
    const h = await harness([() => turtleResponse('gone', { status: 404 })]);
    await handleFetch(makeGet(url), h.deps);
    h.offline();
    const result = await handleFetch(makeGet(url), h.deps);
    expect(cacheProvenance(result.response)).toBe('hit');
    expect(result.response.status).toBe(404);
    expect(await result.response.text()).toBe('gone');
    h.advance(NEGATIVE_CACHE_TTL_MS);
    expect(cacheProvenance((await handleFetch(makeGet(url), h.deps)).response)).toBe('miss');
  });

  it.each([
    'no-store',
    'private',
  ])('labels readable %s network responses miss without storing', async (policy) => {
    const h = await harness([() => turtleResponse('network', { cacheControl: policy })]);
    const result = await handleFetch(makeGet(url), h.deps);
    expect(cacheProvenance(result.response)).toBe('miss');
    expect(await result.response.text()).toBe('network');
    expect(h.cache.size).toBe(0);
  });

  it('labels a request no-store bypass miss and overrides a server-supplied marker', async () => {
    const original = new Response('network', { headers: { [CACHE_PROVENANCE_HEADER]: 'hit' } });
    const h = await harness([() => original]);
    const result = await handleFetch(new Request(url, { cache: 'no-store' }), h.deps);
    expect(cacheProvenance(result.response)).toBe('miss');
    expect(cacheProvenance(original)).toBe('hit');
    expect(h.cache.size).toBe(0);
  });

  it.each([
    'opaque',
    'opaqueredirect',
    'error',
  ])('passes a filtered %s response through without fabricating readable headers', async (type) => {
    const response = Response.error();
    Object.defineProperty(response, 'type', { value: type });
    const h = await harness([() => response]);
    const result = await handleFetch(makeGet(url), h.deps);
    expect(result.response).toBe(response);
    expect(cacheProvenance(result.response)).toBeNull();
    expect(h.cache.size).toBe(0);
  });

  it.each(['HEAD', 'POST'])('leaves %s responses untouched', async (method) => {
    const response = new Response(null);
    const h = await harness([() => response]);
    const result = await handleFetch(new Request(url, { method }), h.deps);
    expect(result.response).toBe(response);
    expect(cacheProvenance(result.response)).toBeNull();
  });
});
