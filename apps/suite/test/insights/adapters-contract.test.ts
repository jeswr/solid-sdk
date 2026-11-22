// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { buildTask } from "@jeswr/solid-task-model";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureSample } from "../../src/apps/insights/demo/sample";
import { readCalendarEvents } from "../../src/apps/insights/sources/adapters/calendar";
import { readHealthMeasurements } from "../../src/apps/insights/sources/adapters/health";
import { readMoneyTransactions } from "../../src/apps/insights/sources/adapters/money";
import { readMusicHistory } from "../../src/apps/insights/sources/adapters/music";
import { readCompletedTasks } from "../../src/apps/insights/sources/adapters/tasks";
import { PlaybackEvent, serializeMusic } from "../../src/apps/music/lib/model";
import { NS, node, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
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

describe("Insights source boundaries", () => {
  const root = "https://pod.example/alice/";
  const projects = `${root}tasks/projects/`;
  const profile = "https://id.example/alice";
  const webId = `${profile}#me`;
  const indexUrl = `${root}settings/public.ttl`;
  const trackerUrl = `${root}projects/custom.ttl`;
  const stateStore = `${root}projects/custom/`;
  const taskUrl = `${stateStore}done.ttl`;
  const notFound = () => new Response(null, { status: 404 });
  const rdf = (body: string) => new Response(body, { headers: { "content-type": "text/turtle" } });

  async function taskSession(defaultStatus: number, folder: string) {
    const profileDoc = new Store();
    node(webId, profileDoc).setIri(`${NS.SOLID}publicTypeIndex`, indexUrl);
    const index = new Store();
    const trackerRegistration = node(`${indexUrl}#tracker`, index);
    trackerRegistration.types.add(`${NS.SOLID}TypeRegistration`);
    trackerRegistration.setIri(`${NS.SOLID}forClass`, `${NS.WF}Tracker`);
    trackerRegistration.setIri(`${NS.SOLID}instance`, trackerUrl);
    const tracker = createTracker(trackerUrl, "Registered tracker", folder, [webId], now);
    const listing = new Store();
    node(stateStore, listing).types.add(`${NS.LDP}BasicContainer`);
    node(stateStore, listing).iris(`${NS.LDP}contains`).add(taskUrl);
    const task = buildTask(taskUrl, { title: "Completed", state: "closed", endedAt: now });
    const docs = new Map([
      [indexUrl, await serialize(index)],
      [trackerUrl, await serialize(tracker.dataset)],
      [stateStore, await serialize(listing)],
      [taskUrl, await serialize(task)],
    ]);
    const profileBody = await serialize(profileDoc);
    const publicFetch = vi.fn<typeof globalThis.fetch>(async () => rdf(profileBody));
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url === projects) return new Response(null, { status: defaultStatus });
      const doc = docs.get(url);
      return doc === undefined ? notFound() : rdf(doc);
    });
    const account = {
      ...session,
      mode: "solid",
      storageUrl: root,
      webId,
      fetch,
      publicFetch,
    } as const;
    return { account, fetch, publicFetch };
  }

  it.each([
    404, 410,
  ])("finds registered Tasks when the default container returns %i", async (status) => {
    const { account, fetch, publicFetch } = await taskSession(status, stateStore);
    expect(await readCompletedTasks(account)).toEqual([{ at: now, value: 1 }]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      projects,
      indexUrl,
      trackerUrl,
      stateStore,
      taskUrl,
    ]);
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(
      profile,
      expect.objectContaining({
        redirect: "manual",
        credentials: "omit",
      }),
    );
  });

  it.each([
    "https://other.example/tasks/",
    "https://pod.example/alice-other/tasks/",
    profile,
  ])("refuses a tracker state store outside the selected pod before dispatch (%s)", async (folder) => {
    const { account, fetch, publicFetch } = await taskSession(404, folder);
    await expect(readCompletedTasks(account)).rejects.toThrow();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([projects, indexUrl, trackerUrl]);
    expect(publicFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses redirects from the foreign public profile before sending a second request", async () => {
    const { account, fetch, publicFetch } = await taskSession(404, stateStore);
    publicFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example/profile" },
      }),
    );
    await expect(readCompletedTasks(account)).rejects.toThrow();
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([projects]);
  });

  it("discards the missing listing body and keeps a missing registered tracker an error", async () => {
    const { account, fetch } = await taskSession(404, stateStore);
    const cancel = vi.fn(() => Promise.reject(new Error("Transport already closed")));
    const index = new Store();
    const registration = node(`${indexUrl}#missing`, index);
    registration.types.add(`${NS.SOLID}TypeRegistration`);
    registration.setIri(`${NS.SOLID}forClass`, `${NS.WF}Tracker`);
    registration.setIri(`${NS.SOLID}instance`, `${root}projects/missing.ttl`);
    fetch
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 404 }))
      .mockResolvedValueOnce(rdf(await serialize(index)))
      .mockResolvedValueOnce(notFound());
    await expect(readCompletedTasks(account)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      projects,
      indexUrl,
      `${root}projects/missing.ttl`,
    ]);
  });

  it("cancels an oversized JSON-LD observation stream during the read", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let chunks = 0;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (++chunks > 20) controller.close();
          else controller.enqueue(chunk);
        },
        cancel,
      }),
      { headers: { "content-type": "application/ld+json" } },
    );
    const json = vi.spyOn(response, "json");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(readHealthMeasurements({ ...session, fetch }, range)).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
    expect(chunks).toBeLessThan(20);
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
  });

  it("refuses deep JSON-LD and remote contexts inside the bounded parser", async () => {
    const jsonld = (body: string) =>
      new Response(body, {
        headers: { "content-type": "application/ld+json" },
      });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonld(`${"[".repeat(129)}{}${"]".repeat(129)}`),
    );
    await expect(readHealthMeasurements({ ...session, fetch }, range)).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
    const globalFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
    try {
      fetch.mockResolvedValueOnce(
        jsonld(JSON.stringify({ "@context": "https://other.example/context" })),
      );
      await expect(readHealthMeasurements({ ...session, fetch }, range)).rejects.toBeInstanceOf(
        RdfFetchError,
      );
      expect(globalFetch).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalFetch.mockRestore();
    }
  });

  it("reads live Spotify plays for the requested months and counts a shared playback IRI once", async () => {
    const live = `${root}integrations/spotify/music/recently-played.ttl`;
    const shard = `${root}music/history/2026-11.ttl`;
    const duplicate = `${live}#both`;
    const spotifyOnly = `${live}#spotify`;
    const native = new Store();
    const imported = new Store();
    const add = (iri: string, at: Date, dataset: Store) => {
      const play = new PlaybackEvent(iri, dataset).stampType();
      play.trackIri = `${root}track`;
      play.startTime = at;
    };
    add(duplicate, now, native);
    add(duplicate, now, imported);
    add(spotifyOnly, now, imported);
    add(`${live}#older`, new Date("2026-10-01T10:00:00Z"), imported);
    const docs = new Map([
      [live, await serializeMusic(imported)],
      [shard, await serializeMusic(native)],
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const doc = docs.get(String(input));
      return doc === undefined ? notFound() : rdf(doc);
    });
    const rows = await readMusicHistory(
      { ...session, fetch, storageUrl: root },
      {
        start: new Date("2026-11-01T00:00:00Z"),
        end: now,
      },
    );
    expect(rows.map((play) => play.iri)).toEqual([duplicate, spotifyOnly]);
  });
});
