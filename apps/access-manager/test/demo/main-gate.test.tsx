// @vitest-environment jsdom
// AUTHORED-BY GPT-6.1 Sol
// The demo never starts pod-auth. Other URLs mount the real auth provider and shared card.
import "@testing-library/jest-dom/vitest";

import { fakePodAuth } from "@jeswr/app-session/testing";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ getPodAuth: vi.fn() }));
vi.mock("../../src/auth/pod-auth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/pod-auth.js")>()),
  getPodAuth: seam.getPodAuth,
}));
vi.mock("../../src/demo/DemoApp.jsx", () => ({
  DemoApp: ({ view }: { view: string }) => <div data-testid="demo-app" data-view={view} />,
}));

async function loadEntry(url: string): Promise<void> {
  vi.resetModules();
  seam.getPodAuth.mockReset().mockResolvedValue(fakePodAuth().auth);
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", url);
  await import("../../src/main.jsx");
}

describe("main.tsx — the ?demo gate at the entry point", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("WITHOUT ?demo the REAL auth path is selected (pod-auth started, login rendered, no demo)", async () => {
    await loadEntry("/");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument(),
    );
    expect(seam.getPodAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("demo-app")).not.toBeInTheDocument();
  });

  it("an unrelated query string still selects the real app", async () => {
    await loadEntry("/?code=abc&state=xyz");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument(),
    );
    expect(seam.getPodAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("demo-app")).not.toBeInTheDocument();
  });

  it("?demo mounts the demo (default view dashboard) and NEVER builds the real core", async () => {
    await loadEntry("/?demo");
    await waitFor(() => expect(screen.getByTestId("demo-app")).toBeInTheDocument());
    expect(screen.getByTestId("demo-app")).toHaveAttribute("data-view", "dashboard");
    expect(seam.getPodAuth).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("?demo=inbox deep-links the inbox view, still with no auth", async () => {
    await loadEntry("/?demo=inbox");
    await waitFor(() => expect(screen.getByTestId("demo-app")).toBeInTheDocument());
    expect(screen.getByTestId("demo-app")).toHaveAttribute("data-view", "inbox");
    expect(seam.getPodAuth).not.toHaveBeenCalled();
  });
});
