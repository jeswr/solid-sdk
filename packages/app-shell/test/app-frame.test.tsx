// AUTHORED-BY Claude Sonnet 5.5
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppFrame, ThemeProvider } from "../src/index.js";

const wrap = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

const base = {
  appName: "Pod Test",
  feedback: { repo: "jeswr/pod-test", appVersion: "abc123" },
  onSignOut: vi.fn(),
  storageNote: { product: "Test", kind: "things" },
};

describe("AppFrame", () => {
  it("renders .app-shell with the header first and the children after it", () => {
    const { container } = render(
      <AppFrame
        {...base}
        session={{
          webId: "https://alice.example/#me",
          displayName: "Alice Example",
          podRoot: "https://alice.example/",
        }}
      >
        <main className="app-main">body</main>
      </AppFrame>,
      { wrapper: wrap },
    );
    const shell = container.querySelector("div.app-shell");
    expect(shell?.children[0]?.tagName).toBe("HEADER");
    expect(shell?.querySelector(".app-brand")).toHaveTextContent("Pod Test");
    expect(shell?.children[1]?.tagName).toBe("MAIN");
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(container.querySelector(".app-note")).toBeNull();
  });

  it("shows the storage note only when the pod root is a fallback", () => {
    const { container } = render(
      <AppFrame
        {...base}
        storageNote={{ ...base.storageNote, podRootAsCode: true }}
        session={{
          webId: "https://alice.example/#me",
          podRoot: "https://alice.example/",
          podRootIsFallback: true,
        }}
      />,
      { wrapper: wrap },
    );
    const note = container.querySelector("p.app-note");
    expect(note).toHaveAttribute("role", "note");
    expect(note?.textContent).toBe(
      "Your profile doesn't list a storage address, so Test can only show public things at https://alice.example/.",
    );
    expect(note?.querySelector("code")).toHaveTextContent("https://alice.example/");
  });
});
