// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Header behaviour for the extension duplicate-chrome fix (bead suite-tracker-lpo),
// cross-app parity rollout from pod-drive:
//   - extension ABSENT  → the full <AccountMenu/> (avatar + display name + WebID + Sign out).
//   - extension PRESENT → the duplicated profile display is dropped, BUT a Sign-out control is
//     kept so a logged-in user (the app still owns its OWN session until it consumes the
//     extension's identity) is NEVER stranded without a logout affordance.
import type { SignedInSession } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Signed-in fixture; the real gate and provider are exercised in App.session.test.tsx.
const mock = vi.hoisted(() => ({
  webId: "https://alice.example/profile/card#me",
  session: {
    webId: "https://alice.example/profile/card#me",
    podRoot: "https://alice.example/",
    podRootIsFallback: false,
    displayName: "Alice Photos",
    avatarUrl: undefined,
  },
  logout: vi.fn(),
}));

vi.mock("@jeswr/app-session/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/app-session/react")>()),
  SessionGate: ({ children }: { children: (signedIn: SignedInSession) => ReactNode }) =>
    children(mock),
  useSession: () => ({
    ...mock,
    fetch: globalThis.fetch,
    ready: true,
    restoringSession: false,
    error: null,
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
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  mock.logout.mockReset();
});

describe("App header — extension duplicate-chrome fix", () => {
  it("extension ABSENT: renders the full AccountMenu", async () => {
    renderApp();
    await screen.findByTestId("photo-gallery");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    // No lone Sign-out button — sign-out lives inside the AccountMenu dropdown.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("extension ABSENT: the account menu keeps a working Sign out", async () => {
    renderApp();
    await screen.findByTestId("photo-gallery");
    fireEvent(
      screen.getByRole("button", { name: "Account menu" }),
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    expect(await screen.findByRole("menu")).toHaveTextContent(mock.webId);
    expect(screen.getByRole("menu")).toHaveTextContent("Alice Photos");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(mock.logout).toHaveBeenCalledTimes(1);
  });

  it("extension PRESENT: hides the AccountMenu but keeps a working Sign-out (no stranded logout)", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    renderApp();
    await screen.findByTestId("photo-gallery");
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
