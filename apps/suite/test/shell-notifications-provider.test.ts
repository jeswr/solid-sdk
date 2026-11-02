// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { act as reactAct } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, render, screen } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const session = vi.hoisted(() => ({ active: { id: "notification-one", kind: "solid" } }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => session }));

import type { SuiteNotification } from "../src/shell/lib/notifications-model";
import { demoNotifications } from "../src/shell/notifications/demo-source";
import { NotificationsProvider, useNotifications } from "../src/shell/notifications/provider";

function Snapshot() {
  const { items, unread } = useNotifications();
  return h("p", {
    "data-testid": "snapshot",
    children: `${unread}: ${items.map((item) => item.title).join(", ")}`,
  });
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", undefined);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  localStorage.clear();
  session.active = { id: "notification-one", kind: "solid" };
});
afterEach(cleanup);
it("drops the previous account synchronously and fences its late refresh", async () => {
  let resolve: (items: SuiteNotification[]) => void = () => {};
  const source = {
    id: "slow",
    list: () =>
      new Promise<SuiteNotification[]>((yes) => {
        resolve = yes;
      }),
  };
  const sources = [source];
  const view = render(h(NotificationsProvider, { sources, children: h(Snapshot) }));
  expect(screen.getByTestId("snapshot").textContent).toBe("0: ");
  const old = resolve;
  session.active = { id: "notification-two", kind: "solid" };
  view.rerender(h(NotificationsProvider, { sources, children: h(Snapshot) }));
  await reactAct(async () => {
    old(demoNotifications());
  });
  expect(screen.getByTestId("snapshot").textContent).toBe("0: ");
  await reactAct(async () => {
    resolve(demoNotifications().slice(0, 1));
  });
  expect(screen.getByTestId("snapshot").textContent).toContain("1: Avery Moss shared");
});
it("updates pluggable sources without keeping the previous source's results", async () => {
  const view = render(
    h(NotificationsProvider, {
      sources: [{ id: "one", list: async () => demoNotifications() }],
      children: h(Snapshot),
    }),
  );
  await reactAct(async () => {});
  expect(screen.getByTestId("snapshot").textContent).toContain("4:");
  view.rerender(
    h(NotificationsProvider, {
      sources: [{ id: "two", list: async () => [] }],
      children: h(Snapshot),
    }),
  );
  await reactAct(async () => {});
  expect(screen.getByTestId("snapshot").textContent).toBe("0: ");
});
