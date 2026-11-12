// AUTHORED-BY Codex GPT-6
import { type CreateOptions, type StorageClient, StorageError } from '@jeswr/storage-client';
import { createLwsBackend } from '@jeswr/storage-client/lws';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOutbox,
  type Outbox,
  type OutboxItem,
  type OutboxOperation,
  type ReplayDelegate,
  withOutbox,
} from '../src/outbox.js';

const root = 'https://pod.example/store/';
const url = `${root}b`;
const webId = 'https://pod.example/profile#me';
const tag = 'app.policy';
const options = { contentType: 'text/plain', ifMatch: '"old"' };
let idb: IDBFactory;
let boxes: Outbox[];
function box() {
  const outbox = createOutbox({ webId, idb, now: () => 1000 });
  boxes.push(outbox);
  return outbox;
}
function storage(protocol: StorageClient['protocol'] = 'solid') {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async (_url, init) =>
      new Response(null, {
        status: init?.method === 'POST' || init?.method === 'PUT' ? 201 : 204,
        headers: { etag: '"new"', location: `${root}assigned` },
      }),
  );
  const client =
    protocol === 'lws' ? createLwsBackend({ root, fetch }) : createSolidBackend({ root, fetch });
  const calls = [
    vi.spyOn(client, 'write'),
    vi.spyOn(client, 'writeRdf'),
    vi.spyOn(client, 'delete'),
    vi.spyOn(client, 'create'),
    vi.spyOn(client, 'head'),
    vi.spyOn(client, 'parentOf'),
  ];
  return { client, fetch, calls };
}
function noStorage(client: ReturnType<typeof storage>) {
  for (const call of client.calls) expect(call).not.toHaveBeenCalled();
  expect(client.fetch).not.toHaveBeenCalled();
}
interface Stored {
  item: OutboxItem;
  request?: { op: string; url: string; container?: string; name?: string; kind?: string };
  createOptions?: CreateOptions;
  createMode?: 'solid' | 'container';
}
async function edit(change: (record: Stored) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(`solid-offline-outbox:${encodeURIComponent(webId)}`, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.getAll();
      request.onsuccess = () => {
        const record = request.result[0] as Stored;
        change(record);
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
beforeEach(() => {
  idb = new IDBFactory();
  boxes = [];
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => {
  for (const outbox of boxes) outbox.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('persisted dispatch destinations', () => {
  const changes: [string, OutboxOperation['op'], (record: Stored) => void][] = [
    [
      'write URL',
      'write',
      (r) => {
        r.item.url = `${root}other`;
      },
    ],
    [
      'delete URL',
      'delete',
      (r) => {
        r.item.url = `${root}other`;
      },
    ],
    [
      'create URL',
      'create',
      (r) => {
        r.item.url = `${root}other`;
      },
    ],
    [
      'container',
      'create',
      (r) => {
        r.item.container = `${root}other/`;
      },
    ],
    [
      'display name',
      'create',
      (r) => {
        r.item.name = 'other';
      },
    ],
    [
      'dispatch name',
      'create',
      (r) => {
        r.createOptions = { ...r.createOptions, name: 'other' };
      },
    ],
    [
      'dispatch kind',
      'create',
      (r) => {
        r.createOptions = { ...r.createOptions, kind: 'container' };
      },
    ],
    [
      'description',
      'write',
      (r) => {
        r.request = { op: 'write', url: `${root}other` };
      },
    ],
    [
      'null description',
      'write',
      (r) => {
        Object.assign(r, { request: null });
      },
    ],
  ];
  it.each(
    changes,
  )('quarantines edited %s at hydration, replay and retry', async (_name, op, change) => {
    const original = box();
    const client = storage();
    withOutbox(client.client, original);
    await original.enqueue({
      op,
      url,
      body: 'bytes',
      ...options,
      ...(op === 'create'
        ? { container: root, name: 'b', createOptions: { name: 'b', contentType: 'text/plain' } }
        : {}),
      guard: { tag },
    });
    await edit(change);
    original.close();
    const outbox = box();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.ready;
    expect(outbox.pending()).toMatchObject([
      { status: 'failed', error: expect.stringContaining('stored request') },
    ]);
    await outbox.replay(client.client);
    await outbox.retry();
    expect(outbox.pending()[0]?.status).toBe('failed');
    expect(delegate).not.toHaveBeenCalled();
    noStorage(client);
  });

  it('withholds an edited invalid operation from pending() and never delivers it', async () => {
    const original = box();
    const client = storage();
    withOutbox(client.client, original);
    await original.enqueue({ op: 'write', url, body: 'bytes', ...options, guard: { tag } });
    await edit((r) => {
      Object.assign(r.item, { op: 'patch' });
    });
    original.close();
    const outbox = box();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.ready;
    // An item without a valid op cannot be shown as an OutboxItem; hydration fails it.
    expect(outbox.pending()).toEqual([]);
    let persisted: Stored | undefined;
    await edit((r) => {
      persisted = structuredClone(r);
    });
    expect(persisted?.item).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('invalid stored item'),
    });
    await outbox.replay(client.client);
    await outbox.retry();
    expect(outbox.pending()).toEqual([]);
    expect(delegate).not.toHaveBeenCalled();
    noStorage(client);
  });

  it.each([
    'mine',
    'both',
  ] as const)('fails edited conflicts before %s can read or deliver', async (strategy) => {
    const outbox = box();
    const client = storage();
    withOutbox(client.client, outbox);
    await outbox.enqueue({ op: 'write', url, body: 'bytes', ...options, guard: { tag } });
    const delegate = vi
      .fn<ReplayDelegate>()
      .mockRejectedValueOnce(
        new StorageError('precondition-failed', { url, method: 'PUT', status: 412 }),
      );
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    const conflict = outbox.conflicts()[0];
    await edit((r) => {
      r.item.url = `${root}other`;
    });
    await expect(outbox.resolve(conflict?.id as string, strategy)).rejects.toThrow(
      'stored request',
    );
    expect(outbox.pending()[0]?.status).toBe('failed');
    expect(outbox.conflicts()).toHaveLength(1);
    expect(delegate).toHaveBeenCalledOnce();
    noStorage(client);
  });

  it('adopts a legacy record using the active backend and checks the recomputed scope', async () => {
    const outbox = box();
    await outbox.enqueue({ op: 'write', url: `${root}a/../b`, body: 'bytes', ...options });
    await edit((r) => {
      delete r.request;
      delete r.createMode;
    });
    const client = storage();
    const stop = outbox.registerGuardPolicy(tag, (request) => request.url === url);
    await outbox.replay(client.client);
    expect(outbox.pending()[0]?.blocked).toBe('guard-required');
    noStorage(client);
    stop();
    await outbox.replay(client.client);
    expect(client.fetch).toHaveBeenCalledOnce();
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
    expect(outbox.pending()).toEqual([]);
  });

  it('snapshots the effective create options before buffering and binds policy to those arguments', async () => {
    const outbox = box();
    const client = storage();
    withOutbox(client.client, outbox);
    const createOptions = { name: 'b', contentType: 'text/plain' };
    const operation: OutboxOperation = {
      op: 'create',
      url: `${root}misleading`,
      container: `${root}a/../`,
      name: 'misleading',
      createOptions,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          createOptions.name = 'other';
          operation.container = `${root}other/`;
          controller.close();
        },
      }),
    };
    await outbox.enqueue(operation);
    expect(outbox.pending()).toMatchObject([{ url, name: 'b', container: root }]);
    const stop = outbox.registerGuardPolicy(tag, (request) => request.url === url);
    await outbox.replay(client.client);
    expect(outbox.pending()[0]?.blocked).toBe('guard-required');
    noStorage(client);
    stop();
    await outbox.replay(client.client);
    expect(client.client.create).toHaveBeenCalledWith(
      root,
      expect.any(Uint8Array),
      expect.objectContaining({ name: 'b' }),
    );
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
  });
});

describe('canonical policy matching and delivery', () => {
  it('delivers an ordinary opted-in online create using its snapshotted arguments', async () => {
    const outbox = box();
    const client = storage();
    const result = await withOutbox(client.client, outbox).create(`${root}a/../`, 'bytes', {
      offline: 'queue',
      name: 'b',
      contentType: 'text/plain',
    });
    expect(result).toMatchObject({ url, created: true });
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    'write',
    'writeRdf',
    'delete',
  ] as const)('preserves ordinary %s delivery under an unrelated policy', async (op) => {
    const outbox = box();
    const client = storage();
    outbox.registerGuardPolicy('unrelated', () => false);
    const wrapped = withOutbox(client.client, outbox);
    const target = `${root}a/../b`;
    if (op === 'write') await wrapped.write(target, 'bytes', options);
    else if (op === 'writeRdf')
      await wrapped.writeRdf(target, [], { ...options, contentType: 'text/turtle' });
    else await wrapped.delete(target, options);
    expect(client.fetch).toHaveBeenCalledOnce();
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
  });

  it('hydrates a legacy create without dispatch options before attaching its client', async () => {
    const original = box();
    await original.enqueue({
      op: 'create',
      url: root,
      container: root,
      body: 'bytes',
      ...options,
      guard: { tag },
    });
    await edit((record) => {
      delete record.request;
      delete record.createMode;
      delete record.createOptions;
    });
    original.close();
    const outbox = box();
    await outbox.ready;
    const client = storage();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    expect(delegate.mock.calls[0]?.[0]).toMatchObject({ op: 'create', url: root, container: root });
    expect(outbox.pending()).toEqual([]);
    noStorage(client);
  });

  it.each([
    'relative',
    'file:///tmp/b',
    'https://user:secret@pod.example/store/b',
    `${root}a%2fb`,
    `${root}b?`,
    `${root}b#`,
    'https:pod.example/store/b',
  ])('rejects invalid or ambiguous mutation destinations before storage: %s', async (target) => {
    const outbox = box();
    const client = storage();
    await expect(
      withOutbox(client.client, outbox).write(target, 'bytes', { ...options, offline: 'queue' }),
    ).rejects.toThrow();
    noStorage(client);
  });

  it('rejects invalid Solid create kinds and non-container destinations before storage', async () => {
    const outbox = box();
    const client = storage();
    const wrapped = withOutbox(client.client, outbox);
    await expect(
      wrapped.create(root, null, { offline: 'queue', kind: 'invalid' as CreateOptions['kind'] }),
    ).rejects.toThrow('create kind');
    await expect(
      wrapped.create(`${root}not-a-container`, null, { offline: 'queue' }),
    ).rejects.toThrow('container URL');
    noStorage(client);
  });

  it('snapshots ordinary create dispatch options before calling a policy matcher', async () => {
    const outbox = box();
    const client = storage();
    const opts = { name: 'b', contentType: 'text/plain' };
    outbox.registerGuardPolicy('unrelated', () => {
      opts.name = 'changed';
      return false;
    });
    await withOutbox(client.client, outbox).create(root, 'bytes', opts);
    expect(opts.name).toBe('changed');
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
  });

  it.each([
    'mine',
    'both',
  ] as const)('rechecks request binding with the active backend before %s', async (strategy) => {
    const outbox = box();
    const client = storage();
    withOutbox(client.client, outbox);
    await outbox.enqueue({
      op: 'create',
      url,
      container: root,
      name: 'b',
      body: 'bytes',
      ...options,
      guard: { tag },
    });
    const delegate = vi
      .fn<ReplayDelegate>()
      .mockRejectedValueOnce(
        new StorageError('precondition-failed', { url, method: 'PUT', status: 412 }),
      );
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    const lws = storage('lws');
    withOutbox(lws.client, outbox);
    await expect(outbox.resolve(outbox.conflicts()[0]?.id as string, strategy)).rejects.toThrow(
      'stored request',
    );
    expect(outbox.pending()[0]?.status).toBe('failed');
    noStorage(client);
    noStorage(lws);
  });

  it.each([
    'replay',
    'retry',
  ] as const)('rejects persisted destination edits after hydration on %s', async (action) => {
    const outbox = box();
    const client = storage();
    withOutbox(client.client, outbox);
    await outbox.enqueue({ op: 'write', url, body: 'bytes', ...options });
    await edit((record) => {
      record.item.url = `${root}other`;
    });
    if (action === 'replay') await outbox.replay(client.client);
    else await outbox.retry();
    expect(outbox.pending()[0]?.status).toBe('failed');
    noStorage(client);
  });

  it.each([
    'command',
    'other',
    'invalid',
  ] as const)('matches the Solid create destination with an advertised trash endpoint: %s', async (mode) => {
    const outbox = box();
    const client = storage();
    const endpoint = `${root}trash/`;
    Object.assign(client.client.features.trash, {
      state: 'available',
      detail: { endpoint: mode === 'invalid' ? 'https://foreign.example/' : endpoint },
    });
    client.fetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { etag: '"new"', location: `${endpoint}assigned` },
      }),
    );
    const matcher = vi.fn(() => false);
    outbox.registerGuardPolicy('unrelated', matcher);
    const container = mode === 'command' ? endpoint : root;
    await withOutbox(client.client, outbox).create(container, JSON.stringify({ resource: url }), {
      name: 'b',
      contentType: 'application/json',
    });
    const target = mode === 'command' ? endpoint : url;
    expect(matcher).toHaveBeenCalledWith({ op: 'create', url: target, container });
    expect(client.fetch.mock.calls[0]?.[0]).toBe(target);
  });

  it.each([
    'write',
    'writeRdf',
    'delete',
    'create',
  ] as const)('matches ordinary and queued %s on the canonical target', async (op) => {
    const outbox = box();
    const client = storage();
    const wrapped = withOutbox(client.client, outbox);
    const matcher = vi.fn((request) => request.url === url);
    outbox.registerGuardPolicy(tag, matcher);
    for (const spelling of [
      `${root}a/../b`,
      `${root}a/%2E%2e/b`,
      'https://POD.EXAMPLE:443/store/b',
    ]) {
      for (const queue of [false, true]) {
        const opts = { ...options, ...(queue ? { offline: 'queue' as const } : {}) };
        const call = () => {
          if (op === 'write') return wrapped.write(spelling, 'bytes', opts);
          if (op === 'writeRdf')
            return wrapped.writeRdf(spelling, [], { ...opts, contentType: 'text/turtle' });
          if (op === 'delete') return wrapped.delete(spelling, opts);
          return wrapped.create(`${root}a/%2e%2e/`, 'bytes', { ...opts, name: 'b' });
        };
        await expect(call()).rejects.toThrow('guard required');
      }
    }
    expect(matcher.mock.calls.every(([request]) => request.url === url)).toBe(true);
    noStorage(client);
  });

  it.each([
    'write',
    'delete',
    'create',
  ] as const)('delivers canonical guarded %s arguments to the delegate and backend', async (op) => {
    const outbox = box();
    const client = storage();
    const wrapped = withOutbox(client.client, outbox);
    const matcher = vi.fn((request) => request.url === url);
    outbox.registerGuardPolicy(
      'unrelated',
      matcher.mockImplementation(() => false),
    );
    const delegate = vi.fn<ReplayDelegate>(async (delivery, ctx) => {
      if (delivery.op === 'write')
        return ctx.storage.write(delivery.url, delivery.body as Uint8Array, { ...options });
      if (delivery.op === 'delete')
        return ctx.storage.delete(delivery.url, { ifMatch: options.ifMatch });
      return ctx.storage.create(
        delivery.container as string,
        delivery.body,
        delivery.createOptions,
      );
    });
    outbox.registerDelegate(tag, delegate);
    const opts = { ...options, guard: { tag }, offline: 'queue' as const };
    if (op === 'write') await wrapped.write(`${root}a/../b`, 'bytes', opts);
    else if (op === 'delete') await wrapped.delete(`${root}a/%2e%2e/b`, opts);
    else await wrapped.create(`${root}a/../`, 'bytes', { ...opts, name: 'b' });
    expect(delegate.mock.calls[0]?.[0]).toMatchObject({ op, url });
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
    expect(matcher.mock.calls.every(([request]) => request.url === url)).toBe(true);
  });

  it('normalizes the slashless storage root alias before describing a Solid create', async () => {
    const outbox = box();
    const client = storage();
    const wrapped = withOutbox(client.client, outbox);
    const matcher = vi.fn(() => false);
    outbox.registerGuardPolicy(tag, matcher);
    await wrapped.create(root.slice(0, -1), 'bytes', { contentType: 'text/plain', name: 'b' });
    expect(matcher).toHaveBeenCalledWith({ op: 'create', url, container: root });
    expect(client.fetch.mock.calls[0]?.[0]).toBe(url);
  });

  it.each([
    'solid',
    'lws',
  ] as const)('describes resolve-both through the same %s create path', async (protocol) => {
    const outbox = box();
    const client = storage(protocol);
    withOutbox(client.client, outbox);
    await outbox.enqueue({ op: 'write', url, body: 'bytes', ...options, guard: { tag } });
    const delegate = vi
      .fn<ReplayDelegate>()
      .mockRejectedValueOnce(
        new StorageError('precondition-failed', { url, method: 'PUT', status: 412 }),
      )
      .mockImplementationOnce(async (delivery, ctx) =>
        ctx.storage.create(delivery.container as string, delivery.body, delivery.createOptions),
      );
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    vi.mocked(client.client.parentOf).mockResolvedValue(`${root}a/../`);
    const matcher = vi.fn(() => false);
    outbox.registerGuardPolicy('unrelated', matcher);
    await outbox.resolve(outbox.conflicts()[0]?.id as string, 'both');
    const target = protocol === 'solid' ? `${root}b-conflict-1000` : root;
    expect(delegate.mock.calls[1]?.[0]).toMatchObject({
      op: 'create',
      url: target,
      container: root,
      name: 'b-conflict-1000',
    });
    expect(matcher).toHaveBeenCalledWith({ op: 'create', url: target, container: root });
    expect(client.fetch.mock.calls[0]?.[0]).toBe(target);
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    undefined,
    'queue',
  ] as const)('allows LWS slash name hints with an unrelated policy (offline=%s)', async (offline) => {
    const outbox = box();
    const client = storage('lws');
    const wrapped = withOutbox(client.client, outbox);
    const matcher = vi.fn(() => false);
    outbox.registerGuardPolicy('unrelated', matcher);
    const container = `${root}opaque-container`;
    const name = 'Report 2026/2027';
    if (offline) vi.stubGlobal('navigator', { onLine: false });
    const result = await wrapped.create(container, 'bytes', {
      name,
      contentType: 'text/plain',
      offline,
    });
    if (offline) {
      expect(result.queued).toBe(true);
      expect(outbox.pending()).toMatchObject([{ url: container, container, name }]);
      const reopened = box();
      await reopened.ready;
      expect(reopened.pending()[0]?.status).toBe('waiting');
      await reopened.replay(client.client);
      expect(reopened.pending()).toEqual([]);
    }
    expect(matcher).toHaveBeenCalledWith({ op: 'create', url: container, container });
    expect(client.fetch).toHaveBeenCalledOnce();
    expect(client.fetch.mock.calls[0]?.[0]).toBe(container);
    expect(new Headers(client.fetch.mock.calls[0]?.[1]?.headers).get('slug')).toBe(
      encodeURIComponent(name),
    );
  });

  it('lets the LWS backend reject invalid hints without treating them as Solid paths', async () => {
    const outbox = box();
    const client = storage('lws');
    outbox.registerGuardPolicy('unrelated', () => false);
    await expect(
      withOutbox(client.client, outbox).create(root, 'bytes', {
        name: 'invalid\n',
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('Invalid name hint');
    expect(client.client.create).toHaveBeenCalledOnce();
    expect(client.fetch).not.toHaveBeenCalled();
  });
});
