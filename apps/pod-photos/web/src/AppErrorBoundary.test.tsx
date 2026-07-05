// AUTHORED-BY Claude Fable 5
//
// AppErrorBoundary — the app-level crash-resilience wiring (#72/#73 parity).
// Verifies the three behaviours the wrapper exists for:
//   1. a render error in the subtree is CAUGHT and replaced by the shared
//      themed default <ErrorState> (role="alert", generic copy — never the raw
//      error message/stack), instead of white-screening;
//   2. the default fallback's "Try again" button resets the boundary and
//      re-renders the children;
//   3. the resetKey is the session `webId` — an identity change (this
//      router-free app's only "navigation") clears a showing error.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock session state (vi.hoisted so the hoisted vi.mock factory can
// close over it — same pattern as App.extension.test.tsx).
const mock = vi.hoisted(() => ({
  webId: "https://alice.example/profile/card#me" as string | null,
}));

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({ webId: mock.webId }),
}));

import { AppErrorBoundary } from "./AppErrorBoundary";

/** A child that throws during render while `shouldThrow` is true. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("secret internal detail");
  return <div data-testid="content">recovered content</div>;
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    mock.webId = "https://alice.example/profile/card#me";
    // React logs caught boundary errors to console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("catches a render error and shows the default themed ErrorState (no internals leaked)", () => {
    render(
      <AppErrorBoundary>
        <Bomb shouldThrow={true} />
      </AppErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The raw error message must never reach the UI.
    expect(alert).not.toHaveTextContent("secret internal detail");
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("recovers via the fallback's Try again button", () => {
    let shouldThrow = true;
    const tree = () => (
      <AppErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </AppErrorBoundary>
    );
    const { rerender } = render(tree());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Fix the child, then reset the boundary.
    shouldThrow = false;
    rerender(tree());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets when the session webId changes (the router-free app's resetKey)", () => {
    let shouldThrow = true;
    const tree = () => (
      <AppErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </AppErrorBoundary>
    );
    const { rerender } = render(tree());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // An identity change (e.g. logout → webId null) with a now-healthy subtree
    // must clear the caught error — the resetKey wiring under test.
    shouldThrow = false;
    mock.webId = null;
    rerender(tree());
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps showing the fallback on a re-render when the webId is UNCHANGED", () => {
    let shouldThrow = true;
    const tree = () => (
      <AppErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </AppErrorBoundary>
    );
    const { rerender } = render(tree());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // FIX the child but keep the SAME webId: if the boundary wrongly reset on a
    // mere re-render, the now-healthy child would render content and this test
    // would fail — only a resetKey CHANGE (or Try again) may recover. (With a
    // still-throwing child this assertion would be vacuous: a wrong reset would
    // just re-catch and show the alert again — roborev finding on the first cut.)
    shouldThrow = false;
    rerender(tree());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });
});
