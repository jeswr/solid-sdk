// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { buildDigest } from "@jeswr/suite-sdk/digest";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred, h } from "./drive-ui-dom";

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

import type { SuiteNotification } from "../src/shell/lib/notifications-model";
import {
  defaultPreferences,
  mergePreferences,
  parsePreferences,
} from "../src/shell/lib/settings-preferences";
import { demoNotificationDate } from "../src/shell/notifications/demo-digest";
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
import { SummaryCard, summaryItems } from "../src/shell/notifications/summary-card";
import { DIGEST_RETRY_MS } from "../src/shell/notifications/use-digest";
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
  const stored = saveDigest("store-a", digest);
  expect(readDigest("store-a")).toEqual(stored);
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
  expect(readDigest("store-fallback")).toEqual(stored);
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDigest("store-fallback")).toEqual(stored);
  expect(readDigest("other")).toBeNull();
  expect(summaryDesktopNotification(digest, "store-a")).toMatchObject({
    id: "summary-store-a",
    title: "Your summary is ready",
    href: "/notifications",
  });
});
it("keeps the latest failed save ahead of stale storage, bounds receipts and stores only card fields", () => {
  const first = buildDigest([digestNotification(n("old"))], {
    since: 0,
    now: at.getTime() - 3600000,
  });
  saveDigest("stale-store", first);
  const latest = buildDigest(
    Array.from({ length: 600 }, (_, i) =>
      digestNotification(n(`large-${i}`, { title: "Same group" })),
    ),
    { since: 0, now: at.getTime() },
  );
  const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const stored = saveDigest("stale-store", latest);
  expect(readDigest("stale-store")).toEqual(stored);
  expect(stored.digestedIds).toHaveLength(500);
  expect(stored.sections[0]?.items[0]?.notificationIds).toHaveLength(20);
  expect(Object.keys(stored).sort()).toEqual([
    "count",
    "digestedIds",
    "headline",
    "now",
    "omitted",
    "sections",
  ]);
  expect(Object.keys(stored.sections[0]?.items[0] ?? {}).sort()).toEqual([
    "id",
    "key",
    "notificationIds",
    "text",
  ]);
  expect(summaryDesktopNotification(latest, "stale-store").id).toBe(
    summaryDesktopNotification(first, "stale-store").id,
  );
  expect(summaryDesktopNotification(latest, "another-account").id).not.toBe(
    summaryDesktopNotification(latest, "stale-store").id,
  );
  set.mockRestore();
  saveDigest("stale-store", latest);
  expect(JSON.parse(localStorage.getItem(digestKey("stale-store")) ?? "null")).toEqual(stored);
  const { digestedIds: _ids, ...legacy } = latest;
  localStorage.setItem(digestKey("legacy"), JSON.stringify(legacy));
  expect(readDigest("legacy")?.digestedIds).toHaveLength(100);
  expect(readDigest("legacy")?.sections[0]?.items[0]?.notificationIds).toHaveLength(20);
});
it("does not repeat a delivery on timer ticks after a failed save over an existing snapshot", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(at);
  saveDigest("failed-save", buildDigest([], { since: 0, now: at.getTime() - 3600000 }));
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  render(tree("failed-save", [{ id: "s", list: async () => [n("new")] }]));
  await act(async () => {});
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  // A stable per-account tag replaces the previous summary; renotify keeps it audible.
  expect(showDesktopNotification).toHaveBeenCalledWith(
    expect.objectContaining({ id: "summary-failed-save" }),
    { renotify: true },
  );
  await act(async () => vi.advanceTimersByTimeAsync(90000));
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  expect(readDigest("failed-save")?.now).toBe(at.getTime());
});
it("refreshes while polling is paused in a hidden tab and includes later-loaded old items by id", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(at);
  let items = [n("initial")];
  const list = vi.fn(async () => items);
  render(tree("hidden", [{ id: "s", list }]));
  await act(async () => {});
  expect(readDigest("hidden")?.digestedIds).toContain("initial");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  // The second item predates the first delivery but was unavailable until this listing.
  items = [...items, n("late", { createdAt: new Date(at.getTime() - 7200000) })];
  list.mockClear();
  vi.setSystemTime(new Date("2026-11-11T12:59:30Z"));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(list).toHaveBeenCalledOnce();
  expect(readDigest("hidden")?.count).toBe(1);
  expect(readDigest("hidden")?.headline).toContain("late");
  expect(readDigest("hidden")?.headline).not.toContain("initial");
  const card = within(screen.getByRole("region", { name: "Summary" }));
  expect(card.getByRole("link", { name: "late" }).getAttribute("href")).toBe("#notification-late");
  fireEvent.click(card.getByRole("button", { name: "Mark all as read" }));
  await act(async () => {});
  expect(actions.items.find((item) => item.id === "late")?.read).toBe(true);
  expect(actions.items.find((item) => item.id === "initial")?.read).toBe(false);
  expect(showDesktopNotification).toHaveBeenCalledTimes(2);
});
it("waits for a successful fresh core listing and fences pending refreshes on unmount", async () => {
  const late = deferred<SuiteNotification[]>();
  const list = vi.fn().mockReturnValueOnce(late.promise);
  const view = render(tree("pending", [{ id: "s", list }]));
  await act(async () => {});
  expect(list).toHaveBeenCalledOnce();
  expect(readDigest("pending")).toBeNull();
  expect(showDesktopNotification).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => late.resolve([n("stale-session")]));
  expect(readDigest("pending")).toBeNull();
  const failed = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([n("recovered")]);
  render(tree("refresh-failure", [{ id: "s", list: failed }]));
  await act(async () => {});
  expect(readDigest("refresh-failure")).toBeNull();
  // The failed listing backs off our own retries; a wake after the back-off recovers.
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(failed).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date(at.getTime() + DIGEST_RETRY_MS));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(readDigest("refresh-failure")?.headline).toContain("recovered");
  expect(showDesktopNotification).toHaveBeenCalledOnce();
});
it("delivers from a completed poll without a second refresh", async () => {
  let items = [n("polled")];
  const list = vi.fn(async () => items);
  render(tree("poll", [{ id: "s", list }]));
  await act(async () => {});
  expect(list).toHaveBeenCalledOnce();
  expect(readDigest("poll")?.headline).toContain("polled");
  items = [...items, n("next", { createdAt: new Date("2026-11-11T12:59Z") })];
  vi.setSystemTime(new Date("2026-11-11T13:00Z"));
  // Stands in for the scheduler's poll: its completion is the digest's fresh listing.
  await act(async () => actions.refresh());
  expect(list).toHaveBeenCalledTimes(2);
  expect(readDigest("poll")?.headline).toContain("next");
  expect(showDesktopNotification).toHaveBeenCalledTimes(2);
});
it("backs off after a failed listing, retries hidden tabs only on the timer, and recovers", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(at);
  const list = vi.fn(async (): Promise<SuiteNotification[]> => {
    throw new Error("offline");
  });
  render(tree("outage", [{ id: "s", list }]));
  await act(async () => {});
  expect(list).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(list).toHaveBeenCalledOnce();
  // Hidden: polling pauses, wakes are ignored and the 30 s timer waits out the back-off.
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(DIGEST_RETRY_MS - 30_000));
  expect(list).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => vi.advanceTimersByTimeAsync(DIGEST_RETRY_MS - 30_000));
  expect(list).toHaveBeenCalledTimes(2);
  list.mockResolvedValue([n("back")]);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(list).toHaveBeenCalledTimes(3);
  expect(readDigest("outage")?.headline).toContain("back");
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(DIGEST_RETRY_MS));
  expect(list).toHaveBeenCalledTimes(3);
});
it("a successful poll ends the back-off at once", async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([n("polled-back")]);
  render(tree("poll-recovers", [{ id: "s", list }]));
  await act(async () => {});
  expect(readDigest("poll-recovers")).toBeNull();
  await act(async () => actions.refresh());
  expect(list).toHaveBeenCalledTimes(2);
  expect(readDigest("poll-recovers")?.headline).toContain("polled-back");
});
it("does not deliver a superseded refresh or refresh concurrently on repeated wakes", async () => {
  const stale = deferred<SuiteNotification[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce([n("cached")])
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue([n("fresh")]);
  render(tree("superseded", [{ id: "s", list }]));
  await act(async () => {});
  expect(readDigest("superseded")?.headline).toContain("cached");
  vi.setSystemTime(new Date("2026-11-11T13:00Z"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(list).toHaveBeenCalledTimes(2);
  // This listing completes while the digest's own refresh is pending, so it is not used.
  await act(async () => actions.refresh());
  await act(async () => stale.resolve([n("stale")]));
  expect(readDigest("superseded")?.headline).toContain("cached");
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(readDigest("superseded")?.headline).toContain("fresh");
  expect(showDesktopNotification).toHaveBeenCalledTimes(2);
});
it("marks every live item in a large group read, even beyond the stored id cap", async () => {
  let items = Array.from({ length: 30 }, (_, i) => n(`big-${i}`, { title: "Big group" }));
  const markRead = vi.fn(async (_ids: readonly string[]) => {});
  render(tree("big-group", [{ id: "s", list: async () => items, markRead }]));
  await act(async () => {});
  const stored = readDigest("big-group");
  expect(stored?.sections[0]?.items[0]?.notificationIds).toHaveLength(20);
  // A later item in the same group is not in the digest's receipts.
  items = [...items, n("big-later", { title: "Big group" })];
  await act(async () => actions.refresh());
  const card = within(screen.getByRole("region", { name: "Summary" }));
  fireEvent.click(card.getByRole("button", { name: "Mark all as read" }));
  await act(async () => {});
  expect(actions.items.filter((item) => item.id.startsWith("big-") && item.read)).toHaveLength(30);
  expect(actions.items.find((item) => item.id === "big-later")?.read).toBe(false);
  expect(markRead).toHaveBeenCalledWith(expect.arrayContaining(["big-0", "big-29"]));
  expect(markRead.mock.calls[0]?.[0]).toHaveLength(30);
});
it("matches legacy snapshots without group keys by their stored ids", () => {
  const digest = saveDigest(
    "legacy-card",
    buildDigest([digestNotification(n("a")), digestNotification(n("b"))], {
      since: 0,
      now: at.getTime(),
    }),
  );
  const legacy = {
    ...digest,
    sections: digest.sections.map((section) => ({
      ...section,
      items: section.items.map(({ key: _key, ...item }) => item),
    })),
  };
  expect(summaryItems(legacy, [n("a"), n("b"), n("c")]).map((item) => item.id)).toEqual(["a", "b"]);
  expect(summaryItems(digest, [n("a"), n("c")]).map((item) => item.id)).toEqual(["a"]);
});
it("ignores optional agent failures and read-save errors when delivering fresh core notifications", async () => {
  let items = [n("pending-read")];
  const sources = [
    {
      id: "inbox",
      list: async () => items,
      markRead: async () => {
        throw new Error("offline");
      },
    },
    {
      id: "agent",
      optional: true,
      list: async () => {
        throw new Error("Workspace storage URL mismatch");
      },
    },
  ];
  render(tree("optional", sources));
  await act(async () => {});
  expect(actions.error).toBeNull();
  expect(readDigest("optional")?.count).toBe(1);
  expect(showDesktopNotification).toHaveBeenCalledOnce();
  await act(async () => actions.markRead("pending-read"));
  expect(actions.error).toContain("Couldn't save");
  items = [...items, n("unread-later")];
  vi.setSystemTime(new Date("2026-11-11T13:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(actions.error).toContain("Couldn't save");
  expect(readDigest("optional")?.headline).toContain("unread-later");
  expect(showDesktopNotification).toHaveBeenCalledTimes(2);
});
it("enabling summaries for read history creates a card without a desktop pop-up", async () => {
  const sources = [{ id: "s", list: async () => [n("history", { read: true })] }];
  const view = render(tree("history", sources, defaultPreferences));
  await act(async () => {});
  view.rerender(tree("history", sources));
  await act(async () => {});
  expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
  expect(readDigest("history")?.count).toBe(1);
  expect(showDesktopNotification).not.toHaveBeenCalled();
});
it("recovers from a future delivery time while retaining the account's existing receipts", async () => {
  saveDigest(
    "clock-rollback",
    buildDigest([digestNotification(n("prior"))], { since: 0, now: at.getTime() + 86400000 }),
  );
  render(
    tree("clock-rollback", [{ id: "s", list: async () => [n("prior"), n("new-after-rollback")] }]),
  );
  await act(async () => {});
  expect(readDigest("clock-rollback")?.now).toBe(at.getTime());
  expect(readDigest("clock-rollback")?.count).toBe(1);
  expect(readDigest("clock-rollback")?.headline).toContain("new-after-rollback");
  expect(showDesktopNotification).toHaveBeenCalledOnce();
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
