// AUTHORED-BY Codex GPT-6.1-Sol
import type { Grant, GrantStore, OAuthStores, OneTimeStore } from "./types.js";

/** Snapshotting, atomic-in-one-process store. Consumed records remain as replay tombstones. */
export class MemoryStore<T> implements OneTimeStore<T> {
  private readonly values = new Map<string, { value: T; used: boolean }>();

  async get(id: string): Promise<T | undefined> {
    const entry = this.values.get(id);
    return entry && structuredClone(entry.value);
  }

  async put(id: string, value: T): Promise<void> {
    if (this.values.has(id)) throw new Error("Record already exists");
    this.values.set(id, { value: structuredClone(value), used: false });
  }

  async consume(id: string): Promise<{ value: T; firstUse: boolean } | undefined> {
    const entry = this.values.get(id);
    if (!entry) return undefined;
    const firstUse = !entry.used;
    entry.used = true;
    return { value: structuredClone(entry.value), firstUse };
  }
}

/** Single-process grant store with irreversible revocation. */
export class MemoryGrantStore implements GrantStore {
  private readonly values = new Map<string, Grant>();

  async get(id: string): Promise<Grant | undefined> {
    const value = this.values.get(id);
    return value && structuredClone(value);
  }

  async put(id: string, value: Grant): Promise<void> {
    if (this.values.has(id)) throw new Error("Grant already exists");
    this.values.set(id, structuredClone(value));
  }

  async revoke(id: string): Promise<void> {
    const value = this.values.get(id);
    if (value) value.revoked = true;
  }
}

/** Create isolated in-memory stores, suitable for tests and a single server process. */
export function createMemoryStores(): OAuthStores {
  return {
    clients: new MemoryStore(),
    pending: new MemoryStore(),
    codes: new MemoryStore(),
    refreshTokens: new MemoryStore(),
    grants: new MemoryGrantStore(),
  };
}
