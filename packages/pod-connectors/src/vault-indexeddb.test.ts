// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { ConnectorTokenVault, IndexedDbVaultStore, MAX_VAULT_RECORDS, vaultId } from "./vault.js";

/** Minimal structured-cloning IDB fake: queued transactions, commit/abort and cursors.
 * No provider/network or browser globals are used. Writes roll back on abort.
 */
function fakeIndexedDb() {
  type Request = { result?: unknown; onsuccess?: () => void; onerror?: () => void };
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
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
        const db = {
          close() {},
          createObjectStore(name: string) {
            storage.set(name, new Map());
          },
          transaction(name: string, _mode: string) {
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
