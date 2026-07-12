// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest setup: jest-dom matchers + a jsdom `matchMedia` polyfill (jsdom ships
// none, and the ThemeProvider reads `prefers-color-scheme`). Tests override the
// `.matches` result per-case via `mockMatchMedia` below.
import "@testing-library/jest-dom/vitest";

/** Install a matchMedia stub whose dark-scheme result is `prefersDark`. */
export function mockMatchMedia(prefersDark: boolean): void {
  window.matchMedia = (query: string) => {
    const matches = /prefers-color-scheme:\s*dark/.test(query) ? prefersDark : false;
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
        listeners.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

// Default: light OS preference unless a test calls mockMatchMedia(true).
mockMatchMedia(false);

// jsdom in this vitest version does not expose a full localStorage (no
// `.clear()`), so install a minimal in-memory Storage the tests + provider use.
if (typeof window.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
  });
}
