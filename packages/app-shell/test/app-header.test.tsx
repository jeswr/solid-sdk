// AUTHORED-BY Claude Sonnet 5.5
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader, ThemeProvider } from "../src/index.js";

afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
});

const wrap = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

const feedback = {
  repo: "jeswr/pod-test",
  appName: "Pod Test",
  appVersion: "abc123",
  webId: "https://alice.example/#me",
};

describe("AppHeader", () => {
  it("renders the brand and the action trio in the shared DOM order", () => {
    const { container } = render(
      <AppHeader
        brand="Pod Test"
        feedback={feedback}
        account={{ webId: feedback.webId, displayName: "Alice Example", onSignOut: vi.fn() }}
      />,
      { wrapper: wrap },
    );
    const header = container.querySelector("header.app-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector(":scope > span.app-brand")).toHaveTextContent("Pod Test");
    const actions = header?.querySelector(":scope > div.app-header-actions");
    expect(actions).not.toBeNull();
    const labels = Array.from(actions?.querySelectorAll("button") ?? []).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent ?? "",
    );
    expect(labels[0]).toMatch(/feedback/i);
    expect(labels[labels.length - 1]).toMatch(/account menu/i);
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
  });

  it("renders children before the feedback button", () => {
    render(
      <AppHeader brand="Pod Test" feedback={feedback} account={{ onSignOut: vi.fn() }}>
        <button type="button">Extra</button>
      </AppHeader>,
      { wrapper: wrap },
    );
    const extra = screen.getByRole("button", { name: "Extra" });
    const fb = screen.getByRole("button", { name: /feedback/i });
    expect(extra.compareDocumentPosition(fb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("forwards sign-out to the account control", () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    const onSignOut = vi.fn();
    render(<AppHeader brand="Pod Test" feedback={feedback} account={{ onSignOut }} />, {
      wrapper: wrap,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
