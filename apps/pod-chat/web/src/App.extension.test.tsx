// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Header behaviour for the extension duplicate-chrome fix (bead suite-tracker-lpo,
// cross-app parity rolled out from pod-drive):
//   - extension ABSENT  → the full <AccountMenu/> (avatar + display name + WebID + Sign out).
//   - extension PRESENT → the duplicated profile display is dropped, BUT a Sign-out control is
//     kept so a logged-in user (the app still owns its OWN session until it consumes the
//     extension's identity) is NEVER stranded without a logout affordance.
//
// This is the ONLY App-render test, so it opts into jsdom per-file (the suite default
// is `node` — see vitest.config.ts). The pragma MUST be the first line.
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A mutable toggle the mocked hook returns, flipped per test.
let extensionPresent = false;
const logout = vi.fn();

// The extension-presence hook lives in @jeswr/app-shell (useSolidExtensionPresent).
// Keep the real app-shell chrome components; override only the presence hook per test.
vi.mock("@jeswr/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/app-shell")>()),
  useSolidExtensionPresent: () => extensionPresent,
}));

// pod-chat's App reads `restoring` (not `restoringSession`) off the session — mirror the
// real useSession shape so App renders its authenticated header.
vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({
    webId: "https://alice.example/profile/card#me",
    session: {
      webId: "https://alice.example/profile/card#me",
      podRoot: "https://alice.example/",
      podRootIsFallback: false,
      displayName: "Alice Chat",
      avatarUrl: undefined,
    },
    logout,
    autologinPending: false,
    restoring: false,
  }),
}));

// Stub the pod-chat rooms view so the header test doesn't drive a live pod fetch.
vi.mock("@jeswr/pod-chat/ui", () => ({
  ChatRooms: () => <div data-testid="chat-rooms" />,
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
  it("extension ABSENT: renders the full AccountMenu, no lone Sign-out button", () => {
    extensionPresent = false;
    renderApp();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // Sign-out lives inside the AccountMenu dropdown, not as a lone header button.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", () => {
    extensionPresent = true;
    renderApp();
    // The duplicated profile menu is gone…
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // …but a Sign-out control remains and calls this app's own logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    fireEvent.click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
    // The rest of the header chrome (not duplicated by the extension) stays.
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
