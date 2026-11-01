// AUTHORED-BY Codex GPT-6.1-Sol
import { createLwsBackend } from '@jeswr/storage-client/lws';
import { afterEach, describe, expect, it } from 'vitest';
import { keyRequest } from '../src/cache-policy.js';
import { handleNotification } from '../src/invalidation.js';
import { MetadataStore } from '../src/metadata-store.js';
import { createPolicyStorage } from '../src/storage.js';
import { handleFetch } from '../src/swr.js';
import { MockBroadcaster, MockByteCache } from './mocks.js';

const ROOT = 'https://alice.example/';
const CONTAINER = `${ROOT}notes`;
const SECOND = `${ROOT}pages?cursor=a%2fb,x&x=1&x=2`;
const THIRD = `${ROOT}pages?cursor=third`;
const KEPT = `${ROOT}kept`;
const REMOVED = `${ROOT}removed`;
const stores: MetadataStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function listing(items: string[], next?: string): Response {
  return new Response(
    JSON.stringify({ type: 'ContainerPage', items: items.map((id) => ({ id })) }),
    {
      headers: {
        'content-type': 'application/lws+json',
        vary: 'Accept',
        etag: 'listing',
        ...(next ? { link: `<${next}>; title="page, next"; rel="next"` } : {}),
      },
    },
  );
}

async function harness() {
  const meta = await MetadataStore.openNamed(`solid-offline:pages-${Math.random()}`);
  stores.push(meta);
  const cache = new MockByteCache();
  const broadcast = new MockBroadcaster();
  let changed = false;
  let online = true;
  const requests: Request[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (!online) throw new Error('offline');
    if (request.url === CONTAINER) {
      const etag = changed ? 'listing-v2' : 'listing';
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304 });
      const response = listing([KEPT], SECOND);
      response.headers.set('etag', etag);
      return response;
    }
    if (request.url === SECOND) return listing(changed ? [] : [REMOVED], THIRD);
    if (request.url === THIRD) return listing([]);
    return listing([]);
  };
  const deps = {
    cache,
    meta,
    broadcast,
    now: () => 500,
    storage: await createPolicyStorage(
      (fetch) => createLwsBackend({ fetch, root: ROOT }),
      transport,
    ),
  };
  const storage = createLwsBackend({
    root: ROOT,
    fetch: async (input, init) => {
      const result = await handleFetch(new Request(input, init), {
        ...deps,
        fetch: transport,
        isOnline: () => online,
      });
      await result.revalidation;
      return result.response;
    },
  });
  // Warm all pages through the real backend and cache pipeline.
  const before: string[] = [];
  for await (const entry of storage.listAll(CONTAINER)) before.push(entry.url);
  expect(before).toEqual([KEPT, REMOVED]);
  return {
    deps,
    storage,
    requests,
    change: () => {
      changed = true;
    },
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
  };
}

describe('paginated listing invalidation', () => {
  it.each([
    { evicted: false, legacy: false },
    { evicted: true, legacy: false },
    { evicted: false, legacy: true },
  ])('purges cursor pages on container Delete (evicted=$evicted, legacy=$legacy)', async ({
    evicted,
    legacy,
  }) => {
    const h = await harness();
    const second = (await h.deps.meta.getByUrl(SECOND))[0];
    const third = (await h.deps.meta.getByUrl(THIRD))[0];
    if (!second || !third) throw new Error('missing cached cursor fixtures');
    const extra = { ...second, key: `${SECOND} x-mode=other`, varyKey: 'x-mode=other' };
    await h.deps.meta.put(extra);
    h.deps.cache.seed(keyRequest(SECOND, extra.varyKey), listing([REMOVED]));
    // Legacy Link traversal can cycle back to the container being deleted.
    h.deps.cache.seed(keyRequest(THIRD, third.varyKey), listing([], CONTAINER));
    const unrelated = `${ROOT}unrelated`;
    await h.deps.meta.put({ ...third, url: unrelated, key: `${unrelated} ${third.varyKey}` });
    h.deps.cache.seed(keyRequest(unrelated, third.varyKey), listing([KEPT]));
    if (evicted) {
      await h.deps.cache.delete(keyRequest(SECOND, second.varyKey));
      await h.deps.cache.delete(keyRequest(SECOND, extra.varyKey));
    }
    if (legacy) {
      for (const url of [CONTAINER, SECOND, THIRD]) {
        for (const record of await h.deps.meta.getByUrl(url)) {
          delete record.nextPages;
          await h.deps.meta.put(record);
        }
      }
    }
    h.requests.length = 0;

    expect(await handleNotification({ type: 'Delete', object: CONTAINER }, h.deps)).toEqual({
      kind: 'deleted',
    });
    expect(h.requests).toEqual([]);
    for (const url of [CONTAINER, SECOND, THIRD]) {
      expect(await h.deps.meta.getByUrl(url)).toEqual([]);
      expect(await h.deps.cache.match(keyRequest(url, second.varyKey))).toBeUndefined();
    }
    expect(await h.deps.cache.match(keyRequest(SECOND, extra.varyKey))).toBeUndefined();
    expect(await h.deps.meta.getByUrl(unrelated)).toHaveLength(1);
    expect(await h.deps.cache.match(keyRequest(unrelated, third.varyKey))).toBeDefined();
    expect(h.deps.broadcast.messages).toEqual([{ url: CONTAINER, event: 'updated' }]);

    h.offline();
    // A caller retaining an opaque cursor must get an offline miss after Delete.
    for (const url of [SECOND, THIRD]) await expect(h.storage.list(url)).rejects.toThrow();
  });

  it.each([
    { type: 'Add', evicted: false, legacy: false },
    { type: 'Remove', evicted: false, legacy: false },
    { type: 'Remove', evicted: true, legacy: false },
    { type: 'Remove', evicted: false, legacy: true },
    { type: 'Update', evicted: false, legacy: false },
    { type: 'Update', evicted: true, legacy: false },
    { type: 'Update', evicted: false, legacy: true },
  ] as const)('evicts cursor pages on $type (evicted=$evicted, legacy=$legacy)', async ({
    type,
    evicted,
    legacy,
  }) => {
    const h = await harness();
    h.change();
    const second = (await h.deps.meta.getByUrl(SECOND))[0];
    if (!second) throw new Error('missing cached cursor fixture');
    const extra = { ...second, key: `${SECOND} x-mode=other`, varyKey: 'x-mode=other' };
    await h.deps.meta.put(extra);
    h.deps.cache.seed(keyRequest(SECOND, extra.varyKey), listing([REMOVED]));
    const unrelated = `${ROOT}unrelated`;
    await h.deps.meta.put({ ...second, url: unrelated, key: `${unrelated} ${second.varyKey}` });
    h.deps.cache.seed(keyRequest(unrelated, second.varyKey), listing([KEPT]));
    const foreign = 'https://foreign.example/page';
    await h.deps.meta.put({ ...second, url: foreign, key: `${foreign} ${second.varyKey}` });
    h.deps.cache.seed(keyRequest(foreign, second.varyKey), listing([KEPT]));
    // A variant's next link may form a cycle. It must not evict the parent.
    const third = (await h.deps.meta.getByUrl(THIRD))[0];
    if (!third) throw new Error('missing cached third-page fixture');
    const last = listing([], CONTAINER);
    last.headers.append('link', `<${unrelated}>; title="fake; rel=next"; rel=prev`);
    last.headers.append('link', `<${unrelated}>; rel=next; anchor="${ROOT}other"`);
    last.headers.append('link', `<${foreign}>; rel=next`);
    h.deps.cache.seed(keyRequest(THIRD, third.varyKey), last);
    if (evicted) {
      expect(second.nextPages).toEqual([THIRD]);
      await h.deps.cache.delete(keyRequest(SECOND, second.varyKey));
      await h.deps.cache.delete(keyRequest(SECOND, extra.varyKey));
    }
    if (legacy) {
      for (const url of [CONTAINER, SECOND]) {
        for (const record of await h.deps.meta.getByUrl(url)) {
          delete record.nextPages;
          await h.deps.meta.put(record);
        }
      }
    }
    h.requests.length = 0;

    const frame =
      type === 'Update'
        ? { type, object: CONTAINER, state: 'listing-v2' }
        : { type, object: REMOVED, target: CONTAINER };
    expect(await handleNotification(frame, h.deps)).toEqual(
      type === 'Update' ? { kind: 'updated', etag: 'listing-v2' } : { kind: 'listing-refreshed' },
    );
    expect(h.requests.map((request) => request.url)).toEqual([CONTAINER]);
    expect(h.requests[0]?.headers.get('if-none-match')).toBe(type === 'Update' ? 'listing' : null);
    for (const url of [SECOND, THIRD]) {
      expect(await h.deps.meta.getByUrl(url)).toEqual([]);
      expect(await h.deps.cache.match(keyRequest(url, second.varyKey))).toBeUndefined();
    }
    expect(await h.deps.cache.match(keyRequest(SECOND, extra.varyKey))).toBeUndefined();
    expect(await h.deps.cache.match(keyRequest(unrelated, second.varyKey))).toBeDefined();
    expect(await h.deps.cache.match(keyRequest(foreign, second.varyKey))).toBeDefined();
    expect(h.deps.broadcast.messages).toEqual([
      { url: CONTAINER, event: 'updated', etag: 'listing-v2' },
    ]);

    h.offline();
    const after: string[] = [];
    await expect(async () => {
      for await (const entry of h.storage.listAll(CONTAINER)) after.push(entry.url);
    }).rejects.toThrow(); // An evicted page is an offline miss, never stale members.
    expect(after).toEqual([KEPT]);

    h.online();
    const refreshed: string[] = [];
    for await (const entry of h.storage.listAll(CONTAINER, { revalidate: true }))
      refreshed.push(entry.url);
    expect(refreshed).toEqual([KEPT]);
  });

  it.each([
    { state: 'listing', kind: 'short-circuit' },
    { state: 'intermediate', kind: '304-confirmed' },
  ])('retains unchanged cursor pages on $kind', async ({ state, kind }) => {
    const h = await harness();
    h.requests.length = 0;

    expect(await handleNotification({ type: 'Update', object: CONTAINER, state }, h.deps)).toEqual({
      kind,
    });
    expect(h.requests.map((request) => request.url)).toEqual(
      kind === 'short-circuit' ? [] : [CONTAINER],
    );
    expect(h.deps.broadcast.messages).toEqual([]);
    for (const url of [SECOND, THIRD]) {
      const records = await h.deps.meta.getByUrl(url);
      expect(records).toHaveLength(1);
      const record = records[0];
      if (!record) throw new Error('missing cached cursor fixture');
      expect(await h.deps.cache.match(keyRequest(url, record.varyKey))).toBeDefined();
    }

    h.offline();
    const unchanged: string[] = [];
    for await (const entry of h.storage.listAll(CONTAINER)) unchanged.push(entry.url);
    expect(unchanged).toEqual([KEPT, REMOVED]);
  });
});
