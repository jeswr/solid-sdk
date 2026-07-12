// AUTHORED-BY Claude Fable 5
//
// Crash-resilience boundary (#72/#73 cross-app parity): the app's routed root
// is wrapped in the shared @jeswr/app-shell <ErrorBoundary>, so a render error
// anywhere in the logged-in tree (here: a throwing FileBrowser) paints the
// themed <ErrorState> fallback instead of white-screening the SPA. Verifies:
//   1. a thrown render error is CAUGHT → the role="alert" fallback shows, and
//      the raw error internals are NOT leaked into the UI;
//   2. the fallback's Retry button resets the boundary and remounts children;
//   3. a `resetKey` change (webId — this router-free app's navigation analog:
//      the login ↔ app session transition) clears a caught error.
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable session state the mocked useSession returns (flipped per test).
let sessionState = makeSession("https://alice.example/profile/card#me");

function makeSession(webId: string) {
  return {
    webId,
    session: {
      podRoot: new URL(webId).origin.concat("/"),
      podRootIsFallback: false,
      displayName: "Alice Drive",
      avatarUrl: undefined,
    },
    logout: vi.fn(),
    autologinPending: false,
    restoringSession: false,
  };
}

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => sessionState,
}));

// Stub the file browser with a toggleable thrower — the "crash anywhere in the
// routed subtree" stand-in. No live pod fetch.
let browserShouldThrow = false;
vi.mock("@jeswr/pod-drive/ui", () => ({
  FileBrowser: () => {
    if (browserShouldThrow) throw new Error("SECRET-INTERNAL-DETAIL: pod exploded");
    return <div data-testid="file-browser" />;
  },
}));

import { App } from "./App";

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

// React logs caught boundary errors via console.error — silence the expected
// noise so the suite output stays readable (restored after each test).
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  browserShouldThrow = false;
  sessionState = makeSession("https://alice.example/profile/card#me");
});

describe("crash-resilience boundary (shared app-shell ErrorBoundary around the routed root)", () => {
  it("renders the app normally when nothing throws (boundary is transparent)", () => {
    renderApp();
    expect(screen.getByTestId("file-browser")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("catches a render error and shows the themed ErrorState — without leaking internals", () => {
    browserShouldThrow = true;
    renderApp();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    // The default fallback must never render the raw error message/stack.
    expect(alert).not.toHaveTextContent("SECRET-INTERNAL-DETAIL");
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
  });

  it("Retry resets the boundary and remounts the children", () => {
    browserShouldThrow = true;
    renderApp();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The underlying cause clears, then the user retries.
    browserShouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByTestId("file-browser")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a resetKey (webId) change — this app's navigation analog — clears a caught error", () => {
    browserShouldThrow = true;
    const { rerender } = renderApp();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Session transition (the router-free app's only "navigation"): a different
    // identity signs in and the crash cause is gone.
    browserShouldThrow = false;
    sessionState = makeSession("https://bob.example/profile/card#me");
    rerender(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("file-browser")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
