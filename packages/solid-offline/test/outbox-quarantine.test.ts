// AUTHORED-BY Claude Opus 5.5
/**
 * Corrupted stored records (int4 review of #605, F1–F4): a record that cannot be shown or
 * sent is quarantined without blocking hydration or valid writes, a quarantined conflict
 * stays resolvable with `'theirs'`, and stored dispatch options are copied field by field.
 */
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOutbox,
  discardQuarantined,
  type Outbox,
  quarantinedRecords,
} from '../src/outbox.js';

const root = 'https://pod.example/';
const url = `${root}file.bin`;
const other = `${root}other.bin`;
const webId = `${root}profile#me`;
let idb: IDBFactory;
let boxes: Outbox[];

function box() {
  const outbox = createOutbox({ webId, idb, now: () => 1000 });
  boxes.push(outbox);
  return outbox;
}
function storage() {
  const client = createMemoryStorage({ root, protocol: 'solid' });
  // Memory writes need a validator; delivery of a write is all these tests observe.
  const write = vi
    .spyOn(client, 'write')
    .mockImplementation(async (target) => ({ url: target, etag: '"new"', created: false }));
  const create = vi.spyOn(client, 'create');
  const remove = vi.spyOn(client, 'delete');
  return { client, write, create, remove };
}
type Raw = Record<string, unknown> & { order: number; item?: unknown };
/** Rewrites every stored record (in key order); return undefined to keep the record. */
async function stored(change: (records: Raw[]) => void): Promise<Raw[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(`solid-offline-outbox:${encodeURIComponent(webId)}`, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<Raw[]>((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.getAll();
      let records: Raw[] = [];
      request.onsuccess = () => {
        records = request.result as Raw[];
        change(records);
        for (const record of records) store.put(record);
      };
      tx.oncomplete = () => resolve(records);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const readAll = () => stored(() => undefined);
const item = (record: Raw | undefined) => record?.item as Record<string, unknown>;

async function conflicted() {
  const original = box();
  await original.enqueue({
    op: 'write',
    url,
    body: 'mine',
    contentType: 'application/octet-stream',
    ifMatch: '"old"',
  });
  const client = storage();
  client.write.mockRejectedValueOnce(
    new StorageError('precondition-failed', { url, method: 'PUT', status: 412 }),
  );
  await original.replay(client.client);
  const [conflict] = original.conflicts();
  expect(conflict).toBeDefined();
  original.close();
  return conflict as NonNullable<typeof conflict>;
}

beforeEach(() => {
  idb = new IDBFactory();
  boxes = [];
});
afterEach(() => {
  for (const outbox of boxes) outbox.close();
  vi.restoreAllMocks();
});

describe('quarantined conflicts (F1)', () => {
  it.each([
    ['an invalid item', (record: Raw) => Object.assign(item(record), { size: -1 })],
    [
      'an invalid conflict field',
      (record: Raw) => Object.assign(record.conflict as object, { kind: 'other' }),
    ],
  ])('keeps a conflict with %s resolvable with theirs, and holds its URL until then', async (_, corrupt) => {
    const { itemId } = await conflicted();
    await stored(([record]) => corrupt(record as Raw));
    const outbox = box();
    await outbox.ready;
    expect(outbox.conflicts()).toEqual([]);
    const [entry] = quarantinedRecords(outbox);
    expect(entry).toEqual({
      id: expect.stringMatching(/^invalid:/),
      itemId,
      conflict: true,
      invalid: true,
    });
    const id = (entry as NonNullable<typeof entry>).id;

    // Fail closed: a later write to the same URL waits behind the unreadable conflict.
    await outbox.enqueue({ op: 'write', url, body: 'next', contentType: 'text/plain' });
    const client = storage();
    await outbox.replay(client.client);
    expect(client.write).not.toHaveBeenCalled();

    await expect(outbox.resolve(id, 'mine')).rejects.toThrow('invalid stored conflict');
    await expect(outbox.resolve(id, 'both')).rejects.toThrow('invalid stored conflict');
    expect(client.write).not.toHaveBeenCalled();
    await outbox.resolve(id, 'theirs');
    expect(quarantinedRecords(outbox)).toEqual([]);
    await outbox.replay(client.client);
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write.mock.calls[0]?.[0]).toBe(url);
    expect(outbox.pending()).toEqual([]);
  });

  it('exposes nothing from the record body of a quarantined conflict', async () => {
    await conflicted();
    await stored(([record]) => {
      Object.assign(item(record as Raw), { id: 'private-id', size: 'private-size' });
      (record as Raw).conflict = 'private-conflict';
    });
    const outbox = box();
    await outbox.ready;
    const entries = quarantinedRecords(outbox);
    expect(entries).toEqual([
      { id: expect.stringMatching(/^invalid:\d+$/), conflict: true, invalid: true },
    ]);
    expect(JSON.stringify(entries)).not.toContain('private');
  });
});

describe('malformed envelopes (F2)', () => {
  it.each([
    ['missing', (record: Raw) => delete record.item],
    ['null', (record: Raw) => Object.assign(record, { item: null })],
    ['a string', (record: Raw) => Object.assign(record, { item: 'private-item' })],
  ])('sets aside a record whose item is %s without blocking valid writes', async (_, corrupt) => {
    const original = box();
    await original.enqueue({ op: 'write', url, body: 'a', contentType: 'text/plain' });
    await original.enqueue({ op: 'write', url: other, body: 'b', contentType: 'text/plain' });
    original.close();
    await stored(([first]) => corrupt(first as Raw));
    const before = await readAll();

    const outbox = box();
    await expect(outbox.ready).resolves.toBeUndefined();
    expect(outbox.pending().map((entry) => entry.url)).toEqual([other]);
    const [entry] = quarantinedRecords(outbox);
    expect(entry).toEqual({ id: `invalid:${before[0]?.order}`, conflict: false, invalid: true });
    // Hydration neither mutates nor deletes the set-aside record.
    expect(await readAll()).toEqual(before);

    const client = storage();
    await outbox.replay(client.client);
    expect(client.write.mock.calls.map(([target]) => target)).toEqual([other]);
    expect(await readAll()).toEqual([before[0]]);

    await expect(discardQuarantined(outbox, 'invalid:999')).rejects.toThrow(
      'quarantined record not found',
    );
    await discardQuarantined(outbox, (entry as NonNullable<typeof entry>).id);
    expect(await readAll()).toEqual([]);
    expect(quarantinedRecords(outbox)).toEqual([]);
  });
});

describe('invalid failed items (F3)', () => {
  it('lists an item that is invalid by construction, never retries it, and discards it', async () => {
    const original = box();
    const queued = await original.enqueue({
      op: 'write',
      url,
      body: 'a',
      contentType: 'text/plain',
    });
    original.close();
    await stored(([record]) => Object.assign(item(record as Raw), { op: 'patch' }));
    const outbox = box();
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
    const [entry] = quarantinedRecords(outbox);
    expect(entry).toMatchObject({ itemId: queued.id, conflict: false, invalid: true });

    const client = storage();
    await outbox.replay(client.client);
    const changed = vi.fn();
    outbox.on('change', changed);
    await expect(outbox.retry()).resolves.toBeUndefined();
    await expect(outbox.retry(queued.id)).resolves.toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    expect(client.write).not.toHaveBeenCalled();
    expect(item((await readAll())[0])).toMatchObject({
      status: 'failed',
      error: '[solid-offline] invalid stored item',
    });

    await discardQuarantined(outbox, (entry as NonNullable<typeof entry>).id);
    expect(await readAll()).toEqual([]);
    expect(await outbox.localBody(queued.id)).toBeNull();
  });

  it('never returns a stored body that is not bytes', async () => {
    const original = box();
    const queued = await original.enqueue({
      op: 'write',
      url,
      body: 'a',
      contentType: 'text/plain',
    });
    original.close();
    await stored(([record]) => Object.assign(record as Raw, { body: 'private-body' }));
    const outbox = box();
    expect(await outbox.localBody(queued.id)).toBeNull();
  });
});

describe('stored dispatch options (F4)', () => {
  it.each([
    ['body', (record: Raw) => Object.assign(record, { body: 'private-body' })],
    ['ifMatch', (record: Raw) => Object.assign(record, { ifMatch: 42 })],
    ['keepalive', (record: Raw) => Object.assign(record, { keepalive: 'yes' })],
    ['deleteOptions', (record: Raw) => Object.assign(record, { deleteOptions: 'all' })],
    [
      'deleteOptions.recursive',
      (record: Raw) => Object.assign(record, { deleteOptions: { recursive: 1 } }),
    ],
    ['createOptions', (record: Raw) => Object.assign(record, { createOptions: 7 })],
    [
      'createOptions.contentType',
      (record: Raw) => Object.assign(record, { createOptions: { contentType: {} } }),
    ],
    [
      'createOptions.links',
      (record: Raw) =>
        Object.assign(record, { createOptions: { links: [{ rel: 1, target: 't' }] } }),
    ],
  ])('fails a record whose stored %s has the wrong type, before any delivery', async (_, corrupt) => {
    const original = box();
    await original.enqueue({ op: 'write', url, body: 'a', contentType: 'text/plain' });
    original.close();
    await stored(([record]) => corrupt(record as Raw));
    const outbox = box();
    await outbox.ready;
    expect(outbox.pending()).toMatchObject([
      { status: 'failed', error: '[solid-offline] invalid stored request options' },
    ]);
    const client = storage();
    await outbox.replay(client.client);
    await outbox.retry();
    expect(client.write).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
    expect(client.remove).not.toHaveBeenCalled();
  });

  it('copies stored create and delete options field by field, dropping unknown keys', async () => {
    const original = box();
    await original.enqueue({
      op: 'create',
      url: root,
      container: root,
      body: 'a',
      createOptions: {
        name: 'new.txt',
        contentType: 'text/plain',
        links: [{ rel: 'https://example.org/rel', target: 'https://example.org/t' }],
      },
    });
    await original.enqueue({ op: 'delete', url: other, deleteOptions: { recursive: false } });
    original.close();
    await stored(([create, remove]) => {
      Object.assign((create as Raw).createOptions as object, { private: 'private-option' });
      Object.assign(((create as Raw).createOptions as { links: object[] }).links[0] as object, {
        private: 'private-link',
      });
      Object.assign((remove as Raw).deleteOptions as object, { private: 'private-option' });
    });
    const outbox = box();
    await outbox.ready;
    const client = storage();
    await client.client.create(root, 'x', { name: 'other.bin', contentType: 'text/plain' });
    client.create.mockClear();
    await outbox.replay(client.client);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(client.create.mock.calls[0]?.[2])).not.toContain('private');
    expect(client.create.mock.calls[0]?.[2]).toMatchObject({
      name: 'new.txt',
      contentType: 'text/plain',
      links: [{ rel: 'https://example.org/rel', target: 'https://example.org/t' }],
    });
    expect(client.remove).toHaveBeenCalledTimes(1);
    expect(client.remove.mock.calls[0]?.[1]).toEqual({
      recursive: false,
      ifMatch: undefined,
      signal: undefined,
    });
  });

  it('binds an exact create to its exactUrl, and rejects a stored exactUrl that moved', async () => {
    const exact = `${root}exact.txt`;
    const original = box();
    const queued = await original.enqueue({
      op: 'create',
      url: root,
      container: root,
      body: 'a',
      createOptions: { exactUrl: exact, contentType: 'text/plain' },
    });
    expect(queued.url).toBe(exact);
    original.close();
    await stored(([record]) => {
      ((record as Raw).createOptions as { exactUrl: string }).exactUrl = `${root}moved.txt`;
    });
    const outbox = box();
    await outbox.ready;
    expect(outbox.pending()).toMatchObject([
      { status: 'failed', error: '[solid-offline] invalid stored request destination' },
    ]);
  });

  it('keeps both for an exact create conflict by creating a named copy', async () => {
    const exact = `${root}exact.txt`;
    const client = storage();
    await client.client.create(root, 'theirs', { exactUrl: exact, contentType: 'text/plain' });
    const outbox = box();
    await outbox.enqueue({
      op: 'create',
      url: root,
      container: root,
      body: 'mine',
      contentType: 'text/plain',
      createOptions: { exactUrl: exact, contentType: 'text/plain' },
    });
    await outbox.replay(client.client);
    const [conflict] = outbox.conflicts();
    expect(conflict?.url).toBe(exact);
    await outbox.resolve((conflict as NonNullable<typeof conflict>).id, 'both');
    expect(outbox.conflicts()).toEqual([]);
    const copy = client.create.mock.calls.at(-1)?.[2];
    expect(copy).toMatchObject({ name: 'exact-conflict-1000.txt' });
    expect(copy).not.toHaveProperty('exactUrl');
  });
});

describe('quarantine helpers', () => {
  it('are empty or reject for an outbox that is closed or was not made by createOutbox', async () => {
    const outbox = box();
    await outbox.ready;
    expect(quarantinedRecords(outbox)).toEqual([]);
    outbox.close();
    expect(quarantinedRecords(outbox)).toEqual([]);
    await expect(discardQuarantined(outbox, 'invalid:1')).rejects.toThrow('outbox is closed');
    const fake = { ...outbox };
    expect(quarantinedRecords(fake)).toEqual([]);
  });
});
