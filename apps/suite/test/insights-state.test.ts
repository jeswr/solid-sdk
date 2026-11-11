// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it, vi } from "vitest";
import { availableSeries, weekComparison } from "../src/apps/insights/lib/presentation";
import type { Source } from "../src/apps/insights/lib/sources";
import { createInsightsStore } from "../src/apps/insights/state/store";
import type { PodSession } from "../src/lib/session/pod-session";

const session = {
  mode: "demo",
  webId: "https://a.test/#me",
  storageUrl: "https://a.test/",
  fetch: vi.fn(),
  displayName: "Fictional",
  subscribe: () => () => {},
  reset: async () => {},
} satisfies PodSession;
const now = new Date("2026-11-11T12:00:00Z");
const source = (status: Source["status"]): Source => ({
  id: "s",
  label: "S",
  status,
  days: 0,
  series: [],
});
describe("Insights state", () => {
  it("publishes loading and ready snapshots, notifies and unsubscribes", async () => {
    const load = vi.fn().mockResolvedValue([source("found")]);
    const seed = vi.fn().mockResolvedValue(undefined);
    const store = createInsightsStore(session, "UTC", { load, seed, now: () => now });
    const notify = vi.fn();
    const off = store.subscribe(notify);
    expect(store.getSnapshot().status).toBe("loading");
    const pending = store.refresh();
    expect(store.getSnapshot().refreshing).toBe(true);
    await pending;
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      sources: [source("found")],
      refreshing: false,
      now,
    });
    expect(load).toHaveBeenCalledWith({ session, now, timeZone: "UTC" });
    expect(seed).toHaveBeenCalledWith(session, now);
    expect(notify).toHaveBeenCalledTimes(2);
    off();
    await store.refresh();
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("keeps empty or partial results usable and treats complete failure as an error", async () => {
    const load = vi.fn().mockResolvedValue([source("error"), source("unavailable")]);
    const store = createInsightsStore(session, "UTC", {
      load,
      seed: async () => {},
      now: () => now,
    });
    await store.refresh();
    expect(store.getSnapshot().status).toBe("error");
    load.mockResolvedValue([source("empty"), source("error")]);
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
    load.mockResolvedValue([]);
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
    load.mockRejectedValue(new Error("denied"));
    await store.refresh();
    expect(store.getSnapshot().sources).toEqual([]);
    expect(store.getSnapshot().status).toBe("error");
  });
  it("discards older reads, failures and cancelled sessions", async () => {
    let resolveFirst: (value: Source[]) => void = () => {};
    let rejectFirst: (error: Error) => void = () => {};
    const first = new Promise<Source[]>((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    const load = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue([source("empty")]);
    const store = createInsightsStore(session, "UTC", {
      load,
      seed: async () => {},
      now: () => now,
    });
    const old = store.refresh();
    await Promise.resolve();
    await store.refresh();
    resolveFirst([source("found")]);
    await old;
    expect(store.getSnapshot().sources).toEqual([source("empty")]);
    const rejected = new Promise<Source[]>((_resolve, reject) => {
      rejectFirst = reject;
    });
    load.mockReturnValueOnce(rejected);
    const pending = store.refresh();
    await Promise.resolve();
    store.cancel();
    rejectFirst(new Error("late"));
    await pending;
    expect(store.getSnapshot().status).toBe("ready");
  });
  it("captures demo-seed failures and supports retry", async () => {
    const seed = vi
      .fn()
      .mockRejectedValueOnce(new Error("seed failed"))
      .mockResolvedValue(undefined);
    const store = createInsightsStore(session, "UTC", {
      load: async () => [],
      seed,
      now: () => now,
    });
    await store.refresh();
    expect(store.getSnapshot().status).toBe("error");
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
    const live = createInsightsStore(session, "UTC");
    expect(live.getSnapshot().now).toBeInstanceOf(Date);
  });
});
describe("presentation", () => {
  const series = {
    id: "s",
    label: "S",
    unit: "u",
    aggregation: "sum" as const,
    points: [
      { at: "2026-11-02", value: 2 },
      { at: "2026-11-03", value: 4 },
      { at: "2026-11-09", value: 4 },
      { at: "2026-11-10", value: 8 },
      { at: "2026-11-11", value: 100 },
    ],
  };
  it("compares the same elapsed weekdays, excludes today and computes raw-unit deltas", () => {
    expect(weekComparison(series, now, "UTC")).toEqual({
      value: 6,
      previous: 3,
      delta: 3,
      days: 2,
      previousDays: 2,
      elapsed: 2,
    });
    expect(weekComparison(series, new Date("2026-11-09T12:00:00Z"), "UTC").value).toBeNull();
    expect(weekComparison({ ...series, points: [] }, now, "UTC").delta).toBeNull();
    expect(
      weekComparison({ ...series, points: [{ at: "2026-11-10", value: 1 }] }, now, "UTC").delta,
    ).toBeNull();
  });
  it("only offers series with real measurements", () => {
    expect(
      availableSeries([{ series: [series, { ...series, points: [] }] }, { series: [] }]),
    ).toEqual([series]);
  });
});
