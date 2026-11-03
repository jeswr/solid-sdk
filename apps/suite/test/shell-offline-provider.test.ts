// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
const fixture = vi.hoisted(() => ({
  account: {
    active: { id: "one", kind: "demo", storageUrl: "https://example.org/" },
    status: "ready",
  },
  settings: { preferences: { offline: true, offlineHintSeen: true }, ready: true, update: vi.fn() },
  pathname: "/drive/my",
  state: "online" as "online" | "offline" | "reconnecting",
  listeners: new Set<() => void>(),
  remember: vi.fn(),
}));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => fixture.account }));
vi.mock("../src/shell/settings/preferences", () => ({ useAllPreferences: () => fixture.settings }));
vi.mock("next/navigation", () => ({ usePathname: () => fixture.pathname }));
vi.mock("../src/shell/sync/service-worker", () => ({ rememberPage: fixture.remember }));
vi.mock("../src/shell/lib/connectivity", async (original) => ({
  ...(await original<typeof import("../src/shell/lib/connectivity")>()),
  createConnectivity: () => ({
    getState: () => fixture.state,
    subscribe: (listener: () => void) => {
      fixture.listeners.add(listener);
      return () => fixture.listeners.delete(listener);
    },
  }),
}));

import { createLocalOutbox } from "../src/shell/lib/outbox";
import {
  OfflineProvider,
  OutboxFactoryContext,
  useRecentTitle,
} from "../src/shell/sync/offline-provider";
import { useSyncSnapshot } from "../src/shell/sync/online";
import { useNeedsConnection } from "../src/shell/sync/requires-online";

function Snapshot() {
  return h("p", {
    "data-testid": "snapshot",
    children: JSON.stringify({
      online: useSyncSnapshot().online,
      disabled: useNeedsConnection().disabled,
    }),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fixture.state = "online";
  fixture.account.active.id = "one";
  fixture.settings.preferences.offline = true;
  fixture.settings.ready = true;
  fixture.pathname = "/drive/my";
  fixture.remember.mockClear();
  document.title = "Drive · Solid Suite";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const tick = async (ms = 0) => {
  await reactAct(async () => {
    vi.advanceTimersByTime(ms);
  });
};
const connection = async (state: typeof fixture.state) => {
  await reactAct(async () => {
    fixture.state = state;
    for (const listener of fixture.listeners) listener();
  });
};

it("honours opt-out before recording, clears history when disabled and leaves other accounts", async () => {
  localStorage.setItem("suite.recent.v1.two", "[]");
  fixture.settings.ready = false;
  const view = render(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(fixture.remember).not.toHaveBeenCalled();
  fixture.settings.ready = true;
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]")).toMatchObject([
    { href: "/drive/my", title: document.title },
  ]);
  fixture.remember.mockClear();
  fixture.settings.preferences.offline = false;
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
  expect(localStorage.getItem("suite.recent.v1.two")).toBe("[]");
  fixture.pathname = "/docs";
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
  expect(fixture.remember).not.toHaveBeenCalled();
});

it("records a route's title after navigation and disconnects the previous title observer", async () => {
  const view = render(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  fixture.pathname = "/docs";
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await reactAct(async () => {
    document.title = "Documents · Solid Suite";
  });
  await tick();
  const recent = JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]");
  expect(recent).toMatchObject([
    { href: "/docs", title: "Documents · Solid Suite" },
    { href: "/drive/my", title: "Drive · Solid Suite" },
  ]);
});

it("never copies the open page into the next account's history after a switch or sign-out", async () => {
  document.title = "Salary review · Docs · Solid Suite";
  fixture.pathname = "/docs/d/salary";
  const view = render(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]")).toHaveLength(1);
  fixture.remember.mockClear();
  fixture.account.active.id = "two";
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  // A later re-run on the same page (preferences settling for the new account) still skips it.
  fixture.settings.ready = false;
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  fixture.settings.ready = true;
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(localStorage.getItem("suite.recent.v1.two")).toBeNull();
  expect(fixture.remember).not.toHaveBeenCalled();
  fixture.pathname = "/drive/my";
  view.rerender(h(OfflineProvider, { children: h(Snapshot) }));
  await reactAct(async () => {
    document.title = "Drive · Solid Suite";
  });
  await tick();
  expect(JSON.parse(localStorage.getItem("suite.recent.v1.two") ?? "[]")).toMatchObject([
    { href: "/drive/my", title: "Drive · Solid Suite" },
  ]);
  expect(fixture.remember).toHaveBeenCalledWith("/drive/my");
});

function Named({ title }: { title: string }) {
  useRecentTitle(title);
  return null;
}

it("records the title a shell page names over a document title Next resets", async () => {
  document.title = "Solid Suite";
  fixture.pathname = "/notifications";
  const tree = (title: string) => h(OfflineProvider, { children: h(Named, { title }) });
  const view = render(tree("Notifications · Home · Solid Suite"));
  await tick();
  expect(JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]")).toMatchObject([
    { href: "/notifications", title: "Notifications · Home · Solid Suite" },
  ]);
  // A name given for one path never labels the next: it falls back to the document title.
  fixture.pathname = "/search";
  view.rerender(h(OfflineProvider, { children: null }));
  await tick();
  expect(JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]")).toMatchObject([
    { href: "/search", title: "Solid Suite" },
    { href: "/notifications", title: "Notifications · Home · Solid Suite" },
  ]);
});

it("does not save excluded pages such as onboarding for offline use", async () => {
  fixture.pathname = "/onboarding";
  render(h(OfflineProvider, { children: h(Snapshot) }));
  await tick();
  expect(fixture.remember).not.toHaveBeenCalled();
  expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
});

it("flushes an outbox on its initial online binding, on account change and after reconnect", async () => {
  const make = () =>
    createLocalOutbox({ storage: null, key: "test", now: () => new Date(), newId: () => "id" });
  const first = make();
  const second = make();
  const one = vi.spyOn(first, "reconnected");
  const two = vi.spyOn(second, "reconnected");
  const factory = (id: string) => (id === "one" ? first : second);
  const tree = () =>
    h(OutboxFactoryContext.Provider, {
      value: factory,
      children: h(OfflineProvider, { children: h(Snapshot) }),
    });
  const view = render(tree());
  expect(one).toHaveBeenCalledOnce();
  fixture.account.active.id = "two";
  view.rerender(tree());
  expect(two).toHaveBeenCalledOnce();
  await connection("reconnecting");
  expect(screen.getByTestId("snapshot").textContent).toBe('{"online":false,"disabled":true}');
  expect(two).toHaveBeenCalledOnce();
  await connection("online");
  expect(two).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("snapshot").textContent).toBe('{"online":true,"disabled":false}');
});

it("debounces connection announcements and suppresses short flaps", async () => {
  render(h(OfflineProvider, { children: h(Snapshot) }));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  await connection("offline");
  await tick(499);
  expect(status.textContent).toBe("");
  await connection("reconnecting");
  await tick(500);
  expect(status.textContent).toBe("Reconnecting…");
  await connection("offline");
  await tick(500);
  expect(status.textContent).toBe("You're offline");
  await connection("online");
  await tick(500);
  expect(status.textContent).toBe("Back online");
});
