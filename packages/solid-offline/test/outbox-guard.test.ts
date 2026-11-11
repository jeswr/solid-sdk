// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type StorageClient, StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { DataFactory } from 'n3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOutbox,
  type GuardedDelivery,
  type JsonValue,
  type Outbox,
  type OutboxGuard,
  type OutboxOperation,
  type ReplayDelegate,
  withOutbox,
} from '../src/outbox.js';

const root = 'https://pod.example/';
const url = `${root}file.bin`;
const webId = `${root}profile#me`;
const tag = 'app.policy-v1';
const guard = { tag, assertions: { policies: ['"acl"'], enabled: true } };
const writeOptions = { contentType: 'application/octet-stream', ifMatch: '"old"' };
const failure = (code: ConstructorParameters<typeof StorageError>[0], extra = {}) =>
  new StorageError(code, { url, method: 'PUT', ...extra });
let idb: IDBFactory;
let boxes: Outbox[];
function box() {
  const outbox = createOutbox({ webId, idb, now: () => 1000 });
  boxes.push(outbox);
  return outbox;
}
function storage() {
  const client = createMemoryStorage({ root });
  const write = vi.spyOn(client, 'write');
  const create = vi.spyOn(client, 'create');
  const remove = vi.spyOn(client, 'delete');
  const head = vi.spyOn(client, 'head');
  return { client, write, create, remove, head };
}
function enqueue(outbox: Outbox, operation: Partial<OutboxOperation> = {}) {
  return outbox.enqueue({ op: 'write', url, body: 'hello', ...writeOptions, guard, ...operation });
}
interface TestStoredItem {
  guard: { tag: string; assertions?: unknown };
  item: { guard: { tag: string; assertions?: unknown }; status: string };
}
async function stored(change: (record: TestStoredItem) => void) {
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
        const record = request.result[0];
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
function expectNoDelivery(client: ReturnType<typeof storage>) {
  expect(client.write).not.toHaveBeenCalled();
  expect(client.create).not.toHaveBeenCalled();
  expect(client.remove).not.toHaveBeenCalled();
}
beforeEach(() => {
  idb = new IDBFactory();
  boxes = [];
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => {
  for (const outbox of boxes) outbox.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guarded delivery', () => {
  it.each([
    true,
    false,
  ])('preserves legacy createOptions.keepalive=%s in delivery snapshots', async (keepalive) => {
    const original = box();
    await enqueue(original, {
      op: 'create',
      container: root,
      name: 'file.bin',
      createOptions: { name: 'file.bin', keepalive },
    });
    await stored((record) => {
      Reflect.deleteProperty(record, 'keepalive');
      Reflect.deleteProperty(record, 'createMode');
    });
    original.close();
    const outbox = box();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(storage().client);
    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({ keepalive, createOptions: { name: 'file.bin', keepalive } }),
      expect.anything(),
    );
  });

  it.each([
    'write',
    'create',
    'delete',
  ] as const)('rehydrates %s assertions privately and delivers a defensive request', async (op) => {
    const original = box();
    const assertions = { policies: ['"captured"'] };
    const body = new Uint8Array([0, 255]);
    const createOptions = { name: 'file.bin', links: [{ rel: 'test', target: 'urn:type' }] };
    await enqueue(original, {
      op,
      body,
      guard: { tag, assertions },
      container: root,
      name: 'file.bin',
      createOptions,
      deleteOptions: { recursive: true },
      keepalive: true,
    });
    assertions.policies[0] = 'changed';
    body.fill(1);
    original.close();
    const outbox = box();
    await outbox.ready;
    expect(outbox.pending()[0]).toMatchObject({ guard: { tag }, blocked: 'no-delegate' });
    expect(outbox.pending()[0]?.guard).toEqual({ tag });
    const snapshot = outbox.pending()[0]?.guard as { tag: string };
    snapshot.tag = 'changed';
    const client = storage();
    const delegate = vi.fn<ReplayDelegate>(async (delivery, ctx) => {
      expect(delivery).toMatchObject({
        op,
        url,
        container: root,
        name: 'file.bin',
        body: new Uint8Array([0, 255]),
        ifMatch: '"old"',
        createOptions,
        deleteOptions: { recursive: true },
        keepalive: true,
        assertions: { policies: ['"captured"'] },
        purpose: 'replay',
      });
      expect(ctx.storage).toBe(client.client);
      expect(ctx.signal.aborted).toBe(false);
      delivery.body?.fill(2);
      (delivery.assertions as { policies: string[] }).policies.push('delegate mutation');
      throw failure('network');
    });
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    expect(outbox.pending()[0]?.guard).toEqual({ tag });
    expect(await outbox.localBody(outbox.pending()[0]?.id as string)).toEqual(
      new Uint8Array([0, 255]),
    );
    delegate.mockImplementationOnce(async (delivery) => {
      expect(delivery.assertions).toEqual({ policies: ['"captured"'] });
    });
    await outbox.replay(client.client);
    expect(outbox.pending()).toEqual([]);
    expectNoDelivery(client);
  });

  it('holds absent delegates and later same-URL work, continues other URLs and retries after registration', async () => {
    const outbox = box();
    const client = storage();
    client.write.mockResolvedValue({ url, etag: null, created: false });
    await enqueue(outbox);
    await enqueue(outbox, { guard: undefined });
    await enqueue(outbox, { url: `${root}other`, guard: undefined });
    const progress = vi.fn();
    await outbox.replay(client.client, { onProgress: progress });
    expect(outbox.pending()).toMatchObject([
      { status: 'waiting', blocked: 'no-delegate' },
      { status: 'waiting' },
    ]);
    expect(client.write.mock.calls.map(([target]) => target)).toEqual([`${root}other`]);
    expect(progress.mock.calls).toEqual([
      [0, 5],
      [5, 5],
    ]);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    expect(outbox.pending()[0]?.blocked).toBeUndefined();
    await outbox.retry();
    expect(delegate).toHaveBeenCalledOnce();
    expect(client.write).toHaveBeenCalledTimes(2);
    expect(outbox.pending()).toEqual([]);
  });

  it('never calls storage or progress without a delegate, including interrupted records', async () => {
    const outbox = box();
    await enqueue(outbox);
    await stored((record) => {
      record.item.status = 'replaying';
    });
    const client = storage();
    const progress = vi.fn();
    await outbox.replay(client.client, { onProgress: progress });
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'no-delegate' }]);
    expect(progress).not.toHaveBeenCalled();
    expect(client.head).not.toHaveBeenCalled();
    expectNoDelivery(client);
  });

  it('validates and deduplicates registrations, makes unregister idempotent, and clears them on close', async () => {
    const outbox = box();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    expect(() => outbox.registerDelegate('Bad tag', delegate)).toThrow('guard tag');
    const unregister = outbox.registerDelegate(tag, delegate);
    expect(() => outbox.registerDelegate(tag, delegate)).toThrow('duplicate');
    unregister();
    const stop = outbox.registerDelegate(tag, delegate);
    unregister();
    await enqueue(outbox);
    const client = storage();
    await outbox.replay(client.client);
    expect(delegate).toHaveBeenCalledOnce();
    await enqueue(outbox);
    outbox.close();
    stop();
    expect(() => outbox.registerDelegate(tag, delegate)).toThrow('closed');
    const reopened = box();
    await reopened.replay(client.client);
    expect(reopened.pending()).toMatchObject([{ blocked: 'no-delegate' }]);
    expect(delegate).toHaveBeenCalledOnce();
    expectNoDelivery(client);
  });

  it.each([
    [failure('network'), 'waiting'],
    [new TypeError('Failed to fetch'), 'waiting'],
    [failure('precondition-failed', { status: 412, etag: '"remote"' }), 'conflict'],
    [failure('forbidden'), 'failed'],
    [new Error('Policy changed'), 'failed'],
    [new TypeError('Invalid policy'), 'failed'],
    ['plain failure', 'failed'],
  ] as const)('classifies delegate failure %s as %s without a raw fallback', async (error, status) => {
    const outbox = box();
    await enqueue(outbox);
    await enqueue(outbox, { url: `${root}second` });
    const delegate = vi
      .fn<ReplayDelegate>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    const client = storage();
    await outbox.replay(client.client);
    expect(outbox.pending()[0]?.status).toBe(status);
    expect(delegate).toHaveBeenCalledTimes(status === 'waiting' ? 1 : 2);
    if (status === 'conflict') expect(outbox.conflicts()[0]?.remoteEtag).toBe('"remote"');
    if (status === 'failed') {
      expect(outbox.pending()[0]?.error).toBe(error instanceof Error ? error.message : error);
      await outbox.retry();
      expect(outbox.pending()).toEqual([]);
    }
    expectNoDelivery(client);
  });

  it('cancels delegate work on close and retains its bytes', async () => {
    const outbox = box();
    await enqueue(outbox);
    outbox.registerDelegate(tag, async (_delivery, ctx) => {
      outbox.close();
      expect(ctx.signal.aborted).toBe(true);
      ctx.signal.throwIfAborted();
    });
    await outbox.replay(storage().client);
    const reopened = box();
    await reopened.ready;
    expect(reopened.pending()[0]?.status).toBe('waiting');
  });

  it('keeps a missing delegate waiting if a progress observer unregisters it', async () => {
    const outbox = box();
    await enqueue(outbox);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    const unregister = outbox.registerDelegate(tag, delegate);
    const progress = vi.fn(() => unregister());
    await outbox.replay(storage().client, { onProgress: progress });
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'no-delegate' }]);
    expect(delegate).not.toHaveBeenCalled();
    expect(progress.mock.calls).toHaveLength(1);
  });

  it.each([
    undefined,
    null,
    { code: 'network' },
    Object.create(null),
  ])('marks non-Error rejection %s failed', async (error) => {
    const outbox = box();
    await enqueue(outbox);
    outbox.registerDelegate(tag, async () => {
      throw error;
    });
    await outbox.replay(storage().client);
    expect(outbox.pending()).toMatchObject([{ status: 'failed', error: expect.any(String) }]);
  });

  it('does not deliver if registration disappears while persisting replay status', async () => {
    const outbox = box();
    await enqueue(outbox);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    const unregister = outbox.registerDelegate(tag, delegate);
    outbox.on('change', () => {
      if (outbox.pending()[0]?.status === 'replaying') unregister();
    });
    await outbox.replay(storage().client);
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'no-delegate' }]);
    expect(delegate).not.toHaveBeenCalled();
  });
});

describe('trusted guard policies', () => {
  it('accepts the matching guard for replay and online delivery, even if its matcher throws', async () => {
    const outbox = box();
    outbox.registerGuardPolicy(tag, () => {
      throw new Error('unavailable');
    });
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    const client = storage();
    await enqueue(outbox);
    await outbox.replay(client.client);
    await withOutbox(client.client, outbox).write(url, 'online', { ...writeOptions, guard });
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(outbox.pending()).toEqual([]);
    expectNoDelivery(client);
    outbox.registerGuardPolicy('another.policy', () => true);
    await expect(
      withOutbox(client.client, outbox).write(url, 'online', { ...writeOptions, guard }),
    ).rejects.toThrow('guard required');
    expect(delegate).toHaveBeenCalledTimes(2);
  });

  it.each([
    'write',
    'writeRdf',
    'create',
    'delete',
  ] as const)('refuses unguarded online %s with and without queue opt-in', async (op) => {
    const outbox = box();
    outbox.registerGuardPolicy(tag, () => true);
    const client = storage();
    const rdf = vi.spyOn(client.client, 'writeRdf');
    const wrapped = withOutbox(client.client, outbox);
    for (const queue of [false, true]) {
      const opts = { ...writeOptions, ...(queue ? { offline: 'queue' as const } : {}) };
      const call = async () => {
        if (op === 'write') return wrapped.write(url, 'body', opts);
        if (op === 'writeRdf')
          return wrapped.writeRdf(url, [], { ...opts, contentType: 'text/turtle' });
        if (op === 'create') return wrapped.create(root, 'body', { ...opts, name: 'file.bin' });
        return wrapped.delete(url, opts);
      };
      await expect(call()).rejects.toThrow('guard required');
    }
    await expect(wrapped.create(root, null)).rejects.toThrow('guard required');
    await expect(wrapped.delete(url)).rejects.toThrow('guard required');
    expectNoDelivery(client);
    expect(rdf).not.toHaveBeenCalled();
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    'stripped',
    'different-tag',
  ] as const)('blocks %s records on hydrate without storage calls', async (tamper) => {
    const original = box();
    await enqueue(original);
    await stored((record) => {
      if (tamper === 'stripped') {
        Reflect.deleteProperty(record, 'guard');
        Reflect.deleteProperty(record.item, 'guard');
      } else {
        record.guard.tag = 'other.policy';
        record.item.guard.tag = 'other.policy';
      }
      record.item.status = 'replaying';
    });
    original.close();
    const outbox = box();
    outbox.registerGuardPolicy(tag, (operation) => operation.url === url);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate('other.policy', delegate);
    await outbox.ready;
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'guard-required' }]);
    const client = storage();
    const progress = vi.fn();
    await outbox.replay(client.client, { onProgress: progress });
    await outbox.retry();
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'guard-required' }]);
    expect(progress).not.toHaveBeenCalled();
    expect(delegate).not.toHaveBeenCalled();
    expect(client.head).not.toHaveBeenCalled();
    expectNoDelivery(client);
  });

  it('checks policies registered after hydration, holds the same URL and lets other URLs proceed', async () => {
    const outbox = box();
    await enqueue(outbox, { guard: undefined });
    await enqueue(outbox);
    await enqueue(outbox, { url: `${root}other`, guard: undefined });
    const matches = vi.fn((operation) => operation.url === url);
    const stop = outbox.registerGuardPolicy(tag, matches);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    const client = storage();
    client.write.mockResolvedValue({ url, etag: null, created: false });
    await outbox.replay(client.client);
    expect(client.write.mock.calls.map(([target]) => target)).toEqual([`${root}other`]);
    expect(outbox.pending()).toMatchObject([
      { status: 'waiting', blocked: 'guard-required' },
      { status: 'waiting' },
    ]);
    expect(delegate).not.toHaveBeenCalled();
    expect(matches).toHaveBeenCalledWith({ op: 'write', url, container: undefined });
    stop();
    await outbox.retry();
    expect(delegate).toHaveBeenCalledOnce();
    expect(outbox.pending()).toEqual([]);
  });

  it('fails closed when a matcher throws, without exposing mutable records to it', async () => {
    const outbox = box();
    await enqueue(outbox, { guard: undefined });
    outbox.registerGuardPolicy(tag, (operation) => {
      operation.url = `${root}changed`;
      throw new Error('unavailable');
    });
    const client = storage();
    await outbox.replay(client.client);
    expect(outbox.pending()).toMatchObject([{ url, status: 'waiting', blocked: 'guard-required' }]);
    expectNoDelivery(client);
  });

  it('preserves delivery of legacy records without a policy and clears policies on close', async () => {
    const original = box();
    await enqueue(original, { guard: undefined });
    original.registerGuardPolicy(tag, () => true);
    original.close();
    const outbox = box();
    const client = storage();
    client.write.mockResolvedValue({ url, etag: null, created: false });
    await outbox.replay(client.client);
    expect(client.write).toHaveBeenCalledOnce();
    expect(outbox.pending()).toEqual([]);
  });

  it('validates tags, rejects duplicates, unregisters idempotently and emits changes', async () => {
    const outbox = box();
    await enqueue(outbox, { guard: undefined });
    const change = vi.fn();
    outbox.on('change', change);
    expect(() => outbox.registerGuardPolicy('INVALID', () => true)).toThrow('guard tag');
    const stop = outbox.registerGuardPolicy(tag, () => true);
    expect(() => outbox.registerGuardPolicy(tag, () => false)).toThrow('duplicate');
    expect(outbox.pending()[0]?.blocked).toBe('guard-required');
    stop();
    const next = outbox.registerGuardPolicy(tag, () => true);
    stop();
    expect(outbox.pending()[0]?.blocked).toBe('guard-required');
    next();
    expect(outbox.pending()[0]?.blocked).toBeUndefined();
    expect(change).toHaveBeenCalledTimes(4);
    outbox.close();
    expect(() => outbox.registerGuardPolicy(tag, () => true)).toThrow('closed');
  });

  it.each([
    'persist',
    'progress',
  ] as const)('checks again when a policy is registered during %s', async (when) => {
    const outbox = box();
    await enqueue(outbox, { guard: undefined });
    let installed = false;
    const install = () => {
      if (!installed && outbox.pending()[0]?.status === 'replaying') {
        installed = true;
        outbox.registerGuardPolicy(tag, () => true);
      }
    };
    if (when === 'persist') outbox.on('change', install);
    const client = storage();
    await outbox.replay(client.client, { onProgress: when === 'progress' ? install : undefined });
    expect(installed).toBe(true);
    expect(outbox.pending()).toMatchObject([{ status: 'waiting', blocked: 'guard-required' }]);
    expectNoDelivery(client);
  });

  it.each([
    'mine',
    'both',
  ] as const)('rejects %s under a late policy before any storage call', async (strategy) => {
    const outbox = box();
    const { client, conflictId } = await guardedConflict(outbox);
    outbox.registerGuardPolicy('other.policy', () => true);
    await expect(outbox.resolve(conflictId, strategy)).rejects.toThrow('guard required');
    expect(outbox.conflicts()).toHaveLength(1);
    expect(client.head).not.toHaveBeenCalled();
    expectNoDelivery(client);
    await outbox.resolve(conflictId, 'theirs');
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    'mine',
    'both',
  ] as const)('rejects %s after both guard fields are removed from a conflict', async (strategy) => {
    const outbox = box();
    const { client, conflictId } = await guardedConflict(outbox);
    await stored((record) => {
      Reflect.deleteProperty(record, 'guard');
      Reflect.deleteProperty(record.item, 'guard');
    });
    outbox.registerGuardPolicy(tag, () => true);
    await expect(outbox.resolve(conflictId, strategy)).rejects.toThrow('guard required');
    expect(outbox.conflicts()).toHaveLength(1);
    expect(client.head).not.toHaveBeenCalled();
    expectNoDelivery(client);
  });

  it('checks a policy installed while buffering an online request', async () => {
    const outbox = box();
    const client = storage();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        outbox.registerGuardPolicy(tag, () => true);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    await expect(
      withOutbox(client.client, outbox).write(url, body, { ...writeOptions, offline: 'queue' }),
    ).rejects.toThrow('guard required');
    expectNoDelivery(client);
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    'mine',
    'both',
  ] as const)('checks late policies after preparing %s resolution', async (strategy) => {
    const outbox = box();
    const { client, conflictId } = await guardedConflict(outbox);
    const install = () => outbox.registerGuardPolicy('another.policy', () => true);
    if (strategy === 'mine')
      client.head.mockImplementationOnce(async () => {
        install();
        return { etag: '"latest"' } as Awaited<ReturnType<StorageClient['head']>>;
      });
    else
      vi.spyOn(client.client, 'parentOf').mockImplementationOnce(async () => {
        install();
        return root;
      });
    await expect(outbox.resolve(conflictId, strategy)).rejects.toThrow('guard required');
    expect(outbox.conflicts()).toHaveLength(1);
    expectNoDelivery(client);
  });

  it('checks the transformed copy request against policies before bare delivery', async () => {
    const outbox = box();
    const { client, conflictId } = await guardedConflict(outbox);
    await stored((record) => {
      Reflect.deleteProperty(record, 'guard');
      Reflect.deleteProperty(record.item, 'guard');
    });
    outbox.registerGuardPolicy(tag, ({ op }) => op === 'create');
    await expect(outbox.resolve(conflictId, 'both')).rejects.toThrow('guard required');
    expect(outbox.conflicts()).toHaveLength(1);
    expectNoDelivery(client);
  });
});

describe('guard validation', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const accessor = Object.defineProperty({}, 'value', { get: () => 'secret', enumerable: true });
  const hidden = Object.defineProperty({}, 'value', { value: 'secret' });
  class Custom {}
  class CustomArray extends Array {}
  it.each([
    undefined,
    () => 1,
    new Date(),
    new Custom(),
    new CustomArray(),
    cyclic,
    NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol('value'),
    new Map(),
    new Set(),
    new Uint8Array([1]),
    [undefined],
    { nested: undefined },
    [() => 1],
    new Array(2),
    accessor,
    hidden,
    { [Symbol('key')]: 1 },
    Object.assign([], { extra: true }),
  ])('rejects non-JSON assertions: %s', async (assertions) => {
    const outbox = box();
    await expect(enqueue(outbox, { guard: { tag, assertions } as OutboxGuard })).rejects.toThrow(
      'guard',
    );
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });
  it.each([
    '',
    'Upper',
    '-first',
    'has space',
    'slash/tag',
    'é',
    `a${'b'.repeat(64)}`,
    1,
  ])('rejects invalid tag %s', async (badTag) => {
    await expect(enqueue(box(), { guard: { tag: badTag } as OutboxGuard })).rejects.toThrow(
      'guard tag',
    );
  });
  it.each([
    null,
    [],
    'tag',
    {},
    { tag, extra: 1 },
    { tag, assertions: null, extra: 1 },
    Object.defineProperty({ tag }, 'assertions', { value: null }),
    { tag, [Symbol('guard')]: 1 },
  ])('rejects malformed guard %s', async (bad) => {
    await expect(enqueue(box(), { guard: bad as OutboxGuard })).rejects.toThrow('guard');
  });
  it('bounds UTF-8 serialized assertions at 16 KiB and accepts plain JSON without losing values', async () => {
    const outbox = box();
    await expect(
      enqueue(outbox, { guard: { tag, assertions: 'x'.repeat(16383) } }),
    ).rejects.toThrow('16 KiB');
    await expect(enqueue(outbox, { guard: { tag, assertions: 'é'.repeat(8192) } })).rejects.toThrow(
      '16 KiB',
    );
    const repeated = { shared: true };
    const values: JsonValue[] = [
      null,
      true,
      false,
      3.5,
      '',
      '€',
      [],
      { values: [1, 's', null], first: repeated, second: repeated },
      Object.create(null),
      'x'.repeat(16382),
    ];
    for (const assertions of values) await enqueue(outbox, { guard: { tag, assertions } });
    await enqueue(outbox, { guard: { tag } });
    const delivered: (JsonValue | undefined)[] = [];
    outbox.registerDelegate(tag, async (delivery) => {
      delivered.push(delivery.assertions);
    });
    await outbox.replay(storage().client);
    expect(delivered).toEqual([...values, undefined]);
  });

  it('bounds depth and node count before reaching later properties', async () => {
    const outbox = box();
    let deep: JsonValue = null;
    for (let i = 0; i < 10000; i++) deep = { nested: deep };
    await expect(enqueue(outbox, { guard: { tag, assertions: deep } })).rejects.toThrow('depth');
    await expect(
      enqueue(outbox, { guard: { tag, assertions: Array.from({ length: 2000 }, () => null) } }),
    ).rejects.toThrow('2,000 nodes');
    let boundary: JsonValue = null;
    for (let i = 0; i < 32; i++) boundary = [boundary];
    await enqueue(outbox, { guard: { tag, assertions: boundary } });
    await enqueue(outbox, {
      guard: { tag, assertions: Array.from({ length: 1999 }, () => 0) },
    });
    expect(outbox.pending()).toHaveLength(2);
  });

  it('rejects a huge array before enumerating its keys or visiting any element', async () => {
    const ownKeys = vi.fn(() => {
      throw new Error('array keys were enumerated');
    });
    const assertions = new Proxy(new Array(1_000_000), { ownKeys });
    await expect(enqueue(box(), { guard: { tag, assertions } })).rejects.toThrow('2,000 nodes');
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it('rejects the next object key as soon as nested values consume the remaining budget', async () => {
    const assertions = { first: Array.from({ length: 1998 }, () => 0), next: 0 };
    await expect(enqueue(box(), { guard: { tag, assertions } })).rejects.toThrow('2,000 nodes');
  });

  it('stops a wide object before materializing all its own keys or reading later descriptors', async () => {
    const assertions = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, i) => [String(i), 0]),
    );
    const ownKeys = vi.spyOn(Reflect, 'ownKeys');
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    await expect(enqueue(box(), { guard: { tag, assertions } })).rejects.toThrow(
      /2,000 nodes|16 KiB/,
    );
    expect(ownKeys.mock.calls.some(([value]) => value === assertions)).toBe(false);
    const visited = descriptors.mock.calls.filter(([value]) => value === assertions);
    expect(visited.length).toBeLessThanOrEqual(2000);
    expect(visited.some(([, key]) => key === '99999')).toBe(false);
  });

  it('bounds top-level guard fields before materializing a wide key list', async () => {
    const malformed = {
      tag,
      assertions: null,
      ...Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [String(i), 0])),
    };
    const ownKeys = vi.spyOn(Reflect, 'ownKeys');
    await expect(enqueue(box(), { guard: malformed })).rejects.toThrow('guard');
    expect(ownKeys.mock.calls.some(([value]) => value === malformed)).toBe(false);
  });

  it('ignores inherited enumerable properties without copying them into guards or assertions', async () => {
    const outbox = box();
    Object.defineProperty(Object.prototype, 'inheritedAssertion', {
      enumerable: true,
      configurable: true,
      value: 42,
    });
    let queued: ReturnType<typeof enqueue>;
    try {
      queued = enqueue(outbox, { guard: { tag, assertions: {} } });
    } finally {
      Reflect.deleteProperty(Object.prototype, 'inheritedAssertion');
    }
    await queued;
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(storage().client);
    expect(delegate.mock.calls[0]?.[0].assertions).toEqual({});
  });

  it.each([
    ['large string', { first: 'é'.repeat(100000), later: undefined }],
    ['large key', { ['é'.repeat(100000)]: null, later: undefined }],
    ['backslash', '\\'.repeat(8192)],
    ['control', '\u0000'.repeat(3000)],
    ['lone surrogate', '\ud800'.repeat(3000)],
    ['surrogate pair', '😀'.repeat(4096)],
  ])('stops at the running serialized UTF-8 budget: %s', async (_name, assertions) => {
    await expect(enqueue(box(), { guard: { tag, assertions } as OutboxGuard })).rejects.toThrow(
      '16 KiB',
    );
  });

  it.each([
    (record: TestStoredItem) => {
      record.guard.tag = 'INVALID';
    },
    (record: TestStoredItem) => {
      record.guard.assertions = { bad: undefined };
    },
    (record: TestStoredItem) => {
      record.guard.assertions = new Date();
    },
    (record: TestStoredItem) => {
      record.guard.assertions = 'x'.repeat(16383);
    },
    (record: TestStoredItem) => {
      Object.assign(record, { guard: null });
    },
    (record: TestStoredItem) => {
      Reflect.deleteProperty(record, 'guard');
    },
    (record: TestStoredItem) => {
      record.item.guard.tag = 'other';
    },
    (record: TestStoredItem) => {
      Reflect.deleteProperty(record.item, 'guard');
    },
  ])('quarantines tampered persisted guards during hydration and retry: %s', async (tamper) => {
    const original = box();
    await enqueue(original);
    await stored(tamper);
    original.close();
    const outbox = box();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.ready;
    expect(outbox.pending()).toMatchObject([
      { status: 'failed', error: expect.stringContaining('invalid stored guard') },
    ]);
    const client = storage();
    await outbox.replay(client.client);
    await outbox.retry();
    const reopened = box();
    await reopened.ready;
    expect(reopened.pending()[0]?.status).toBe('failed');
    expect(delegate).not.toHaveBeenCalled();
    expectNoDelivery(client);
  });
});

async function guardedConflict(outbox: Outbox, op: OutboxOperation['op'] = 'write') {
  await enqueue(outbox, {
    op,
    keepalive: true,
    ...(op === 'create' ? { container: root, name: 'file.bin' } : {}),
  });
  const delegate = vi
    .fn<ReplayDelegate>()
    .mockRejectedValueOnce(failure('precondition-failed', { status: 412 }));
  const unregister = outbox.registerDelegate(tag, delegate);
  const client = storage();
  client.head.mockResolvedValue({ etag: '"latest"' } as Awaited<ReturnType<StorageClient['head']>>);
  await outbox.replay(client.client);
  const conflictId = outbox.conflicts()[0]?.id as string;
  return { delegate, unregister, client, conflictId };
}
describe('guarded conflicts', () => {
  it.each([
    'write',
    'create',
    'delete',
  ] as const)('resolves mine for %s through its delegate with the fresh ETag', async (op) => {
    const outbox = box();
    const { delegate, client, conflictId } = await guardedConflict(outbox, op);
    delegate.mockResolvedValue(undefined);
    await outbox.resolve(conflictId, 'mine');
    expect(delegate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        op: op === 'delete' ? 'delete' : 'write',
        url,
        ifMatch: '"latest"',
        body: new TextEncoder().encode('hello'),
        assertions: guard.assertions,
        purpose: 'resolve-mine',
        keepalive: true,
      }),
      expect.objectContaining({ storage: client.client, signal: expect.any(AbortSignal) }),
    );
    expect(client.head).toHaveBeenCalledWith(url, { revalidate: true });
    expectNoDelivery(client);
    expect(outbox.pending()).toEqual([]);
  });
  it.each([
    'write',
    'create',
  ] as const)('resolves both for %s with a guarded create and copy name', async (op) => {
    const outbox = box();
    const { delegate, client, conflictId } = await guardedConflict(outbox, op);
    delegate.mockResolvedValue(undefined);
    await outbox.resolve(conflictId, 'both');
    expect(delegate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        op: 'create',
        url: `${root}file-conflict-1000.bin`,
        container: root,
        name: 'file-conflict-1000.bin',
        createOptions: {
          name: 'file-conflict-1000.bin',
          contentType: writeOptions.contentType,
          keepalive: true,
        },
        assertions: guard.assertions,
        purpose: 'resolve-both',
        keepalive: true,
      }),
      expect.anything(),
    );
    expect(delegate.mock.calls.at(-1)?.[0].ifMatch).toBeUndefined();
    expectNoDelivery(client);
    expect(outbox.pending()).toEqual([]);
  });
  it.each([
    'mine',
    'both',
  ] as const)('refuses %s with no delegate, retains the conflict, and allows theirs', async (strategy) => {
    const outbox = box();
    const { delegate, unregister, client, conflictId } = await guardedConflict(outbox);
    unregister();
    await expect(outbox.resolve(conflictId, strategy)).rejects.toThrow('no replay delegate');
    expect(outbox.conflicts()).toHaveLength(1);
    expect(client.head).not.toHaveBeenCalled();
    await outbox.resolve(conflictId, 'theirs');
    expect(outbox.pending()).toEqual([]);
    expect(delegate).toHaveBeenCalledOnce();
    expectNoDelivery(client);
  });
  it.each([
    'mine',
    'both',
  ] as const)('retains %s conflicts on delegate errors, just like raw resolution', async (strategy) => {
    const outbox = box();
    const { delegate, client, conflictId } = await guardedConflict(outbox);
    delegate.mockRejectedValueOnce(new Error('Policy changed'));
    await expect(outbox.resolve(conflictId, strategy)).rejects.toThrow('Policy changed');
    expect(outbox.conflicts()).toHaveLength(1);
    expectNoDelivery(client);
  });
});

describe('guarded online writes', () => {
  const invoke = async (
    op: 'write' | 'writeRdf' | 'create' | 'delete',
    outbox: Outbox,
    client: StorageClient,
    queue = true,
    customGuard = guard,
  ) => {
    const wrapped = withOutbox(client, outbox);
    const opts = {
      ...writeOptions,
      keepalive: true,
      guard: customGuard,
      ...(queue ? { offline: 'queue' as const } : {}),
    };
    if (op === 'write') return wrapped.write(url, 'hello', opts);
    if (op === 'writeRdf')
      return wrapped.writeRdf(
        url,
        [
          DataFactory.quad(
            DataFactory.namedNode('urn:s'),
            DataFactory.namedNode('urn:p'),
            DataFactory.literal('hello'),
          ),
        ],
        { ...opts, contentType: 'text/turtle' },
      );
    if (op === 'create') return wrapped.create(root, 'hello', { ...opts, name: 'file.bin' });
    return wrapped.delete(url, opts);
  };
  it.each([
    'write',
    'writeRdf',
    'create',
    'delete',
  ] as const)('routes online %s through its delegate, returns its result, and refuses missing delegates', async (op) => {
    const outbox = box();
    const client = storage();
    const rdf = vi.spyOn(client.client, 'writeRdf');
    await expect(invoke(op, outbox, client.client)).rejects.toThrow('no replay delegate');
    const result = { url, etag: '"guarded"', created: true };
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(result);
    outbox.registerDelegate(tag, delegate);
    expect(await invoke(op, outbox, client.client)).toEqual(op === 'delete' ? undefined : result);
    const delivery = delegate.mock.calls[0]?.[0] as GuardedDelivery;
    expect(delivery).toMatchObject({
      op: op === 'writeRdf' ? 'write' : op,
      url,
      assertions: guard.assertions,
      purpose: 'replay',
      keepalive: true,
    });
    if (op === 'writeRdf')
      expect(new TextDecoder().decode(delivery.body as Uint8Array)).toContain(
        '<urn:s> <urn:p> "hello"',
      );
    if (op === 'delete') expect(delivery.body).toBeNull();
    expectNoDelivery(client);
    expect(rdf).not.toHaveBeenCalled();
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });
  it('keeps guard enforcement without queue opt-in, and never queues network errors then', async () => {
    const outbox = box();
    const client = storage();
    for (const op of ['write', 'writeRdf', 'create', 'delete'] as const) {
      await expect(invoke(op, outbox, client.client, false)).rejects.toThrow('no replay delegate');
    }
    outbox.registerDelegate(tag, async () => {
      throw failure('network');
    });
    await expect(invoke('write', outbox, client.client, false)).rejects.toMatchObject({
      code: 'network',
    });
    expect(outbox.pending()).toEqual([]);
    expectNoDelivery(client);
  });
  it('queues offline guarded requests without registration and persists assertions for later replay', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const outbox = box();
    const client = storage();
    for (const op of ['write', 'writeRdf', 'create', 'delete'] as const)
      await invoke(op, outbox, client.client);
    expect(outbox.pending()).toHaveLength(4);
    expect(outbox.pending().every((item) => item.blocked === 'no-delegate')).toBe(true);
    expectNoDelivery(client);
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await outbox.replay(client.client);
    expect(delegate).toHaveBeenCalledTimes(4);
    expect(delegate.mock.calls.every(([delivery]) => delivery.keepalive === true)).toBe(true);
    expect(
      delegate.mock.calls.every(
        ([delivery]) => JSON.stringify(delivery.assertions) === JSON.stringify(guard.assertions),
      ),
    ).toBe(true);
    expectNoDelivery(client);
  });
  it('queues delegate network errors with unmutated assertions and bytes, but propagates policy refusals', async () => {
    const outbox = box();
    const client = storage();
    const delegate = vi
      .fn<ReplayDelegate>()
      .mockImplementationOnce(async (delivery) => {
        delivery.body?.fill(0);
        throw failure('network');
      })
      .mockRejectedValueOnce(new Error('Policy refused'))
      .mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    expect(await invoke('write', outbox, client.client)).toMatchObject({ queued: true });
    expect(await outbox.localBody(outbox.pending()[0]?.id as string)).toEqual(
      new TextEncoder().encode('hello'),
    );
    await expect(invoke('create', outbox, client.client)).rejects.toThrow('Policy refused');
    await outbox.replay(client.client);
    expect(outbox.pending()).toEqual([]);
    expectNoDelivery(client);
  });
  it('validates before online delivery and refuses retained guarded clients after close', async () => {
    const outbox = box();
    const client = storage();
    const delegate = vi.fn<ReplayDelegate>().mockResolvedValue(undefined);
    outbox.registerDelegate(tag, delegate);
    await expect(
      invoke('write', outbox, client.client, true, {
        tag: 'INVALID',
        assertions: guard.assertions,
      }),
    ).rejects.toThrow('guard tag');
    const wrapped = withOutbox(client.client, outbox);
    outbox.close();
    await expect(wrapped.write(url, 'body', { ...writeOptions, guard })).rejects.toThrow('closed');
    expect(delegate).not.toHaveBeenCalled();
    expectNoDelivery(client);
  });
});
