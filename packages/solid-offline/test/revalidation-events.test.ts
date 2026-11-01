// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleNotification, resyncSweep } from '../src/invalidation.js';
import { MetadataStore } from '../src/metadata-store.js';
import { reportRevalidation } from '../src/revalidation-events.js';
import { createStatusSurface } from '../src/status.js';
import { handleFetch, type SwrDeps } from '../src/swr.js';
import { MockBroadcaster, MockByteCache, makeGet, turtleResponse } from './mocks.js';

const URL = 'https://pod.example/document';
const stores: MetadataStore[] = [];
const surfaces: ReturnType<typeof createStatusSurface>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const surface of surfaces.splice(0)) surface.close();
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

it('pairs concurrent attempts with distinct IDs across broadcasters', async () => {
  const first = new MockBroadcaster();
  const second = new MockBroadcaster();
  let settleFirst!: () => void;
  const pending = new Promise<void>((resolve) => {
    settleFirst = resolve;
  });
  const older = reportRevalidation(
    URL,
    first,
    () => pending,
    () => 'revalidated',
  );
  await reportRevalidation(
    URL,
    second,
    async () => undefined,
    () => 'updated',
  );
  settleFirst();
  await older;
  const firstId = first.messages[0]?.attemptId;
  const secondId = second.messages[0]?.attemptId;
  expect(firstId).toEqual(expect.any(String));
  expect(secondId).toEqual(expect.any(String));
  expect(firstId).not.toBe(secondId);
  expect(first.messages).toEqual([
    { url: URL, event: 'revalidating', attemptId: firstId },
    { url: URL, event: 'revalidated', attemptId: firstId },
  ]);
  expect(second.messages).toEqual([
    { url: URL, event: 'revalidating', attemptId: secondId },
    { url: URL, event: 'updated', attemptId: secondId },
  ]);
});

describe.each(['start', 'terminal', 'both'] as const)('%s broadcast failure', (failureAt) => {
  function broadcaster() {
    return {
      postMessage: vi.fn((message: { url: string; event: string }) => {
        const start = message.event === 'revalidating';
        if (failureAt === 'both' || (failureAt === 'start' ? start : !start)) {
          throw new Error('fixture broadcast failure');
        }
      }),
    };
  }

  it.each([
    'updated',
    'revalidated',
    'revalidate-failed',
  ] as const)('preserves the operation result for %s', async (event) => {
    const broadcast = broadcaster();
    const result = { kind: 'fixture result' };
    const run = vi.fn(async () => result);
    await expect(reportRevalidation(URL, broadcast, run, () => event)).resolves.toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    expect(broadcast.postMessage.mock.calls).toEqual([
      [{ url: URL, event: 'revalidating', attemptId: expect.any(String) }],
      [{ url: URL, event, attemptId: expect.any(String) }],
    ]);
  });

  it('preserves the original operation error', async () => {
    const broadcast = broadcaster();
    const failure = new TypeError('fixture operation failure');
    const run = vi.fn(async () => {
      throw failure;
    });
    const eventFor = vi.fn(() => 'updated' as const);
    await expect(reportRevalidation(URL, broadcast, run, eventFor)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
    expect(eventFor).not.toHaveBeenCalled();
    expect(broadcast.postMessage.mock.calls).toEqual([
      [{ url: URL, event: 'revalidating', attemptId: expect.any(String) }],
      [{ url: URL, event: 'revalidate-failed', attemptId: expect.any(String) }],
    ]);
  });

  it.each(['Delete', '403', '404'] as const)('still purges revoked bytes on %s', async (path) => {
    const deps = await setup();
    const broadcast = broadcaster();
    deps.broadcast.postMessage = broadcast.postMessage;
    deps.fetch = vi.fn(async () => new Response(null, { status: Number(path) }));
    await expect(
      handleNotification({ type: path === 'Delete' ? 'Delete' : 'Update', object: URL }, deps),
    ).resolves.toEqual({ kind: 'deleted' });
    expect(await deps.meta.getByUrl(URL)).toEqual([]);
    expect(deps.cache.size).toBe(0);
    expect(deps.fetch).toHaveBeenCalledTimes(path === 'Delete' ? 0 : 1);
    expect(broadcast.postMessage.mock.calls).toEqual([
      [{ url: URL, event: 'revalidating', attemptId: expect.any(String) }],
      [{ url: URL, event: 'updated', attemptId: expect.any(String) }],
    ]);
  });
});

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
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
    ]);
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
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      { url: URL, event, attemptId: expect.any(String) },
    ]);
    expect(deps.broadcast.messages[1]?.attemptId).toBe(deps.broadcast.messages[0]?.attemptId);
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
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      { url: URL, event: 'updated', attemptId: expect.any(String) },
    ]);
  });

  it('reports failed confirmation when storing the response fails', async () => {
    const deps = await setup();
    deps.fetch = vi.fn(async () => turtleResponse('new', { etag: '"new"' }));
    vi.spyOn(deps.cache, 'put').mockRejectedValueOnce(new Error('fixture storage failure'));
    await run(deps).catch(() => undefined);
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      { url: URL, event: 'revalidate-failed', attemptId: expect.any(String) },
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
      expect(deps.broadcast.messages).toEqual([
        { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      ]);
      if (outcome === 'error') throw new TypeError('fixture offline');
      return turtleResponse('confirmed');
    });
  const request = makeGet(URL);
  request.headers.set('cache-control', 'no-cache');
  await handleFetch(request, deps).catch(() => undefined);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  expect(deps.broadcast.messages).toEqual([
    { url: URL, event: 'revalidating', attemptId: expect.any(String) },
    {
      url: URL,
      event: outcome === '200' ? 'updated' : 'revalidate-failed',
      attemptId: expect.any(String),
    },
  ]);
});

it('reports a failed sweep attempt before propagating its error', async () => {
  const deps = await setup();
  await handleFetch(makeGet('https://pod.example/other'), deps);
  const failure = new TypeError('fixture offline');
  deps.fetch = vi.fn(async () => {
    throw failure;
  });
  await expect(resyncSweep(deps)).rejects.toBe(failure);
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(deps.broadcast.messages).toEqual([
    { url: URL, event: 'revalidating', attemptId: expect.any(String) },
    { url: URL, event: 'revalidate-failed', attemptId: expect.any(String) },
  ]);
});

describe('direct delete lifecycle', () => {
  it.each([
    'success',
    'storage failure',
  ] as const)('balances a delete during an unresolved fetch: %s', async (outcome) => {
    const deps = await setup();
    const listeners = new Set<(event: MessageEvent) => void>();
    const surface = createStatusSurface({
      channel: {
        addEventListener: (_type, listener) => {
          listeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
          listeners.delete(listener);
        },
        close() {},
      },
      isOnline: () => true,
    });
    surfaces.push(surface);
    surface.markFresh(URL);
    const postMessage = deps.broadcast.postMessage.bind(deps.broadcast);
    deps.broadcast.postMessage = (message) => {
      postMessage(message);
      for (const listener of listeners) listener(new MessageEvent('message', { data: message }));
    };

    let settle!: (response: Response) => void;
    deps.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    const first = await handleFetch(makeGet(URL), deps);
    expect(surface.getSnapshot().pending).toBe(1);
    const failure = new Error('fixture storage failure');
    if (outcome === 'storage failure') {
      vi.spyOn(deps.meta, 'delete').mockRejectedValueOnce(failure);
    }
    const deleted = await handleNotification({ type: 'Delete', object: URL }, deps);
    expect(deleted).toEqual(
      outcome === 'success' ? { kind: 'deleted' } : { kind: 'error', error: failure },
    );
    expect(deps.broadcast.messages).toEqual([
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      { url: URL, event: 'revalidating', attemptId: expect.any(String) },
      {
        url: URL,
        event: outcome === 'success' ? 'updated' : 'revalidate-failed',
        attemptId: expect.any(String),
      },
    ]);
    expect(surface.getSnapshot().pending).toBe(1);

    // A second fetch starts before the original one settles. Its pending state
    // must survive the original terminal event as well as the delete's event.
    // Restore cached data so the second read can start a background attempt.
    deps.fetch = vi.fn(async () => turtleResponse('cached again', { etag: '"new"' }));
    await handleFetch(makeGet(URL), deps);
    let settleSecond!: (response: Response) => void;
    deps.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          settleSecond = resolve;
        }),
    );
    const second = await handleFetch(makeGet(URL), deps);
    settle(new Response(null, { status: 304 }));
    await first.revalidation;
    expect(surface.getSnapshot().pending).toBe(1);
    settleSecond(new Response(null, { status: 304 }));
    await second.revalidation;
    expect(surface.getSnapshot().pending).toBe(0);
    expect(surface.getSnapshot().resources[URL]).toBe(outcome === 'success' ? 'updated' : 'fresh');
  });
});
