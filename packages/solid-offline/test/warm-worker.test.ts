// AUTHORED-BY Codex GPT-6.1-Sol
/** Exercise an unwrapped public client through the worker, with consuming Cache.put. */
import { createLwsBackend } from '@jeswr/storage-client/lws';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { keyRequest } from '../src/cache-policy.js';
import { createOfflineClient } from '../src/index.js';
import { MetadataStore } from '../src/metadata-store.js';
import { WARM_REQUEST_HEADER, warmStorage } from '../src/warm-transport.js';
import { resolveBudget, warm } from '../src/warmer.js';
import { MockByteCache } from './mocks.js';

const root = 'https://alice.example/';
const url = `${root}doc`;
const webId = `${root}profile#me`;
let scopedWebId: string;
let dispose: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.resetModules();
  scopedWebId = `${webId}-${Math.random()}`;
});
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function worker(transport: typeof fetch) {
  const handlers = new Map<string, (event: unknown) => void>();
  const pending: Promise<unknown>[] = [];
  const broadcasts: unknown[] = [];
  const cache = new MockByteCache();
  const put = vi.spyOn(cache, 'put').mockImplementation(async (request, response) => {
    // Cache.put resolves only after consuming the complete body in browsers.
    const body = await response.arrayBuffer();
    cache.seed(request, new Response(body, { status: response.status, headers: response.headers }));
  });
  const network = vi.fn(transport);
  vi.stubGlobal('self', {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    caches: { open: async () => cache },
    navigator: { onLine: true },
    fetch: network,
  });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage(message: unknown) {
        broadcasts.push(message);
      }
      addEventListener() {}
      close() {}
    },
  );
  await import('../src/worker.js');
  const send = (data: unknown, ports: MessagePort[] = []) =>
    handlers.get('message')?.({
      data,
      ports,
      source: { id: 'page', postMessage() {} },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
  send({
    type: 'config',
    config: { webId: scopedWebId, storageRoot: root, storageBackend: { protocol: 'solid' } },
  });
  const controller = { postMessage: send };
  vi.stubGlobal('navigator', {
    serviceWorker: {
      controller,
      register: async () => ({ active: controller }),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const pageFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    let response: Promise<Response> | undefined;
    handlers.get('fetch')?.({
      request,
      clientId: 'page',
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    return response ?? network(request);
  };
  dispose = async () => {
    send({ type: 'config', config: {} });
    await Promise.all(pending);
  };
  return {
    storage: createSolidBackend({ root, fetch: pageFetch }),
    pageFetch,
    send,
    network,
    cache,
    put,
    broadcasts,
    async restart() {
      vi.resetModules();
      await import('../src/worker.js');
    },
  };
}

function streaming(length?: string, chunkSize = 1_000_000) {
  const cancel = vi.fn();
  let pulls = 0;
  const headers = { 'content-type': 'text/plain', ...(length ? { 'content-length': length } : {}) };
  const transport: typeof fetch = async (input, init) => {
    if (new Request(input, init).method === 'HEAD') return new Response(null, { headers });
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulls === 20) controller.close();
            else {
              pulls += 1;
              controller.enqueue(new Uint8Array(chunkSize));
            }
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
      { headers },
    );
  };
  return { transport, cancel, pulls: () => pulls };
}

it('preserves public-client HEAD size evidence and skips the GET entirely', async () => {
  const body = streaming('9000000');
  const { storage, network, cache, put } = await worker(body.transport);
  const result = await warm(webId, { storage }, resolveBudget(), '', { seeds: [url] });
  expect(network.mock.calls.map(([input, init]) => new Request(input, init).method)).toEqual([
    'HEAD',
  ]);
  expect(result.visits[0]).toMatchObject({ skipped: 'large-resource', bytes: 9_000_000 });
  expect(body.pulls()).toBe(0);
  expect(cache.size).toBe(0);
  expect(put).not.toHaveBeenCalled();
});

it.each([
  undefined,
  '1',
])('bounds a streamed body before Cache.put with Content-Length %s', async (length) => {
  const body = streaming(length);
  const { storage, network, cache, put } = await worker(body.transport);
  const result = await warm(webId, { storage }, resolveBudget(), '', { seeds: [url] });
  expect(result.warmed).toBe(0);
  expect(result.visits[0]?.skipped).toBe('large-resource');
  expect(result.budgetHit).toBe(false);
  expect(body.pulls()).toBeLessThanOrEqual(8);
  expect(body.cancel).toHaveBeenCalledOnce();
  expect(network).toHaveBeenCalledTimes(2); // No unbounded fallback after the guard rejects.
  expect(cache.size).toBe(0);
  expect(put).not.toHaveBeenCalled();
});

it('shares the transport budget across concurrent reads before either can be stored', async () => {
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (new Request(input, init).method === 'HEAD') return new Response(null);
    const body = streaming(undefined, 600);
    cancels.push(body.cancel);
    return body.transport(input, init);
  };
  const { storage, cache, put } = await worker(transport);
  const result = await warm(
    webId,
    { storage },
    resolveBudget({ maxBytes: 1000, concurrency: 2 }),
    '',
    {
      seeds: [`${root}a`, `${root}b`],
    },
  );
  expect(result.bytes).toBeLessThanOrEqual(1000);
  expect(result.budgetHit).toBe(true);
  expect(result.warmed).toBe(0);
  for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
  expect(cache.size).toBe(0);
  expect(put).not.toHaveBeenCalled();
});

it('guards the initial profile read before the page has received its body', async () => {
  const body = streaming(undefined, 512);
  const { storage, put } = await worker(body.transport);
  const result = await warm(webId, { storage }, resolveBudget({ maxBytes: 1024 }));
  expect(result.budgetHit).toBe(true);
  expect(result.bytes).toBe(1024);
  expect(body.pulls()).toBeLessThanOrEqual(5);
  expect(put).not.toHaveBeenCalled();
});

it.each([
  undefined,
  'private',
  'no-store',
])('keeps small reads and cache policy intact (%s)', async (policy) => {
  const headers = { 'content-type': 'text/plain', ...(policy ? { 'cache-control': policy } : {}) };
  const { storage, cache, put } = await worker(
    async (input, init) =>
      new Response(new Request(input, init).method === 'HEAD' ? null : 'small', { headers }),
  );
  const result = await warm(webId, { storage }, resolveBudget(), '', { seeds: [url] });
  expect(result.warmed).toBe(1);
  expect(result.bytes).toBe(5);
  expect(cache.size).toBe(policy ? 0 : 1);
  expect(put).toHaveBeenCalledTimes(policy ? 0 : 1);
  const meta = await MetadataStore.open(scopedWebId);
  expect((await meta.getByUrl(url)).length).toBe(policy ? 0 : 1);
  meta.close();
});

it('uses HEAD size evidence to avoid GET when the remaining budget is smaller', async () => {
  const body = streaming('5000');
  const { storage, network, put } = await worker(body.transport);
  const result = await warm(webId, { storage }, resolveBudget({ maxBytes: 1024 }), '', {
    seeds: [url],
  });
  expect(result.budgetHit).toBe(true);
  expect(result.bytes).toBe(0);
  expect(network).toHaveBeenCalledOnce();
  expect(put).not.toHaveBeenCalled();
});

it('bounds all LWS listAll pages before the worker stores them', async () => {
  const next = `${root}cursor?after=one`;
  const oversized = streaming(undefined, 512);
  const { pageFetch, cache } = await worker(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'HEAD') return new Response(null);
    if (request.url === next) return oversized.transport(input, init);
    return new Response(JSON.stringify({ type: 'ContainerPage', items: [] }), {
      headers: {
        'content-type': 'application/lws+json',
        link: `<${next}>; rel="next"`,
      },
    });
  });
  const storage = createLwsBackend({ root, fetch: pageFetch });
  const result = await warm(webId, { storage }, resolveBudget({ maxBytes: 1024 }), '', {
    seeds: [root],
  });
  expect(result.budgetHit).toBe(true);
  expect(result.bytes).toBeLessThanOrEqual(1024);
  expect(oversized.pulls()).toBeLessThan(20);
  expect(oversized.cancel).toHaveBeenCalledOnce();
  const meta = await MetadataStore.open(scopedWebId);
  expect(await meta.getByUrl(next)).toEqual([]);
  meta.close();
  expect(cache.size).toBe(1); // The complete root listing only.
});

it('cancels an in-flight worker stream when warming is stopped', async () => {
  const cancel = vi.fn();
  let pulling = false;
  const { storage, put } = await worker(async (input, init) => {
    if (new Request(input, init).method === 'HEAD') return new Response(null);
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            pulling = true;
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
  });
  const abort = new AbortController();
  const running = warm(webId, { storage, signal: abort.signal }, resolveBudget(), '', {
    seeds: [url],
  });
  const rejected = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(pulling).toBe(true));
  abort.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(put).not.toHaveBeenCalled();
});

it('leaves ordinary page reads outside the warming guard', async () => {
  const { storage, pageFetch, put } = await worker(async () => new Response('normal'));
  const session = await warmStorage(storage, resolveBudget({ maxBytes: 1 }));
  try {
    expect(await (await pageFetch(url)).text()).toBe('normal');
    expect(put).toHaveBeenCalledOnce();
  } finally {
    await session.close();
  }
});

it.each([
  'document',
  'listing',
])('does not guard a foreground %s overlapping warming', async (kind) => {
  let finish: ((response: Response) => void) | undefined;
  const { storage, pageFetch, network } = await worker(async (input, init) => {
    const request = new Request(input, init);
    expect(request.headers.has(WARM_REQUEST_HEADER)).toBe(false);
    if (request.headers.get('cache-control') === 'no-cache')
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return new Response('foreground bytes');
  });
  const session = await warmStorage(
    kind === 'listing' ? createLwsBackend({ root, fetch: pageFetch }) : storage,
    resolveBudget({ maxBytes: 1 }),
  );
  try {
    const warming =
      kind === 'document'
        ? session.storage.read(url)
        : session.storage.listAll(root)[Symbol.asyncIterator]().next();
    const rejected = expect(warming).rejects.toThrow();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const response = await pageFetch(kind === 'document' ? url : `${root}cursor?next=1`, {
      headers: {
        accept: kind === 'document' ? '*/*' : 'application/lws+json, application/ld+json;q=0.5',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('foreground bytes');
    finish?.(new Response('warming bytes'));
    await rejected;
    expect(network).toHaveBeenCalledTimes(2);
    expect(await session.close()).toMatchObject({ bytes: 0, budgetHit: true });
  } catch (error) {
    finish?.(new Response(null));
    await session.close();
    throw error;
  }
});

it.each([200, 304])('waits for cached warming revalidation (%s) before closing', async (status) => {
  let fresh = false;
  let finish: ((response: Response) => void) | undefined;
  const { storage, pageFetch, cache, broadcasts } = await worker(async (input, init) => {
    const request = new Request(input, init);
    const headers = { 'content-type': 'text/plain', etag: '"old"' };
    if (request.method === 'HEAD') return new Response(null, { headers });
    if (!fresh) return new Response('old bytes', { headers });
    expect(request.headers.get('if-none-match')).toBe('"old"');
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  await (await pageFetch(url)).text();
  broadcasts.length = 0;
  fresh = true;
  let complete = false;
  const running = warm(webId, { storage }, resolveBudget(), '', { seeds: [url] }).then((result) => {
    complete = true;
    return result;
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(complete).toBe(false);
  finish?.(
    new Response(status === 304 ? null : 'fresh bytes', {
      status,
      headers: { 'content-type': 'text/plain', etag: status === 304 ? '"old"' : '"new"' },
    }),
  );
  const result = await running;
  expect(result.warmed).toBe(1);
  expect(result.visits[0]?.bytes).toBe(status === 304 ? 9 : 11);
  const meta = await MetadataStore.open(scopedWebId);
  const [record] = await meta.getByUrl(url);
  expect(record?.etag).toBe(status === 304 ? '"old"' : '"new"');
  expect(await (await cache.match(keyRequest(url, record?.varyKey ?? '')))?.text()).toBe(
    status === 304 ? 'old bytes' : 'fresh bytes',
  );
  expect(broadcasts).toEqual(status === 304 ? [] : [{ url, event: 'updated', etag: '"new"' }]);
  meta.close();
});

it.each([
  'manual',
  'reconnect',
])('restores scope for %s warming after worker restart', async (trigger) => {
  let online: (() => void) | undefined;
  vi.stubGlobal('addEventListener', (type: string, listener: () => void) => {
    if (type === 'online') online = listener;
  });
  vi.stubGlobal('removeEventListener', vi.fn());
  const { storage, restart, network } = await worker(
    async (input, init) =>
      new Response(new Request(input, init).method === 'HEAD' ? null : '', {
        headers: { 'content-type': 'text/turtle' },
      }),
  );
  const client = createOfflineClient({
    storage,
    webId: scopedWebId,
    channelName: 'warming-updates',
    warm: { warmOnLogin: false, seeds: [url] },
  });
  try {
    await client.register();
    expect((await client.warm())?.warmed).toBeGreaterThan(0);
    await restart(); // Same controller and durable stores; no controllerchange.
    network.mockClear();
    if (trigger === 'manual') expect((await client.warm())?.warmed).toBeGreaterThan(0);
    else {
      expect(online).toBeTypeOf('function');
      online?.();
      await vi.waitFor(() => expect(network).toHaveBeenCalled());
      expect((await client.warm())?.warmed).toBeGreaterThan(0);
    }
    expect(network).toHaveBeenCalled();
    const meta = await MetadataStore.open(scopedWebId);
    expect(await meta.getByUrl(url)).toHaveLength(1);
    meta.close();
  } finally {
    client.close();
  }
});

it('does not retry a broken body outside the warming guard', async () => {
  const { storage, network, put } = await worker(async (input, init) => {
    if (new Request(input, init).method === 'HEAD') return new Response(null);
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('Connection lost'));
        },
      }),
    );
  });
  const result = await warm(webId, { storage }, resolveBudget(), '', { seeds: [url] });
  expect(result.visits[0]?.skipped).toBe('fetch-error');
  expect(result.warmed).toBe(0);
  expect(network).toHaveBeenCalledTimes(2);
  expect(put).not.toHaveBeenCalled();
});

it('rejects a concurrent crawl instead of replacing its transport guard', async () => {
  const { storage, put } = await worker(async () => new Response('larger than one byte'));
  const session = await warmStorage(storage, resolveBudget({ maxBytes: 1 }));
  try {
    await expect(warmStorage(storage, resolveBudget())).rejects.toThrow('already active');
    await expect(session.storage.read(url)).rejects.toThrow('limit exceeded');
    expect(put).not.toHaveBeenCalled();
  } finally {
    await session.close();
  }
});

it.each([
  false,
  true,
])('keeps warming scoped when config changes identity: %s', async (changeIdentity) => {
  const { storage, network, put, send } = await worker(async () => new Response('small'));
  const session = await warmStorage(storage, resolveBudget());
  try {
    send({
      type: 'config',
      config: {
        webId: changeIdentity ? `${scopedWebId}-other` : scopedWebId,
        storageRoot: root,
        storageBackend: { protocol: 'solid' },
      },
    });
    if (changeIdentity) {
      await expect(session.storage.read(url)).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    } else {
      expect(await (await session.storage.read(url)).text()).toBe('small');
      expect(put).toHaveBeenCalledOnce();
    }
  } finally {
    await session.close();
  }
});
