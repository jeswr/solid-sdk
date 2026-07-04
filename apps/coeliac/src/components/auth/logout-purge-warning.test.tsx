// AUTHORED-BY Claude Fable 5
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LogoutPurgeWarning } from "./logout-purge-warning";

describe("LogoutPurgeWarning", () => {
  it("renders a visible alert about the incomplete local-cache wipe (default copy)", () => {
    render(<LogoutPurgeWarning onRetry={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/may not have been fully cleared/i);
  });

  it("(c) renders the specific message passed in (e.g. the retryPurge-updated warning)", () => {
    render(
      <LogoutPurgeWarning
        message="Still could not clear local health data: blocked"
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Still could not clear local health data: blocked/);
    // The generic default copy is NOT shown when a specific message is provided.
    expect(alert.textContent).not.toMatch(/On a shared device, clear it before someone else/);
  });

  it("renders a distinct revoke-failure message (session may still be live)", () => {
    render(
      <LogoutPurgeWarning
        message="Sign-out may be incomplete — your credentials could not be revoked, so you may still be signed in on this device. Reload the page and sign out again."
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/you may still be signed in/i);
  });

  it("retries the purge when 'Clear local data' is pressed", async () => {
    const onRetry = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<LogoutPurgeWarning onRetry={onRetry} onDismiss={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /clear local data/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("dismisses when 'Dismiss' is pressed", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<LogoutPurgeWarning onRetry={vi.fn(async () => {})} onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
