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
const PLAIN_SLOT = "aes256gcm";
const WRAPPED_SLOT = "aes256gcm-pbkdf2";
/** PBKDF2-SHA-256 work factor for passphrase-wrapped vault keys. */
export const VAULT_KEY_PBKDF2_ITERATIONS = 600_000;
const WRAP_AAD = new TextEncoder().encode("pod-connectors-vault-key:1");

/** Options for {@link IndexedDbVaultStore.getOrCreateKey}. */
export interface VaultKeyOptions {
  /**
   * Store the vault key wrapped by a key derived from this user secret (8 to 1024 UTF-16
   * code units), so a copied profile or same-origin script cannot use it without the secret.
   * A database uses one mode for its lifetime; the host must not persist the passphrase.
   */
  readonly passphrase?: string;
}

interface WrappedKeyEntry {
  readonly version: 1;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly wrapped: Uint8Array<ArrayBuffer>;
}

function wrappedEntry(value: unknown): WrappedKeyEntry {
  const entry = value as Partial<WrappedKeyEntry> | null;
  if (
    !entry ||
    typeof entry !== "object" ||
    entry.version !== 1 ||
    !(entry.salt instanceof Uint8Array) ||
    entry.salt.length !== 16 ||
    !(entry.iv instanceof Uint8Array) ||
    entry.iv.length !== 12 ||
    !(entry.wrapped instanceof Uint8Array) ||
    entry.wrapped.length !== 48
  )
    throw new ConnectorVaultError();
  return entry as WrappedKeyEntry;
}

async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const secret = new TextEncoder().encode(passphrase);
  try {
    const base = await globalThis.crypto.subtle.importKey("raw", secret, "PBKDF2", false, [
      "deriveKey",
    ]);
    return await globalThis.crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: VAULT_KEY_PBKDF2_ITERATIONS },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["wrapKey", "unwrapKey"],
    );
  } finally {
    secret.fill(0);
  }
}

/** Ciphertexts and a structured-cloned, non-extractable CryptoKey share one database.
 * Use a distinct database name for each host/owner. Without a passphrase, anyone with a copy
 * of the browser profile, or script on the same origin, can use the key to decrypt records;
 * non-extractable only prevents exporting the raw key bytes.
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
  /**
   * Elect one vault key per database. With `passphrase`, only a PBKDF2-wrapped form is stored
   * and the key is unusable without the passphrase; a wrong passphrase or a mode mismatch
   * fails with the generic vault error.
   */
  async getOrCreateKey(options: VaultKeyOptions = {}): Promise<CryptoKey> {
    const passphrase = options?.passphrase;
    if (passphrase !== undefined) return this.getOrCreateWrappedKey(passphrase);
    // Generate outside the transaction so awaiting WebCrypto cannot auto-commit it.
    const candidate = await generateBrowserVaultKey();
    const key = await this.transaction<CryptoKey>("keys", "readwrite", (store, set) => {
      const wrapped = store.get(WRAPPED_SLOT);
      wrapped.onsuccess = () => {
        try {
          // A passphrase-protected database never gains an unprotected key.
          if (wrapped.result !== undefined) {
            store.transaction.abort();
            return;
          }
          const request = store.get(PLAIN_SLOT);
          request.onsuccess = () => {
            try {
              const key = request.result ?? candidate;
              if (request.result === undefined) store.put(candidate, PLAIN_SLOT);
              set(key);
            } catch {
              store.transaction.abort();
            }
          };
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
  private async getOrCreateWrappedKey(passphrase: string): Promise<CryptoKey> {
    try {
      if (
        typeof passphrase !== "string" ||
        passphrase.length < 8 ||
        passphrase.length > 1024 ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(passphrase)
      )
        throw new ConnectorVaultError();
      const read = (store: IDBObjectStore, found: (value: unknown) => void) => {
        const plain = store.get(PLAIN_SLOT);
        plain.onsuccess = () => {
          try {
            if (plain.result !== undefined) {
              store.transaction.abort();
              return;
            }
            const wrapped = store.get(WRAPPED_SLOT);
            wrapped.onsuccess = () => found(wrapped.result);
          } catch {
            store.transaction.abort();
          }
        };
      };
      let entry = await this.transaction<unknown>("keys", "readonly", (store, set) =>
        read(store, set),
      );
      let derived: { salt: Uint8Array; key: CryptoKey } | undefined;
      if (entry === undefined) {
        // Derive and wrap outside the transaction, then elect transactionally.
        const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const kek = await wrappingKey(passphrase, salt);
        const exportable = await globalThis.crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        const candidate: WrappedKeyEntry = {
          version: 1,
          salt,
          iv,
          wrapped: new Uint8Array(
            await globalThis.crypto.subtle.wrapKey("raw", exportable, kek, {
              name: "AES-GCM",
              iv,
              additionalData: WRAP_AAD,
              tagLength: 128,
            }),
          ),
        };
        derived = { salt, key: kek };
        entry = await this.transaction<unknown>("keys", "readwrite", (store, set) =>
          read(store, (value) => {
            if (value === undefined) store.put(candidate, WRAPPED_SLOT);
            set(value ?? candidate);
          }),
        );
      }
      const stored = wrappedEntry(entry);
      const kek =
        derived && derived.salt === stored.salt
          ? derived.key
          : await wrappingKey(passphrase, stored.salt);
      // Only the non-extractable unwrapped instance is ever returned.
      const key = await globalThis.crypto.subtle.unwrapKey(
        "raw",
        stored.wrapped,
        kek,
        { name: "AES-GCM", iv: stored.iv, additionalData: WRAP_AAD, tagLength: 128 },
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
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
