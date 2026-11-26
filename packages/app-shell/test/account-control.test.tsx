// AUTHORED-BY GPT-6.1 Sol
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountControl } from "../src/index.js";

afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

describe("AccountControl", () => {
  it("forwards identity and sign-out to the account menu when the extension is absent", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <AccountControl
        webId="https://alice.example/#me"
        displayName="Alice Example"
        avatarUrl="https://alice.example/avatar.png"
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(await screen.findByText("https://alice.example/#me")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders a working isolated ghost sign-out button when the extension is already present", () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    const onSignOut = vi.fn();
    render(<AccountControl onSignOut={onSignOut} />);
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveAttribute("data-app-shell-control");
    fireEvent.click(button);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("reacts to late extension presence and uses the custom standalone label", () => {
    const onSignOut = vi.fn();
    render(<AccountControl onSignOut={onSignOut} signOutLabel="Leave account" />);
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    act(() => {
      (window as unknown as { solid: unknown }).solid = { webId: null };
      window.dispatchEvent(new CustomEvent("solid-extension:ready"));
    });
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave account" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
