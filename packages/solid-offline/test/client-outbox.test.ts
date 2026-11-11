// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from '@jeswr/storage-client';
import { createMemoryStorage } from '@jeswr/storage-client/memory';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineClient } from '../src/index.js';
import { createOutbox, type Outbox } from '../src/outbox.js';

const root = 'https://pod.example/';
const webId = `${root}profile#me`;
let outbox: Outbox;
let page: EventTarget;
const clients: ReturnType<typeof createOfflineClient>[] = [];

beforeEach(() => {
  page = new EventTarget();
  vi.stubGlobal('window', page);
  vi.stubGlobal('navigator', { onLine: true });
  const idb = new IDBFactory();
  vi.stubGlobal('indexedDB', idb);
  outbox = createOutbox({ webId, idb });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  outbox.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function enqueue(url = `${root}file`) {
  await outbox.enqueue({
    op: 'write',
    url,
    body: 'local',
    contentType: 'text/plain',
    ifMatch: '"old"',
  });
}
function client(storage = createMemoryStorage({ protocol: 'solid', root })) {
  const offline = createOfflineClient({ storage, outbox, webId });
  clients.push(offline);
  return { offline, storage };
}

describe('offline client outbox integration', () => {
  it('replays after register even when service workers are unsupported, and on online', async () => {
    const { offline, storage } = client();
    const write = vi
      .spyOn(storage, 'write')
      .mockResolvedValue({ url: `${root}file`, etag: '"new"', created: false });
    await enqueue();
    expect(write).not.toHaveBeenCalled();
    await offline.register();
    expect(outbox.pending()).toEqual([]);
    await enqueue();
    page.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(outbox.pending()).toEqual([]));
    expect(write).toHaveBeenCalledTimes(2);
    offline.close();
    await enqueue();
    page.dispatchEvent(new Event('online'));
    expect(write).toHaveBeenCalledTimes(2);
    await offline.register();
    expect(outbox.pending()).toEqual([]);
  });

  it('keeps unsent changes across logout and stops after the active request is aborted', async () => {
    const { offline, storage } = client();
    let started: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(storage, 'write').mockImplementation(async (_url, _body, opts) => {
      started?.();
      await new Promise<void>((_resolve, reject) => {
        opts.signal?.addEventListener(
          'abort',
          () => reject(new StorageError('network', { url: `${root}file`, method: 'PUT' })),
          { once: true },
        );
      });
      return { url: `${root}file`, etag: null, created: false };
    });
    await enqueue();
    await enqueue(`${root}second`);
    const registration = offline.register();
    await active;
    await offline.logout();
    await registration;
    expect(outbox.pending().map((item) => item.status)).toEqual(['waiting', 'waiting']);
    const reopened = createOutbox({ webId });
    try {
      await reopened.ready;
      expect(reopened.pending()).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });

  it('strips the outbox from worker config, and de-duplicates reconnect listeners', async () => {
    const postMessage = vi.fn();
    const worker = { postMessage };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: worker,
        register: vi.fn(async () => ({ active: worker })),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const add = vi.spyOn(page, 'addEventListener');
    const { offline } = client();
    const replay = vi.spyOn(outbox, 'replay');
    await offline.register();
    await offline.register();
    expect(add.mock.calls.filter(([event]) => event === 'online')).toHaveLength(1);
    const config = postMessage.mock.calls[0]?.[0];
    expect(config.config.outbox).toBeUndefined();
    expect(() => structuredClone(config)).not.toThrow();
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it('does not replay if close runs during service-worker registration', async () => {
    let complete: ((registration: unknown) => void) | undefined;
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn(
          () =>
            new Promise((resolve) => {
              complete = resolve;
            }),
        ),
      },
    });
    const { offline } = client();
    const replay = vi.spyOn(outbox, 'replay');
    const registering = offline.register();
    offline.close();
    complete?.({ active: null });
    await registering;
    expect(replay).not.toHaveBeenCalled();
  });

  it('rejects a queue belonging to a different active WebID', () => {
    expect(() => createOfflineClient({ webId: `${root}other`, outbox })).toThrow(
      'WebID must match',
    );
    expect(() => createOfflineClient({ outbox })).toThrow('WebID must match');
  });
});
