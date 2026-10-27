// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleNotification, resyncSweep } from '../src/invalidation.js';
import { MetadataStore } from '../src/metadata-store.js';
import { handleFetch, type SwrDeps } from '../src/swr.js';
import { MockBroadcaster, MockByteCache, makeGet, turtleResponse } from './mocks.js';

const URL = 'https://pod.example/document';
const stores: MetadataStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

async function setup() {
  const meta = await MetadataStore.openNamed(`revalidation-${crypto.randomUUID()}`);
  stores.push(meta);
  const cache = new MockByteCache();
  const broadcast = new MockBroadcaster();
  const deps: SwrDeps & { broadcast: MockBroadcaster; cache: MockByteCache } = {
    meta,
    cache,
    broadcast,
    now: () => 1000,
    isOnline: () => true,
    fetch: vi.fn(async () => turtleResponse('cached', { etag: '"old"' })),
  };
  await handleFetch(makeGet(URL), deps);
  return deps;
}

const outcomes = [
  { name: '304', status: 304, event: 'revalidated' },
  { name: '200', status: 200, event: 'updated' },
  { name: '403', status: 403, event: 'updated' },
  { name: '404', status: 404, event: 'updated' },
  { name: '500', status: 500, event: 'revalidate-failed' },
  { name: 'network error', status: 0, event: 'revalidate-failed' },
  { name: 'offline', status: -1, event: 'revalidate-failed' },
] as const;

describe.each([
  'background',
  'forced',
  'notification',
  'listing',
  'sweep',
] as const)('%s revalidation lifecycle', (path) => {
  it.each(outcomes)('pairs one start with one terminal event for $name', async (outcome) => {
    const deps = await setup();
    let settle!: (response: Response) => void;
    let fail!: (error: Error) => void;
    const response = new Promise<Response>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.fetch = vi.fn(async () => {
      started();
      return response;
    });
    const run = async () => {
      if (path === 'background' || path === 'forced') {
        const request = makeGet(URL);
        if (path === 'forced') request.headers.set('cache-control', 'no-cache');
        const result = await handleFetch(request, deps);
        await result.revalidation;
      } else if (path === 'sweep') {
        await resyncSweep(deps);
      } else {
        await handleNotification(
          { type: path === 'listing' ? 'Add' : 'Update', object: URL },
          deps,
        );
      }
    };
    // Observe rejection immediately; forced reads continue to reject on network failure.
    const done = run().catch((error: unknown) => error);
    await fetching;
    expect(deps.broadcast.messages).toEqual([{ url: URL, event: 'revalidating' }]);
    if (outcome.status <= 0) {
      if (outcome.status === -1) deps.isOnline = () => false;
      fail(new TypeError(outcome.name));
    } else {
      settle(
        outcome.status === 304
          ? new Response(null, { status: 304 })
          : turtleResponse('network bytes', { status: outcome.status, etag: '"new"' }),
      );
    }
    await done;
    // An unsolicited 304 to an unconditional listing request does not confirm its bytes.
    const event =
      path === 'listing' && outcome.status === 304 ? 'revalidate-failed' : outcome.event;
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating' },
      { url: URL, event },
    ]);
  });
});

it('does not invent revalidation events for offline cache hits or skipped validators', async () => {
  const deps = await setup();
  deps.isOnline = () => false;
  const result = await handleFetch(makeGet(URL), deps);
  expect(result.source).toBe('cache-hit-offline');
  expect(result.revalidation).toBeUndefined();
  expect(deps.broadcast.messages).toEqual([]);
  deps.isOnline = () => true;
  const [record] = await deps.meta.getByUrl(URL);
  if (!record) throw new Error('missing fixture');
  delete record.etag;
  await deps.meta.put(record);
  const skipped = await handleFetch(makeGet(URL), deps);
  expect(await skipped.revalidation).toEqual({ kind: 'skipped' });
  expect(deps.broadcast.messages).toEqual([]);
});

describe.each([
  'background',
  'forced',
  'notification',
  'listing',
] as const)('%s adversarial outcomes', (path) => {
  async function run(deps: SwrDeps) {
    if (path === 'notification' || path === 'listing') {
      return handleNotification(
        { type: path === 'listing' ? 'Remove' : 'Update', object: URL },
        deps,
      );
    }
    const request = makeGet(URL);
    if (path === 'forced') request.headers.set('cache-control', 'no-cache');
    const result = await handleFetch(request, deps);
    return result.revalidation;
  }

  it.each([
    'no-store',
    'private',
  ])('terminates with updated after a %s purge', async (cacheControl) => {
    const deps = await setup();
    deps.fetch = vi.fn(async () => turtleResponse('uncacheable', { cacheControl, etag: '"new"' }));
    await run(deps);
    expect(await deps.meta.getByUrl(URL)).toEqual([]);
    expect(deps.cache.size).toBe(0);
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating' },
      { url: URL, event: 'updated' },
    ]);
  });

  it('reports failed confirmation when storing the response fails', async () => {
    const deps = await setup();
    deps.fetch = vi.fn(async () => turtleResponse('new', { etag: '"new"' }));
    vi.spyOn(deps.cache, 'put').mockRejectedValueOnce(new Error('fixture storage failure'));
    await run(deps).catch(() => undefined);
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating' },
      { url: URL, event: 'revalidate-failed' },
    ]);
  });
});

it.each([
  '200',
  'error',
] as const)('pairs a forced 304 retry with one %s outcome', async (outcome) => {
  const deps = await setup();
  const [record] = await deps.meta.getByUrl(URL);
  if (!record) throw new Error('missing fixture');
  delete record.etag;
  await deps.meta.put(record);
  deps.fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockImplementationOnce(async () => {
      expect(deps.broadcast.messages).toEqual([{ url: URL, event: 'revalidating' }]);
      if (outcome === 'error') throw new TypeError('fixture offline');
      return turtleResponse('confirmed');
    });
  const request = makeGet(URL);
  request.headers.set('cache-control', 'no-cache');
  await handleFetch(request, deps).catch(() => undefined);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  expect(deps.broadcast.messages).toEqual([
    { url: URL, event: 'revalidating' },
    { url: URL, event: outcome === '200' ? 'updated' : 'revalidate-failed' },
  ]);
});

it('settles a failed sweep URL and continues confirming the next one', async () => {
  const deps = await setup();
  const other = 'https://pod.example/other';
  await handleFetch(makeGet(other), deps);
  deps.fetch = vi.fn(async (input) => {
    if ((input as Request).url === URL) throw new TypeError('fixture offline');
    return new Response(null, { status: 304 });
  });
  expect(await resyncSweep(deps)).toMatchObject({ checked: 2, confirmed: 1, skipped: 1 });
  for (const url of [URL, other]) {
    expect(deps.broadcast.messages.filter((message) => message.url === url)).toEqual([
      { url, event: 'revalidating' },
      { url, event: url === URL ? 'revalidate-failed' : 'revalidated' },
    ]);
  }
});
