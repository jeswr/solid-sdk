// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { adapterContainerUrl, runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { Provenance } from "../core/provenance.js";
import {
  createMemoryPod,
  demoImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute, ImportContext } from "../core/types.js";
import { CLASSES, ExerciseAction, SCHEMA } from "../core/vocab.js";
import { fitbitAdapter } from "../fitbit/adapter.js";
import { createRegistry } from "../registry.js";
import { createGoogleHealthAdapter, googleHealthAdapter } from "./adapter.js";
import {
  endpoint,
  type HealthType,
  MAX_PAGE_BYTES,
  MAX_PAGE_ITEMS,
  MAX_STAGES,
  MAX_TOKEN_CHARS,
  point,
  SOURCE_ORIGIN,
  TYPES,
} from "./api.js";
import { EXERCISE, GOOGLE_HEALTH_FIXTURES, HEART_RATE, SLEEP, STEPS, WEIGHT } from "./fixtures.js";
import { healthDocuments } from "./mapping.js";

const ROOT = `${TEST_POD_ROOT}integrations/fitbit/`;
const ACT = `${ROOT}health/activities.ttl`;
const checkpoint = (cursors: Partial<Record<HealthType, string>>) =>
  JSON.stringify({ version: 1, cursors });
const prior: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00Z",
  lastSync: "2026-06-11T00:00:00Z",
  cursor: checkpoint({ "heart-rate": "2026-06-10T07:12:00.000Z" }),
  lastOutcome: "success",
  counts: { documents: 1, items: 1, skipped: 0 },
};
const routes = (type: HealthType, pages: unknown[]): FixtureRoute[] => [
  ...GOOGLE_HEALTH_FIXTURES.filter((r) => r.url !== endpoint(type)),
  ...pages.map((json) => ({ url: endpoint(type), json })),
];
function run(
  source: readonly FixtureRoute[] = GOOGLE_HEALTH_FIXTURES,
  options: {
    cursor?: string;
    state?: ConnectorState;
    adapter?: ReturnType<typeof createGoogleHealthAdapter>;
    pod?: ReturnType<typeof createMemoryPod>;
    transport?: typeof fetch;
    signal?: AbortSignal;
  } = {},
) {
  const adapter = options.adapter ?? googleHealthAdapter;
  const pod = options.pod ?? createMemoryPod();
  const api = vi.fn(options.transport ?? fixtureFetch("google-health", source));
  const onState = vi.fn();
  const result = runImport({
    adapter,
    mode: "live",
    sourceAuth: { fetch: api },
    podWriter: createFetchPodWriter({
      adapterId: "google-health",
      podRoot: TEST_POD_ROOT,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      fetch: pod.fetch,
    }),
    cursor: options.cursor,
    state: options.state,
    onState,
    signal: options.signal,
  });
  return { result, pod, api, onState };
}
afterEach(() => vi.useRealTimers());

describe("Google Health successor", () => {
  it("registers a restricted, readonly Google OAuth connection and hides retired Fitbit from new connections", () => {
    const registry = createRegistry({
      "google-health": { clientId: "fixture", tokenProxyUrl: "https://proxy.test/token" },
      fitbit: { clientId: "old", tokenProxyUrl: "https://old.test/token" },
    });
    expect(registry.allCatalogEntries().some((e) => e.id === "fitbit")).toBe(false);
    expect(registry.TIER_B_ADAPTERS.some((e) => e.metadata.id === "fitbit")).toBe(false);
    expect(registry.adapterById("fitbit")?.metadata.deprecated).toMatch(/Google Health/);
    const adapter = registry.adapterById("google-health")!;
    expect(registry.statusOf(adapter.metadata)).toBe("approval-needed");
    expect(adapter.metadata.categories).toEqual(["health"]);
    expect(adapter.metadata.scopes).toHaveLength(4);
    expect(
      adapter.metadata.scopes.every((s) => s.endsWith(".readonly") && s.includes("/googlehealth.")),
    ).toBe(true);
    expect(adapter.oauth?.authorizationEndpoint).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(adapter.oauth?.tokenEndpoint).toBe("https://oauth2.googleapis.com/token");
    expect(adapter.oauth?.extraAuthParams?.access_type).toBe("offline");
    expect(adapterContainerUrl(TEST_POD_ROOT, "google-health")).toBe(ROOT);
  });

  it("maps equivalent Fitbit exercises to exactly the same pod ids and exercise fields, preserving other legacy items", async () => {
    const { pod: legacy } = await demoImport(fitbitAdapter);
    const { pod: fresh } = await demoImport(googleHealthAdapter);
    const before = new ExerciseAction(
      `${ACT}#activity-51817963271`,
      legacy.dataset(ACT),
      DataFactory,
    );
    const after = new ExerciseAction(
      `${ACT}#activity-51817963271`,
      fresh.dataset(ACT),
      DataFactory,
    );
    expect(after.types.has(CLASSES.ExerciseAction)).toBe(true);
    expect([
      after.name,
      after.identifier,
      after.exerciseType,
      after.duration,
      after.distance,
      after.startTime,
    ]).toEqual([
      before.name,
      before.identifier,
      before.exerciseType,
      before.duration,
      before.distance,
      before.startTime,
    ]);
    await demoImport(googleHealthAdapter, { pod: legacy });
    expect(
      new ExerciseAction(`${ACT}#activity-51817991042`, legacy.dataset(ACT), DataFactory).name,
    ).toBe("Walk");
    expect([
      ...legacy
        .dataset(ACT)
        .match(
          null,
          DataFactory.namedNode(`${SCHEMA}identifier`),
          DataFactory.literal("51817963271"),
        ),
    ]).toHaveLength(1);
    expect(legacy.urls().some((url) => url.includes("integrations/google-health/"))).toBe(false);
  });

  it("imports synthetic summaries, heart samples, sleep stages and weight with provenance and stable re-imports", async () => {
    const first = run();
    const report = await first.result;
    expect(report.categories).toEqual(["health"]);
    expect(report.written).toHaveLength(5);
    const cursors = JSON.parse(report.cursor!).cursors;
    expect(cursors.steps).toBe("2026-06-09T00:00:00.000Z");
    expect(cursors.weight).toBe("2026-06-08T07:00:00.000Z");
    const sleep = report.written.find((d) => d.url.includes("/sleep/"))!;
    expect(first.pod.get(sleep.url)).toContain("deep");
    expect([
      ...first.pod.dataset(sleep.url).match(null, DataFactory.namedNode(`${SCHEMA}hasPart`), null),
    ]).toHaveLength(3);
    expect(first.pod.get(`${ROOT}health/heart-rate.ttl`)).toContain("bpm");
    expect(first.pod.get(`${ROOT}health/weight.ttl`)).toContain("kg");
    const urls = first.pod.urls();
    const sizes = report.written.map((d) => first.pod.dataset(d.url).size);
    const second = run(undefined, { pod: first.pod, cursor: report.cursor });
    await second.result;
    expect(second.pod.urls()).toEqual(urls);
    expect(report.written.map((d) => second.pod.dataset(d.url).size)).toEqual(sizes);
    expect(second.pod.get(`${ROOT}_provenance.ttl`)).toContain("google-health");
  });

  it.each([
    "",
    "users/me/dataTypes/exercise-session/dataPoints/google-new-id",
  ])("retains a stored Fitbit id when Google supplies %j", async (name) => {
    const { pod } = await demoImport(fitbitAdapter);
    const r = run(routes("exercise-session", [{ dataPoints: [{ ...EXERCISE, name }] }]), { pod });
    await r.result;
    const ds = pod.dataset(ACT);
    const ex = new ExerciseAction(`${ACT}#activity-51817963271`, ds, DataFactory);
    expect(ex.identifier).toBe("51817963271");
    expect([...ds.match(null, DataFactory.namedNode(`${SCHEMA}startTime`), null)]).toHaveLength(3);
  });

  it("keeps an old complete summary on malformed points and aligns the overlap to full days", async () => {
    const first = run();
    const report = await first.result;
    const day = report.written.find((d) => d.url.includes("/daily/"))!;
    const r = run(routes("steps", [{ dataPoints: [{ ...STEPS, steps: { count: 10 } }, null] }]), {
      pod: first.pod,
      cursor: report.cursor,
    });
    const second = await r.result;
    expect(second.skipped).toBe(1);
    expect(
      [...r.pod.dataset(day.url).match(null, DataFactory.namedNode(`${SCHEMA}value`), null)].map(
        (q) => q.object.value,
      ),
    ).toEqual(["6120"]);
    expect(JSON.parse(second.cursor!).cursors.steps).toBe(JSON.parse(report.cursor!).cursors.steps);
    expect(new URL(String(r.api.mock.calls[0]?.[0])).searchParams.get("filter")).toContain(
      'endTime >= "2026-06-07T00:00:00.000Z"',
    );
  });

  it("ignores the inclusive previous-day boundary when rebuilding summary totals", async () => {
    const cursor = checkpoint({ steps: "2026-06-10T12:00:00.000Z" });
    const boundary = {
      ...STEPS,
      startTime: "2026-06-07T23:00:00Z",
      endTime: "2026-06-08T00:00:00Z",
    };
    const r = run(routes("steps", [{ dataPoints: [boundary, STEPS] }]), { cursor });
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-07/"))).toBe(false);
  });

  it("preserves the checkpoint after conditional Pod write failure", async () => {
    const pod = createMemoryPod();
    const transport = pod.fetch;
    pod.fetch = async (input, init) =>
      String(input).endsWith("health/activities.ttl") && init?.method === "PUT"
        ? new Response("", { status: 412 })
        : transport(input, init);
    const r = run(undefined, { pod, state: prior });
    await expect(r.result).rejects.toThrow();
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
  });

  it("follows 3 reconcile pages and treats an empty token as completion, deduplicating repeated points", async () => {
    const r = run(
      routes("steps", [
        { dataPoints: [STEPS], nextPageToken: "second" },
        { dataPoints: [STEPS], nextPageToken: "third" },
        { dataPoints: [STEPS], nextPageToken: "" },
      ]),
    );
    const report = await r.result;
    const requests = r.api.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((u) => u.pathname.endsWith("/steps/dataPoints:reconcile"));
    expect(requests.map((u) => u.searchParams.get("pageToken"))).toEqual([null, "second", "third"]);
    expect(requests.every((u) => u.searchParams.get("pageSize") === "1000")).toBe(true);
    const day = report.written.find((d) => d.url.includes("/daily/"))!;
    expect(
      [...r.pod.dataset(day.url).match(null, DataFactory.namedNode(`${SCHEMA}value`), null)].map(
        (q) => q.object.value,
      ),
    ).toEqual(["6120"]);
  });

  it("uses per-type 48h overlap, retains older samples and updates replayed sample ids in place", async () => {
    const initial = run();
    const first = await initial.result;
    const source = routes("heart-rate", [
      {
        dataPoints: [
          { ...HEART_RATE, heartRate: { beatsPerMinute: 75 } },
          { ...HEART_RATE, time: "2026-06-09T07:12:00Z" },
        ],
      },
    ]);
    const r = run(source, { cursor: first.cursor, pod: initial.pod });
    const report = await r.result;
    const url = r.api.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.pathname.includes("/heart-rate/"))!;
    expect(url.searchParams.get("filter")).toContain('time >= "2026-06-06T07:12:00.000Z"');
    expect(url.pathname).not.toContain(":reconcile");
    const ds = r.pod.dataset(`${ROOT}health/heart-rate.ttl`);
    expect(
      [...ds.match(null, DataFactory.namedNode(`${SCHEMA}value`), null)]
        .map((q) => q.object.value)
        .sort(),
    ).toEqual(["72", "75"]);
    expect(JSON.parse(report.cursor!).cursors["heart-rate"]).toBe("2026-06-09T07:12:00.000Z");
  });

  it("removes old sleep stage nodes when a session's stages change", async () => {
    const first = run();
    await first.result;
    const r = run(
      routes("sleep", [
        { dataPoints: [{ ...SLEEP, sleep: { stages: SLEEP.sleep.stages.slice(0, 1) } }] },
      ]),
      { pod: first.pod },
    );
    const report = await r.result;
    const doc = report.written.find((d) => d.url.includes("/sleep/"))!;
    expect(r.pod.get(doc.url)).not.toContain("#stage-2");
  });

  it.each([
    null,
    {},
    { dataPoints: null },
    { dataPoints: [], nextPageToken: null },
    { dataPoints: [], nextPageToken: 7 },
    { dataPoints: [], nextPageToken: "x".repeat(MAX_TOKEN_CHARS + 1) },
    { dataPoints: Array(MAX_PAGE_ITEMS + 1).fill(null) },
  ])("fails malformed page %j before writes and preserves the checkpoint", async (json) => {
    const r = run(routes("weight", [json]), { state: prior });
    await expect(r.result).rejects.toThrow(/page/);
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it("bounds repeated and endless tokens", async () => {
    for (const source of [
      [{ dataPoints: [], nextPageToken: "same" }],
      [
        { dataPoints: [], nextPageToken: "one" },
        { dataPoints: [], nextPageToken: "two" },
      ],
    ]) {
      const r = run(routes("steps", source), {
        adapter: createGoogleHealthAdapter({ maxPages: 2 }),
      });
      await expect(r.result).rejects.toThrow(/cursor|page cap/);
      expect(r.api).toHaveBeenCalledTimes(2);
    }
  });

  it.each([
    { maxRequests: 1, maxItems: 100, maxBytes: 10000 },
    { maxRequests: 100, maxItems: 1, maxBytes: 10000 },
    { maxRequests: 100, maxItems: 100, maxBytes: 1 },
  ])("shares one run budget across all types: %j", async (limits) => {
    const r = run(undefined, { adapter: createGoogleHealthAdapter({ limits }) });
    await expect(r.result).rejects.toThrow(/budget/);
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it("cancels oversized JSON without parsing", async () => {
    const cancel = vi.fn();
    const r = run(undefined, {
      transport: async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-length": String(MAX_PAGE_BYTES + 1) },
        }),
    });
    await expect(r.result).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("charges sleep stages to the same run item budget as points", async () => {
    const source = TYPES.map((type) => ({
      url: endpoint(type),
      json: { dataPoints: type === "sleep" ? [SLEEP] : [] },
    }));
    const r = run(source, {
      adapter: createGoogleHealthAdapter({ limits: { maxRequests: 10, maxItems: 3 } }),
    });
    await expect(r.result).rejects.toThrow(/item budget/);
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it("rejects future and out-of-window samples without advancing their cursor", async () => {
    const r = run(
      routes("heart-rate", [
        {
          dataPoints: [
            { ...HEART_RATE, time: "2026-06-07T07:11:59Z" },
            { ...HEART_RATE, time: "2026-06-11T07:12:01Z" },
          ],
        },
      ]),
      {
        cursor: checkpoint({ "heart-rate": "2026-06-09T07:12:00.000Z" }),
        adapter: createGoogleHealthAdapter({ now: () => new Date("2026-06-11T07:12:00Z") }),
      },
    );
    const report = await r.result;
    expect(report.skipped).toBe(2);
    expect(JSON.parse(report.cursor ?? "{}").cursors["heart-rate"]).toBe(
      "2026-06-09T07:12:00.000Z",
    );
    expect(report.written.some((doc) => doc.url.endsWith("/heart-rate.ttl"))).toBe(false);
  });

  it.each([
    429, 500, 503,
  ])("backs off HTTP %i and succeeds without duplicating points", async (status) => {
    vi.useFakeTimers();
    let calls = 0;
    const fixtures = fixtureFetch("google-health", GOOGLE_HEALTH_FIXTURES);
    const r = run(undefined, {
      transport: async (input, init) =>
        ++calls === 1
          ? new Response("", { status, headers: { "retry-after": "2" } })
          : fixtures(input, init),
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(r.api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await r.result).written).toHaveLength(5);
    expect(r.api).toHaveBeenCalledTimes(TYPES.length + 1);
  });

  it("caps retries and keeps the prior checkpoint on persistent throttling", async () => {
    const r = run(undefined, {
      state: prior,
      transport: async () => new Response("", { status: 429, headers: { "retry-after": "0" } }),
    });
    await expect(r.result).rejects.toMatchObject({ status: 429 });
    expect(r.api).toHaveBeenCalledTimes(4);
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
  });

  it("aborts backoff promptly without another request or pod write", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const r = run(undefined, {
      signal: controller.signal,
      transport: async () => new Response("", { status: 429, headers: { "retry-after": "60" } }),
    });
    const rejected = expect(r.result).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(r.api).toHaveBeenCalledOnce();
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it.each([
    "x",
    checkpoint({ "heart-rate": "invalid" }),
    checkpoint({ steps: "2999-01-01T00:00:00Z" }),
    JSON.stringify({ version: 1, cursors: { unknown: "2026-01-01T00:00:00Z" } }),
  ])("rejects invalid stored cursor before source traffic", async (cursor) => {
    const r = run(undefined, { cursor });
    await expect(r.result).rejects.toThrow(/checkpoint/);
    expect(r.api).not.toHaveBeenCalled();
  });

  it("refuses retired Fitbit live runs before contacting a provider", async () => {
    const api = vi.fn<typeof fetch>();
    const r = run(undefined, { adapter: fitbitAdapter, transport: api });
    await expect(r.result).rejects.toThrow(/Google Health/);
    expect(api).not.toHaveBeenCalled();
  });

  it("skips hostile individual payloads, reports the count and holds that type cursor", async () => {
    const r = run(
      routes("heart-rate", [
        {
          dataPoints: [null, {}, { ...HEART_RATE, heartRate: { beatsPerMinute: -1 } }, HEART_RATE],
        },
      ]),
      { state: prior },
    );
    const report = await r.result;
    expect(report.skipped).toBe(3);
    expect(JSON.parse(report.cursor!).cursors["heart-rate"]).toBe(
      JSON.parse(prior.cursor!).cursors["heart-rate"],
    );
  });

  it("rejects inconsistent reconciled data before writing", async () => {
    const r = run(routes("steps", [{ dataPoints: [STEPS, { ...STEPS, steps: { count: 3 } }] }]));
    await expect(r.result).rejects.toThrow(/Conflicting/);
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
    const p = point("steps", STEPS)!;
    expect(() =>
      healthDocuments([p, { ...p, start: "2026-06-08T12:00:00.000Z" }], (s) => ROOT + s),
    ).toThrow(/Overlapping/);
  });

  it("maps nameless points deterministically, bounds stages, and rejects unsafe names and invalid samples", () => {
    const exercise = point("exercise-session", { ...EXERCISE, name: "" })!;
    expect(exercise.key).toBe(point("exercise-session", { ...EXERCISE, name: "" })?.key);
    expect(exercise.key).toBe(
      point("exercise-session", {
        ...EXERCISE,
        name: "users/me/dataTypes/exercise-session/dataPoints/opaque-id",
      })?.key,
    );
    expect(
      point("sleep", {
        ...SLEEP,
        sleep: { stages: Array(MAX_STAGES + 1).fill(SLEEP.sleep.stages[0]) },
      }),
    ).toBeUndefined();
    expect(point("sleep", SLEEP)?.key).toBe(
      point("sleep", { ...SLEEP, name: "users/me/dataTypes/sleep/dataPoints/opaque-id" })?.key,
    );
    expect(
      point("sleep", {
        ...SLEEP,
        sleep: { stages: [SLEEP.sleep.stages[0], SLEEP.sleep.stages[0]] },
      }),
    ).toBeUndefined();
    expect(point("weight", { ...WEIGHT, time: "invalid" })).toBeUndefined();
    expect(
      point("weight", { ...WEIGHT, weight: { kilograms: Number.POSITIVE_INFINITY } }),
    ).toBeUndefined();
    expect(
      point("exercise-session", {
        ...EXERCISE,
        name: "users/me/dataTypes/exercise-session/dataPoints/../../bad",
      }),
    ).toBeUndefined();
    expect(
      point("exercise-session", {
        ...EXERCISE,
        exerciseSession: { activityName: "a".repeat(257) },
      }),
    ).toBeUndefined();
  });

  it("requires all scopes before starting requests", async () => {
    const api = vi.fn<typeof fetch>();
    await expect(
      googleHealthAdapter.import({ scopes: [], api } as unknown as ImportContext),
    ).rejects.toThrow(/permissions/);
    expect(api).not.toHaveBeenCalled();
  });

  it("fails ambiguous and conflicting legacy activity matches before writing", () => {
    const ds = new Store();
    for (const id of ["1", "2"]) {
      const ex = new ExerciseAction(`${ACT}#activity-${id}`, ds, DataFactory).mark();
      ex.exerciseType = "Run";
      ex.startTime = new Date(EXERCISE.startTime);
    }
    const p = point("exercise-session", EXERCISE)!;
    expect(() => healthDocuments([p], (s) => ROOT + s, ds)).toThrow(/Ambiguous/);
    expect(() => healthDocuments([p, p], (s) => ROOT + s)).toThrow(/Conflicting/);
  });

  it("protects legacy ids even when their stored start time is absent", () => {
    const ds = new Store();
    new ExerciseAction(`${ACT}#activity-51817963271`, ds, DataFactory).mark().name = "Legacy";
    const p = point("exercise-session", EXERCISE);
    expect(p).toBeDefined();
    if (!p) throw new Error("Invalid synthetic fixture");
    expect(() => healthDocuments([p], (s) => ROOT + s, ds)).toThrow(/ambiguous legacy Fitbit id/);
  });

  it("serializes Google Health and Fitbit imports against their shared container", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixtures = fixtureFetch("google-health", GOOGLE_HEALTH_FIXTURES);
    const first = run(undefined, {
      transport: async (input, init) => {
        await blocked;
        return fixtures(input, init);
      },
    });
    try {
      await expect(demoImport(fitbitAdapter, { pod: first.pod })).rejects.toThrow(
        /already running/,
      );
    } finally {
      release();
      await first.result;
    }
  });

  it("refuses a colliding numeric Google id until provenance establishes Google ownership", () => {
    const ds = new Store();
    const iri = `${ACT}#activity-51817963271`;
    const ex = new ExerciseAction(iri, ds, DataFactory).mark();
    ex.startTime = new Date("2026-06-07T07:12:00Z");
    ex.exerciseType = "Walk";
    const p = point("exercise-session", EXERCISE)!;
    expect(() => healthDocuments([p], (s) => ROOT + s, ds)).toThrow(/ambiguous legacy Fitbit id/);
    new Provenance(iri, ds, DataFactory).derivedFrom.add(SOURCE_ORIGIN);
    const [doc] = healthDocuments([p], (s) => ROOT + s, ds);
    expect(new ExerciseAction(iri, doc!.dataset, DataFactory).startTime?.toISOString()).toBe(
      p.start,
    );
  });

  it("uses reconcile and existing typed measurement fields for distance and calories", async () => {
    const source = GOOGLE_HEALTH_FIXTURES.filter(
      (r) => ![endpoint("distance"), endpoint("calories")].includes(r.url),
    );
    source.push({
      url: endpoint("distance"),
      json: {
        dataPoints: [
          { startTime: STEPS.startTime, endTime: STEPS.endTime, distance: { meters: 5200 } },
        ],
      },
    });
    source.push({
      url: endpoint("calories"),
      json: {
        dataPoints: [
          { startTime: STEPS.startTime, endTime: STEPS.endTime, calories: { kilocalories: 432 } },
        ],
      },
    });
    const r = run(source);
    const report = await r.result;
    for (const [type, value, unit] of [
      ["distance", "5200", "m"],
      ["calories", "432", "kcal"],
    ]) {
      const doc = report.written.find((d) => d.url.endsWith(`/${type}.ttl`))!;
      const ds = r.pod.dataset(doc.url);
      expect(
        [...ds.match(null, DataFactory.namedNode(`${SCHEMA}value`), null)].map(
          (q) => q.object.value,
        ),
      ).toEqual([value]);
      expect(
        [...ds.match(null, DataFactory.namedNode(`${SCHEMA}unitText`), null)].map(
          (q) => q.object.value,
        ),
      ).toEqual([unit]);
    }
  });

  it("caps streamed JSON without a content-length header and cancels it", async () => {
    const cancel = vi.fn();
    let sent = false;
    const r = run(undefined, {
      transport: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(new Uint8Array(MAX_PAGE_BYTES + 1));
              }
            },
            cancel,
          }),
        ),
    });
    await expect(r.result).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    401, 403, 404,
  ])("does not retry nontransient API HTTP %i without a refresh-capable host", async (status) => {
    const r = run(undefined, { transport: async () => new Response("", { status }) });
    await expect(r.result).rejects.toMatchObject({ status });
    expect(r.api).toHaveBeenCalledOnce();
  });

  it("refuses a provider delay over the wait cap without waiting", async () => {
    const r = run(undefined, {
      transport: async () =>
        new Response("", { status: 429, headers: { "retry-after": "99999999999999999999" } }),
    });
    await expect(r.result).rejects.toMatchObject({ status: 429 });
    expect(r.api).toHaveBeenCalledOnce();
  });

  it("holds empty type cursors and produces no empty data documents", async () => {
    const r = run(
      TYPES.map((t) => ({ url: endpoint(t), json: { dataPoints: [] } })),
      { state: prior },
    );
    const report = await r.result;
    expect(report.written).toHaveLength(0);
    expect(report.cursor).toBe(prior.cursor);
  });
});
