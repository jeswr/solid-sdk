// AUTHORED-BY Claude Fable 5
//
// ErrorState — the standalone themed error panel. Pins the a11y contract
// (role="alert"), the default friendly copy, the optional Retry wiring, and the
// visual-language handles (the lucide alert icon + the `as-` token classes) so
// the panel keeps matching the shell's EmptyState/LoadingState look.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "../src/components/error-state.js";

describe("ErrorState", () => {
  it('renders a role="alert" panel with the default friendly copy', () => {
    render(<ErrorState />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("An unexpected error occurred. Please try again.");
  });

  it("renders custom title and message", () => {
    render(<ErrorState title="Could not load mail" message="Check your connection." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load mail");
    expect(alert).toHaveTextContent("Check your connection.");
  });

  it("shows NO Retry button when onRetry is not provided", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fires onRetry when the Retry button is clicked (default label)", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("honours a custom retryLabel", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retryLabel="Reload inbox" />);
    await userEvent.click(screen.getByRole("button", { name: "Reload inbox" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("carries the shell visual language: alert icon (aria-hidden) + as- token classes", () => {
    const { container } = render(<ErrorState />);
    // lucide renders <svg class="lucide lucide-<name>"> — the stable handle.
    const icon = container.querySelector("svg.lucide-triangle-alert");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    // Themes via the shell-PRIVATE `as-` utilities (never `dark:` variants).
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("border-as-border");
    expect(alert.className).not.toContain("dark:");
  });

  it("appends the caller className last (placement override wins)", () => {
    render(<ErrorState className="my-8" />);
    expect(screen.getByRole("alert").className).toMatch(/my-8$/);
  });
});
