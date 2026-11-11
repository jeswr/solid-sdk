// @vitest-environment jsdom
// AUTHORED-BY GPT-6.1 Sol
// Drive the real entry tree with a fake pod-auth and fixture pod. Shared chrome must mount after
// login, the app's theme must persist, and every data request must use an explicit transport.
import "@testing-library/jest-dom/vitest";
import { fakePodAuth, identity } from "@jeswr/app-session/testing";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADA, createDemoSession } from "../../src/demo/fixtures.js";

const FIND = { timeout: 10_000 } as const;

const seam = vi.hoisted(() => {
  const publicFetch = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", publicFetch);
  return { getPodAuth: vi.fn(), publicFetch };
});
vi.mock("../../src/auth/pod-auth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/pod-auth.js")>()),
  getPodAuth: seam.getPodAuth,
}));

/**
 * React (no error boundary here — by design: this asserts the tree does not
 * crash) routes an uncaught render error to `reportError`, which surfaces as
 * a window `error` event, NOT as a throw from `fireEvent`. Capture them so
 * the failure mode is a readable assertion, not an unhandled-error teardown.
 */
const renderErrors: string[] = [];
function onWindowError(event: ErrorEvent): void {
  renderErrors.push(String(event.error?.message ?? event.message));
  event.preventDefault();
}

async function loadEntryAndLogIn(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", "/"); // the REAL (non-demo) path
  // The entry mounts its own createRoot (not RTL render), so wrap the mount +
  // login click in act() ourselves.
  await act(async () => {
    await import("../../src/main.jsx");
  });
  const login = await screen.findByRole("button", { name: "Home provider" }, FIND);
  await act(async () => {
    fireEvent.click(login);
  });
}

describe("main.tsx — the REAL authenticated Shell mounts (theme provider present)", () => {
  beforeEach(() => {
    renderErrors.length = 0;
    window.addEventListener("error", onWindowError);
    document.documentElement.classList.remove("dark");
    const fake = fakePodAuth();
    const demo = createDemoSession();
    fake.auth.login.mockImplementation(async () => {
      const signedIn = { ...identity, webId: ADA, subject: ADA };
      fake.emit("login", signedIn);
      return signedIn;
    });
    fake.auth.fetch.mockImplementation(demo.session.fetch);
    seam.publicFetch.mockImplementation(demo.session.fetch);
    seam.getPodAuth.mockResolvedValue(fake.auth);
    vi.stubEnv("VITE_HOME_IDP", "https://provider.example/");
    vi.stubEnv("VITE_HOME_IDP_NAME", "Home provider");
  });

  afterEach(() => {
    window.removeEventListener("error", onWindowError);
    vi.unstubAllEnvs();
  });

  it("after login the entry-mounted tree renders the Shell chrome without crashing", async () => {
    await loadEntryAndLogIn();

    // Pre-fix this is where the bug bit: ThemeToggle's useTheme() threw
    // ("useTheme must be used inside a <ThemeProvider>") and React unmounted
    // the root — a white screen. The chrome must mount instead.
    await waitFor(() => {
      if (renderErrors.length > 0) {
        throw new Error(`post-login render crashed: ${renderErrors.join("; ")}`);
      }
      expect(screen.getByRole("tab", { name: "Shared" })).toBeInTheDocument();
    }, FIND);

    // The full app-shell chrome is up.
    expect(screen.getByRole("button", { name: "Change colour theme" })).toBeInTheDocument();
    expect(renderErrors).toEqual([]);

    // And the real data layer ran over the session fetch (not a blank shell).
    await screen.findByText("/health/", undefined, FIND);
  }, 30_000);

  it("the mounted ThemeProvider actually works: switching to Dark flips the suite .dark class on <html>", async () => {
    await loadEntryAndLogIn();

    const toggle = await screen.findByRole("button", { name: "Change colour theme" }, FIND);
    // Radix dropdowns open on pointerdown (not click), and its trigger checks
    // `event.button === 0`. jsdom has no PointerEvent, so RTL's
    // fireEvent.pointerDown would drop `button` — dispatch a MouseEvent (which
    // carries `button`) with the pointerdown type instead, then the click.
    await act(async () => {
      fireEvent(
        toggle,
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
      fireEvent.click(toggle);
    });
    const darkItem = await screen.findByText("Dark", undefined, FIND);
    await act(async () => {
      fireEvent.click(darkItem);
    });

    // Suite convention (pod-drive/pod-photos parity): the provider's default
    // attributeClass ".dark" toggles on <html> — the hook styles.css and the
    // app-shell `dark:` utilities key off.
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(renderErrors).toEqual([]);
  }, 30_000);

  it("persists a selected theme and restores it after the entry point reloads", async () => {
    window.localStorage.removeItem("access-manager:app-shell-theme");
    window.localStorage.setItem("app-shell-theme", "dark");
    window.localStorage.setItem("pod-drive:app-shell-theme", "dark");
    await loadEntryAndLogIn();
    // Other apps and the legacy shared key cannot choose Access Manager's theme.
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    const toggle = await screen.findByRole("button", { name: "Change colour theme" }, FIND);
    await act(async () => {
      fireEvent(
        toggle,
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
      fireEvent.click(toggle);
    });
    const darkItem = await screen.findByText("Dark", undefined, FIND);
    await act(async () => {
      fireEvent.click(darkItem);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("access-manager:app-shell-theme")).toBe("dark");
    });

    // Simulate a page reload: discard the mounted DOM and reload the real entry
    // module. The new ThemeProvider must read the stored preference on mount.
    document.documentElement.classList.remove("dark");
    await loadEntryAndLogIn();

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(window.localStorage.getItem("access-manager:app-shell-theme")).toBe("dark");
    expect(window.localStorage.getItem("app-shell-theme")).toBe("dark");
    expect(window.localStorage.getItem("pod-drive:app-shell-theme")).toBe("dark");
    expect(renderErrors).toEqual([]);
  }, 30_000);
});
