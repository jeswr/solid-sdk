// AUTHORED-BY Codex (GPT-6.1 Sol)
import { buildTask, Task, taskSubject } from "@jeswr/solid-task-model";
import { DataFactory } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  health: vi.fn(),
  money: vi.fn(),
  music: vi.fn(),
  projects: vi.fn(),
  tasks: vi.fn(),
  discover: vi.fn(),
  range: vi.fn(),
}));
vi.mock("@/apps/health/lib/data/metrics", () => ({ loadMeasurements: mock.health }));
vi.mock("@/apps/health/lib/data/store", () => ({ createHealthDataStore: vi.fn() }));
vi.mock("@/apps/money/lib/data/container", async (original) => ({
  ...(await original<typeof import("../src/apps/money/lib/data/container")>()),
  storeOf: () => ({
    accounts: async () => [{ id: "account", balance: { currency: "GBP" } }],
    transactions: mock.money,
  }),
}));
vi.mock("@/apps/music/lib/model/io", () => ({ loadHistory: mock.music }));
vi.mock("@/apps/tasks/lib/model/store", () => ({
  TaskStore: class {
    projects = "https://insights.test/tasks/projects/";
    listProjects = mock.projects;
    listTasks = mock.tasks;
  },
}));
vi.mock("@/apps/calendar/state/repository", () => ({
  discoverCalendars: mock.discover,
  loadRange: mock.range,
}));

import {
  adapters,
  calendarSource,
  healthSource,
  loadSources,
  moneySource,
  musicSource,
  tasksSource,
} from "../src/apps/insights/lib/sources";
import { ModelError } from "../src/apps/tasks/lib/model/errors";
import type { PodSession } from "../src/lib/session/pod-session";

const now = new Date("2026-11-11T15:00:00Z");
const session = {
  mode: "demo",
  displayName: "Fictional",
  webId: "https://insights.test/profile#me",
  storageUrl: "https://insights.test/",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: async () => {},
} satisfies PodSession;
const context = { session, now, timeZone: "Europe/London" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.health.mockResolvedValue([]);
  mock.money.mockResolvedValue([]);
  mock.music.mockResolvedValue([]);
  mock.projects.mockResolvedValue([]);
  mock.tasks.mockResolvedValue([]);
  mock.discover.mockResolvedValue({ calendars: [], warnings: [] });
  mock.range.mockResolvedValue({ events: [], warnings: [] });
});
describe("source adapters", () => {
  it("declares health aggregations and converts sleep seconds to minutes", async () => {
    mock.health.mockResolvedValue([
      { kind: "steps", value: 8500, at: now },
      { kind: "sleep", value: 25200, at: now },
      { kind: "heartRate", value: 60, at: now },
    ]);
    const result = await healthSource.read(context);
    expect(result.map((s) => [s.id, s.unit, s.aggregation])).toEqual([
      ["health.steps", "steps", "sum"],
      ["health.sleep", "min", "sum"],
      ["health.heartRate", "bpm", "mean"],
      ["health.weight", "kg", "last"],
    ]);
    expect(result[1]?.points[0]?.value).toBe(420);
    expect(result[2]?.label).toBe("Heart rate");
    expect(mock.health.mock.calls[0]?.[1].start < now).toBe(true);
  });
  it("keeps currencies apart and excludes income, transfers and invalid amounts", async () => {
    mock.money.mockResolvedValue([
      { postingTime: "2026-11-01", amount: "-12.50", currency: "GBP" },
      { postingTime: "2026-11-01", amount: "50", currency: "GBP" },
      { postingTime: "2026-11-02", amount: "-8", currency: "EUR" },
      { postingTime: "2026-11-02", amount: "-9", currency: "EUR", debitAccount: "from" },
      { postingTime: "2026-11-02", amount: "-9", currency: "EUR", creditAccount: "to" },
      { postingTime: "2026-11-02", amount: "oops", currency: "GBP" },
    ]);
    const result = await moneySource.read(context);
    expect(result.map((s) => s.unit)).toEqual(["EUR", "GBP"]);
    expect(result[0]?.points).toEqual([{ at: "2026-11-02", value: 8 }]);
    expect(result[1]?.points).toEqual([{ at: "2026-11-01", value: 12.5 }]);
  });
  it("reads explicit month shards, de-duplicates playback identity in the shared reader, and counts listens", async () => {
    mock.music.mockResolvedValue([
      { startTime: now },
      { startTime: new Date(now.getTime() - 30000) },
    ]);
    const result = await musicSource.read(context);
    expect(result[0]?.points.map((p) => p.value)).toEqual([1, 1]);
    expect(mock.music.mock.calls[0]?.[1]).toBe("https://insights.test/music/");
    expect(mock.music.mock.calls[0]?.[2].every((d: Date) => d.getUTCDate() === 1)).toBe(true);
  });
  it("counts only completed tasks with a completion date, once per document", async () => {
    mock.projects.mockResolvedValue([
      { tracker: {} },
      { tracker: { stateStore: "https://insights.test/tasks/a/" } },
      { tracker: { stateStore: "https://insights.test/tasks/b/" } },
    ]);
    const closed = {
      url: "https://insights.test/tasks/a/closed.ttl",
      dataset: buildTask("https://insights.test/tasks/a/closed.ttl", {
        title: "Fictional task",
        state: "closed",
        endedAt: now,
      }),
    };
    const undatedUrl = "https://insights.test/undated.ttl";
    const undated = buildTask(undatedUrl, { title: "Undated", state: "closed" });
    new Task(taskSubject(undatedUrl), undated, DataFactory).endedAt = undefined;
    mock.tasks.mockResolvedValue([
      closed,
      {
        url: "https://insights.test/open.ttl",
        dataset: buildTask("https://insights.test/open.ttl", { title: "Open", state: "open" }),
      },
      {
        url: "https://insights.test/undated.ttl",
        dataset: undated,
      },
      {
        url: "https://insights.test/non-task.ttl",
        dataset: buildTask("https://insights.test/other.ttl", {
          title: "Other subject",
          state: "open",
        }),
      },
    ]);
    const result = await tasksSource.read(context);
    expect(result[0]?.points).toEqual([{ at: now, value: 1 }]);
    expect(mock.tasks).toHaveBeenCalledTimes(2);
  });
  it("maps absent Tasks to empty and propagates denied or corrupt resources", async () => {
    mock.projects.mockRejectedValue(new ModelError(404, "https://insights.test/tasks/projects/"));
    expect((await tasksSource.read(context))[0]?.points).toEqual([]);
    mock.projects.mockRejectedValue(new ModelError(403, "https://insights.test/tasks/projects/"));
    await expect(tasksSource.read(context)).rejects.toThrow();
    mock.projects.mockRejectedValue(new ModelError(404, "https://insights.test/a-task.ttl"));
    await expect(tasksSource.read(context)).rejects.toThrow();
    mock.projects.mockRejectedValue(new Error("broken"));
    await expect(tasksSource.read(context)).rejects.toThrow();
  });
  it("reads expanded calendar occurrences and treats partial warnings as an error", async () => {
    mock.range.mockResolvedValue({
      events: [{ data: { start: "2026-11-01" } }, { data: { start: now } }],
      warnings: [],
    });
    expect((await calendarSource.read(context))[0]?.points).toEqual([
      { at: "2026-11-01", value: 1 },
      { at: now, value: 1 },
    ]);
    mock.range.mockResolvedValue({ events: [], warnings: [{}] });
    await expect(calendarSource.read(context)).rejects.toThrow("events");
    mock.discover.mockResolvedValue({ calendars: [], warnings: [{}] });
    await expect(calendarSource.read(context)).rejects.toThrow("calendars");
  });
  it("isolates failures, filters date bounds/non-finite values and counts distinct local days", async () => {
    const reader = {
      id: "sample",
      label: "Sample",
      read: vi.fn().mockResolvedValue([
        {
          id: "s",
          label: "S",
          unit: "u",
          aggregation: "sum",
          points: [
            { at: now, value: 0 },
            { at: now, value: 2 },
            { at: "2020-01-01", value: 2 },
            { at: "2027-01-01", value: 2 },
            { at: now, value: Number.NaN },
            { at: "invalid timestamp", value: 3 },
            { at: "2026-02-30", value: 3 },
          ],
        },
      ]),
    };
    const result = await loadSources(context, [
      reader,
      {
        id: "denied",
        label: "Denied",
        read: async () => {
          throw new Error("secret pod URL");
        },
      },
      { id: "empty", label: "Empty", read: async () => [] },
    ]);
    expect(result.map((r) => [r.status, r.days])).toEqual([
      ["found", 1],
      ["error", 0],
      ["empty", 0],
      ["unavailable", 0],
    ]);
    expect(result[0]?.series[0]?.points).toHaveLength(2);
    expect(result[0]?.droppedPoints).toBe(3);
    expect(JSON.stringify(result)).not.toContain("secret pod URL");
    expect(session.fetch).not.toHaveBeenCalled();
  });
  it("has every shipped adapter and leaves mood explicitly unavailable", async () => {
    expect(adapters.map((a) => a.id)).toEqual(["health", "money", "music", "tasks", "calendar"]);
    expect((await loadSources(context)).map((s) => s.status)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "unavailable",
    ]);
  });
});
