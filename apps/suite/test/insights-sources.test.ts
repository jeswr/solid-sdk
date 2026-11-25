// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
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
vi.mock("@/apps/health/lib/data/store", () => ({
  createHealthDataStore: () => ({ base: "https://insights.test/health/" }),
}));
vi.mock("@/apps/insights/sources/adapters/money", () => ({
  readMoneyTransactions: mock.money,
}));
vi.mock("@/apps/music/lib/data/history", () => ({ loadHistory: mock.music }));
vi.mock("@/apps/tasks/lib/model/store", () => ({
  TaskStore: class {
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
  it("requests the overlapping months from Music and counts each playback identity once", async () => {
    mock.music.mockResolvedValue([
      { iri: "one", startTime: now },
      { iri: "two", startTime: new Date(now.getTime() - 30000) },
      { iri: "one", startTime: now },
    ]);
    const result = await musicSource.read(context);
    expect(result[0]?.points.map((p) => p.value)).toEqual([1, 1]);
    expect(mock.music).toHaveBeenCalledWith(session.fetch, session.storageUrl, now, 6);
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
  it("propagates denied, stale, or corrupt task resources", async () => {
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
  it("queries across civil date boundaries and retains only the intended local days", async () => {
    const now = new Date("2026-11-30T12:30:00Z");
    mock.range.mockImplementation((_session, _calendars, from: Date, to: Date) => ({
      warnings: [],
      events: ["2026-07-04", "2026-07-05", "2026-12-01", "2026-12-01T12:00:00Z"]
        .filter((day) => new Date(day) >= from && new Date(day) <= to)
        .map((start) => ({ data: { start } })),
    }));
    const [calendar] = await loadSources({ session, now, timeZone: "Pacific/Auckland" }, [
      calendarSource,
    ]);
    expect(calendar?.series[0]?.points).toEqual([
      { at: "2026-07-05", value: 1 },
      { at: "2026-12-01", value: 1 },
    ]);
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
  it("bounds a stalled source, cancels both transports, and publishes completed sources", async () => {
    vi.useFakeTimers();
    try {
      const late = Promise.withResolvers<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>((input) =>
        String(input).endsWith("/fast") ? Promise.resolve(new Response()) : new Promise(() => {}),
      );
      fetch.mockImplementationOnce(() => late.promise);
      const publicFetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
      const read = vi.fn(async ({ session, signal }: Parameters<typeof loadSources>[0]) => {
        if (session.mode !== "solid") throw new Error("Expected a Solid session");
        await Promise.all([
          session.fetch(session.storageUrl),
          session.fetch(new Request(session.storageUrl)),
          session.publicFetch(session.webId, { signal: signal ?? null }),
        ]);
        return [];
      });
      const fast = {
        id: "fast",
        label: "Fast",
        read: async ({ session }: Parameters<typeof loadSources>[0]) => {
          await session.fetch(`${session.storageUrl}fast`);
          return [
            {
              id: "s",
              label: "S",
              unit: "u",
              aggregation: "sum" as const,
              points: [{ at: now, value: 1 }],
            },
          ];
        },
      };
      const load = loadSources(
        { ...context, session: { ...session, mode: "solid", fetch, publicFetch } },
        [{ id: "stalled", label: "Stalled", read }, fast],
      );
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(publicFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await load).map(({ status }) => status)).toEqual(["error", "found", "unavailable"]);
      for (const [, init] of [...fetch.mock.calls, ...publicFetch.mock.calls])
        expect(init?.signal?.aborted).toBe(true);
      const cancel = vi.fn(() => Promise.reject(new Error("Transport already closed")));
      late.resolve(new Response(new ReadableStream({ cancel })));
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
      const timedOutSession = read.mock.calls[0]?.[0].session;
      await expect(timedOutSession?.fetch(session.storageUrl)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
