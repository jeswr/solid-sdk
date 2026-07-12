// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ThemeProvider — persistence + the .dark class + system-preference resolution.

import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, themeScript, useTheme } from "../src/components/theme-provider.js";
import { mockMatchMedia } from "./setup.js";

const KEY = "app-shell-theme";

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        go-dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        go-light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        go-system
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    mockMatchMedia(false);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to system and resolves to light when the OS prefers light", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("system mode resolves to dark and adds the .dark class when the OS prefers dark", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("setTheme persists the choice to localStorage and toggles the .dark class", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("go-dark").click();
    });
    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => {
      screen.getByText("go-light").click();
    });
    expect(localStorage.getItem(KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("adopts a persisted preference on mount", () => {
    localStorage.setItem(KEY, "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("honours a custom storageKey", () => {
    render(
      <ThemeProvider storageKey="my-key">
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("go-dark").click();
    });
    expect(localStorage.getItem("my-key")).toBe("dark");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does not persist when storageKey is null", () => {
    render(
      <ThemeProvider storageKey={null}>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("go-dark").click();
    });
    expect(localStorage.getItem(KEY)).toBeNull();
    // Still applies in-memory for the current page.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("useTheme throws outside a provider", () => {
    function Bare() {
      useTheme();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/inside a <ThemeProvider>/);
  });

  describe("themeScript", () => {
    it("emits a no-flash script using the given key + class", () => {
      const s = themeScript("k", "is-dark");
      expect(s).toContain('localStorage.getItem("k")');
      expect(s).toContain('"is-dark"');
      expect(s).toContain("prefers-color-scheme: dark");
    });
    it("defaults to the suite key + class", () => {
      const s = themeScript();
      expect(s).toContain('"app-shell-theme"');
      expect(s).toContain('"dark"');
    });
  });

  // #80 — the apply runs as a (pre-paint) layout effect, so `resolvedTheme` and
  // the `.dark` class are correct on the FIRST commit, with no deferred tick that
  // would flash the wrong mode for content rendered off `resolvedTheme`. RTL's
  // `render` flushes effects synchronously, so a correct value immediately after
  // render (with no extra `act`/tick) demonstrates the before-paint resolution.
  describe("pre-paint init (no flash)", () => {
    it("a dark-OS user with no stored preference resolves to dark immediately", () => {
      mockMatchMedia(true);
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
      // No intervening act()/await: the value is already correct post-render.
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("a stored 'dark' preference is adopted + applied immediately (no light frame)", () => {
      mockMatchMedia(false); // OS prefers light — the stored override must still win.
      localStorage.setItem(KEY, "dark");
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    // Discriminating test (roborev #80 Low): the apply MUST be a LAYOUT effect, not
    // a passive one. React runs every LAYOUT effect in the committed tree before ANY
    // PASSIVE effect, and runs passive effects child-FIRST (the parent provider's
    // passive effect would run AFTER a child's). So a CHILD's passive `useEffect`
    // observing the `.dark` class sees it ALREADY applied iff the provider applied it
    // in a layout effect; if the provider regressed to `useEffect`, the child's
    // passive effect would run first and observe the class NOT yet set. This fails on
    // a regression to plain `useEffect`, which the prior render-only tests did not.
    it("applies the .dark class in a LAYOUT effect (before a child's passive effect)", () => {
      mockMatchMedia(true); // dark OS, no stored pref → should resolve dark on apply.
      let darkClassSeenByChildPassiveEffect: boolean | null = null;
      function ChildObserver() {
        useEffect(() => {
          darkClassSeenByChildPassiveEffect = document.documentElement.classList.contains("dark");
        }, []);
        return null;
      }
      render(
        <ThemeProvider>
          <ChildObserver />
        </ThemeProvider>,
      );
      // If the apply were a passive effect, this would be `false` (child passive
      // effect runs before the parent's). A layout-effect apply makes it `true`.
      expect(darkClassSeenByChildPassiveEffect).toBe(true);
    });
  });
});
