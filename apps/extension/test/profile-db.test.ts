// AUTHORED-BY GPT-6.1-Sol (Codex)
import { describe, expect, it } from 'vitest';
import { createDpopProof } from '../src/background/core/dpop';
import { ProfileStore } from '../src/background/core/profile-store';
import { ProfileDb } from '../src/background/profile-db';
import { noLegacy, profileCredentials } from './profile-fixtures';

/** Minimal fixture IndexedDB: named stores, async transactions and structured-cloned values. */
function fixtureIdb() {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  let created = false;
  let abortNext = false;
  let failRead = false;
  let closed = 0;
  const db = {
    createObjectStore: (name: string) => stores.set(name, new Map()),
    close: () => closed++,
    transaction: (_names: string[], mode: string) => {
      const snapshot = structuredClone(stores);
      let pending = 0;
      let settled = false;
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: new Error('fixture transaction aborted'),
        objectStore: (name: string) => {
          const backing = snapshot.get(name)!;
          const req = <T>(op: () => T) => {
            pending++;
            const r = {
              result: undefined as T | undefined,
              error: new Error('fixture read failed'),
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => {
              if (failRead && mode === 'readonly') r.onerror?.();
              else {
                r.result = op();
                r.onsuccess?.();
              }
              pending--;
              queueMicrotask(() => {
                if (pending !== 0 || settled) return;
                settled = true;
                if (abortNext) {
                  abortNext = false;
                  tx.onabort?.();
                } else {
                  if (mode === 'readwrite')
                    for (const [key, value] of snapshot) stores.set(key, value);
                  tx.oncomplete?.();
                }
              });
            });
            return r;
          };
          return {
            get: (key: IDBValidKey) => req(() => structuredClone(backing.get(key))),
            getAll: () => req(() => structuredClone([...backing.values()])),
            put: (value: unknown, key: IDBValidKey) =>
              req(() => {
                backing.set(key, structuredClone(value));
                return key;
              }),
            clear: () => req(() => backing.clear()),
          };
        },
      };
      return tx;
    },
  };
  const factory = {
    open: () => {
      const req = {
        result: db,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (!created) {
          created = true;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    stores,
    abort: () => {
      abortNext = true;
    },
    readError: () => {
      failRead = true;
    },
    closed: () => closed,
  };
}

describe('ProfileDb IndexedDB adapter', () => {
  it('persists profile-keyed tokens, default and non-extractable keys across close/reopen', async () => {
    const fixture = fixtureIdb();
    const db = await ProfileDb.open(fixture.factory);
    const store = new ProfileStore(db, async () => {});
    await store.initialise(noLegacy, async () => {});
    const a = await profileCredentials();
    const b = await profileCredentials('bob');
    await store.login(a.session, a.keyPair, a.display);
    await store.login(b.session, b.keyPair, b.display);
    await store.setDefault('2');
    db.close();
    expect(fixture.closed()).toBe(1);
    const reopened = await ProfileDb.open(fixture.factory);
    const restored = new ProfileStore(reopened, async () => {});
    expect((await restored.getDefault())?.session?.accessToken).toBe(b.session.accessToken);
    const aKey = (await restored.session('1'))!.keyPair;
    expect(aKey.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', aKey.privateKey)).rejects.toThrow();
    expect(
      await createDpopProof({ keyPair: aKey, htm: 'GET', htu: 'https://pod.example/private/' }),
    ).toBeTypeOf('string');
    expect([...fixture.stores.get('profiles')!.keys()]).toEqual(['1', '2']);
    expect((await restored.list()).profiles.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('waits for commit and preserves the previous snapshot on transaction abort', async () => {
    const fixture = fixtureIdb();
    const db = await ProfileDb.open(fixture.factory);
    const before = await db.read();
    fixture.abort();
    await expect(db.write({ ...before, migrated: true })).rejects.toThrow('aborted');
    expect(await db.read()).toEqual(before);
    fixture.readError();
    await expect(db.read()).rejects.toThrow('read failed');
  });

  it('fails closed when IndexedDB is unavailable or opening fails', async () => {
    await expect(ProfileDb.open(undefined)).rejects.toThrow('requires IndexedDB');
    const factory = {
      open: () => {
        const req = {
          error: new Error('fixture open failure'),
          onerror: null as (() => void) | null,
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    } as unknown as IDBFactory;
    await expect(ProfileDb.open(factory)).rejects.toThrow('open failure');
  });
});
