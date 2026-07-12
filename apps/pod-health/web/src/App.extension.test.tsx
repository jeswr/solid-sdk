// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the browser-extension-present header swap (App.tsx, cross-app parity
// rollout — reference pod-drive). The shared @jeswr/app-shell
// `useSolidExtensionPresent()` hook drives the account surface:
//   - extension PRESENT → the extension owns the account surface, so the app's full
//     <AccountMenu/> (avatar + name + WebID) would DUPLICATE it. App drops it and
//     renders only a minimal <Button>Sign out</Button> wired to the app's own logout
//     (the app still holds its OWN independent session — it must not strand the user).
//   - extension ABSENT → the normal <AccountMenu/> is rendered.
//
// We render the WHOLE App so the assertion covers the real header conditional, not a
// re-implementation. The heavy leaves are stubbed to the smallest doubles that let
// the authenticated header mount: useSession returns a logged-in session, the
// pod-health <HealthRecords> view and the async Type-Index discovery are stubbed
// (their behaviour is tested elsewhere). Only `useSolidExtensionPresent` is
// overridden on the otherwise-REAL @jeswr/app-shell (importOriginal), so the real
// <AccountMenu/> / <Button/> render — the swap is exercised end-to-end.
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The single knob the App's header branches on. Mutated per test before importing App.
let extensionPresent = false;

vi.mock("@jeswr/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/app-shell")>()),
  useSolidExtensionPresent: () => extensionPresent,
}));

// A logged-in session so App renders its authenticated header (not the login/restore
// screens). displayName/avatarUrl feed the AccountMenu; podRoot feeds discovery.
vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({
    webId: "https://alice.example/profile/card#me",
    session: {
      webId: "https://alice.example/profile/card#me",
      podRoot: "https://alice.example/",
      podRootIsFallback: false,
      displayName: "Alice Health",
      avatarUrl: null,
    },
    logout: vi.fn(),
    autologinPending: false,
    restorePending: false,
  }),
}));

// Stub the pod-health data view — it needs the auth-patched global fetch at runtime;
// its behaviour is out of scope for this header test.
vi.mock("pod-health/ui", () => ({
  HealthRecords: () => <div data-testid="health-records" />,
}));

// Resolve discovery immediately so the effect settles without touching the network.
vi.mock("./health-resource", () => ({
  discoverHealthResource: () =>
    Promise.resolve({ resourceUrl: "https://alice.example/health/record.ttl", isFallback: false }),
}));

async function renderApp() {
  // Import App AFTER the mocks + the `extensionPresent` flag are set for this test.
  const { App } = await import("./App");
  // main.tsx wraps the app in <ThemeProvider> (the header's <ThemeToggle/> reads the
  // theme context); mirror that here so App mounts.
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  // Let the discovery effect flush so there are no act() warnings.
  await waitFor(() => expect(screen.getByTestId("health-records")).toBeInTheDocument());
}

describe("App header — browser-extension-present account swap", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("extension PRESENT → hides AccountMenu, keeps a minimal Sign out", async () => {
    extensionPresent = true;
    await renderApp();
    // The minimal Sign-out control is present…
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    // …and the full AccountMenu (its trigger is labelled "Account menu") is NOT rendered.
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
  });

  it("extension ABSENT → renders the normal AccountMenu", async () => {
    extensionPresent = false;
    await renderApp();
    // The AccountMenu trigger is present…
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
    // …and there is no standalone Sign-out button (sign-out lives inside the closed
    // AccountMenu dropdown, not the header).
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});
