// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Render the signed-in header with the real AccountControl and extension detection.
// SessionGate startup and sign-out transitions are covered in App.session.test.tsx.
import type { SignedInSession } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const sessionState = {
  webId: "https://alice.example/profile/card#me",
  session: {
    webId: "https://alice.example/profile/card#me",
    podRoot: "https://alice.example/",
    podRootIsFallback: false,
    displayName: "Alice Health",
  },
  logout: vi.fn(),
  fetch: globalThis.fetch,
};

vi.mock("@jeswr/app-session/react", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session/react")>()),
  SessionGate: ({ children }: { children: (signedIn: SignedInSession) => ReactNode }) =>
    children(sessionState),
  useSession: () => sessionState,
}));

// Stub the pod-health data view — it receives the session fetch at runtime;
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
    document.documentElement.removeAttribute("data-solid-extension");
    delete (window as unknown as { solid?: unknown }).solid;
  });

  it("extension PRESENT → hides AccountMenu, keeps a minimal Sign out", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    await renderApp();
    // The minimal Sign-out control is present…
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toHaveAttribute(
      "data-variant",
      "ghost",
    );
    // …and the full AccountMenu (its trigger is labelled "Account menu") is NOT rendered.
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
  });

  it("extension ABSENT → renders the normal AccountMenu", async () => {
    await renderApp();
    // The AccountMenu trigger is present…
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
    expect(screen.getByText("Alice Health")).toBeInTheDocument();
    // …and there is no standalone Sign-out button (sign-out lives inside the closed
    // AccountMenu dropdown, not the header).
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});
