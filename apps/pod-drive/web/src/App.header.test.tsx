// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Header behaviour for the extension duplicate-chrome fix (bead suite-tracker-lpo):
//   - extension ABSENT  → the full <AccountMenu/> (avatar + display name + WebID + Sign out).
//   - extension PRESENT → the duplicated profile display is dropped, BUT a Sign-out control is
//     kept so a logged-in user (the app still owns its OWN session until it consumes the
//     extension's identity) is NEVER stranded without a logout affordance.
// The second case is the roborev finding's requested "logged-in test for extension-present
// logout behaviour".
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A mutable toggle the mocked hook returns, flipped per test.
let extensionPresent = false;
const logout = vi.fn();

// The extension-presence hook now lives in @jeswr/app-shell (useSolidExtensionPresent).
// Keep the real app-shell chrome components; override only the presence hook per test.
vi.mock("@jeswr/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/app-shell")>()),
  useSolidExtensionPresent: () => extensionPresent,
}));

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({
    webId: "https://alice.example/profile/card#me",
    session: {
      podRoot: "https://alice.example/",
      podRootIsFallback: false,
      displayName: "Alice Drive",
      avatarUrl: undefined,
    },
    logout,
    autologinPending: false,
    restoringSession: false,
  }),
}));

// Stub the pod-drive file browser so the header test doesn't drive a live pod fetch.
vi.mock("@jeswr/pod-drive/ui", () => ({
  FileBrowser: () => <div data-testid="file-browser" />,
}));

import { App } from "./App";

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

afterEach(() => {
  extensionPresent = false;
  logout.mockReset();
});

describe("App header — extension duplicate-chrome fix", () => {
  it("extension ABSENT: renders the full AccountMenu", () => {
    extensionPresent = false;
    renderApp();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // No lone Sign-out button — sign-out lives inside the AccountMenu dropdown.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", () => {
    extensionPresent = true;
    renderApp();
    // The duplicated profile menu is gone…
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // …but a Sign-out control remains and calls the app's own logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    fireEvent.click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
    // The rest of the header chrome (not duplicated by the extension) stays.
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
