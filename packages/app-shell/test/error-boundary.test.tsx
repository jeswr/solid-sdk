// AUTHORED-BY Claude Fable 5
//
// ErrorBoundary — pins the catch/fallback/recovery contract:
//   - a throwing child → the DEFAULT <ErrorState> fallback (role="alert"), with
//     the raw error message NEVER leaked to the UI;
//   - onError(error, info) receives the raw detail (the telemetry seam), incl.
//     a normalised Error for thrown non-Errors, and a throwing hook is contained;
//   - resetKey CHANGE recovers; an unchanged re-render does not;
//   - the default fallback's Retry and a function-fallback's reset() recover;
//   - custom node + function fallbacks render (function form gets error+reset).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/error-boundary.js";

// React logs caught render errors to console.error — silence it so test output
// stays readable, and restore after each case.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SECRET = "secret-internal-detail-42";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error(SECRET);
  return <div>recovered content</div>;
}

function ThrowString(): never {
  // React propagates non-Error throws too; the boundary must normalise them.
  throw "plain string failure";
}

describe("ErrorBoundary", () => {
  it("catches a throwing child and shows the default ErrorState fallback (role=alert)", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(screen.queryByText("recovered content")).toBeNull();
  });

  it("NEVER leaks the raw error message/stack into the UI", () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(container.textContent).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls onError with the raw error + React error info (the telemetry seam)", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(SECRET);
    expect(String((info as { componentStack?: string }).componentStack)).toContain("Boom");
  });

  it("normalises a thrown non-Error before handing it to onError", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowString />
      </ErrorBoundary>,
    );
    const [error] = onError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("plain string failure");
    // Still shows the friendly fallback, not the thrown text.
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("contains a throwing onError hook (the boundary still shows its fallback)", () => {
    render(
      <ErrorBoundary
        onError={() => {
          throw new Error("telemetry exploded");
        }}
      >
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("recovers when resetKey changes (navigation clears a caught error)", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/inbox">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/settings">
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does NOT reset on a re-render with an UNCHANGED resetKey", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/inbox">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/inbox">
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    // Same key → the fallback stays (children are not remounted).
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("recovered content")).toBeNull();
  });

  it("the default fallback's Retry button resets the boundary", async () => {
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error(SECRET);
      return <div>recovered content</div>;
    }
    render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false; // the underlying failure is gone; Retry should recover
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a custom node fallback instead of the default", () => {
    render(
      <ErrorBoundary fallback={<p>custom fallback panel</p>}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback panel")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a function fallback receives { error, reset } and reset() recovers", async () => {
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error(SECRET);
      return <div>recovered content</div>;
    }
    render(
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <div>
            <p>kind: {error instanceof Error ? "Error" : "other"}</p>
            <button type="button" onClick={reset}>
              start over
            </button>
          </div>
        )}
      >
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("kind: Error")).toBeInTheDocument();
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "start over" }));
    expect(screen.getByText("recovered content")).toBeInTheDocument();
  });
});
