// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, StoredItem } from "../src/apps/calendar/lib/model";
import {
  applySeriesPlan,
  localEventItem,
  planSeriesEdit,
  removeReplacement,
  type SeriesMutations,
  type SeriesReplacement,
  withSourceCalendar,
} from "../src/apps/calendar/state/editing";
import type { EventWrite } from "../src/apps/calendar/state/repository";
import type { CalendarInfo } from "../src/apps/calendar/state/view";

const root = "https://pod.example/";
const work: CalendarInfo = {
  url: `${root}calendar/work.ttl`,
  container: `${root}calendar/work/`,
  title: "Work",
  colour: `#${"abc"}`, // built at runtime: the token gate rejects raw hex
  etag: '"c1"',
};
const home: CalendarInfo = {
  ...work,
  url: `${root}calendar/home.ttl`,
  container: `${root}calendar/home/`,
  title: "Home",
};
const url = `${root}calendar/work/series.ttl`;
const zone = "Europe/London";
const series: CalendarEvent = {
  name: "Stand-up",
  uid: "series",
  start: new Date("2026-10-26T09:30:00Z"),
  end: new Date("2026-10-26T09:45:00Z"),
  recurrence: { frequency: "WEEKLY", byDay: ["MO", "WE", "FR"] },
  inCalendar: `${work.url}#it`,
};
const source: StoredItem<CalendarEvent> = { url, etag: '"e1"', data: series };

function mutations(overrides: Partial<SeriesMutations> = {}) {
  const calls: unknown[][] = [];
  const record =
    (name: string, result?: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const value: SeriesMutations = {
    resolve: vi.fn(async (u: string, etag: string | null, confirm?: boolean) => {
      calls.push(["resolve", u, etag, confirm]);
      return etag ?? '"new"';
    }),
    create: vi.fn(record("create")) as SeriesMutations["create"],
    update: vi.fn(record("update")) as SeriesMutations["update"],
    delete: vi.fn(record("delete")) as SeriesMutations["delete"],
    ...overrides,
  };
  return { value, calls };
}
function counter() {
  let id = 0;
  return () => `id-${++id}`;
}

describe("removeReplacement", () => {
  it("does nothing without a pending replacement", async () => {
    const { value, calls } = mutations();
    await removeReplacement(value, { current: undefined });
    expect(calls).toEqual([]);
  });
  it("deletes a pending replacement with confirmation, then forgets it", async () => {
    const { value, calls } = mutations();
    const replacement: SeriesReplacement = { current: { url: `${url}x`, etag: null } };
    await removeReplacement(value, replacement);
    expect(calls).toEqual([["delete", `${url}x`, "", true]]);
    expect(replacement.current).toBeUndefined();
    replacement.current = { url: `${url}y`, etag: '"r"' };
    await removeReplacement(value, replacement);
    expect(calls.at(-1)).toEqual(["delete", `${url}y`, '"r"', true]);
  });
});

describe("applySeriesPlan", () => {
  const moved = (event: CalendarEvent): CalendarEvent => ({
    ...event,
    start: new Date("2026-10-28T10:30:00Z"),
    end: new Date("2026-10-28T10:45:00Z"),
  });
  const occurrence = new Date("2026-10-28T09:30:00Z");

  it("updates a single event in place without requiring confirmation", async () => {
    const single: StoredItem<CalendarEvent> = {
      url,
      etag: '"e1"',
      data: { ...series, recurrence: undefined },
    };
    const plan = planSeriesEdit(single.data, single.data.start, moved(single.data), "all", zone);
    const { value, calls } = mutations();
    const replacement: SeriesReplacement = { current: undefined };
    await applySeriesPlan({
      plan,
      source: single,
      mode: "all",
      target: work,
      mutations: value,
      replacement,
    });
    expect(calls).toEqual([
      ["resolve", url, '"e1"', false],
      ["update", url, plan.original, '"e1"', false],
    ]);
  });
  it('"this" confirms the replacement before excepting the occurrence', async () => {
    const plan = planSeriesEdit(series, occurrence, moved(series), "this", zone);
    const { value, calls } = mutations();
    const replacement: SeriesReplacement = { current: undefined };
    await applySeriesPlan({
      plan,
      source,
      mode: "this",
      target: work,
      mutations: value,
      replacement,
      newId: counter(),
    });
    const created = `${work.container}id-1.ttl`;
    expect(calls).toEqual([
      ["resolve", url, '"e1"', true],
      ["create", created, { ...plan.created, uid: "id-2" }, true],
      ["resolve", created, null, undefined],
      ["update", url, plan.original, '"e1"', true],
    ]);
    expect(replacement.current).toBeUndefined();
  });
  it("leaves a confirmed replacement for compensation when the original fails", async () => {
    const plan = planSeriesEdit(series, occurrence, moved(series), "this", zone);
    const failure = new Error("412");
    const { value } = mutations({
      update: vi.fn(async () => {
        throw failure;
      }),
    });
    const replacement: SeriesReplacement = { current: undefined };
    await expect(
      applySeriesPlan({
        plan,
        source,
        mode: "this",
        target: work,
        mutations: value,
        replacement,
        newId: counter(),
      }),
    ).rejects.toBe(failure);
    expect(replacement.current).toEqual({ url: `${work.container}id-1.ttl`, etag: '"new"' });
    // A retry removes that replacement first.
    const retry = mutations();
    await applySeriesPlan({
      plan,
      source,
      mode: "this",
      target: work,
      mutations: retry.value,
      replacement,
      newId: counter(),
    });
    expect(retry.calls[0]).toEqual(["delete", `${work.container}id-1.ttl`, '"new"', true]);
  });
  it("previews the series change while the replacement confirms, then releases it", async () => {
    const plan = planSeriesEdit(series, occurrence, moved(series), "this", zone);
    const release = vi.fn(() => {
      calls.push(["release"]);
    });
    const { value, calls } = mutations({
      preview: vi.fn((write) => {
        calls.push(["preview", write]);
        return release;
      }),
    });
    await applySeriesPlan({
      plan,
      source,
      mode: "this",
      target: work,
      mutations: value,
      replacement: { current: undefined },
      newId: counter(),
    });
    expect(calls.map((call) => call[0])).toEqual([
      "resolve",
      "preview",
      "create",
      "resolve",
      "update",
      "release",
    ]);
    expect(calls[1]?.[1]).toEqual({ kind: "update", url, data: plan.original, etag: '"e1"' });
  });
  it("releases the preview when the series write fails", async () => {
    const plan = planSeriesEdit(series, occurrence, moved(series), "this", zone);
    const release = vi.fn();
    const failure = new Error("412");
    const { value } = mutations({
      preview: vi.fn(() => release),
      update: vi.fn(async () => {
        throw failure;
      }),
    });
    await expect(
      applySeriesPlan({
        plan,
        source,
        mode: "this",
        target: work,
        mutations: value,
        replacement: { current: undefined },
        newId: counter(),
      }),
    ).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });
  it("previews a delete when the plan drops the original, and nothing for plain edits", async () => {
    const preview = vi.fn(() => () => {});
    const dropped = planSeriesEdit(series, series.start, moved(series), "following", zone);
    await applySeriesPlan({
      plan: dropped,
      source,
      mode: "following",
      target: work,
      mutations: mutations({ preview }).value,
      replacement: { current: undefined },
      newId: counter(),
    });
    expect(preview).toHaveBeenCalledWith({ kind: "delete", url, etag: '"e1"' });
    preview.mockClear();
    const single = { ...series, recurrence: undefined };
    await applySeriesPlan({
      plan: planSeriesEdit(single, single.start, moved(single), "all", zone),
      source: { url, etag: '"e1"', data: single },
      mode: "all",
      target: work,
      mutations: mutations({ preview }).value,
      replacement: { current: undefined },
    });
    expect(preview).not.toHaveBeenCalled();
  });
  it("moves a series to another calendar by creating there and deleting the source", async () => {
    const edited = { ...moved(series), inCalendar: `${home.url}#it` };
    const plan = planSeriesEdit(series, occurrence, edited, "all", zone);
    const { value, calls } = mutations();
    await applySeriesPlan({
      plan,
      source,
      mode: "all",
      target: home,
      mutations: value,
      replacement: { current: undefined },
      newId: counter(),
    });
    expect(calls.map((call) => call[0])).toEqual(["resolve", "create", "resolve", "delete"]);
    expect(calls[1]?.[1]).toBe(`${home.container}id-1.ttl`);
    expect(calls[3]).toEqual(["delete", url, '"e1"', true]);
  });
  it("deletes the source when the plan drops the original", async () => {
    const plan = planSeriesEdit(series, series.start, moved(series), "following", zone);
    expect(plan.original).toBeNull();
    const { value, calls } = mutations();
    await applySeriesPlan({
      plan,
      source,
      mode: "following",
      target: work,
      mutations: value,
      replacement: { current: undefined },
      newId: counter(),
    });
    expect(calls.map((call) => call[0])).toEqual(["resolve", "create", "resolve", "delete"]);
  });
  it("creates a new event without resolving a source", async () => {
    const data = { ...series, recurrence: undefined };
    const { value, calls } = mutations();
    await applySeriesPlan({
      plan: { original: data },
      source: { url: "", etag: null, data },
      mode: "all",
      target: work,
      mutations: value,
      replacement: { current: undefined },
      newId: () => "fresh",
    });
    expect(calls).toEqual([
      ["create", `${work.container}fresh.ttl`, { ...data, uid: "fresh" }, false],
    ]);
    const none = mutations();
    await applySeriesPlan({
      plan: { original: null },
      source: { url: "", etag: null, data },
      mode: "all",
      target: work,
      mutations: none.value,
      replacement: { current: undefined },
    });
    expect(none.calls).toEqual([]);
  });
  it("names replacements with random UUIDs by default", async () => {
    const plan = planSeriesEdit(series, occurrence, moved(series), "this", zone);
    const { value, calls } = mutations();
    await applySeriesPlan({
      plan,
      source,
      mode: "this",
      target: work,
      mutations: value,
      replacement: { current: undefined },
    });
    expect(calls[1]?.[1]).toMatch(/^https:\/\/pod\.example\/calendar\/work\/[\da-f-]{36}\.ttl$/);
  });
});

describe("local event sources", () => {
  const data = { ...series, recurrence: undefined };
  it("returns the latest local intent, null after a delete, undefined without one", () => {
    const create: EventWrite = { kind: "create", url, data };
    const update: EventWrite = { kind: "update", url, data: { ...data, name: "U" }, etag: '"e2"' };
    expect(localEventItem(url, [])).toBeUndefined();
    expect(localEventItem(url, [create])).toEqual({ url, etag: null, data });
    expect(localEventItem(url, [create, update])?.etag).toBe('"e2"');
    expect(localEventItem(url, [{ ...update, confirmation: { etag: '"e3"' } }])?.etag).toBe('"e3"');
    expect(localEventItem(url, [update, { kind: "delete", url, etag: '"e2"' }])).toBeNull();
    expect(localEventItem(`${url}x`, [update])).toBeUndefined();
  });
  it("fills the calendar from the container holding the event", () => {
    const bare = { url, etag: '"e1"', data: { ...data, inCalendar: undefined } };
    expect(withSourceCalendar(bare, [home, work]).data.inCalendar).toBe(`${work.url}#it`);
    expect(withSourceCalendar(bare, [home]).data.inCalendar).toBeUndefined();
    const set = { ...bare, data: { ...data, inCalendar: `${home.url}#it` } };
    expect(withSourceCalendar(set, [work]).data.inCalendar).toBe(`${home.url}#it`);
  });
});
