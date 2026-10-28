// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 5.5
import { act, type ComponentType, createElement, lazy } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ Workspace: null as ComponentType | null }));
vi.mock("@/lib/demo-pod/browser", () => ({
  getDemoPod: () => Promise.resolve({ fetch: vi.fn(), subscribe: vi.fn() }),
  resetDemoPod: vi.fn(),
}));
vi.mock("../src/apps/docs/components/common", () => ({ DocumentSkeleton: () => "skeleton" }));
vi.mock("../src/apps/docs/components/docs-workspace", () => ({
  DocsWorkspace: () => (mocks.Workspace ? createElement(mocks.Workspace) : null),
}));

import { DocsShell } from "../src/apps/docs/components/docs-shell";
import { usePodSessionState } from "../src/lib/session/pod-session";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function Status() {
  return createElement("p", null, usePodSessionState().status);
}

it("hydrates a workspace whose code loads after the session settles against the loading markup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  mocks.Workspace = Status;
  host.innerHTML = renderToString(createElement(DocsShell, null, null));
  document.body.append(host);
  expect(host.textContent).toBe("loading");
  // The workspace's code arrives only after the demo pod has opened, like a slow route chunk.
  let load: (module: { default: typeof Status }) => void = () => undefined;
  mocks.Workspace = lazy(
    () => new Promise<{ default: typeof Status }>((resolve) => (load = resolve)),
  );
  const recoverable = vi.fn();
  const root = hydrateRoot(host, createElement(DocsShell, null, null), {
    onRecoverableError: recoverable,
  });
  try {
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => load({ default: Status }));
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.textContent).toBe("ready");
  } finally {
    act(() => root.unmount());
  }
});
