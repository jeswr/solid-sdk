// AUTHORED-BY Codex GPT-6

/** Shared relay state. Redis implementations must use SET NX PX, never get-then-set. */
export interface RelayStore {
  /** Atomically reserve a replay key until ttlMs has elapsed. Fail closed on store errors. */
  insertIfAbsent(key: string, ttlMs: number): Promise<boolean>;
}

/** Share one instance between local relays; independent processes need a shared backend. */
export class InMemoryRelayStore implements RelayStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async insertIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid replay lifetime");
    const now = this.now();
    for (const [entry, expiry] of this.entries) if (expiry <= now) this.entries.delete(entry);
    // No await between checking and inserting: concurrent callers have exactly one winner.
    if (this.entries.has(key)) return false;
    this.entries.set(key, now + ttlMs);
    return true;
  }
}
