import type { IssueQuery } from "./filter";

/** A named, persisted filter/sort preset. */
export interface SavedView {
  id: string;
  name: string;
  query: IssueQuery;
}

const KEY = "solid-issues:saved-views";

/** Minimal storage contract so tests can inject a stub (localStorage matches it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Persisted, name-deduplicated saved views (most-recently-saved first). */
export class SavedViews {
  readonly #storage: KeyValueStorage;
  constructor(storage: KeyValueStorage = globalThis.localStorage) {
    this.#storage = storage;
  }

  list(): SavedView[] {
    try {
      const raw = this.#storage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SavedView[]) : [];
    } catch {
      return [];
    }
  }

  /** Save (or overwrite by name) a view; returns it. */
  save(name: string, query: IssueQuery, id = crypto.randomUUID()): SavedView {
    const view: SavedView = { id, name: name.trim(), query };
    const rest = this.list().filter((v) => v.name !== view.name);
    this.#storage.setItem(KEY, JSON.stringify([view, ...rest]));
    return view;
  }

  remove(id: string): void {
    this.#storage.setItem(KEY, JSON.stringify(this.list().filter((v) => v.id !== id)));
  }
}
