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
    return fallback();
  }
  list(): T[] {
    const entries = this.access(
      (storage) => {
        const entries: [string, string][] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(this.prefix)) continue;
          const value = storage.getItem(key);
          if (value !== null) entries.push([key, value]);
        }
        return entries;
      },
      () => [...memory].filter(([key]) => key.startsWith(this.prefix)),
    );
    return entries
      .map(([key, value]) => {
        // Corrupt recovery data must block readiness, rather than silently abandon a write.
        const intent = this.decode(JSON.parse(value));
        if (key !== this.prefix + intent.id) throw new Error("Recovery record is invalid.");
        memory.set(key, value);
        return intent;
      })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  put(intent: T) {
    const key = this.prefix + intent.id;
    const value = JSON.stringify(intent);
    memory.set(key, value);
    this.access(
      (storage) => storage.setItem(key, value),
      () => undefined,
    );
  }
  remove(intent: T) {
    const key = this.prefix + intent.id;
    memory.delete(key);
    this.access(
      (storage) => storage.removeItem(key),
      () => undefined,
    );
  }
  /** Web Locks serialize cooperating tabs; conditional RDF writes still guard other clients. */
  lock<T>(work: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.prefix) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => {
        const locks = globalThis.navigator?.locks;
        return locks ? locks.request(this.prefix, work) : work();
      });
    queues.set(this.prefix, next);
    return next.finally(() => {
      if (queues.get(this.prefix) === next) queues.delete(this.prefix);
    });
  }
}
