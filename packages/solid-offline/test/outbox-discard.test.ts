// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { createOutbox } from '../src/outbox.js';

it('preserves imported failed intents until explicit retry', async () => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  const write = vi
    .spyOn(storage, 'write')
    .mockResolvedValue({ url: storage.root, etag: '"1"', created: false });
  const operation = {
    op: 'write' as const,
    url: `${storage.root}file`,
    body: 'text',
    contentType: 'text/plain',
  };
  try {
    await expect(
      a.enqueue({ ...operation, initialStatus: 'replaying' as 'failed' }),
    ).rejects.toThrow('initial status');
    const item = await a.enqueue({ ...operation, initialStatus: 'failed' });
    await a.replay(storage);
    expect(write).not.toHaveBeenCalled();
    await a.retry(item.id);
    expect(write).toHaveBeenCalledOnce();
    expect(a.pending()).toEqual([]);
  } finally {
    a.close();
  }
});

it.each([
  false,
  true,
])('discards across tabs during replay without resurrecting entries (failure: %s)', async (fail) => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const b = createOutbox({ webId: a.webId, idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  let finish!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const write = vi.spyOn(storage, 'write').mockImplementation(async (url) => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (fail) throw new Error('late failure');
    return { url, etag: '"1"', created: false };
  });
  try {
    const enqueue = (url: string) =>
      a.enqueue({ op: 'write', url, body: 'text', contentType: 'text/plain' });
    const first = await enqueue('https://pod.example/first');
    const second = await enqueue('https://pod.example/second');
    const replay = a.replay(storage);
    await active;
    await b.discard(first.id);
    await b.discard(second.id);
    await b.discard('absent');
    finish();
    await replay;
    expect(write).toHaveBeenCalledTimes(1);
    expect(a.pending()).toEqual([]);
    const reopened = createOutbox({ webId: a.webId, idb });
    await reopened.ready;
    expect(reopened.pending()).toEqual([]);
    reopened.close();
    b.close();
    await expect(b.discard(first.id)).rejects.toThrow('closed');
  } finally {
    a.close();
    b.close();
  }
});

function gate() {
  let finish!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { active, done, started, finish: () => finish() };
}
const precondition = (url: string) =>
  new StorageError('precondition-failed', { url, method: 'PUT', status: 412, etag: '"remote"' });

it.each([
  false,
  true,
])('a discard during an in-flight retry is not undone by its result (failure: %s)', async (fail) => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const b = createOutbox({ webId: a.webId, idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  const step = gate();
  const write = vi.spyOn(storage, 'write').mockImplementation(async (url) => {
    step.started();
    await step.done;
    if (fail) throw new Error('late failure');
    return { url, etag: '"1"', created: false };
  });
  try {
    const item = await a.enqueue({
      op: 'write',
      url: 'https://pod.example/file',
      body: 'text',
      contentType: 'text/plain',
      initialStatus: 'failed',
    });
    await a.replay(storage);
    const retry = a.retry(item.id);
    await step.active;
    await b.discard(item.id);
    step.finish();
    await retry;
    expect(write).toHaveBeenCalledOnce();
    expect(a.pending()).toEqual([]);
    const reopened = createOutbox({ webId: a.webId, idb });
    await reopened.ready;
    expect(reopened.pending()).toEqual([]);
    reopened.close();
  } finally {
    a.close();
    b.close();
  }
});

it('a retry that starts after a discard has nothing left to send', async () => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const b = createOutbox({ webId: a.webId, idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  const write = vi
    .spyOn(storage, 'write')
    .mockImplementation(async (url) => ({ url, etag: '"1"', created: false }));
  try {
    const item = await a.enqueue({
      op: 'write',
      url: 'https://pod.example/file',
      body: 'text',
      contentType: 'text/plain',
      initialStatus: 'failed',
    });
    await a.replay(storage);
    await b.discard(item.id);
    await a.retry(item.id);
    expect(write).not.toHaveBeenCalled();
    expect(a.pending()).toEqual([]);
  } finally {
    a.close();
    b.close();
  }
});

it('discarding a conflicted item clears it from conflicts(); a conflict ID is not an item ID', async () => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const b = createOutbox({ webId: a.webId, idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  vi.spyOn(storage, 'write').mockRejectedValueOnce(precondition('https://pod.example/file'));
  try {
    const item = await a.enqueue({
      op: 'write',
      url: 'https://pod.example/file',
      body: 'text',
      contentType: 'text/plain',
      ifMatch: '"old"',
    });
    await a.replay(storage);
    const [record] = a.conflicts();
    expect(record?.itemId).toBe(item.id);
    await b.discard(record?.id as string);
    expect(a.conflicts()).toHaveLength(1);
    await b.discard(item.id);
    await vi.waitFor(() => expect(a.conflicts()).toEqual([]));
    expect(a.pending()).toEqual([]);
    expect(b.conflicts()).toEqual([]);
    await expect(a.resolve(record?.id as string, 'mine')).rejects.toThrow('conflict not found');
  } finally {
    a.close();
    b.close();
  }
});

it.each([
  false,
  true,
])('a discard during an in-flight resolution does not resurrect the conflict (failure: %s)', async (fail) => {
  const idb = new IDBFactory();
  const a = createOutbox({ webId: 'https://pod.example/#me', idb });
  const b = createOutbox({ webId: a.webId, idb });
  const storage = createMemoryStorage({ root: 'https://pod.example/', protocol: 'solid' });
  vi.spyOn(storage, 'head').mockResolvedValue({ etag: '"remote"' } as Awaited<
    ReturnType<typeof storage.head>
  >);
  const step = gate();
  const write = vi
    .spyOn(storage, 'write')
    .mockRejectedValueOnce(precondition('https://pod.example/file'))
    .mockImplementation(async (url) => {
      step.started();
      await step.done;
      if (fail) throw new Error('late failure');
      return { url, etag: '"2"', created: false };
    });
  try {
    const item = await a.enqueue({
      op: 'write',
      url: 'https://pod.example/file',
      body: 'text',
      contentType: 'text/plain',
      ifMatch: '"old"',
    });
    await a.replay(storage);
    const [record] = a.conflicts();
    const resolve = a.resolve(record?.id as string, 'mine');
    const settled = resolve.then(
      () => 'resolved',
      () => 'rejected',
    );
    await step.active;
    await b.discard(item.id);
    step.finish();
    expect(await settled).toBe(fail ? 'rejected' : 'resolved');
    expect(write).toHaveBeenCalledTimes(2);
    // A failed resolution does not refresh; the discard's broadcast updates the snapshot.
    await vi.waitFor(() => expect(a.conflicts()).toEqual([]));
    expect(a.pending()).toEqual([]);
    const reopened = createOutbox({ webId: a.webId, idb });
    await reopened.ready;
    expect(reopened.pending()).toEqual([]);
    expect(reopened.conflicts()).toEqual([]);
    reopened.close();
  } finally {
    a.close();
    b.close();
  }
});
