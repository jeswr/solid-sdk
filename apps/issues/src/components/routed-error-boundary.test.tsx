// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5

// Guards the suite-shared <ErrorBoundary> wiring: a throwing page shows the
// themed fallback (never the raw error text), the Retry button recovers, and a
// route change (the `resetKey={pathname}`) clears a caught error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// usePathname feeds the boundary's resetKey; hoisted so the mock factory (which
// vitest hoists above imports) can read the current value.
const nav = vi.hoisted(() => ({ pathname: "/a" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { RoutedErrorBoundary } from "./routed-error-boundary";

// A child whose throwing is controlled from the outside so we can exercise
// recovery (the same element re-rendered after the fault clears).
let shouldCrash = true;
function Flaky() {
  if (shouldCrash) throw new Error("boom-secret-internal");
  return <div>recovered</div>;
}

beforeEach(() => {
  shouldCrash = true;
  nav.pathname = "/a";
});
afterEach(cleanup);

describe("RoutedErrorBoundary", () => {
  it("renders children when they don't throw", () => {
    shouldCrash = false;
    render(
      <RoutedErrorBoundary>
        <Flaky />
      </RoutedErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeTruthy();
  });

  it("shows a themed fallback and never leaks the raw error text", () => {
    // React logs the caught error to console.error; silence it for a clean run.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <RoutedErrorBoundary>
          <Flaky />
        </RoutedErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(screen.queryByText(/boom-secret-internal/)).toBeNull();
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("recovers when Retry is clicked after the fault clears", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <RoutedErrorBoundary>
          <Flaky />
        </RoutedErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      shouldCrash = false;
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(screen.getByText("recovered")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("recovers on route change via the pathname resetKey", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(
        <RoutedErrorBoundary>
          <Flaky />
        </RoutedErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      // Navigate: the app re-renders with a new pathname and a page that no
      // longer throws — the boundary should clear on the resetKey change.
      shouldCrash = false;
      nav.pathname = "/b";
      rerender(
        <RoutedErrorBoundary>
          <Flaky />
        </RoutedErrorBoundary>,
      );
      expect(screen.getByText("recovered")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
