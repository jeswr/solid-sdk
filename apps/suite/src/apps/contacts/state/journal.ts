// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { SavedDocument } from "../lib/model/intent";
import type { MergeSelection } from "./merge";

export interface Intent {
  id: string;
  kind: "create" | "delete" | "restore" | "migrate" | "book" | "merge";
  startedAt: string;
  bookUrl: string;
  destination: string;
  destinations: string[];
  person?: SavedDocument;
  source?: SavedDocument;
  /** Delete only: the trash copy, created before anything is unlinked or deleted. */
  trash?: SavedDocument;
  /** Merge only: each duplicate's pre-merge RDF and the labels it must leave. */
  duplicates?: MergeDuplicate[];
  /** Merge only: the reviewed choices, so only an identical request resumes this record. */
  selection?: MergeSelection;
  labels: string[];
  completed: string[];
  repairs: string[];
  attempting?: string;
  phase: "forward" | "reconcile" | "rollback";
}
export interface MergeDuplicate {
  person: SavedDocument;
  labels: string[];
}
export interface IntentStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const browserIntentStorage = () => globalThis.localStorage;
export function journalPrefix(webId: string, bookUrl: string) {
  return `solid-suite:contacts:intent:${encodeURIComponent(webId)}:${encodeURIComponent(bookUrl)}:`;
}

// Survives provider remounts when browser storage is unavailable. Never claim reload durability.
const memory = new Map<string, string>();
// Share fallback mode too: readable storage may contain stale checkpoints after quota failures.
const volatile = new Set<string>();
const queues = new Map<string, Promise<unknown>>();
export class IntentJournal {
  readonly prefix: string;
  constructor(
    webId: string,
    readonly bookUrl: string,
    private warn: (message: string) => void,
    private storage: () => IntentStorage = browserIntentStorage,
  ) {
    this.prefix = journalPrefix(webId, bookUrl);
  }
  private access<T>(persistent: (storage: IntentStorage) => T, fallback: () => T): T {
    if (!volatile.has(this.prefix)) {
      try {
        return persistent(this.storage());
      } catch {
        volatile.add(this.prefix);
        this.warn(
          "This browser cannot save Contacts recovery. Keep this tab open until saving finishes; recovery will be lost on reload.",
        );
      }
    }
    return fallback();
  }
  list(): Intent[] {
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
        const intent = JSON.parse(value) as Intent;
        if (key !== this.prefix + intent.id || intent.bookUrl !== this.bookUrl)
          throw new Error("Contacts recovery record is invalid.");
        memory.set(key, value);
        return intent;
      })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  put(intent: Intent) {
    const key = this.prefix + intent.id;
    const value = JSON.stringify(intent);
    memory.set(key, value);
    this.access(
      (storage) => storage.setItem(key, value),
      () => undefined,
    );
  }
  remove(intent: Intent) {
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
