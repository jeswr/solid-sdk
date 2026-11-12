// AUTHORED-BY Claude Opus 5.5
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, h, mount } from "../drive-ui-dom";

const fixtures = vi.hoisted(() => ({
  provider: vi.fn(),
  presenter: vi.fn(),
  state: { status: "ready", session: { mode: "demo", webId: "w" } } as Record<string, unknown>,
}));
vi.mock("@jeswr/suite-ui", () => ({
  ErrorState: () => null,
  LoadingSkeleton: ({ label }: { label: string }) => label,
  Toaster: () => null,
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => fixtures.state,
}));
vi.mock("@/shell/app-frame", () => ({
  AppFrame: ({ children }: { children: ReactNode }) => children,
  AppHeading: ({ children }: { children: ReactNode }) => children,
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../src/apps/slides/state/slides-context", () => ({
  SlidesProvider: () => {
    fixtures.provider();
    return "workspace";
  },
}));
vi.mock("../../src/apps/slides/components/slides-workspace", () => ({
  SlidesWorkspace: () => null,
}));
vi.mock("../../src/apps/slides/components/presenter", async () => {
  const { useContext } = await import("react");
  const { SlideSessionContext } = await import("../../src/apps/slides/components/slide-canvas");
  return {
    PresenterWindow: ({ channelId }: { channelId: string }) => {
      fixtures.presenter(channelId, useContext(SlideSessionContext));
      return "presenter";
    },
  };
});

import { SlidesApp } from "../../src/apps/slides/components/slides-app";

afterEach(() => {
  window.history.replaceState(null, "", "/slides");
  fixtures.provider.mockReset();
  fixtures.presenter.mockReset();
});
it("opens the presenter window without mounting the collection provider", async () => {
  window.history.replaceState(null, "", "/slides?presenter=abc");
  const view = await mount(h(SlidesApp));
  await act(async () => {});
  expect(view.host.textContent).toBe("presenter");
  expect(fixtures.provider).not.toHaveBeenCalled();
  expect(fixtures.presenter).toHaveBeenCalledWith("abc", fixtures.state.session);
  fixtures.state = { status: "loading" };
  await view.unmount();
  const loading = await mount(h(SlidesApp));
  await act(async () => {});
  expect(fixtures.presenter).toHaveBeenLastCalledWith("abc", null);
  await loading.unmount();
  fixtures.state = { status: "ready", session: { mode: "demo", webId: "w" } };
});
it("mounts the collection provider in a normal window", async () => {
  const view = await mount(h(SlidesApp));
  await act(async () => {});
  expect(view.host.textContent).toBe("workspace");
  expect(fixtures.provider).toHaveBeenCalled();
  expect(fixtures.presenter).not.toHaveBeenCalled();
  await view.unmount();
});
