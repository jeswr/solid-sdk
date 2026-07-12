// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Test setup. Node ships an EXPERIMENTAL global `localStorage` (gated behind
// `--localstorage-file`) that, under vitest, can shadow the DOM env's
// `window.localStorage` — its methods then throw ("localStorage.clear is not a
// function"). We install a clean, deterministic in-memory Storage shim on BOTH
// `globalThis` and `window` so component + theme-core code (which reads the bare
// `localStorage`) always hits a working, isolated implementation regardless of
// the DOM env (jsdom) or the Node global. We point at a separately-captured
// instance (not `window.localStorage`) to avoid any get-recursion.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// React 19 requires this flag so `act(...)` flushes effects/state in the test
// environment (otherwise: "The current testing environment is not configured to
// support act(...)" and props set via the @lit/react wrappers never commit).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shim = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: shim,
  writable: true,
});
if (typeof window !== "undefined" && window !== (globalThis as unknown as Window)) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
    writable: true,
  });
}
