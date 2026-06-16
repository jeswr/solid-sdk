// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest setup for the jsdom-environment runs: jest-dom matchers + a jsdom
// `matchMedia` polyfill (jsdom ships none, and the @jeswr/app-shell ThemeProvider
// — mounted by the App under test — reads `prefers-color-scheme`). Mirrors the
// app-shell package's own setup so the component test behaves identically.
import "@testing-library/jest-dom/vitest";

// Install a matchMedia stub (default: light OS preference). The FeedbackButton
// render test does not depend on the scheme; this just stops the ThemeProvider
// from throwing on a missing matchMedia.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Install a minimal in-memory localStorage when jsdom does not provide a WORKING one.
// This vitest/jsdom setup exposes `localStorage` whose `setItem` IS a function but
// THROWS when called — it emits "`--localstorage-file` was provided without a valid
// path". A `typeof setItem === "function"` check is therefore too weak: it passes and
// leaves the broken storage installed, so a test fails before reaching the behavior
// under test. We instead PROBE by actually calling setItem/removeItem inside try/catch
// and install the polyfill if the store is undefined, missing setItem, OR callable-but-
// throwing. The silent-session-restore RememberedAccount pointer is localStorage-backed,
// so the implementation-level SessionProvider test needs a functioning store to seed a
// returning-user pointer. Test-infra only — never shipped.
const localStorageWorks = (): boolean => {
  try {
    if (
      typeof globalThis.localStorage === "undefined" ||
      typeof globalThis.localStorage.setItem !== "function"
    ) {
      return false;
    }
    // The load-bearing probe: jsdom's broken store has a callable setItem that THROWS.
    const probeKey = "__localStorage_probe__";
    globalThis.localStorage.setItem(probeKey, "1");
    globalThis.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
};
if (!localStorageWorks()) {
  const store = new Map<string, string>();
  const memoryLocalStorage: Storage = {
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
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryLocalStorage,
    configurable: true,
    writable: true,
  });
}
