// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// The entry-point gate: demo mode mounts ONLY under ?demo, and WITHOUT ?demo
// the real auth path is selected — buildController() runs and the login
// screen renders; the demo module is never mounted. The heavy leaves
// (LoginController, the login web component, the demo app) are mocked so the
// test exercises exactly the REAL gating logic in src/main.tsx.
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildController } = vi.hoisted(() => ({ buildController: vi.fn(() => ({})) }));

vi.mock("../../src/auth/controller.js", () => ({
  buildController,
}));
vi.mock("../../src/demo/DemoApp.jsx", () => ({
  DemoApp: ({ view }: { view: string }) => <div data-testid="demo-app" data-view={view} />,
}));
// The web-component packages register custom elements / drive auth — stub them
// out so the entry module loads without any real login machinery.
vi.mock("@jeswr/solid-elements", () => ({}));
vi.mock("@jeswr/solid-elements/react", () => ({
  LoginPanel: () => <div data-testid="login-panel" />,
}));

async function loadEntry(url: string): Promise<void> {
  vi.resetModules();
  buildController.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", url);
  await import("../../src/main.jsx");
}

describe("main.tsx — the ?demo gate at the entry point", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("WITHOUT ?demo the REAL auth path is selected (controller built, login rendered, no demo)", async () => {
    await loadEntry("/");
    await waitFor(() => expect(screen.getByTestId("login-panel")).toBeInTheDocument());
    expect(buildController).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("demo-app")).not.toBeInTheDocument();
  });

  it("an unrelated query string still selects the real app", async () => {
    await loadEntry("/?code=abc&state=xyz");
    await waitFor(() => expect(screen.getByTestId("login-panel")).toBeInTheDocument());
    expect(buildController).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("demo-app")).not.toBeInTheDocument();
  });

  it("?demo mounts the demo (default view dashboard) and NEVER builds the real controller", async () => {
    await loadEntry("/?demo");
    await waitFor(() => expect(screen.getByTestId("demo-app")).toBeInTheDocument());
    expect(screen.getByTestId("demo-app")).toHaveAttribute("data-view", "dashboard");
    expect(buildController).not.toHaveBeenCalled();
    expect(screen.queryByTestId("login-panel")).not.toBeInTheDocument();
  });

  it("?demo=inbox deep-links the inbox view, still with no auth", async () => {
    await loadEntry("/?demo=inbox");
    await waitFor(() => expect(screen.getByTestId("demo-app")).toBeInTheDocument());
    expect(screen.getByTestId("demo-app")).toHaveAttribute("data-view", "inbox");
    expect(buildController).not.toHaveBeenCalled();
  });
});
