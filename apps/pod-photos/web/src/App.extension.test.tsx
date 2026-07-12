// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Header behaviour for the extension duplicate-chrome fix (bead suite-tracker-lpo),
// cross-app parity rollout from pod-drive:
//   - extension ABSENT  → the full <AccountMenu/> (avatar + display name + WebID + Sign out).
//   - extension PRESENT → the duplicated profile display is dropped, BUT a Sign-out control is
//     kept so a logged-in user (the app still owns its OWN session until it consumes the
//     extension's identity) is NEVER stranded without a logout affordance.
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Shared mock state. Declared via vi.hoisted so it is initialized BEFORE the hoisted
// vi.mock factories below reference it (avoids any TDZ/hoisting hazard — the factories
// close over `mock`, and each test mutates `mock.extensionPresent`).
const mock = vi.hoisted(() => ({ extensionPresent: false, logout: vi.fn() }));

// The extension-presence hook lives in @jeswr/app-shell (useSolidExtensionPresent).
// Keep the real app-shell chrome components; override only the presence hook per test.
vi.mock("@jeswr/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/app-shell")>()),
  useSolidExtensionPresent: () => mock.extensionPresent,
}));

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({
    webId: "https://alice.example/profile/card#me",
    session: {
      webId: "https://alice.example/profile/card#me",
      podRoot: "https://alice.example/",
      podRootIsFallback: false,
      displayName: "Alice Photos",
      avatarUrl: undefined,
    },
    logout: mock.logout,
    autologinPending: false,
    restoring: false,
  }),
}));

// Stub the pod-photos gallery + photos-root discovery so the header test never
// drives a live pod fetch.
vi.mock("@jeswr/pod-photos/ui", () => ({
  PhotoGallery: () => <div data-testid="photo-gallery" />,
}));

vi.mock("./photos-root", () => ({
  resolvePhotosRoot: () =>
    Promise.resolve({ rootUrl: "https://alice.example/photos/", isFallback: false }),
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
  mock.extensionPresent = false;
  mock.logout.mockReset();
});

describe("App header — extension duplicate-chrome fix", () => {
  it("extension ABSENT: renders the full AccountMenu", () => {
    mock.extensionPresent = false;
    renderApp();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // No lone Sign-out button — sign-out lives inside the AccountMenu dropdown.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", () => {
    mock.extensionPresent = true;
    renderApp();
    // The duplicated profile menu is gone…
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    // …but a Sign-out control remains and calls the app's own logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    fireEvent.click(signOut);
    expect(mock.logout).toHaveBeenCalledTimes(1);
    // The rest of the header chrome (not duplicated by the extension) stays.
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
