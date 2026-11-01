// AUTHORED-BY Codex GPT-6.1-Sol
import type { TasksCache } from "./tasks-cache";

/** Keep the row mounted while its local checkbox fills, then hand persistence to the cache. */
class CompletionVisuals {
  private urls: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();
  private pending = new Map<string, () => void>();
  getSnapshot = () => this.urls;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.urls = new Set(this.pending.keys());
    for (const listener of this.listeners) listener();
  }
  wait(url: string): Promise<void> {
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(url);
        this.emit();
        resolve();
      };
      const timer = setTimeout(finish, 400);
      this.pending.set(url, finish);
      this.emit();
    });
  }
  flush = () => {
    for (const finish of this.pending.values()) finish();
  };
}
const managers = new WeakMap<TasksCache, CompletionVisuals>();
export function completionVisuals(cache: TasksCache) {
  let manager = managers.get(cache);
  if (!manager) {
    manager = new CompletionVisuals();
    managers.set(cache, manager);
  }
  return manager;
}
