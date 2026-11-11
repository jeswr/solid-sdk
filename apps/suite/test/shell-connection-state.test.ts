// AUTHORED-BY Codex GPT-6.1
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectionState } from "../src/shell/lib/connectivity";
import { ConnectionContext, useConnectionState } from "../src/shell/sync/connection-state";
import { act, h, mount } from "./drive-ui-dom";

afterEach(() => vi.restoreAllMocks());
function Status() {
  return h("output", null, useConnectionState());
}

it("tracks browser connectivity outside the shell and releases its subscription", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const view = await mount(h(Status));
  expect(view.host.textContent).toBe("online");
  online.mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(view.host.textContent).toBe("offline");
  online.mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(view.host.textContent).toBe("online");
  await view.unmount();
});

it("uses the shell's reachability state, including reconnecting, when supplied", async () => {
  let state: ConnectionState = "reconnecting";
  const listeners = new Set<() => void>();
  const connection = {
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => state,
  };
  const view = await mount(h(ConnectionContext.Provider, { value: connection }, h(Status)));
  expect(view.host.textContent).toBe("reconnecting");
  await act(async () => {
    state = "online";
    for (const listener of listeners) listener();
  });
  expect(view.host.textContent).toBe("online");
  await view.unmount();
  expect(listeners.size).toBe(0);
});

it("has a stable server snapshot without consulting browser connectivity", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(renderToString(h(Status))).toContain("online");
});
