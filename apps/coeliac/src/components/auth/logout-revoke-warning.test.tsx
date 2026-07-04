// AUTHORED-BY Claude Opus 4.8
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LogoutRevokeWarning } from "./logout-revoke-warning";

describe("LogoutRevokeWarning", () => {
  it("renders a visible alert about the possibly-live session", () => {
    render(<LogoutRevokeWarning onRetry={vi.fn(async () => {})} onReload={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/you may still be signed in/i);
  });

  it("renders the specific message passed in", () => {
    render(
      <LogoutRevokeWarning
        message="Sign-out still failed — you may still be signed in on this device (503)."
        onRetry={vi.fn(async () => {})}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Sign-out still failed/);
  });

  it("(a) offers NO 'Clear local data' action and NO plain 'Dismiss' (security state, not dismissible)", () => {
    render(<LogoutRevokeWarning onRetry={vi.fn(async () => {})} onReload={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clear local data/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("retries the revocation when 'Sign out again' is pressed", async () => {
    const onRetry = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<LogoutRevokeWarning onRetry={onRetry} onReload={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /sign out again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("reloads when 'Reload page' is pressed", async () => {
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<LogoutRevokeWarning onRetry={vi.fn(async () => {})} onReload={onReload} />);
    await user.click(screen.getByRole("button", { name: /reload page/i }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
