// AUTHORED-BY Claude Opus 5.5
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOutbox, type Outbox } from '../src/outbox.js';

const root = 'https://pod.example/';
const webId = `${root}profile#me`;
let idb: IDBFactory;
let boxes: Outbox[];

function box(namespace?: string, identity = webId): Outbox {
  const outbox = createOutbox({
    webId: identity,
    idb,
    ...(namespace === undefined ? {} : { namespace }),
  });
  boxes.push(outbox);
  return outbox;
}
function storage() {
  const client = createMemoryStorage({ root, protocol: 'solid' });
  const write = vi
    .spyOn(client, 'write')
    .mockImplementation(async (url) => ({ url, etag: '"new"', created: false }));
  return { client, write };
}
const enqueue = (outbox: Outbox, url: string) =>
  outbox.enqueue({ op: 'write', url, body: 'text', contentType: 'text/plain' });

beforeEach(() => {
  idb = new IDBFactory();
  boxes = [];
});
afterEach(() => {
  for (const outbox of boxes) outbox.close();
  vi.restoreAllMocks();
});

it.each([
  '',
  'Chat',
  '1chat',
  '-chat',
  'chat:drive',
  'chat/drive',
  'chat app',
  'a'.repeat(65),
  42,
  null,
])('rejects the invalid namespace %j before opening storage', (namespace) => {
  const open = vi.spyOn(idb, 'open');
  expect(() => createOutbox({ webId, idb, namespace: namespace as string })).toThrow(
    new TypeError('[solid-offline] invalid outbox namespace'),
  );
  expect(open).not.toHaveBeenCalled();
});

it('accepts tag-shaped namespaces and names a separate database for each', async () => {
  const shared = box();
  const chat = box('chat');
  const longest = box(`a${'b'.repeat(63)}`);
  const dotted = box('suite.chat-v1');
  await Promise.all([shared.ready, chat.ready, longest.ready, dotted.ready]);
  await Promise.all([
    enqueue(shared, `${root}shared`),
    enqueue(chat, `${root}chat`),
    enqueue(longest, `${root}longest`),
    enqueue(dotted, `${root}dotted`),
  ]);
  const names = (await idb.databases()).map((db) => db.name).sort();
  const id = encodeURIComponent(webId);
  expect(names).toEqual(
    [
      `solid-offline-outbox:${id}`,
      `solid-offline-outbox:chat:${id}`,
      `solid-offline-outbox:a${'b'.repeat(63)}:${id}`,
      `solid-offline-outbox:suite.chat-v1:${id}`,
    ].sort(),
  );
});

it('keeps records, replay and purge of a namespaced queue apart from the default queue', async () => {
  const shared = box();
  const chat = box('chat');
  const other = box('other');
  await Promise.all([shared.ready, chat.ready, other.ready]);
  await enqueue(shared, `${root}drive`);
  await enqueue(chat, `${root}chat`);
  await enqueue(other, `${root}other`);
  expect(shared.pending().map((item) => item.url)).toEqual([`${root}drive`]);
  expect(chat.pending().map((item) => item.url)).toEqual([`${root}chat`]);
  expect(other.pending().map((item) => item.url)).toEqual([`${root}other`]);

  const { client, write } = storage();
  await chat.replay(client);
  expect(write.mock.calls.map(([url]) => url)).toEqual([`${root}chat`]);
  expect(chat.pending()).toEqual([]);
  expect(shared.pending()).toHaveLength(1);

  await other.purge();
  expect(other.pending()).toEqual([]);
  expect(shared.pending()).toHaveLength(1);

  // The same namespace and WebID reopen the same queue; another WebID does not.
  const sameChat = box('chat');
  const foreign = box('chat', 'https://bob.example/#me');
  await enqueue(chat, `${root}again`);
  await Promise.all([sameChat.ready, foreign.ready]);
  await vi.waitFor(() =>
    expect(sameChat.pending().map((item) => item.url)).toEqual([`${root}again`]),
  );
  expect(foreign.pending()).toEqual([]);
  const reopened = box();
  await reopened.ready;
  expect(reopened.pending().map((item) => item.url)).toEqual([`${root}drive`]);
});

it('broadcasts changes only to instances of the same namespace', async () => {
  const chat = box('chat');
  const peer = box('chat');
  const shared = box();
  await Promise.all([chat.ready, peer.ready, shared.ready]);
  const seenByPeer = vi.fn();
  const seenByShared = vi.fn();
  peer.on('change', seenByPeer);
  shared.on('change', seenByShared);
  await enqueue(chat, `${root}chat`);
  await vi.waitFor(() => expect(peer.pending()).toHaveLength(1));
  expect(seenByPeer).toHaveBeenCalled();
  // Let any (wrongly addressed) broadcast arrive before asserting its absence.
  await enqueue(peer, `${root}peer`);
  await vi.waitFor(() => expect(chat.pending()).toHaveLength(2));
  expect(seenByShared).not.toHaveBeenCalled();
  expect(shared.pending()).toEqual([]);
});

it('does not serialise a namespaced replay behind the default queue replay', async () => {
  const shared = box();
  const chat = box('chat');
  await Promise.all([shared.ready, chat.ready]);
  await enqueue(shared, `${root}drive`);
  await enqueue(chat, `${root}chat`);
  let finish!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { client, write } = storage();
  write.mockImplementationOnce(async (url) => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    throw new StorageError('network', { url, method: 'PUT' });
  });
  const blocked = shared.replay(client);
  await active;
  // The default queue holds its replay lock; the chat queue has its own.
  await chat.replay(client);
  expect(chat.pending()).toEqual([]);
  expect(write.mock.calls.map(([url]) => url)).toEqual([`${root}drive`, `${root}chat`]);
  finish();
  await blocked;
  expect(shared.pending().map((item) => item.status)).toEqual(['waiting']);
});
