// AUTHORED-BY Codex GPT-6.1-Sol
import { readdir, readFile } from 'node:fs/promises';
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyRequest } from '../src/cache-policy.js';
import { handleNotification, resyncSweep } from '../src/invalidation.js';
import { MetadataStore } from '../src/metadata-store.js';
import { createPolicyStorage, policyResponse } from '../src/storage.js';
import { resolveBudget, warm } from '../src/warmer.js';
import { MockBroadcaster, MockByteCache, turtleResponse } from './mocks.js';

const ROOT = 'https://alice.example/';
const DOC = `${ROOT}doc`;
const stores: MetadataStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

async function invalidationHarness(transport?: typeof fetch) {
  const meta = await MetadataStore.openNamed(`solid-offline:plumbing-${Math.random()}`);
  stores.push(meta);
  const cache = new MockByteCache();
  const broadcast = new MockBroadcaster();
  const storage = transport
    ? await createPolicyStorage((fetch) => createSolidBackend({ fetch, root: ROOT }), transport)
    : createMemoryStorage({ protocol: 'lws', root: ROOT });
  await meta.put({
    key: `${DOC} accept=text/turtle`,
    url: DOC,
    varyKey: 'accept=text/turtle',
    etag: 'v1',
    status: 200,
    fetchedAt: 0,
    aclStatus: 'ok',
  });
  cache.seed(keyRequest(DOC, 'accept=text/turtle'), turtleResponse('old', { etag: 'v1' }));
  return { storage, cache, meta, broadcast, now: () => 500 };
}

describe('StorageClient warming', () => {
  it('walks every page of an LWS memory backend and reads every small member', async () => {
    const storage = createMemoryStorage({ protocol: 'lws', root: ROOT, pageSize: 2 });
    const members: string[] = [];
    for (let i = 0; i < 7; i++)
      members.push(
        (await storage.create(ROOT, `body-${i}`, { name: `doc-${i}`, contentType: 'text/plain' }))
          .url,
      );
    const read = vi.spyOn(storage, 'read');
    const listAll = vi.spyOn(storage, 'listAll');
    const result = await warm(`${ROOT}profile#me`, { storage }, resolveBudget(), '', {
      seeds: [ROOT],
    });
    expect(result.budgetHit).toBe(false);
    expect(result.warmed).toBe(8);
    expect(result.visits.filter((visit) => members.includes(visit.url))).toHaveLength(7);
    expect(listAll).toHaveBeenCalledWith(ROOT, { signal: undefined });
    expect(read.mock.calls.map(([url]) => url).sort()).toEqual([ROOT, ...members].sort());
  });

  it('uses backend container kind for a slashless LWS identifier', async () => {
    const memory = createMemoryStorage({ protocol: 'lws', root: ROOT });
    const container = (await memory.create(ROOT, null, { kind: 'container' })).url;
    const doc = (await memory.create(container, 'body', { contentType: 'text/plain' })).url;
    const opaque = `${ROOT}opaque-container`;
    const mapUrl = (url: string) => (url === opaque ? container : url);
    const storage = {
      ...memory,
      read: async (url: string) => ({ ...(await memory.read(mapUrl(url))), url }),
      head: (url: string) => memory.head(mapUrl(url)),
      listAll: (url: string) => memory.listAll(mapUrl(url)),
    };
    const result = await warm(`${ROOT}profile#me`, { storage }, resolveBudget(), '', {
      seeds: [opaque],
    });
    expect(result.visits.find((visit) => visit.url === opaque)?.container).toBe(true);
    expect(result.visits.some((visit) => visit.url === doc)).toBe(true);
  });

  it('uses listing size/type to skip large members without a read, and respects resource/depth caps', async () => {
    const storage = createMemoryStorage({ protocol: 'lws', root: ROOT, pageSize: 1 });
    const binary = (await storage.create(ROOT, 'bytes', { contentType: 'image/png' })).url;
    const nested = (await storage.create(ROOT, null, { kind: 'container' })).url;
    const child = (await storage.create(nested, 'body', { contentType: 'text/plain' })).url;
    const read = vi.spyOn(storage, 'read');
    const result = await warm(
      `${ROOT}profile#me`,
      { storage },
      resolveBudget({ maxDepth: 1 }),
      '',
      { seeds: [ROOT] },
    );
    expect(result.visits.find((visit) => visit.url === binary)?.skipped).toBe('large-binary');
    expect(read.mock.calls.some(([url]) => url === binary || url === child)).toBe(false);
    const capped = await warm(
      `${ROOT}profile#me`,
      { storage },
      resolveBudget({ maxResources: 1 }),
      '',
      { seeds: [ROOT] },
    );
    expect(capped.warmed).toBe(1);
    expect(capped.budgetHit).toBe(true);
  });

  it('filters foreign seeds before I/O and honors an already aborted crawl', async () => {
    const storage = createMemoryStorage({ protocol: 'lws', root: ROOT });
    const read = vi.spyOn(storage, 'read');
    const head = vi.spyOn(storage, 'head');
    await warm(`${ROOT}profile#me`, { storage }, resolveBudget(), '', {
      seeds: ['https://foreign.example/'],
    });
    await warm(`${ROOT}profile#me`, { storage, signal: AbortSignal.abort() }, resolveBudget(), '', {
      seeds: [ROOT],
    });
    expect(read).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });
});

describe('StorageClient invalidation', () => {
  it('HEAD-confirms an unchanged ETag without reading or overwriting GET bytes', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      turtleResponse('', { etag: 'v1' }),
    );
    const deps = await invalidationHarness(transport);
    const result = await resyncSweep(deps);
    expect(result).toEqual({ checked: 1, confirmed: 1, replaced: 0, purged: 0, skipped: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0] as unknown as Request;
    expect(request.method).toBe('HEAD');
    expect(request.cache).toBe('no-cache');
    expect(await (await deps.cache.match(keyRequest(DOC, 'accept=text/turtle')))?.text()).toBe(
      'old',
    );
  });

  it('reads conditionally after a changed HEAD and retains HTTP cache headers', async () => {
    const requests: Request[] = [];
    const deps = await invalidationHarness(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return turtleResponse(request.method === 'HEAD' ? '' : 'new', {
        etag: 'v2',
        vary: 'Accept, X-Mode',
      });
    });
    expect((await resyncSweep(deps)).replaced).toBe(1);
    expect(requests.map((request) => request.method)).toEqual(['HEAD', 'GET']);
    expect(requests[1]?.headers.get('if-none-match')).toBe('v1');
    expect((await deps.meta.getByUrl(DOC))[0]?.vary).toBe('Accept, X-Mode');
  });

  it.each([
    'no-store',
    'private',
  ])('purges changed responses with %s rather than caching a reconstructed result', async (cacheControl) => {
    const deps = await invalidationHarness(async () =>
      turtleResponse('new', { etag: 'v2', cacheControl }),
    );
    expect((await handleNotification({ type: 'Update', object: DOC }, deps)).kind).toBe('deleted');
    expect(await deps.meta.getByUrl(DOC)).toEqual([]);
    expect(deps.cache.size).toBe(0);
  });

  it('keeps GET bytes intact when a HEAD confirms the same ETag', async () => {
    const deps = await invalidationHarness(async () =>
      turtleResponse('', { etag: 'v1', cacheControl: 'no-store' }),
    );
    expect((await resyncSweep(deps)).confirmed).toBe(1);
    expect(deps.cache.size).toBe(1);
  });

  it('refetches entries with no validator and isolates transient failures in a sweep', async () => {
    const deps = await invalidationHarness(async () => turtleResponse('new', { etag: 'v2' }));
    const record = (await deps.meta.getByUrl(DOC))[0];
    if (!record) throw new Error('missing fixture');
    delete record.etag;
    await deps.meta.put(record);
    expect((await resyncSweep(deps)).replaced).toBe(1);
    vi.spyOn(deps.storage, 'head').mockRejectedValueOnce(
      new StorageError('network', { method: 'HEAD', url: DOC }),
    );
    expect((await resyncSweep(deps)).skipped).toBe(1);
  });

  it('evicts changed bytes conservatively when an injected client has no original HTTP policy', async () => {
    const deps = await invalidationHarness();
    vi.spyOn(deps.storage, 'read');
    vi.mocked(deps.storage.read).mockImplementation(async () => {
      const storage = createMemoryStorage({ protocol: 'solid', root: ROOT });
      await storage.write(DOC, 'new', { ifMatch: '*', contentType: 'text/plain' });
      return storage.read(DOC);
    });
    expect((await handleNotification({ type: 'Update', object: DOC }, deps)).kind).toBe('deleted');
    expect(deps.cache.size).toBe(0);
  });

  it('rejects foreign notification objects and targets before any reads', async () => {
    const deps = await invalidationHarness();
    const read = vi.spyOn(deps.storage, 'read');
    expect(
      (await handleNotification({ type: 'Update', object: 'https://foreign.example/doc' }, deps))
        .kind,
    ).toBe('skipped');
    expect(
      (
        await handleNotification(
          { type: 'Add', object: DOC, target: 'https://foreign.example/' },
          deps,
        )
      ).kind,
    ).toBe('skipped');
    expect(read).not.toHaveBeenCalled();
  });
});

it('contains no duplicated socket implementation in package source', async () => {
  const source = new URL('../src/', import.meta.url);
  for (const file of await readdir(source)) {
    if (file.endsWith('.ts'))
      expect(await readFile(new URL(file, source), 'utf8')).not.toMatch(
        /WebSocket|socketFactory|receiveFrom|backoffDelay/,
      );
  }
});

it('keeps HTTP policy associated with the correct concurrent read', async () => {
  const resolvers: Array<(response: Response) => void> = [];
  const storage = await createPolicyStorage(
    (fetch) => createSolidBackend({ fetch, root: ROOT }),
    async () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const first = storage.read(DOC);
  const second = storage.read(DOC);
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  resolvers[1]?.(turtleResponse('second', { etag: 'v2', cacheControl: 'no-store' }));
  resolvers[0]?.(turtleResponse('first', { etag: 'v1' }));
  const [a, b] = await Promise.all([first, second]);
  expect(policyResponse(a)?.headers.get('cache-control')).toBeNull();
  expect(policyResponse(b)?.headers.get('cache-control')).toBe('no-store');
  expect(await a.text()).toBe('first');
  expect(await b.text()).toBe('second');
});
