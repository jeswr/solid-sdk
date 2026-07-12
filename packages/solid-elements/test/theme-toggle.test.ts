// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JeswrThemeToggle } from "../src/components/theme-toggle.js";

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

async function mount(): Promise<JeswrThemeToggle> {
  const el = document.createElement("jeswr-theme-toggle") as JeswrThemeToggle;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  document.body.innerHTML = "";
  mockMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<jeswr-theme-toggle> registration", () => {
  it("is defined under the jeswr- prefix", () => {
    expect(customElements.get("jeswr-theme-toggle")).toBe(JeswrThemeToggle);
  });
});

describe("<jeswr-theme-toggle> reactivity (useDefineForClassFields footgun check)", () => {
  it("reflects the property to the attribute when set", async () => {
    const el = await mount();
    el.theme = "dark";
    await el.updateComplete;
    // If class fields shadowed Lit's accessor, setting the prop would NOT
    // trigger reactivity / reflection. This passing is the proof reactivity works.
    expect(el.getAttribute("theme")).toBe("dark");
    expect(el.resolvedTheme).toBe("dark");
  });

  it("renders the right label per theme", async () => {
    const el = await mount();
    el.theme = "light";
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".label")?.textContent).toBe("Light");
    el.theme = "dark";
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".label")?.textContent).toBe("Dark");
  });
});

describe("<jeswr-theme-toggle> co-operation with localStorage + .dark", () => {
  it("on connect, adopts the stored preference and applies .dark", async () => {
    localStorage.setItem("app-shell-theme", "dark");
    const el = await mount();
    expect(el.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("clicking cycles light → dark → system and persists to the shared key", async () => {
    localStorage.setItem("app-shell-theme", "light");
    const el = await mount();
    const button = el.shadowRoot?.querySelector("button") as HTMLButtonElement;

    button.click();
    await el.updateComplete;
    expect(el.theme).toBe("dark");
    expect(localStorage.getItem("app-shell-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    button.click();
    await el.updateComplete;
    expect(el.theme).toBe("system");
    expect(localStorage.getItem("app-shell-theme")).toBe("system");
  });

  it("emits a theme-change CustomEvent with { theme, resolvedTheme }", async () => {
    const el = await mount();
    const detail = await new Promise<{ theme: string; resolvedTheme: string }>((resolve) => {
      el.addEventListener("theme-change", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      });
      el.shadowRoot?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(detail.theme).toBeDefined();
    expect(["light", "dark"]).toContain(detail.resolvedTheme);
  });
});

describe("<jeswr-theme-toggle> system-mode live follow + listener cleanup", () => {
  it("follows prefers-color-scheme while in system mode", async () => {
    localStorage.setItem("app-shell-theme", "system");
    const mql = mockMatchMedia(false);
    const el = await mount();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // OS flips to dark while in system mode → component follows.
    mql.dispatch(true);
    await el.updateComplete;
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the matchMedia listener on disconnect (no leak)", async () => {
    localStorage.setItem("app-shell-theme", "system");
    const mql = mockMatchMedia(false);
    const removeSpy = vi.spyOn(mql, "removeEventListener");
    const el = await mount();
    el.remove();
    expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("stops following the OS once switched away from system", async () => {
    localStorage.setItem("app-shell-theme", "system");
    const mql = mockMatchMedia(false);
    const el = await mount();
    // Switch to explicit light.
    el.theme = "light";
    await el.updateComplete;
    // OS flips dark — should NOT affect an explicit-light toggle.
    mql.dispatch(true);
    await el.updateComplete;
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
