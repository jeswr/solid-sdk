// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createOutbox, type Outbox } from '../src/outbox.js';

const root = 'https://pod.example/';
const webId = `${root}profile#me`;
const boxes: Outbox[] = [];
function box(idb: IDBFactory, identity = webId) {
  const outbox = createOutbox({ webId: identity, idb });
  boxes.push(outbox);
  return outbox;
}
const enqueue = (outbox: Outbox, guard?: { tag: string }) =>
  outbox.enqueue({
    op: 'write',
    url: `${root}day`,
    body: 'private',
    contentType: 'text/plain',
    guard,
  });
afterEach(() => {
  for (const outbox of boxes.splice(0)) outbox.close();
  vi.unstubAllGlobals();
});

it('unknown IDs are inert and emit change; other items and WebIDs survive reopen', async () => {
  const idb = new IDBFactory();
  const alice = box(idb);
  const bob = box(idb, `${root}bob#me`);
  const first = await enqueue(alice);
  const second = await enqueue(alice);
  const foreign = await enqueue(bob);
  const changed = vi.fn();
  alice.on('change', changed);
  await alice.discard('unknown');
  expect(alice.pending()).toHaveLength(2);
  expect(changed).toHaveBeenCalledOnce();
  await alice.discard(first.id);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(await alice.localBody(first.id)).toBeNull();
  alice.close();
  const reopened = box(idb);
  const other = box(idb, bob.webId);
  await Promise.all([reopened.ready, other.ready]);
  expect(reopened.pending()).toEqual([second]);
  expect(other.pending()).toEqual([foreign]);
});

it.each([
  'no-delegate',
  'guard-required',
] as const)('discards a %s blocked item', async (reason) => {
  const outbox = box(new IDBFactory());
  const item = await enqueue(outbox, reason === 'no-delegate' ? { tag: 'intent.v1' } : undefined);
  if (reason === 'guard-required') outbox.registerGuardPolicy('intent.v1', () => true);
  expect(outbox.pending()[0]?.blocked).toBe(reason);
  await outbox.discard(item.id);
  expect(outbox.pending()).toEqual([]);
  expect(await outbox.localBody(item.id)).toBeNull();
});

it.each([
  'forbidden',
  'precondition-failed',
] as const)('discards %s items and conflict bytes', async (code) => {
  const idb = new IDBFactory();
  const outbox = box(idb);
  const item = await enqueue(outbox);
  const storage = createMemoryStorage({ root, protocol: 'solid' });
  vi.spyOn(storage, 'write').mockRejectedValue(
    new StorageError(code, { url: `${root}day`, method: 'PUT' }),
  );
  await outbox.replay(storage);
  expect(outbox.pending()[0]?.status).toBe(code === 'forbidden' ? 'failed' : 'conflict');
  const conflict = outbox.conflicts()[0];
  await outbox.discard(item.id);
  expect(outbox.pending()).toEqual([]);
  expect(outbox.conflicts()).toEqual([]);
  if (conflict) expect(await outbox.localBody(conflict.id)).toBeNull();
  const reopened = box(idb);
  await reopened.ready;
  expect(reopened.conflicts()).toEqual([]);
  expect(reopened.pending()).toEqual([]);
});

it('waits under the replay Web Lock while another instance delivers, then discards retained failure', async () => {
  const request = vi.fn(async (_name: string, run: () => Promise<unknown>) => run());
  vi.stubGlobal('navigator', { locks: { request } });
  const idb = new IDBFactory();
  const outbox = box(idb);
  const other = box(idb);
  const item = await enqueue(outbox);
  const storage = createMemoryStorage({ root, protocol: 'solid' });
  let fail!: (error: Error) => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(storage, 'write').mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
        started();
      }),
  );
  const replay = outbox.replay(storage);
  await sending;
  expect(outbox.pending()[0]?.status).toBe('replaying');
  let discarded = false;
  const discard = other.discard(item.id).then(() => {
    discarded = true;
  });
  await Promise.resolve();
  expect(discarded).toBe(false);
  fail(new Error('delivery failed'));
  await Promise.all([replay, discard]);
  expect(other.pending()).toEqual([]);
  expect(request.mock.calls.map(([name]) => name)).toEqual(
    Array(3).fill(`solid-offline-outbox:${encodeURIComponent(webId)}`),
  );
});

it('waits for successful delivery and becomes an unknown-id no-op', async () => {
  const outbox = box(new IDBFactory());
  const item = await enqueue(outbox);
  const storage = createMemoryStorage({ root, protocol: 'solid' });
  let finish!: () => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(storage, 'write').mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
      started();
    });
    return { url: item.url, etag: null, created: false };
  });
  const replay = outbox.replay(storage);
  await sending;
  const discard = outbox.discard(item.id);
  finish();
  await Promise.all([replay, discard]);
  expect(outbox.pending()).toEqual([]);
});

it('refuses an interrupted record still marked replaying, retaining its bytes', async () => {
  const idb = new IDBFactory();
  const outbox = box(idb);
  const item = await enqueue(outbox);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = idb.open(`solid-offline-outbox:${encodeURIComponent(webId)}`, 1);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    const request = store.getAll();
    request.onsuccess = () => {
      const record = request.result[0];
      record.item.status = 'replaying';
      store.put(record);
    };
    tx.oncomplete = () => resolve();
  });
  db.close();
  await expect(outbox.discard(item.id)).rejects.toThrow('being delivered');
  expect(new TextDecoder().decode((await outbox.localBody(item.id)) as Uint8Array)).toBe('private');
  outbox.close();
  await expect(outbox.discard(item.id)).rejects.toThrow('closed');
});

it('broadcasts removal to same-WebID observers without notifying another identity', async () => {
  const idb = new IDBFactory();
  const outbox = box(idb);
  const observer = box(idb);
  const foreign = box(idb, `${root}bob#me`);
  await Promise.all([outbox.ready, observer.ready, foreign.ready]);
  const item = await enqueue(outbox);
  await vi.waitFor(() => expect(observer.pending()).toHaveLength(1));
  const otherChanged = vi.fn();
  foreign.on('change', otherChanged);
  await outbox.discard(item.id);
  await vi.waitFor(() => expect(observer.pending()).toEqual([]));
  expect(otherChanged).not.toHaveBeenCalled();
});
