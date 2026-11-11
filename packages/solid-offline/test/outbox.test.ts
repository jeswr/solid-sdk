// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import { IDBFactory } from 'fake-indexeddb';
import { DataFactory, Parser, Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutbox, type Outbox, withOutbox } from '../src/outbox.js';

const root = 'https://pod.example/';
const url = `${root}file.bin`;
const webId = `${root}profile#me`;
const writeOptions = { contentType: 'application/octet-stream', ifMatch: '"old"' };
const failure = (code: ConstructorParameters<typeof StorageError>[0], extra = {}) =>
  new StorageError(code, { url, method: 'PUT', ...extra });
let idb: IDBFactory;
let boxes: Outbox[];
let clock: number;

function box(identity = webId): Outbox {
  const outbox = createOutbox({ webId: identity, idb, now: () => clock });
  boxes.push(outbox);
  return outbox;
}
function storage() {
  const client = createMemoryStorage({ root, protocol: 'solid' });
  const write = vi.spyOn(client, 'write').mockResolvedValue({ url, etag: '"new"', created: false });
  const create = vi
    .spyOn(client, 'create')
    .mockResolvedValue({ url, etag: '"new"', created: true });
  const remove = vi.spyOn(client, 'delete').mockResolvedValue(undefined);
  return { client, write, create, remove };
}
async function enqueue(outbox: Outbox, target = url, body = 'hello') {
  return outbox.enqueue({ op: 'write', url: target, body, ...writeOptions });
}
function offline() {
  vi.stubGlobal('navigator', { onLine: false });
}
function online() {
  vi.stubGlobal('navigator', { onLine: true });
}
async function conflict(outbox: Outbox, client: StorageClient, type = 'application/octet-stream') {
  await outbox.enqueue({ op: 'write', url, body: 'local', ifMatch: '"old"', contentType: type });
  vi.mocked(client.write).mockRejectedValueOnce(
    failure('precondition-failed', { status: 412, etag: '"remote"' }),
  );
  await outbox.replay(client);
  return outbox.conflicts()[0] as NonNullable<ReturnType<Outbox['conflicts']>[0]>;
}

beforeEach(() => {
  idb = new IDBFactory();
  boxes = [];
  clock = 1000;
});
afterEach(() => {
  for (const outbox of boxes) outbox.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('persistent outbox', () => {
  it('hydrates snapshots across reopen and isolates WebIDs, including purge', async () => {
    const alice = box();
    const bob = box(`${root}bob#me`);
    const item = await enqueue(alice);
    await enqueue(bob, `${root}other`);
    alice.close();
    const reopened = box();
    await reopened.ready;
    expect(reopened.pending()).toEqual([item]);
    const body = await reopened.localBody(item.id);
    expect(new TextDecoder().decode(body as Uint8Array)).toBe('hello');
    body?.fill(0);
    expect(await reopened.localBody(item.id)).toEqual(new TextEncoder().encode('hello'));
    const snapshot = reopened.pending();
    if (snapshot[0]) snapshot[0].status = 'failed';
    expect(reopened.pending()[0]?.status).toBe('waiting');
    await reopened.purge();
    expect(reopened.pending()).toEqual([]);
    expect(bob.pending()).toHaveLength(1);
    expect(await reopened.localBody('unknown')).toBeNull();
  });

  it('replays one at a time in createdAt order with stable FIFO ties and validators', async () => {
    const outbox = box();
    clock = 20;
    await enqueue(outbox, `${root}later`);
    clock = 10;
    await enqueue(outbox, `${root}first`);
    await enqueue(outbox, `${root}second`);
    const { client, write } = storage();
    let active = 0;
    write.mockImplementation(async (target) => {
      expect(active++).toBe(0);
      expect(outbox.pending().find((item) => item.url === target)?.status).toBe('replaying');
      await Promise.resolve();
      active--;
      return { url: target, etag: null, created: false };
    });
    await Promise.all([outbox.replay(client), outbox.replay(client)]);
    expect(write.mock.calls.map(([target]) => target)).toEqual([
      `${root}first`,
      `${root}second`,
      `${root}later`,
    ]);
    expect(write.mock.calls[0]?.[2].ifMatch).toBe('"old"');
    expect(outbox.pending()).toEqual([]);
  });

  it.each([
    failure('network'),
    new TypeError('Failed to fetch'),
  ])('stops at a network failure and retains waiting items: %s', async (error) => {
    const outbox = box();
    await enqueue(outbox);
    await enqueue(outbox, `${root}second`);
    const { client, write } = storage();
    write.mockRejectedValueOnce(error);
    await outbox.replay(client);
    expect(outbox.pending().map((item) => item.status)).toEqual(['waiting', 'waiting']);
    expect(write).toHaveBeenCalledOnce();
    await outbox.replay(client);
    expect(outbox.pending()).toEqual([]);
  });

  it('marks non-network errors failed and supports retry one or all', async () => {
    const outbox = box();
    const first = await enqueue(outbox);
    await enqueue(outbox, `${root}second`);
    const { client, write } = storage();
    write.mockRejectedValueOnce(failure('forbidden')).mockRejectedValueOnce('plain failure');
    await outbox.replay(client);
    expect(outbox.pending()).toMatchObject([
      { status: 'failed', error: expect.stringContaining('forbidden') },
      { status: 'failed', error: 'plain failure' },
    ]);
    await outbox.retry(first.id);
    expect(outbox.pending()).toMatchObject([{ status: 'failed' }]);
    await outbox.retry();
    expect(outbox.pending()).toEqual([]);
  });

  it('persists conflicts, holds all same-URL work and continues other URLs', async () => {
    const outbox = box();
    const first = await enqueue(outbox);
    await enqueue(outbox);
    await enqueue(outbox, `${root}other`);
    const { client, write } = storage();
    write.mockRejectedValueOnce(failure('precondition-failed', { status: 412, etag: '"remote"' }));
    const changed = vi.fn();
    const conflicted = vi.fn();
    const unsubscribe = outbox.on('change', changed);
    outbox.on('conflict', conflicted);
    await outbox.replay(client);
    expect(write.mock.calls.map(([target]) => target)).toEqual([url, `${root}other`]);
    expect(outbox.pending().map((item) => item.status)).toEqual(['conflict', 'waiting']);
    expect(outbox.conflicts()).toMatchObject([
      { itemId: first.id, url, kind: 'binary', localEtag: '"old"', remoteEtag: '"remote"' },
    ]);
    const id = outbox.conflicts()[0]?.id as string;
    expect(await outbox.localBody(id)).toEqual(new TextEncoder().encode('hello'));
    expect(conflicted).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalled();
    unsubscribe();
    changed.mockClear();
    await outbox.replay(client);
    expect(write).toHaveBeenCalledTimes(2);
    const reopened = box();
    await reopened.ready;
    expect(reopened.conflicts()).toEqual(outbox.conflicts());
    await outbox.resolve(id, 'theirs');
    expect(changed).not.toHaveBeenCalled();
    await outbox.replay(client);
    expect(outbox.pending()).toEqual([]);
  });

  it('reports byte progress at each successful item boundary', async () => {
    const outbox = box();
    await enqueue(outbox, url, 'é');
    await outbox.enqueue({
      op: 'delete',
      url: `${root}gone`,
      ifMatch: '"delete"',
      deleteOptions: { recursive: true },
    });
    const { client, remove } = storage();
    const progress = vi.fn();
    await outbox.replay(client, { onProgress: progress });
    expect(progress.mock.calls).toEqual([
      [0, 2],
      [2, 2],
      [0, 0],
      [0, 0],
    ]);
    expect(remove).toHaveBeenCalledWith(
      `${root}gone`,
      expect.objectContaining({ ifMatch: '"delete"', recursive: true }),
    );
  });

  it('stops after cancellation and leaves the current operation waiting', async () => {
    const outbox = box();
    await enqueue(outbox);
    await enqueue(outbox, `${root}second`);
    const { client, write } = storage();
    const controller = new AbortController();
    write.mockImplementationOnce(async () => {
      controller.abort();
      throw failure('network');
    });
    await outbox.replay(client, { signal: controller.signal });
    expect(outbox.pending().map((item) => item.status)).toEqual(['waiting', 'waiting']);
    await outbox.replay(client, { signal: controller.signal });
    expect(write).toHaveBeenCalledOnce();
  });

  it('serializes two instances for one WebID', async () => {
    const one = box();
    const two = box();
    await enqueue(one);
    const { client, write } = storage();
    await Promise.all([one.replay(client), two.replay(client)]);
    expect(write).toHaveBeenCalledOnce();
  });
});

describe('conflict resolution', () => {
  it('mine uses a fresh HEAD ETag and retains the conflict if the write races', async () => {
    const outbox = box();
    const { client, write } = storage();
    const record = await conflict(outbox, client);
    const head = vi
      .spyOn(client, 'head')
      .mockResolvedValue({ etag: '"latest"' } as Awaited<ReturnType<StorageClient['head']>>);
    write.mockRejectedValueOnce(failure('precondition-failed', { status: 412 }));
    await expect(outbox.resolve(record.id, 'mine')).rejects.toMatchObject({ status: 412 });
    expect(outbox.conflicts()).toHaveLength(1);
    await outbox.resolve(record.id, 'mine');
    expect(head).toHaveBeenCalledWith(url, { revalidate: true });
    expect(write).toHaveBeenLastCalledWith(url, new TextEncoder().encode('local'), {
      contentType: 'application/octet-stream',
      ifMatch: '"latest"',
    });
    expect(outbox.pending()).toEqual([]);
  });

  it('mine refuses a missing ETag', async () => {
    const outbox = box();
    const { client } = storage();
    const record = await conflict(outbox, client);
    vi.spyOn(client, 'head').mockResolvedValue({ etag: null } as Awaited<
      ReturnType<StorageClient['head']>
    >);
    await expect(outbox.resolve(record.id, 'mine')).rejects.toThrow('current ETag');
    expect(outbox.conflicts()).toHaveLength(1);
  });

  it('theirs discards only the conflicted local body without sending a request', async () => {
    const outbox = box();
    const { client, write } = storage();
    const record = await conflict(outbox, client);
    write.mockClear();
    await outbox.resolve(record.id, 'theirs');
    expect(outbox.conflicts()).toEqual([]);
    expect(await outbox.localBody(record.id)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    await expect(outbox.resolve(record.id, 'theirs')).rejects.toThrow('not found');
  });

  it.each([
    ['application/octet-stream', 'photo.jpg', 'photo-conflict-1000.jpg'],
    ['text/turtle', 'note.ttl', 'note (copy).ttl'],
    ['application/ld+json; charset=utf-8', 'note.jsonld', 'note (copy).jsonld'],
    ['text/plain', 'README', 'README-conflict-1000'],
  ])('both creates %s as %s with If-None-Match:*', async (contentType, original, copy) => {
    const outbox = box();
    const target = `${root}${original}`;
    await outbox.enqueue({
      op: 'write',
      url: target,
      body: 'local',
      contentType,
      ifMatch: '"old"',
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 412, headers: { ETag: '"remote"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { ETag: '"copy"' } }));
    const client = createSolidBackend({ root, fetch: fetcher });
    await outbox.replay(client);
    await outbox.resolve(outbox.conflicts()[0]?.id as string, 'both');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [requestUrl, init] = fetcher.mock.calls[1] as Parameters<typeof fetch>;
    expect(requestUrl).toBe(`${root}${encodeURIComponent(copy)}`);
    expect(new Headers(init?.headers).get('if-none-match')).toBe('*');
    expect(new Headers(init?.headers).get('if-match')).toBeNull();
    expect(outbox.pending()).toEqual([]);
  });

  it('a failed copy never drops the queued body', async () => {
    const outbox = box();
    const { client, create } = storage();
    const record = await conflict(outbox, client);
    create.mockRejectedValueOnce(failure('precondition-failed', { status: 412 }));
    await expect(outbox.resolve(record.id, 'both')).rejects.toMatchObject({ status: 412 });
    expect(outbox.conflicts()).toHaveLength(1);
  });

  it('resolves a conflicted delete with mine, and rejects both', async () => {
    const outbox = box();
    const { client, remove } = storage();
    await outbox.enqueue({ op: 'delete', url, ifMatch: '"old"' });
    remove.mockRejectedValueOnce(failure('precondition-failed', { status: 412 }));
    await outbox.replay(client);
    const id = outbox.conflicts()[0]?.id as string;
    await expect(outbox.resolve(id, 'both')).rejects.toThrow('deletes');
    vi.spyOn(client, 'head').mockResolvedValue({ etag: '"latest"' } as Awaited<
      ReturnType<StorageClient['head']>
    >);
    await outbox.resolve(id, 'mine');
    expect(remove).toHaveBeenLastCalledWith(url, { ifMatch: '"latest"' });
  });
});

describe('withOutbox', () => {
  it('passes writes and nonqueueable operations through untouched without opt-in', async () => {
    offline();
    const outbox = box();
    const { client, write, create, remove } = storage();
    const rdf = vi.spyOn(client, 'writeRdf').mockRejectedValue(failure('network'));
    write.mockRejectedValue(failure('network'));
    create.mockRejectedValue(failure('network'));
    remove.mockRejectedValue(failure('network'));
    const wrapped = withOutbox(client, outbox);
    const body = new Uint8Array([1]);
    await expect(wrapped.write(url, body, writeOptions)).rejects.toMatchObject({ code: 'network' });
    expect(write).toHaveBeenCalledWith(url, body, writeOptions);
    expect(write.mock.calls[0]?.[1]).toBe(body);
    await expect(wrapped.writeRdf(url, [], { ifMatch: '*' })).rejects.toMatchObject({
      code: 'network',
    });
    expect(rdf).toHaveBeenCalledWith(url, [], { ifMatch: '*' });
    await expect(wrapped.create(root, body)).rejects.toMatchObject({ code: 'network' });
    await expect(wrapped.delete(url)).rejects.toMatchObject({ code: 'network' });
    const patch = vi.spyOn(client, 'patch').mockRejectedValue(failure('network'));
    const move = vi.spyOn(client, 'move').mockRejectedValue(failure('network'));
    await expect(
      wrapped.patch(url, { kind: 'raw', mediaType: 'test', body: '' }, { ifMatch: '*' }),
    ).rejects.toThrow();
    await expect(wrapped.move(url, root)).rejects.toThrow();
    expect(patch).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledOnce();
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
    expect(wrapped.root).toBe(root);
    expect(wrapped.isWithinStorage(url)).toBe(true);
  });

  it('queues only opted-in network failures, captures streams before consumption and preserves bytes', async () => {
    online();
    const outbox = box();
    const { client, write } = storage();
    write.mockImplementationOnce(async (_url, body) => {
      await new Response(new Uint8Array(body as Uint8Array).buffer).arrayBuffer();
      throw failure('network');
    });
    const wrapped = withOutbox(client, outbox);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 255]));
        controller.close();
      },
    });
    expect(await wrapped.write(url, stream, { ...writeOptions, offline: 'queue' })).toEqual({
      url,
      etag: null,
      created: false,
      queued: true,
    });
    expect(await outbox.localBody(outbox.pending()[0]?.id as string)).toEqual(
      new Uint8Array([0, 255]),
    );
    await outbox.replay(wrapped);
    expect(write).toHaveBeenCalledTimes(2);
    expect(outbox.pending()).toEqual([]);
  });

  it('queues writes, creates, deletes and RDF while offline without attempting requests', async () => {
    offline();
    const outbox = box();
    const { client, write, create, remove } = storage();
    const rdf = vi.spyOn(client, 'writeRdf');
    const wrapped = withOutbox(client, outbox);
    await wrapped.write(url, new Blob(['binary']), { ...writeOptions, offline: 'queue' });
    await wrapped.create(root, 'new', {
      contentType: 'text/plain',
      name: 'a b.txt',
      offline: 'queue',
    });
    await wrapped.delete(`${root}gone`, { ifMatch: '"gone"', recursive: true, offline: 'queue' });
    const quad = DataFactory.quad(
      DataFactory.namedNode('urn:s'),
      DataFactory.namedNode('urn:p'),
      DataFactory.literal('é'),
    );
    await wrapped.writeRdf(`${root}rdf.ttl`, new Store([quad]), {
      ifMatch: '"rdf"',
      prefixes: { ex: 'urn:' },
      offline: 'queue',
    });
    expect(write).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(rdf).not.toHaveBeenCalled();
    expect(outbox.pending()).toMatchObject([
      { op: 'write' },
      { op: 'create', url: `${root}a%20b.txt` },
      { op: 'delete' },
      { op: 'write', contentType: 'text/turtle' },
    ]);
    const rdfBody = await outbox.localBody(outbox.pending()[3]?.id as string);
    expect(
      new Parser().parse(new TextDecoder().decode(rdfBody as Uint8Array))[0]?.equals(quad),
    ).toBe(true);
    online();
    await outbox.replay(client);
    expect(create).toHaveBeenCalledWith(
      root,
      new TextEncoder().encode('new'),
      expect.objectContaining({ name: 'a b.txt' }),
    );
    expect(outbox.pending()).toEqual([]);
  });

  it('preserves normal success and HTTP failures with opt-in', async () => {
    online();
    const outbox = box();
    const { client, write } = storage();
    const wrapped = withOutbox(client, outbox);
    expect(await wrapped.write(url, 'ok', { ...writeOptions, offline: 'queue' })).toEqual({
      url,
      etag: '"new"',
      created: false,
    });
    write.mockRejectedValueOnce(failure('forbidden'));
    await expect(
      wrapped.write(url, 'forbidden', { ...writeOptions, offline: 'queue' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });

  it('does not queue aborts, invalid names, out-of-scope URLs or named-graph Turtle', async () => {
    offline();
    const outbox = box();
    const { client } = storage();
    const wrapped = withOutbox(client, outbox);
    const controller = new AbortController();
    controller.abort();
    await expect(
      wrapped.write(url, '', { ...writeOptions, offline: 'queue', signal: controller.signal }),
    ).rejects.toThrow();
    await expect(
      wrapped.write('https://outside.example/file', '', { ...writeOptions, offline: 'queue' }),
    ).rejects.toMatchObject({ code: 'scope' });
    await expect(wrapped.create(root, '', { name: '..', offline: 'queue' })).rejects.toThrow(
      'invalid create name',
    );
    const q = DataFactory.quad(
      DataFactory.namedNode('urn:s'),
      DataFactory.namedNode('urn:p'),
      DataFactory.literal('v'),
      DataFactory.namedNode('urn:g'),
    );
    await expect(wrapped.writeRdf(url, [q], { ifMatch: '*', offline: 'queue' })).rejects.toThrow(
      'default graph',
    );
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });

  it('creates a stable generated name and retains container creation options', async () => {
    offline();
    const outbox = box();
    const { client, create } = storage();
    const wrapped = withOutbox(client, outbox);
    const result = await wrapped.create(root, null, {
      kind: 'container',
      offline: 'queue',
      links: [{ rel: 'test', target: 'urn:test' }],
    });
    const item = outbox.pending()[0];
    expect(item?.name).toMatch(/^offline-/);
    expect(result.url).toBe(`${root}${item?.name}/`);
    await outbox.replay(client);
    expect(create).toHaveBeenCalledWith(
      root,
      null,
      expect.objectContaining({
        name: item?.name,
        kind: 'container',
        links: [{ rel: 'test', target: 'urn:test' }],
      }),
    );
  });
});

// Additional lifecycle seams exercise real persistence and BroadcastChannel delivery.
describe('outbox observers and recovery', () => {
  it('refreshes same-WebID tabs, broadcasts conflicts, and keeps other identities isolated', async () => {
    const one = box();
    const two = box();
    const other = box(`${root}other#me`);
    await Promise.all([one.ready, two.ready, other.ready]);
    const change = vi.fn();
    const conflictEvent = vi.fn();
    const foreign = vi.fn();
    two.on('change', change);
    two.on('conflict', conflictEvent);
    other.on('change', foreign);
    await enqueue(one);
    await vi.waitFor(() => expect(two.pending()).toHaveLength(1));
    expect(change).toHaveBeenCalled();
    expect(other.pending()).toEqual([]);
    expect(foreign).not.toHaveBeenCalled();
    const { client, write } = storage();
    write.mockRejectedValueOnce(failure('precondition-failed', { status: 412 }));
    await one.replay(client);
    await vi.waitFor(() => expect(two.conflicts()).toHaveLength(1));
    await vi.waitFor(() => expect(conflictEvent).toHaveBeenCalled());
    await one.purge();
    await vi.waitFor(() => expect(two.pending()).toEqual([]));
  });

  it('uses the Web Locks seam and isolates failures in UI observers', async () => {
    const request = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { locks: { request } });
    const outbox = box();
    outbox.on('change', () => {
      throw new Error('observer');
    });
    await enqueue(outbox);
    const { client } = storage();
    await outbox.replay(client, {
      onProgress: () => {
        throw new Error('progress observer');
      },
    });
    expect(outbox.pending()).toEqual([]);
    expect(request).toHaveBeenCalled();
  });

  it('recovers an interrupted replaying record after reopen', async () => {
    const outbox = box();
    await enqueue(outbox);
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
    outbox.close();
    const reopened = box();
    await reopened.ready;
    expect(reopened.pending()[0]?.status).toBe('replaying');
    const { client } = storage();
    await reopened.replay(client);
    expect(reopened.pending()).toEqual([]);
  });

  it('requires a bound client for retry and rejects use after closing', async () => {
    const outbox = box();
    await expect(outbox.retry()).rejects.toThrow('withOutbox or replay');
    outbox.close();
    await expect(enqueue(outbox)).rejects.toThrow('closed');
    expect(() => createOutbox({ webId: '' })).toThrow('requires a WebID');
    vi.stubGlobal('indexedDB', undefined);
    expect(() => createOutbox({ webId })).toThrow('requires IndexedDB');
  });
});

describe('queued RDF serialization', () => {
  it('preserves JSON-LD format, named graphs, node objects and lexical literal values', async () => {
    offline();
    const outbox = box();
    const { client, write } = storage();
    const wrapped = withOutbox(client, outbox);
    const { quad, namedNode, blankNode, literal } = DataFactory;
    const subject = namedNode('urn:subject');
    const predicate = namedNode('urn:predicate');
    const graph = namedNode('urn:graph');
    const data = [
      quad(
        subject,
        predicate,
        literal('01', namedNode('http://www.w3.org/2001/XMLSchema#integer')),
      ),
      quad(subject, predicate, namedNode('urn:object')),
      quad(subject, predicate, literal('bonjour', 'fr'), graph),
      quad(subject, predicate, literal('second'), graph),
      quad(blankNode('source'), predicate, blankNode('source'), blankNode('graph')),
    ];
    await wrapped.writeRdf(url, data, {
      ifMatch: '*',
      contentType: 'application/ld+json',
      offline: 'queue',
    });
    const item = outbox.pending()[0];
    expect(item?.contentType).toBe('application/ld+json');
    const text = new TextDecoder().decode(
      (await outbox.localBody(item?.id as string)) as Uint8Array,
    );
    expect(JSON.parse(text)).toEqual([
      {
        '@id': 'urn:subject',
        'urn:predicate': [
          { '@value': '01', '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
          { '@id': 'urn:object' },
        ],
      },
      {
        '@id': 'urn:graph',
        '@graph': [
          {
            '@id': 'urn:subject',
            'urn:predicate': [
              { '@value': 'bonjour', '@language': 'fr' },
              { '@value': 'second', '@type': 'http://www.w3.org/2001/XMLSchema#string' },
            ],
          },
        ],
      },
      { '@id': '_:b1', '@graph': [{ '@id': '_:b0', 'urn:predicate': [{ '@id': '_:b0' }] }] },
    ]);
    await outbox.replay(client);
    expect(write).toHaveBeenCalledWith(
      url,
      new TextEncoder().encode(text),
      expect.objectContaining({ contentType: 'application/ld+json' }),
    );
  });

  it('supports empty JSON-LD and offline network failure during an online RDF attempt', async () => {
    online();
    const outbox = box();
    const { client } = storage();
    const rdf = vi.spyOn(client, 'writeRdf').mockRejectedValueOnce(failure('network'));
    const wrapped = withOutbox(client, outbox);
    await wrapped.writeRdf(url, [], {
      ifMatch: '*',
      contentType: 'application/ld+json',
      offline: 'queue',
    });
    expect(rdf).toHaveBeenCalledWith(url, [], { ifMatch: '*', contentType: 'application/ld+json' });
    expect(
      new TextDecoder().decode(
        (await outbox.localBody(outbox.pending()[0]?.id as string)) as Uint8Array,
      ),
    ).toBe('[]');
  });

  it('rejects malformed IRIs, languages and invalid term positions before queuing', async () => {
    offline();
    const outbox = box();
    const { client } = storage();
    const wrapped = withOutbox(client, outbox);
    const { quad, namedNode, literal, variable } = DataFactory;
    const bad = [
      quad(namedNode('urn:unsafe>'), namedNode('urn:p'), literal('value')),
      quad(namedNode('urn:s'), namedNode('urn:p'), literal('value', 'en\n<urn:injected>')),
      quad(variable('s'), namedNode('urn:p'), literal('value')),
      quad(namedNode('urn:s'), variable('p'), literal('value')),
      quad(namedNode('urn:s'), namedNode('urn:p'), variable('value')),
      quad(namedNode('urn:s'), namedNode('urn:p'), literal('value', namedNode('not absolute'))),
      quad(namedNode('urn:s'), namedNode('urn:p'), literal('value', 'en--rtl')),
    ];
    for (const q of bad)
      await expect(
        wrapped.writeRdf(url, [q], { ifMatch: '*', offline: 'queue' }),
      ).rejects.toThrow();
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });

  it('rebuilds foreign terms with forged private IDs and preserves Unicode IRIs and unsafe blank labels', async () => {
    offline();
    const outbox = box();
    const { client } = storage();
    const wrapped = withOutbox(client, outbox);
    const { quad, namedNode, blankNode, literal } = DataFactory;
    const q = quad(blankNode('label with spaces'), namedNode('urn:p'), literal('v'));
    const foreign = {
      ...q,
      equals: () => false,
      predicate: q.predicate,
      object: q.object,
      graph: q.graph,
      subject: {
        termType: 'BlankNode' as const,
        value: 'label with spaces',
        id: '_:evil . <urn:s> <urn:p> <urn:o>',
        equals: () => false,
      },
    };
    const unicode = quad(
      namedNode('https://example.org/😀'),
      namedNode('urn:p'),
      literal('unicode'),
    );
    await wrapped.writeRdf(url, [foreign, unicode], { ifMatch: '*', offline: 'queue' });
    const body = new TextDecoder().decode(
      (await outbox.localBody(outbox.pending()[0]?.id as string)) as Uint8Array,
    );
    const parsed = new Parser().parse(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.subject.value).not.toContain('evil');
    expect(parsed[1]?.subject.value).toBe('https://example.org/😀');
  });

  it('does not mistake a programming TypeError for a network failure', async () => {
    online();
    const outbox = box();
    const { client, write } = storage();
    write.mockRejectedValueOnce(new TypeError('invalid content type'));
    await expect(
      withOutbox(client, outbox).write(url, 'x', { ...writeOptions, offline: 'queue' }),
    ).rejects.toThrow('invalid content type');
    await outbox.ready;
    expect(outbox.pending()).toEqual([]);
  });
});
