// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Header behaviour for the extension duplicate-chrome fix (cross-app rollout of the
// pod-drive pattern, bead suite-tracker-lpo):
//   - extension ABSENT  → the full <AccountMenu/> (avatar + display name + WebID + Sign out).
//   - extension PRESENT → the duplicated profile display is dropped, BUT a Sign-out control is
//     kept so a logged-in user (the app still owns its OWN session until it consumes the
//     extension's identity) is NEVER stranded without a logout affordance.
import type { SignedInSession } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mutable mock state, defined via vi.hoisted so it is safely available inside the
// hoisted vi.mock factories (avoids the top-level-closure hoisting footgun). The
// logout is asserted on; extension presence uses the real document marker.
const mocks = vi.hoisted(() => ({ logout: vi.fn() }));

const sessionState = {
  webId: "https://alice.example/profile/card#me",
  session: {
    webId: "https://alice.example/profile/card#me",
    podRoot: "https://alice.example/",
    podRootIsFallback: false,
    displayName: "Alice Music",
    avatarUrl: undefined,
  },
  logout: mocks.logout,
  fetch: globalThis.fetch,
};

vi.mock("@jeswr/app-session/react", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session/react")>()),
  // These tests supply a signed-in fixture; App.session.test.tsx exercises the real gate.
  SessionGate: ({ children }: { children: (signedIn: SignedInSession) => ReactNode }) =>
    children(sessionState),
  useSession: () => sessionState,
}));

// Stub the music base discovery so the header test resolves a base immediately
// without driving a live pod fetch.
vi.mock("./music-base", () => ({
  discoverMusicBase: () =>
    Promise.resolve({ base: "https://alice.example/music/", isFallback: false }),
}));

// Stub the data layer + UI so mounting the App does not reach a live pod.
vi.mock("@jeswr/pod-music", () => ({
  MusicStore: class {},
}));
vi.mock("@jeswr/pod-music/ui", () => ({
  MusicLibrary: () => <div data-testid="music-library" />,
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
  mocks.logout.mockReset();
});

describe("App header — extension duplicate-chrome fix (pod-music)", () => {
  it("extension ABSENT: renders the full AccountMenu", async () => {
    renderApp();
    await screen.findByTestId("music-library");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // No lone Sign-out button — sign-out lives inside the AccountMenu dropdown.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    renderApp();
    await screen.findByTestId("music-library");
    // The duplicated profile menu is gone…
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // …but a Sign-out control remains and calls the app's own logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    fireEvent.click(signOut);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    // The rest of the header chrome (not duplicated by the extension) stays.
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
