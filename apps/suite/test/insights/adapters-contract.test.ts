// AUTHORED-BY Codex (GPT-6.1 Sol)
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureSample } from "../../src/apps/insights/demo/sample";
import { readCalendarEvents } from "../../src/apps/insights/sources/adapters/calendar";
import { readHealthMeasurements } from "../../src/apps/insights/sources/adapters/health";
import { readMoneyTransactions } from "../../src/apps/insights/sources/adapters/money";
import { readMusicHistory } from "../../src/apps/insights/sources/adapters/music";
import { readCompletedTasks } from "../../src/apps/insights/sources/adapters/tasks";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/seed";
import type { PodSession } from "../../src/lib/session/pod-session";

const now = new Date("2026-11-11T12:00:00Z");
const range = { start: new Date("2026-06-14T00:00:00Z"), end: now };
let session: PodSession;
beforeAll(async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    latency: 0,
    // Health metrics require an owner-private root; the shell fixture intentionally
    // has a shared health/activity record unrelated to the observation store.
    seed: (await buildDemoSeed(now.getTime())).filter((entry) => !entry.path.startsWith("health/")),
  });
  session = {
    mode: "demo",
    storageUrl: pod.root,
    webId: DEMO_WEBID,
    displayName: "Fictional",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await ensureSample(session, now);
  const store = new TaskStore({
    fetch: session.fetch,
    storage: session.storageUrl,
    webId: session.webId,
    typeIndex: false,
    ensurePrivateTasksAccess: async () => true,
    now: () => now,
  });
  const project = await store.createProject("Fictional Insights contract");
  await store.createTask(
    project,
    { title: "Finish fictional report", state: "closed", endedAt: now },
    "insights-contract",
  );
}, 90_000);

describe("real foreign reader contracts over the in-memory pod", () => {
  it("reads typed health observations without writes", async () => {
    const fetch = vi.fn(session.fetch);
    const rows = await readHealthMeasurements({ ...session, fetch }, range);
    expect(rows.length).toBeGreaterThan(100);
    expect(
      rows.some(
        (row) => row.kind === "steps" && Number.isFinite(row.value) && row.at instanceof Date,
      ),
    ).toBe(true);
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("uses Money's ranged ledger and fetches only the window's month shards", async () => {
    const fetch = vi.fn(session.fetch);
    const rows = await readMoneyTransactions({ ...session, fetch }, range);
    expect(rows.some((row) => row.currency === "GBP" && Number(row.amount) < 0)).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.postingTime >= range.start.toISOString() &&
          row.postingTime <= range.end.toISOString(),
      ),
    ).toBe(true);
    const shards = fetch.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/transactions/"));
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.every((url) => /\/transactions\/2026-(06|07|08|09|10|11)\.ttl$/.test(url))).toBe(
      true,
    );
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("reads real scrobbles and expanded calendar events", async () => {
    const history = await readMusicHistory(session, range);
    expect(history.length).toBeGreaterThan(100);
    expect(history[0]?.startTime).toBeInstanceOf(Date);
    const events = await readCalendarEvents(session, range, "Europe/London");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.data.start && typeof event.url === "string")).toBe(true);
  });
  it("discovers completed tasks through the real TaskStore and model", async () => {
    expect(await readCompletedTasks(session)).toContainEqual({ at: now, value: 1 });
  });
  it("keeps missing sources empty and propagates denied reads", async () => {
    const absent = { ...session, fetch: vi.fn(async () => new Response(null, { status: 404 })) };
    expect(await readHealthMeasurements(absent, range)).toEqual([]);
    expect(await readMoneyTransactions(absent, range)).toEqual([]);
    expect(await readMusicHistory(absent, range)).toEqual([]);
    expect(await readCompletedTasks(absent)).toEqual([]);
    await expect(readCalendarEvents(absent, range, "UTC")).rejects.toThrow();
    const denied = { ...session, fetch: vi.fn(async () => new Response(null, { status: 403 })) };
    for (const read of [
      () => readHealthMeasurements(denied, range),
      () => readMoneyTransactions(denied, range),
      () => readMusicHistory(denied, range),
      () => readCompletedTasks(denied),
      () => readCalendarEvents(denied, range, "UTC"),
    ])
      await expect(read()).rejects.toThrow();
  });
});
