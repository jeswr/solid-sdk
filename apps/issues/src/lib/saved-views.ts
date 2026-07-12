import type { IssueQuery } from "./filter";
import type { View } from "./view";

/**
 * A named, persisted filter/sort/layout preset. The optional `view` captures the
 * active layout (board/list/timeline/…) so restoring a saved view also restores
 * how the work is displayed — the Jira/Monday "saved filter + board" behaviour.
 * `view` is optional for backward-compatibility with views saved before layouts
 * were captured (they restore only the query and leave the layout unchanged).
 */
export interface SavedView {
  id: string;
  name: string;
  query: IssueQuery;
  view?: View;
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
  save(name: string, query: IssueQuery, id = crypto.randomUUID(), view?: View): SavedView {
    const saved: SavedView = { id, name: name.trim(), query, ...(view ? { view } : {}) };
    const rest = this.list().filter((v) => v.name !== saved.name);
    this.#storage.setItem(KEY, JSON.stringify([saved, ...rest]));
    return saved;
  }

  remove(id: string): void {
    this.replace(this.list().filter((v) => v.id !== id));
  }

  /**
   * Overwrite the entire stored list. Used by the pod migration to keep ONLY the
   * views that failed to migrate (so a partial failure never drops local views).
   */
  replace(views: SavedView[]): void {
    this.#storage.setItem(KEY, JSON.stringify(views));
  }

  /** Empty the stored list. */
  clear(): void {
    this.replace([]);
  }
}
