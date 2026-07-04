// AUTHORED-BY Claude Fable 5
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LogoutPurgeWarning } from "./logout-purge-warning";

describe("LogoutPurgeWarning", () => {
  it("renders a visible alert about the incomplete local-cache wipe", () => {
    render(<LogoutPurgeWarning onRetry={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/may not have been fully cleared/i);
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
