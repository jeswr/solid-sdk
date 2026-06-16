// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ThemeProvider — persistence + the .dark class + system-preference resolution.
import { act, render, screen } from "@testing-library/react";
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
});
