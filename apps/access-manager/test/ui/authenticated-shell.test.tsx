// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
//
// Regression guard for the P1 theme-mount bug: the REAL entry point
// (src/main.tsx, the non-demo path) must mount the authenticated Shell —
// including the @jeswr/app-shell chrome (ThemeToggle / AccountMenu /
// FeedbackButton) — without crashing. Before the fix, main.tsx rendered
// <App> with NO <ThemeProvider>, so the first ThemeToggle render after login
// threw "useTheme must be used inside a <ThemeProvider>" and React tore the
// whole root down: the real post-login UI white-screened. The bug was MASKED
// because no test rendered the logged-in Shell through the entry tree — the
// view tests render DashboardView/InboxView/… directly, and the ?demo path
// (DemoApp) wraps its OWN provider.
//
// This test drives the SAME component tree the app mounts: only the two auth
// leaves are stubbed — buildController (the reactive-auth popup machinery)
// and the LoginPanel web-component wrapper, replaced by a button that emits
// the same `session-change` detail the real panel does. Everything after
// login — App, SessionProvider, Shell, the app-shell chrome, the data layer
// walking the fixture pod — is the production code path.
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADA, createDemoSession } from "../../src/demo/fixtures.js";
import type { SolidFetch } from "../../src/lib/http.js";

const FIND = { timeout: 10_000 } as const;

/** Runtime seam the hoisted module mocks read (set per-test, read at call time). */
const seam = vi.hoisted(() => ({
  webId: "" as string,
  fetch: undefined as unknown,
}));

// The real buildController spins up the reactive-auth popup machinery (an
// <authorization-code-flow> element + IndexedDB persistence) — stub it with a
// controller whose authenticated fetch is the inert fixture pod.
vi.mock("../../src/auth/controller.js", () => ({
  buildController: () => ({
    authenticatedFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      (seam.fetch as SolidFetch)(input, init)) as SolidFetch,
    logout: async () => undefined,
  }),
}));
// The web-component package registers custom elements / drives real auth —
// stub the side-effect import, and replace the login panel with a button that
// fires the SAME session-change detail the real <jeswr-login-panel> emits.
vi.mock("@jeswr/solid-elements", () => ({}));
vi.mock("@jeswr/solid-elements/react", () => ({
  LoginPanel: ({
    onSessionChange,
  }: {
    onSessionChange: (e: { detail: { webId: string | null; loggedIn: boolean } }) => void;
  }) => (
    <button
      type="button"
      data-testid="stub-login"
      onClick={() => onSessionChange({ detail: { webId: seam.webId, loggedIn: true } })}
    >
      log in
    </button>
  ),
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
  const login = await screen.findByTestId("stub-login", undefined, FIND);
  await act(async () => {
    fireEvent.click(login);
  });
}

describe("main.tsx — the REAL authenticated Shell mounts (theme provider present)", () => {
  beforeEach(() => {
    renderErrors.length = 0;
    window.addEventListener("error", onWindowError);
    // NB: no localStorage assertions/cleanup anywhere in this file — under
    // this vitest jsdom setup `window.localStorage` is Node's non-functional
    // webstorage stub (no getItem/setItem), which the ThemeProvider tolerates
    // (guarded reads); persistence is untestable here by construction.
    document.documentElement.classList.remove("dark");
    seam.webId = ADA;
    seam.fetch = createDemoSession().session.fetch;
  });

  afterEach(() => {
    window.removeEventListener("error", onWindowError);
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
});
