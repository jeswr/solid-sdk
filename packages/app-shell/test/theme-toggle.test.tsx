// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ThemeToggle — characterization of the trigger ICON selection (the one bit of
// observable behaviour the toggle owns beyond delegating to useTheme/setTheme).
// Pinned BEFORE the icon-selection refactor so the de-densified lookup is proven
// byte-identical to the prior chained ternary:
//   - SSR markup     → Monitor (SSR-stable, hydration-safe) — asserted via
//                      `renderToStaticMarkup` (which does NOT flush effects, so it
//                      captures the genuine first-paint/SSR markup a client
//                      `render()` can't; pins the no-hydration-mismatch contract).
//   - theme "dark"   → Moon   } the post-mount cases, via a client `render()`
//   - theme "light"  → Sun    } (RTL flushes effects, so these see the mounted
//   - theme "system" → Monitor} state).
// lucide-react renders each icon as <svg class="lucide lucide-<name>">, so the
// `.lucide-<name>` class on the trigger's svg is the stable assertion handle.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider.js";
import { ThemeToggle } from "../src/components/theme-toggle.js";
import { mockMatchMedia } from "./setup.js";

// Radix guards interactions behind a pointer-events check jsdom can't satisfy;
// disable it so the dropdown opens under test (same pattern as account-menu).
const user = userEvent.setup({ pointerEventsCheck: 0 });

/** The lucide class on the toggle TRIGGER's icon (the button, not the menu items). */
function triggerIconClass(container: HTMLElement): string {
  const trigger = container.querySelector('button[aria-label="Change colour theme"]');
  const svg = trigger?.querySelector("svg");
  return svg?.getAttribute("class") ?? "";
}

function renderToggle(stored?: "light" | "dark" | "system") {
  localStorage.clear();
  document.documentElement.className = "";
  mockMatchMedia(false);
  if (stored) localStorage.setItem("app-shell-theme", stored);
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle trigger icon", () => {
  // PRE-MOUNT / SSR-stable markup: a server render (no effects) must emit the
  // Monitor icon even with a stored `dark` preference and a dark OS — because the
  // provider's SSR-stable initial `theme` is the default ("system") until the
  // mount/layout effect adopts storage, and the toggle's `mounted` gate keeps the
  // icon stable across that first paint. `renderToStaticMarkup` runs WITHOUT
  // effects, so it captures exactly the first-paint/SSR markup a client `render()`
  // (which flushes effects) cannot observe — pinning the hydration-safety contract
  // consumers rely on (no light→dark icon flip mismatch on hydration).
  it("renders the Monitor icon in SSR markup even with a stored dark preference (hydration-safe)", () => {
    localStorage.clear();
    localStorage.setItem("app-shell-theme", "dark");
    mockMatchMedia(true);
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(html).toContain("lucide-monitor");
    expect(html).not.toContain("lucide-moon");
  });

  it("shows the Monitor icon for the system preference (default)", () => {
    const { container } = renderToggle("system");
    expect(triggerIconClass(container)).toContain("lucide-monitor");
  });

  it("shows the Moon icon when the preference is dark", () => {
    const { container } = renderToggle("dark");
    expect(triggerIconClass(container)).toContain("lucide-moon");
  });

  it("shows the Sun icon when the preference is light", () => {
    const { container } = renderToggle("light");
    expect(triggerIconClass(container)).toContain("lucide-sun");
  });

  it("marks the active option with aria-current after mount", async () => {
    renderToggle("dark");
    // Open the menu (Radix opens on a pointer sequence), then assert aria-current.
    await user.click(screen.getByRole("button", { name: /change colour theme/i }));
    const current = await screen.findByText("Dark");
    expect(current.closest('[aria-current="true"]')).not.toBeNull();
  });
});
