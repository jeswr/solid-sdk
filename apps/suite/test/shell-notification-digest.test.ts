// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { buildDigest } from "@jeswr/suite-sdk/digest";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { h } from "./drive-ui-dom";

const ui = createRequire(new URL("../../../packages/suite-ui/package.json", import.meta.url));
const { cleanup, fireEvent, render, screen, within } = ui(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({ active: { id: "digest-settings" } }),
}));
vi.mock("../src/shell/notifications/desktop", async (original) => ({
  ...(await original<typeof import("../src/shell/notifications/desktop")>()),
  showDesktopNotification: vi.fn(async () => {}),
}));

import { demoNotificationDate } from "../src/lib/demo-pod/seed-notifications";
import type { SuiteNotification } from "../src/shell/lib/notifications-model";
import {
  defaultPreferences,
  mergePreferences,
  parsePreferences,
} from "../src/shell/lib/settings-preferences";
import { showDesktopNotification } from "../src/shell/notifications/desktop";
import {
  digestNotification,
  digestSchedule,
  immediateDesktopNotification,
  notifyImmediately,
  summaryDesktopNotification,
} from "../src/shell/notifications/digest";
import { digestKey, readDigest, saveDigest } from "../src/shell/notifications/digest-store";
import {
  NotificationSessionProvider,
  useNotificationDigest,
  useNotifications,
} from "../src/shell/notifications/provider";
import { SummaryCard } from "../src/shell/notifications/summary-card";
import { NotificationSummarySettings } from "../src/shell/settings/notification-summary";
import { PreferencesProvider } from "../src/shell/settings/preferences";

const at = new Date("2026-11-11T12:15Z");
const n = (id: string, patch: Partial<SuiteNotification> = {}): SuiteNotification => ({
  id,
  kind: "shared",
  title: id,
  createdAt: new Date(at.getTime() - 1000),
  read: false,
  ...patch,
});
const preferences = mergePreferences(defaultPreferences, {
  summary: { mode: "hourly" },
  desktop: true,
});
let actions: ReturnType<typeof useNotifications>;
function Consumer() {
  actions = useNotifications();
  const digest = useNotificationDigest();
  return h(
    "main",
    null,
    h("p", { "data-testid": "digest", children: digest?.headline ?? "none" }),
    h(SummaryCard),
  );
}
const tree = (
  accountId: string,
  sources: Parameters<typeof NotificationSessionProvider>[0]["sources"],
  prefs = preferences,
) =>
  h(NotificationSessionProvider, { accountId, sources, preferences: prefs, children: h(Consumer) });
beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  vi.clearAllMocks();
  vi.stubGlobal("indexedDB", undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("adapts semantic source metadata and classifies delivery without changing the tray", () => {
  const rich = digestNotification(
    n("a", {
      category: "agent-approval",
      app: "agent",
      blocking: true,
      urgent: false,
      actor: { name: "Sam", webId: "https://sam.example/#me" },
      target: { id: "plan", title: "Plan" },
    }),
  );
  expect(rich).toMatchObject({
    app: "agent",
    actor: { id: "https://sam.example/#me", name: "Sam" },
    target: { id: "plan", title: "Plan" },
    blocking: true,
    urgent: false,
  });
  expect(digestNotification(n("a", { actor: { name: "Sam" } })).actor).toEqual({ name: "Sam" });
  for (const kind of [
    "shared",
    "access-request",
    "comment",
    "task",
    "sync-conflict",
    "storage",
    "system",
  ] as const)
    expect(digestNotification(n(kind, { kind })).app).toBeTruthy();
  expect(notifyImmediately(n("a"), preferences, at)).toBe(false);
  expect(notifyImmediately(n("a", { urgent: true }), preferences, at)).toBe(true);
  expect(
    notifyImmediately(n("a", { category: "direct-mention", kind: "comment" }), preferences, at),
  ).toBe(true);
  expect(
    notifyImmediately(
      n("a", { urgent: true }),
      mergePreferences(preferences, { desktop: false }),
      at,
    ),
  ).toBe(false);
  expect(
    notifyImmediately(
      n("a", { urgent: true }),
      mergePreferences(preferences, { summary: { urgentImmediately: false } }),
      at,
    ),
  ).toBe(false);
  expect(
    notifyImmediately(
      n("a", { urgent: true }),
      mergePreferences(preferences, { notifications: { shared: false } }),
      at,
    ),
  ).toBe(false);
  expect(
    notifyImmediately(
      n("a", { urgent: true }),
      mergePreferences(preferences, {
        quietHours: { enabled: true, start: "12:00", end: "13:00" },
      }),
      at,
    ),
  ).toBe(false);
  expect(
    notifyImmediately(n("a"), mergePreferences(preferences, { summary: { mode: "off" } }), at),
  ).toBe(true);
  expect(
    immediateDesktopNotification(
      n("a", { kind: "comment", title: "Private comment", body: "Private text" }),
    ),
  ).toMatchObject({ title: "You were mentioned in a comment" });
  expect(
    immediateDesktopNotification(n("a", { kind: "comment", body: "Private text" })),
  ).not.toHaveProperty("body");
  expect(immediateDesktopNotification(n("a")).title).toBe("a");
  expect(digestSchedule(defaultPreferences).mode).toBe("off");
  expect(
    digestSchedule(mergePreferences(preferences, { summary: { mode: "daily" } })),
  ).toMatchObject({ mode: "daily", time: "09:00" });
  expect(
    digestSchedule(mergePreferences(preferences, { summary: { mode: "twice-daily" } })),
  ).toMatchObject({ mode: "twice-daily", times: ["09:00", "17:00"] });
  expect(
    parsePreferences(
      '{"summary":{"mode":"bad","time":"25:00","secondTime":"bad","urgentImmediately":"yes"}}',
    ).summary,
  ).toEqual(defaultPreferences.summary);
  expect(mergePreferences(preferences, { summary: null }).summary).toEqual(preferences.summary);
});
it("stores only valid per-account snapshots and survives unavailable local storage", () => {
  const digest = buildDigest([digestNotification(n("a"))], { since: 0, now: at.getTime() });
  saveDigest("store-a", digest);
  expect(readDigest("store-a")).toEqual(digest);
  expect(readDigest("store-b")).toBeNull();
  localStorage.setItem(digestKey("invalid"), "{}");
  expect(readDigest("invalid")).toBeNull();
  localStorage.setItem(digestKey("invalid"), "{");
  expect(readDigest("invalid")).toBeNull();
  localStorage.removeItem(digestKey("store-a"));
  expect(readDigest("store-a")).toBeNull();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  saveDigest("store-fallback", digest);
  expect(readDigest("store-fallback")).toEqual(digest);
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDigest("store-fallback")).toEqual(digest);
  expect(readDigest("other")).toBeNull();
  expect(summaryDesktopNotification(digest)).toMatchObject({
    title: "Your summary is ready",
    href: "/notifications",
  });
});
it("delivers one summary, suppresses ordinary pings, allows urgent ones and marks only summary items read", async () => {
  let items = [n("initial")];
  const markRead = vi.fn(async () => {});
  const sources = [{ id: "fixture", list: async () => items, markRead }];
  render(tree("flow", sources));
  await act(async () => {});
  expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  const card = within(screen.getByRole("region", { name: "Summary" }));
  expect(card.getByRole("link", { name: "initial" }).getAttribute("href")).toBe(
    "#notification-initial",
  );
  vi.setSystemTime(new Date("2026-11-11T12:20Z"));
  items = [
    ...items,
    n("later", { createdAt: new Date("2026-11-11T12:19Z") }),
    n("urgent", { urgent: true, createdAt: new Date("2026-11-11T12:19Z") }),
  ];
  await act(async () => actions.refresh());
  expect(showDesktopNotification).toHaveBeenCalledTimes(2);
  expect(vi.mocked(showDesktopNotification).mock.calls[1]?.[0].id).toBe("urgent");
  fireEvent.click(card.getByRole("button", { name: "Mark all as read" }));
  await act(async () => {});
  expect(actions.items.find((i) => i.id === "initial")?.read).toBe(true);
  expect(actions.items.find((i) => i.id === "later")?.read).toBe(false);
  expect(markRead).toHaveBeenCalledWith(["initial"]);
  vi.setSystemTime(new Date("2026-11-11T13:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(showDesktopNotification).toHaveBeenCalledTimes(3);
  expect(screen.getByTestId("digest").textContent).not.toContain("initial");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(showDesktopNotification).toHaveBeenCalledTimes(3);
});
it("resumes a saved digest without another ping and hides it when switched off", async () => {
  const sources = [{ id: "s", list: async () => [n("saved")] }];
  const view = render(tree("resume", sources));
  await act(async () => {});
  view.unmount();
  render(tree("resume", sources));
  await act(async () => {});
  expect(showDesktopNotification).toHaveBeenCalledTimes(1);
  cleanup();
  render(tree("resume", sources, defaultPreferences));
  await act(async () => {});
  expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
});
it("waits through quiet hours, fences unmount and does not publish failed/empty sources", async () => {
  const sources = [{ id: "s", list: async () => [n("quiet")] }];
  const quiet = mergePreferences(preferences, {
    quietHours: { enabled: true, start: "12:00", end: "13:00" },
  });
  const view = render(tree("quiet", sources, quiet));
  await act(async () => {});
  expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  vi.setSystemTime(new Date("2026-11-11T13:00Z"));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  view.unmount();
  vi.setSystemTime(new Date("2026-11-11T14:00Z"));
  window.dispatchEvent(new Event("focus"));
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  const failed = render(
    tree("failed", [
      {
        id: "f",
        list: async () => {
          throw new Error("offline");
        },
      },
    ]),
  );
  await act(async () => {});
  expect(readDigest("failed")).toBeNull();
  failed.unmount();
  render(tree("empty", [{ id: "e", list: async () => [] }]));
  await act(async () => {});
  expect(readDigest("empty")?.count).toBe(0);
  expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
});
it("persists summary schedule, times and the urgent toggle through the existing preferences provider", async () => {
  vi.stubGlobal("HTMLSelectElement", window.HTMLSelectElement);
  vi.stubGlobal("HTMLOptionElement", window.HTMLOptionElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  render(h(PreferencesProvider, { children: h(NotificationSummarySettings) }));
  fireEvent(
    screen.getByRole("combobox", { name: "Summary schedule" }),
    Object.assign(new MouseEvent("pointerdown", { bubbles: true, button: 0 }), {
      pointerType: "mouse",
    }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Twice a day" }));
  fireEvent.change(screen.getByLabelText("Summary time"), { target: { value: "08:30" } });
  fireEvent.change(screen.getByLabelText("Second summary time"), { target: { value: "18:00" } });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Deliver urgent notifications immediately" }),
  );
  const saved = parsePreferences(localStorage.getItem("suite.prefs.v1.digest-settings"));
  expect(saved.summary).toEqual({
    mode: "twice-daily",
    time: "08:30",
    secondTime: "18:00",
    urgentImmediately: false,
  });
});

it("keeps demo event times stable per account across reloads", () => {
  expect(demoNotificationDate("clock", at)).toEqual(at);
  expect(demoNotificationDate("clock", new Date(at.getTime() + 1000))).toEqual(at);
  expect(demoNotificationDate("clock-other", new Date(at.getTime() + 1000))).toEqual(
    new Date(at.getTime() + 1000),
  );
  localStorage.setItem("suite.notification-demo-clock.v1.clock", "invalid");
  expect(demoNotificationDate("clock", at)).toEqual(at);
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(demoNotificationDate("blocked", at)).toEqual(at);
});
