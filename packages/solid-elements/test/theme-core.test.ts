// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyResolvedTheme,
  nextTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
} from "../src/theme-core.js";

/** Install a controllable matchMedia returning `matches` for the dark query. */
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatch: (next: boolean) => {
      (mql as { matches: boolean }).matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the storage key + class match app-shell exactly", () => {
  it("uses app-shell-theme and .dark", () => {
    expect(THEME_STORAGE_KEY).toBe("app-shell-theme");
    expect(THEME_DARK_CLASS).toBe("dark");
  });
});

describe("readStoredTheme / persistTheme", () => {
  it("round-trips a valid value", () => {
    persistTheme("dark");
    expect(localStorage.getItem("app-shell-theme")).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });
  it("returns null for an unknown stored value", () => {
    localStorage.setItem("app-shell-theme", "purple");
    expect(readStoredTheme()).toBeNull();
  });
  it("returns null when nothing is stored", () => {
    expect(readStoredTheme()).toBeNull();
  });
});

describe("resolveTheme / systemPrefersDark", () => {
  it("resolves explicit modes directly", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
  it("resolves system via matchMedia", () => {
    mockMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
    expect(resolveTheme("system")).toBe("dark");
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });
});

describe("applyResolvedTheme — co-operative DOM writes", () => {
  it("toggles .dark and sets colorScheme on <html>", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
  it("does not clobber other classes a host ThemeProvider may have set", () => {
    document.documentElement.classList.add("some-host-class");
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("some-host-class")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("is idempotent (applying the same mode twice is a no-op)", () => {
    applyResolvedTheme("dark");
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("nextTheme cycle", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });
});
