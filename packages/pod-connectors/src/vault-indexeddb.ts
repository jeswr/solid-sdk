// AUTHORED-BY Codex GPT-6.1-Sol
import {
  ConnectorVaultError,
  generateBrowserVaultKey,
  MAX_VAULT_RECORDS,
  type VaultStore,
  validateSealed,
  validateVaultCryptoKey,
  vaultKey,
} from "./vault.js";
import { VaultMutex } from "./vault-lock.js";

const mutexes = new WeakMap<IDBFactory, VaultMutex>();

/** Ciphertexts and a structured-cloned, non-extractable CryptoKey share one database.
 * Use a distinct database name for each host/owner. Same-origin script can use this key.
 */
export class IndexedDbVaultStore implements VaultStore {
  private database: Promise<IDBDatabase> | undefined;
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    vaultKey(id);
    const name = JSON.stringify(["pod-connectors-vault", this.name, id]);
    if (globalThis.navigator?.locks) return globalThis.navigator.locks.request(name, fn);
    let mutex = mutexes.get(this.factory);
    if (!mutex) {
      mutex = new VaultMutex();
      mutexes.set(this.factory, mutex);
    }
    return mutex.withLock(name, fn);
  }
  constructor(
    private readonly name = "pod-connectors-vault",
    private readonly factory: IDBFactory = globalThis.indexedDB,
  ) {
    if (typeof name !== "string" || !name.length || name.length > 256)
      throw new ConnectorVaultError();
  }

  private async db(): Promise<IDBDatabase> {
    try {
      if (!this.database)
        this.database = new Promise((resolve, reject) => {
          const request = this.factory.open(this.name, 1);
          let rejected = false;
          request.onupgradeneeded = () => {
            try {
              request.result.createObjectStore("records");
              request.result.createObjectStore("keys");
            } catch {
              rejected = true;
              request.transaction?.abort();
              reject(new ConnectorVaultError());
            }
          };
          request.onerror = () => reject(new ConnectorVaultError());
          request.onblocked = () => {
            rejected = true;
            reject(new ConnectorVaultError());
          };
          request.onsuccess = () => {
            if (rejected) {
              request.result.close();
              return;
            }
            request.result.onversionchange = () => {
              request.result.close();
              this.database = undefined;
            };
            resolve(request.result);
          };
        });
      return await this.database;
    } catch {
      this.database = undefined;
      throw new ConnectorVaultError();
    }
  }
  private async transaction<T>(
    store: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, set: (result: T) => void) => void,
  ): Promise<T> {
    try {
      const db = await this.db();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(new ConnectorVaultError());
        try {
          operation(tx.objectStore(store), (value) => {
            result = value;
          });
        } catch {
          tx.abort();
          reject(new ConnectorVaultError());
        }
      });
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async getOrCreateKey(): Promise<CryptoKey> {
    // Generate outside the transaction so awaiting WebCrypto cannot auto-commit it.
    const candidate = await generateBrowserVaultKey();
    const key = await this.transaction<CryptoKey>("keys", "readwrite", (store, set) => {
      const request = store.get("aes256gcm");
      request.onsuccess = () => {
        try {
          const key = request.result ?? candidate;
          if (request.result === undefined) store.put(candidate, "aes256gcm");
          set(key);
        } catch {
          store.transaction.abort();
        }
      };
    });
    try {
      validateVaultCryptoKey(key);
      if (key.extractable) throw new ConnectorVaultError();
      return key;
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async get(id: string): Promise<string | undefined> {
    vaultKey(id);
    const value = await this.transaction<unknown>("records", "readonly", (store, set) => {
      const request = store.get(id);
      request.onsuccess = () => set(request.result);
    });
    if (value === undefined) return undefined;
    validateSealed(value as string);
    return value as string;
  }
  async put(id: string, value: string): Promise<void> {
    vaultKey(id);
    validateSealed(value);
    await this.transaction<void>("records", "readwrite", (store) => {
      const existing = store.get(id);
      existing.onsuccess = () => {
        try {
          const count = store.count();
          count.onsuccess = () => {
            try {
              if (existing.result === undefined && count.result >= MAX_VAULT_RECORDS) {
                store.transaction.abort();
              } else store.put(value, id);
            } catch {
              store.transaction.abort();
            }
          };
        } catch {
          store.transaction.abort();
        }
      };
    });
  }
  async delete(id: string): Promise<void> {
    vaultKey(id);
    await this.transaction<void>("records", "readwrite", (store) => {
      store.delete(id);
    });
  }
  async list(): Promise<string[]> {
    return this.transaction<string[]>("records", "readonly", (store, set) => {
      const ids: string[] = [];
      const cursor = store.openKeyCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) {
          set(ids);
          return;
        }
        try {
          if (ids.length >= MAX_VAULT_RECORDS || typeof item.key !== "string")
            throw new ConnectorVaultError();
          vaultKey(item.key);
          ids.push(item.key);
          item.continue();
        } catch {
          store.transaction.abort();
        }
      };
    });
  }
  async close(): Promise<void> {
    try {
      (await this.db()).close();
      this.database = undefined;
    } catch {
      throw new ConnectorVaultError();
    }
  }
}
