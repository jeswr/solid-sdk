// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ConnectorTokenVault, IndexedDbVaultStore, MAX_VAULT_RECORDS, vaultId } from "./vault.js";

/** Minimal structured-cloning IDB fake: queued transactions, commit/abort and cursors.
 * No provider/network or browser globals are used. Writes roll back on abort.
 */
function fakeIndexedDb() {
  type Request = { result?: unknown; onsuccess?: () => void; onerror?: () => void };
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  const connections: { onversionchange?: () => void }[] = [];
  let tail = Promise.resolve();
  let failOpen = false;
  let failCommit = false;
  let blocked = false;
  const factory = {
    open(name: string) {
      const request: Request & { onupgradeneeded?: () => void; onblocked?: () => void } = {};
      queueMicrotask(() => {
        if (failOpen) {
          request.onerror?.();
          return;
        }
        if (blocked) {
          request.onblocked?.();
          return;
        }
        let data = databases.get(name);
        const fresh = !data;
        if (!data) {
          data = new Map();
          databases.set(name, data);
        }
        const storage = data;
        let closed = false;
        const db: {
          onversionchange?: () => void;
          close(): void;
          createObjectStore(name: string): void;
          transaction(name: string, mode: string): unknown;
        } = {
          close() {
            closed = true;
          },
          createObjectStore(name: string) {
            storage.set(name, new Map());
          },
          transaction(name: string, _mode: string) {
            if (closed) throw new Error("closed database");
            let finish!: () => void;
            const ready = tail;
            tail = new Promise<void>((resolve) => {
              finish = resolve;
            });
            let local: Map<IDBValidKey, unknown>;
            let pending = 0;
            let aborted = false;
            let started = false;
            const tx: {
              oncomplete?: () => void;
              onabort?: () => void;
              onerror?: () => void;
              abort(): void;
              objectStore(): unknown;
            } = {
              abort() {
                if (!aborted) {
                  aborted = true;
                  queueMicrotask(() => {
                    tx.onabort?.();
                    finish();
                  });
                }
              },
              objectStore() {
                return store;
              },
            };
            const commit = () =>
              queueMicrotask(() => {
                if (aborted || pending || !started) return;
                if (failCommit) {
                  tx.abort();
                  return;
                }
                storage.set(name, local);
                tx.oncomplete?.();
                finish();
              });
            const schedule = (action: () => void) => {
              pending++;
              void ready.then(() => {
                if (!started) {
                  local = new Map(storage.get(name));
                  started = true;
                }
                if (!aborted) {
                  try {
                    action();
                  } catch {
                    tx.abort();
                  }
                }
                pending--;
                commit();
              });
            };
            const operation = (read: () => unknown) => {
              const request: Request = {};
              schedule(() => {
                request.result = structuredClone(read());
                request.onsuccess?.();
              });
              return request;
            };
            const store = {
              transaction: tx,
              get(key: IDBValidKey) {
                return operation(() => local.get(key));
              },
              count() {
                return operation(() => local.size);
              },
              put(value: unknown, key: IDBValidKey) {
                return operation(() => {
                  local.set(key, structuredClone(value));
                  return key;
                });
              },
              delete(key: IDBValidKey) {
                return operation(() => {
                  local.delete(key);
                });
              },
              openKeyCursor() {
                const request: Request = {};
                let keys: IDBValidKey[] | undefined;
                let index = 0;
                const next = () =>
                  schedule(() => {
                    keys ??= [...local.keys()];
                    const key = keys[index++];
                    request.result = key === undefined ? null : { key, continue: next };
                    request.onsuccess?.();
                  });
                next();
                return request;
              },
            };
            return tx;
          },
        };
        connections.push(db);
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    databases,
    connections,
    failOpen: () => {
      failOpen = true;
    },
    failCommit: () => {
      failCommit = true;
    },
    blocked: () => {
      blocked = true;
    },
  };
}

const key = { connectorId: "spotify", account: "fixture" };
describe("IndexedDB encrypted vault", () => {
  it("clears a version-changed handle and reopens on the next call", async () => {
    const fake = fakeIndexedDb();
    const store = new IndexedDbVaultStore("owner", fake.factory);
    await store.put(vaultId(key), "sealed");
    expect(fake.connections).toHaveLength(1);
    fake.connections[0]!.onversionchange!();
    expect(await store.get(vaultId(key))).toBe("sealed");
    expect(fake.connections).toHaveLength(2);
  });
  it("uses Web Locks when present and releases the callback on throw", async () => {
    const request = vi.fn(async (_name, fn) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    try {
      const fake = fakeIndexedDb();
      const store = new IndexedDbVaultStore("owner", fake.factory);
      await expect(
        store.withLock(vaultId(key), async () => {
          throw new Error("callback");
        }),
      ).rejects.toThrow("callback");
      expect(await store.withLock(vaultId(key), async () => 1)).toBe(1);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[0]![0]).toBe(request.mock.calls[1]![0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("fallback mutex serializes separate store instances sharing a database", async () => {
    vi.stubGlobal("navigator", {});
    try {
      const fake = fakeIndexedDb();
      const one = new IndexedDbVaultStore("owner", fake.factory);
      const two = new IndexedDbVaultStore("owner", fake.factory);
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const events: number[] = [];
      const first = one
        .withLock(vaultId(key), async () => {
          events.push(1);
          ready.resolve();
          await release.promise;
          throw new Error("callback");
        })
        .catch(() => {});
      await ready.promise;
      const second = two.withLock(vaultId(key), async () => {
        events.push(2);
      });
      await Promise.resolve();
      expect(events).toEqual([1]);
      release.resolve();
      await Promise.all([first, second]);
      expect(events).toEqual([1, 2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("persists a non-extractable CryptoKey in the same DB and restores after reopening", async () => {
    const fake = fakeIndexedDb();
    const store = new IndexedDbVaultStore("owner", fake.factory);
    const cryptoKey = await store.getOrCreateKey();
    expect(cryptoKey.extractable).toBe(false);
    const vault = new ConnectorTokenVault(cryptoKey, store);
    expect(await vault.get(key)).toBeUndefined();
    await vault.put(key, { refreshToken: "synthetic-sensitive-refresh", obtainedAt: 1 });
    const raw = fake.databases.get("owner")!;
    expect(raw.get("keys")?.get("aes256gcm")).toBeInstanceOf(CryptoKey);
    expect(raw.get("records")?.get(vaultId(key))).not.toContain("synthetic-sensitive-refresh");
    await store.close();
    const reopened = new IndexedDbVaultStore("owner", fake.factory);
    const restored = new ConnectorTokenVault(await reopened.getOrCreateKey(), reopened);
    expect((await restored.get(key))?.refreshToken).toBe("synthetic-sensitive-refresh");
    expect(await restored.list()).toEqual([key]);
    await restored.delete(key);
    await restored.delete(key);
    expect(await restored.list()).toEqual([]);
  });
  it("concurrent opens elect one key transactionally", async () => {
    const fake = fakeIndexedDb();
    const first = new IndexedDbVaultStore("owner", fake.factory);
    const second = new IndexedDbVaultStore("owner", fake.factory);
    const [one, two] = await Promise.all([first.getOrCreateKey(), second.getOrCreateKey()]);
    await new ConnectorTokenVault(one, first).put(key, { refreshToken: "same-key", obtainedAt: 1 });
    expect((await new ConnectorTokenVault(two, second).get(key))?.refreshToken).toBe("same-key");
  });
  it("caps records and cursor traversal, but allows replacement/deletion at the cap", async () => {
    const fake = fakeIndexedDb();
    const store = new IndexedDbVaultStore("owner", fake.factory);
    await store.getOrCreateKey();
    const records = fake.databases.get("owner")!.get("records")!;
    for (let index = 0; index < MAX_VAULT_RECORDS; index++)
      records.set(vaultId({ ...key, account: String(index) }), "sealed");
    await expect(store.put(vaultId(key), "new")).rejects.toThrow(
      "Connector vault operation failed.",
    );
    expect(records.has(vaultId(key))).toBe(false);
    await store.put(vaultId({ ...key, account: "0" }), "replaced");
    expect(await store.list()).toHaveLength(MAX_VAULT_RECORDS);
    await store.delete(vaultId({ ...key, account: "0" }));
    await store.put(vaultId(key), "new");
    fake.databases
      .get("owner")
      ?.get("records")
      ?.set(vaultId({ ...key, account: "overflow" }), "sealed");
    await expect(store.list()).rejects.toThrow("Connector vault operation failed.");
  });
  it("rejects corrupt/extractable keys, bad stored data and invalid cursor identities", async () => {
    for (const badKey of [
      { extractable: false },
      await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
      ]),
    ]) {
      const fake = fakeIndexedDb();
      const store = new IndexedDbVaultStore("owner", fake.factory);
      await store.getOrCreateKey();
      fake.databases.get("owner")?.get("keys")?.set("aes256gcm", badKey);
      await expect(store.getOrCreateKey()).rejects.toThrow("Connector vault operation failed.");
    }
    const fake = fakeIndexedDb();
    const store = new IndexedDbVaultStore("owner", fake.factory);
    await store.getOrCreateKey();
    fake.databases.get("owner")?.get("records")?.set(vaultId(key), { token: "sensitive" });
    await expect(store.get(vaultId(key))).rejects.toThrow("Connector vault operation failed.");
    fake.databases.get("owner")?.get("records")?.set("noncanonical", "sealed");
    await expect(store.list()).rejects.toThrow("Connector vault operation failed.");
  });
  it("masks open/blocked/transaction failures and waits for commit before resolving", async () => {
    for (const failure of ["failOpen", "blocked", "failCommit"] as const) {
      const fake = fakeIndexedDb();
      const store = new IndexedDbVaultStore("owner", fake.factory);
      if (failure === "failCommit") await store.getOrCreateKey();
      fake[failure]();
      await expect(store.getOrCreateKey()).rejects.toMatchObject({
        message: "Connector vault operation failed.",
      });
    }
  });
});
