// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

/** Shared relay state. Redis implementations must use SET NX PX, never get-then-set. */
export interface RelayStore {
  /** Atomically reserve a replay key until ttlMs has elapsed. Fail closed on store errors. */
  insertIfAbsent(key: string, ttlMs: number): Promise<boolean>;
}

/** Share one instance between local relays; independent processes need a shared backend. */
export class InMemoryRelayStore implements RelayStore {
  // One queue per lifetime: insertion order is then expiry order, so cleanup only ever
  // looks at the head of each queue and never scans unexpired reservations.
  private readonly queues = new Map<number, Map<string, number>>();
  private size = 0;

  constructor(
    private readonly now: () => number = Date.now,
    /** Fail closed when this many unexpired reservations are held. */
    private readonly capacity = 100_000,
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error("Invalid replay capacity");
  }

  async insertIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid replay lifetime");
    const now = this.now();
    this.expire(now, 64);
    // No await between checking and inserting: concurrent callers have exactly one winner.
    for (const queue of this.queues.values()) {
      const expiry = queue.get(key);
      if (expiry === undefined) continue;
      if (expiry > now) return false;
      queue.delete(key);
      this.size--;
    }
    if (this.size >= this.capacity) this.expire(now, Number.POSITIVE_INFINITY);
    if (this.size >= this.capacity) throw new Error("Replay store full");
    let queue = this.queues.get(ttlMs);
    if (!queue) {
      queue = new Map();
      this.queues.set(ttlMs, queue);
    }
    queue.set(key, now + ttlMs);
    this.size++;
    return true;
  }

  /** Drops expired reservations from the queue heads, at most `budget` per queue. */
  private expire(now: number, budget: number): void {
    for (const [ttl, queue] of this.queues) {
      let removed = 0;
      for (const [key, expiry] of queue) {
        if (expiry > now || removed >= budget) break;
        queue.delete(key);
        removed++;
        this.size--;
      }
      if (queue.size === 0) this.queues.delete(ttl);
    }
  }
}
