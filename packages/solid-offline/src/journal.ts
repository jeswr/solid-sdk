// AUTHORED-BY Codex GPT-6.1-Sol
export interface IntentStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const browserIntentStorage = () => globalThis.localStorage;

// Survives provider remounts when browser storage is unavailable. Never claim reload durability.
const memory = new Map<string, string>();
// Share fallback mode too: readable storage may contain stale checkpoints after quota failures.
const volatile = new Set<string>();
const persisted = new Set<string>();
const queues = new Map<string, Promise<unknown>>();
export class DurableJournal<T extends { id: string; startedAt: string }> {
  constructor(
    readonly prefix: string,
    private decode: (value: unknown) => T,
    private warn: (message: string) => void,
    private unavailableMessage: string,
    private storage: () => IntentStorage = browserIntentStorage,
  ) {}
  private access<T>(persistent: (storage: IntentStorage) => T, fallback: () => T): T {
    if (!volatile.has(this.prefix)) {
      try {
        return persistent(this.storage());
      } catch {
        volatile.add(this.prefix);
        this.warn(this.unavailableMessage);
      }
    }
    // Readable storage can still confirm a deletion after a quota failure. Do not
    // adopt its old values over dirty memory, or discard never-persisted records.
    try {
      this.prune(this.storage());
    } catch {
      // Unreadable storage leaves the last observed snapshot in charge.
    }
    return fallback();
  }
  private forget(key: string) {
    memory.delete(key);
    persisted.delete(key);
  }
  private keys(storage: IntentStorage): Set<string> {
    const keys = new Set<string>();
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(this.prefix)) keys.add(key);
    }
    return keys;
  }
  private prune(storage: IntentStorage) {
    const keys = this.keys(storage);
    for (const key of persisted)
      if (key.startsWith(this.prefix) && !keys.has(key)) this.forget(key);
    for (const key of persisted)
      if (key.startsWith(this.prefix) && storage.getItem(key) === null) this.forget(key);
  }
  private snapshot(storage: IntentStorage): [string, string][] {
    const keys = this.keys(storage);
    // Evict before reading values: a later getItem failure must not resurrect a
    // record whose deletion we already observed in the complete key enumeration.
    for (const key of memory.keys())
      if (key.startsWith(this.prefix) && !keys.has(key)) this.forget(key);
    const entries: [string, string][] = [];
    for (const key of keys) {
      const value = storage.getItem(key);
      if (value === null) this.forget(key);
      else {
        memory.set(key, value);
        persisted.add(key);
        entries.push([key, value]);
      }
    }
    return entries;
  }
  list(): T[] {
    const entries = this.access(
      (storage) => this.snapshot(storage),
      () => [...memory].filter(([key]) => key.startsWith(this.prefix)),
    );
    return entries
      .map(([key, value]) => {
        const intent = this.decode(JSON.parse(value));
        if (key !== this.prefix + intent.id) throw new Error('Recovery record is invalid.');
        return intent;
      })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  /** False means memory-only storage. Migrations must retain their durable source. */
  put(intent: T): boolean {
    const key = this.prefix + intent.id;
    const value = JSON.stringify(intent);
    return this.access(
      (storage) => {
        this.snapshot(storage);
        storage.setItem(key, value);
        memory.set(key, value);
        persisted.add(key);
        return true;
      },
      () => {
        memory.set(key, value);
        return false;
      },
    );
  }
  remove(intent: T) {
    const key = this.prefix + intent.id;
    this.access(
      (storage) => {
        this.snapshot(storage);
        storage.removeItem(key);
        this.forget(key);
      },
      () => {
        memory.delete(key);
      },
    );
  }
  /** Web Locks serialize cooperating tabs; conditional pod writes still guard other clients. */
  lock<T>(work: () => Promise<T>): Promise<T> {
    return withJournalLock(this.prefix, work);
  }
}

/** Serialize a handoff that spans journal namespaces (for example a legacy account key). */
export function withJournalLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async (): Promise<T> => {
      const locks = globalThis.navigator?.locks;
      return locks ? await locks.request(key, work) : await work();
    });
  queues.set(key, next);
  return next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}
