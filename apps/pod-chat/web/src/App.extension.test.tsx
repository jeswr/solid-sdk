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
// Session startup is covered in App.session.test.tsx; these tests supply a signed-in fixture.
import type { SignedInSession } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();
const signedIn: SignedInSession = {
  webId: "https://alice.example/profile/card#me",
  session: {
    webId: "https://alice.example/profile/card#me",
    podRoot: "https://alice.example/",
    podRootIsFallback: false,
    displayName: "Alice Chat",
    avatarUrl: undefined,
  },
};

vi.mock("@jeswr/app-session/react", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session/react")>()),
  SessionGate: ({ children }: { children: (identity: SignedInSession) => ReactNode }) =>
    children(signedIn),
  useSession: () => ({ ...signedIn, logout, fetch: globalThis.fetch }),
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
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  logout.mockReset();
});

describe("App header — extension duplicate-chrome fix", () => {
  it("extension ABSENT: renders the full AccountMenu with working sign-out", async () => {
    renderApp();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // Sign-out lives inside the AccountMenu dropdown, not as a lone header button.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
    fireEvent(
      screen.getByRole("button", { name: "Account menu" }),
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    expect(await screen.findByText(signedIn.webId)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    renderApp();
    // The duplicated profile menu is gone…
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // …but a Sign-out control remains and calls this app's own logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    expect(signOut).toHaveAttribute("data-app-shell-control");
    fireEvent.click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
    // The rest of the header chrome (not duplicated by the extension) stays.
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
