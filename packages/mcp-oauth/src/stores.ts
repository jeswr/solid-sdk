// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import type { Grant, GrantStore, OAuthStores, OneTimeStore } from "./types.js";
import { expiry } from "./vault-stores.js";

/** Snapshotting, atomic-in-one-process store. Consumed records remain as replay tombstones. */
export class MemoryStore<T> implements OneTimeStore<T> {
  private readonly values = new Map<
    string,
    { value: T; used: boolean; expiresAt?: number | undefined }
  >();

  private purge() {
    for (const [id, entry] of this.values) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) this.values.delete(id);
    }
  }

  async get(id: string): Promise<T | undefined> {
    this.purge();
    const entry = this.values.get(id);
    return entry && structuredClone(entry.value);
  }

  async put(id: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = expiry(ttlSeconds);
    this.purge();
    if (this.values.has(id)) throw new Error("Record already exists");
    this.values.set(id, { value: structuredClone(value), used: false, expiresAt });
  }

  async consume(
    id: string,
    ttlSeconds?: number,
  ): Promise<{ value: T; firstUse: boolean } | undefined> {
    const expiresAt = expiry(ttlSeconds);
    this.purge();
    const entry = this.values.get(id);
    if (!entry) return undefined;
    const firstUse = !entry.used;
    entry.used = true;
    if (firstUse && expiresAt !== undefined) entry.expiresAt = expiresAt;
    return { value: structuredClone(entry.value), firstUse };
  }
}

/** Single-process grant store with irreversible revocation. */
export class MemoryGrantStore implements GrantStore {
  private readonly values = new Map<string, Grant>();
  private readonly expiries = new Map<string, number>();
  private readonly revokedSessions = new Set<string>();

  private purge() {
    for (const [id, expiresAt] of this.expiries) {
      if (expiresAt <= Date.now()) {
        this.values.delete(id);
        this.expiries.delete(id);
      }
    }
  }

  async get(id: string): Promise<Grant | undefined> {
    this.purge();
    const value = this.values.get(id);
    return value && structuredClone(value);
  }

  async put(id: string, value: Grant, ttlSeconds?: number): Promise<void> {
    const expiresAt = expiry(ttlSeconds);
    this.purge();
    if (this.values.has(id)) throw new Error("Grant already exists");
    this.values.set(id, structuredClone(value));
    if (expiresAt !== undefined) this.expiries.set(id, expiresAt);
  }

  async revoke(id: string): Promise<void> {
    this.purge();
    const value = this.values.get(id);
    if (value) value.revoked = true;
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.revokedSessions.add(sessionId);
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return this.revokedSessions.has(sessionId);
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
