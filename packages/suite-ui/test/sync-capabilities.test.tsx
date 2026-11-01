// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CapabilityGate,
  CapabilityProvider,
  useCapabilities,
  useRequiresOnline,
} from "../src/sync/index.js";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("capability gates", () => {
  it("preserves supported controls and reacts to provider changes", () => {
    const click = vi.fn();
    const view = (supported: boolean) => (
      <CapabilityProvider capabilities={{ trash: supported }}>
        <CapabilityGate need="trash" fallback="disabled">
          <button type="button" onClick={click}>
            Trash
          </button>
        </CapabilityGate>
      </CapabilityProvider>
    );
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole("button"));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
    rerender(view(false));
    fireEvent.click(screen.getByRole("button"));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true");
  });
  it("fails closed without a provider or with a missing capability", () => {
    const { rerender } = render(
      <CapabilityGate need="trash" fallback="disabled">
        <button type="button">Trash</button>
      </CapabilityGate>,
    );
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
    rerender(
      <CapabilityProvider capabilities={{ move: true }}>
        <CapabilityGate need="trash" fallback="disabled">
          <button type="button">Trash</button>
        </CapabilityGate>
      </CapabilityProvider>,
    );
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
  });
  it("hides unsupported controls", () => {
    render(
      <CapabilityGate need="selfRegistration" fallback="hidden">
        <button type="button">Create account</button>
      </CapabilityGate>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });
  it("explains disabled controls in a keyboard and pointer tooltip", async () => {
    const user = userEvent.setup();
    render(
      <CapabilityGate need="trash" fallback="disabled" reason="Trash is unavailable here">
        <button type="button">Trash</button>
      </CapabilityGate>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("group"));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Trash is unavailable here");
    await user.tab();
    await user.hover(screen.getByRole("group"));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Trash is unavailable here");
  });
  it("disables all fragment children and shows the storage help link", () => {
    render(
      <CapabilityGate need="versioning" fallback="note">
        {/* biome-ignore lint/complexity/noUselessFragments: Exercise fragment children supplied by consumers. */}
        <>
          <button type="button">History</button>
          <button type="button">Restore</button>
          {null}
        </>
      </CapabilityGate>,
    );
    for (const button of screen.getAllByRole<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
    expect(screen.getByText(/Not available on this storage ·/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Learn what your storage supports" }).getAttribute("href"),
    ).toBe("/settings/storage");
  });
  it("exposes capability values and the online convention from explicit props", () => {
    function Probe({ online }: { online: boolean }) {
      const capabilities = useCapabilities();
      const requirement = useRequiresOnline(online, "change sharing");
      return <output>{JSON.stringify({ capabilities, ...requirement })}</output>;
    }
    const { rerender } = render(
      <CapabilityProvider capabilities={{ move: true }}>
        <Probe online={false} />
      </CapabilityProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(
      '{"capabilities":{"move":true},"disabled":true,"reason":"Reconnect to change sharing"}',
    );
    rerender(<Probe online />);
    expect(screen.getByRole("status").textContent).toBe(
      '{"capabilities":{},"disabled":false,"reason":"Reconnect to change sharing"}',
    );
  });
});
