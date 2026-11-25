// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: "online",
  seed: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => mocks.connection }));
vi.mock("../src/apps/insights/demo/sample", () => ({ ensureSample: mocks.seed }));
vi.mock("../src/apps/insights/lib/sources", () => ({ loadSources: mocks.load }));

import { InsightsProvider, useInsights } from "../src/apps/insights/state/insights-context";
import type { PodSession } from "../src/lib/session/pod-session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  mocks.connection = "online";
  vi.clearAllMocks();
});
describe("Insights provider", () => {
  it("subscribes, debounces online changes, preserves loaded data offline and refreshes on reconnect", async () => {
    let changed = (_url: string) => {};
    const off = vi.fn();
    const session = {
      mode: "demo",
      storageUrl: "https://a.test/",
      webId: "https://a.test/#me",
      displayName: "Fictional",
      fetch: vi.fn(),
      reset: async () => {},
      subscribe: (listener: typeof changed) => {
        changed = listener;
        return off;
      },
    } satisfies PodSession;
    function Child() {
      const state = useInsights();
      return (
        <p>
          {state.status}
          <button type="button" onClick={state.refresh}>
            Refresh
          </button>
        </p>
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = () =>
      root?.render(
        <InsightsProvider session={session}>
          <Child />
        </InsightsProvider>,
      );
    await act(async () => {
      render();
    });
    expect(host.textContent).toContain("ready");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await act(async () => {
      changed("https://a.test/health/");
      changed("https://a.test/");
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    mocks.connection = "offline";
    await act(async () => {
      render();
    });
    await act(async () => {
      changed("https://a.test/");
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("ready");
    mocks.connection = "online";
    await act(async () => {
      render();
    });
    expect(mocks.load).toHaveBeenCalledTimes(3);
    await act(async () => host.querySelector("button")?.click());
    expect(mocks.load).toHaveBeenCalledTimes(4);
    await act(async () => root?.unmount());
    root = undefined;
    expect(off).toHaveBeenCalled();
    host.remove();
  });
  it("requires a provider", () => {
    function Invalid() {
      useInsights();
      return null;
    }
    // Server rendering exercises the guard without triggering the external store hook.
    expect(() => renderToString(<Invalid />)).toThrow("InsightsProvider is required");
  });
});
