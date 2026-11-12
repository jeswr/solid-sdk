// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationAuthError } from "../core/errors.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { adapterContainerUrl, createSourceAuth, runImport } from "../core/import-runner.js";
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
import { createStateStore } from "../node/state.js";
import { createRegistry } from "../registry.js";
import { createGoogleHealthAdapter, type GoogleHealthOptions } from "./adapter.js";
import {
  ACTIVITY_SCOPE,
  endpoint,
  GOOGLE_HEALTH_SCOPES,
  type HealthType,
  MAX_PAGE_BYTES,
  MAX_PAGE_ITEMS,
  MAX_STAGES,
  MAX_TOKEN_CHARS,
  METRICS_SCOPE,
  point,
  SLEEP_SCOPE,
  SOURCE_ORIGIN,
  TYPES,
} from "./api.js";
import {
  demoFixtures,
  EXERCISE,
  FIXTURE_NOW,
  GOOGLE_HEALTH_FIXTURES,
  HEART_RATE,
  SLEEP,
  STEPS,
  WEIGHT,
} from "./fixtures.js";
import { HealthMapper, healthDocuments } from "./mapping.js";
import { HEALTH_VOCAB } from "./vocab-map.js";

const ROOT = `${TEST_POD_ROOT}integrations/fitbit/`;
const ACT = `${ROOT}health/activities.ttl`;
const UNTIL = FIXTURE_NOW.toISOString();
const adapterAt = (now: Date | string = FIXTURE_NOW, options: GoogleHealthOptions = {}) =>
  createGoogleHealthAdapter({ now: () => new Date(now), ...options });
const gh = adapterAt();
/** Version 2 checkpoint whose windows were read at their own end. */
const checkpoint = (cursors: Partial<Record<HealthType, string>>) =>
  JSON.stringify({ version: 2, cursors, fetchedAt: cursors });
const cursorsOf = (cursor: string | undefined) =>
  (JSON.parse(cursor ?? "{}") as { cursors: Record<string, string> }).cursors;
const prior: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00Z",
  lastSync: "2026-06-09T00:00:00Z",
  cursor: checkpoint({ "heart-rate": "2026-06-09T07:12:00.000Z" }),
  lastOutcome: "success",
  counts: { documents: 1, items: 1, skipped: 0 },
};
const values = (pod: ReturnType<typeof createMemoryPod>, url: string, predicate: string) =>
  [...pod.dataset(url).match(null, DataFactory.namedNode(predicate), null)].map(
    (q) => q.object.value,
  );
const routes = (type: HealthType, pages: unknown[]): FixtureRoute[] => [
  ...GOOGLE_HEALTH_FIXTURES.filter((r) => r.url !== endpoint(type)),
  ...pages.map((json) => ({ url: endpoint(type), json })),
];

type Raw = Record<string, unknown>;
/**
 * A synthetic provider honouring the window filter and pageToken: each type's points are
 * answered only for the windows that contain them (by `time`, else `endTime`), in pages.
 * `extra` adds misplaced points to chosen windows (unattributable or future points).
 */
function provider(
  data: Partial<Record<HealthType, readonly Raw[]>>,
  options: {
    pageSize?: number;
    extra?: (type: HealthType, from: number, to: number) => unknown[];
  } = {},
): typeof fetch {
  const pageSize = options.pageSize ?? MAX_PAGE_ITEMS;
  const indexed = new Map<string, { at: number[]; raw: Raw[] }>();
  for (const [type, points] of Object.entries(data)) {
    const sorted = [...(points ?? [])]
      .map((raw) => ({ raw, at: Date.parse(String(raw.time ?? raw.endTime)) }))
      .sort((a, b) => a.at - b.at);
    indexed.set(type, { at: sorted.map((p) => p.at), raw: sorted.map((p) => p.raw) });
  }
  const lowerBound = (xs: number[], x: number, strict: boolean) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((xs[mid] as number) < x || (strict && xs[mid] === x)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return async (input) => {
    const url = new URL(String(input));
    const type = /\/dataTypes\/([a-z-]+)\/dataPoints/.exec(url.pathname)?.[1] as HealthType;
    const filter = url.searchParams.get("filter") ?? "";
    const m = /^(time|endTime) (>=|>) "([^"]+)" AND \1 (<|<=) "([^"]+)"$/.exec(filter);
    if (!m) throw new Error(`Unexpected filter ${filter}`);
    const from = Date.parse(m[3] as string);
    const to = Date.parse(m[5] as string);
    const series = indexed.get(type) ?? { at: [], raw: [] };
    // Samples: [from, to); intervals: (from, to].
    const lo = lowerBound(series.at, from, m[2] === ">");
    const hi = lowerBound(series.at, to, m[4] === "<=");
    const all = [...series.raw.slice(lo, hi), ...(options.extra?.(type, from, to) ?? [])];
    const offset = Number(url.searchParams.get("pageToken")?.slice(1) ?? 0);
    const page = all.slice(offset, offset + pageSize);
    const more = offset + pageSize < all.length;
    return new Response(
      JSON.stringify({ dataPoints: page, nextPageToken: more ? `p${offset + pageSize}` : "" }),
    );
  };
}

function run(
  source: readonly FixtureRoute[] | typeof fetch = GOOGLE_HEALTH_FIXTURES,
  options: {
    cursor?: string;
    state?: ConnectorState;
    adapter?: ReturnType<typeof createGoogleHealthAdapter>;
    pod?: ReturnType<typeof createMemoryPod>;
    signal?: AbortSignal;
    scopes?: readonly string[];
  } = {},
) {
  const adapter = options.adapter ?? gh;
  const pod = options.pod ?? createMemoryPod();
  const api = vi.fn(typeof source === "function" ? source : fixtureFetch("google-health", source));
  const onState = vi.fn();
  const result = runImport({
    adapter,
    mode: "live",
    sourceAuth: { fetch: api, ...(options.scopes && { scopes: options.scopes }) },
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
const requests = (api: ReturnType<typeof vi.fn>, type: HealthType) =>
  api.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((u) => u.pathname.includes(`/dataTypes/${type}/`));
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
    expect(adapter.metadata.scopes).toEqual([
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
      "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
      "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    ]);
    expect(adapter.oauth?.authorizationEndpoint).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(adapter.oauth?.tokenEndpoint).toBe("https://oauth2.googleapis.com/token");
    expect(adapter.oauth?.extraAuthParams?.access_type).toBe("offline");
    expect(adapterContainerUrl(TEST_POD_ROOT, "google-health")).toBe(ROOT);
  });

  it("maps equivalent Fitbit exercises to exactly the same pod ids and exercise fields, preserving other legacy items", async () => {
    const { pod: legacy } = await demoImport(fitbitAdapter);
    const { pod: fresh } = await demoImport(gh);
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
    await demoImport(gh, { pod: legacy });
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

  it("moves demo fixtures by whole days into the first-import lookback", async () => {
    const now = new Date("2026-11-12T09:30:00Z");
    expect(demoFixtures(FIXTURE_NOW)).toBe(GOOGLE_HEALTH_FIXTURES);
    const shifted = JSON.stringify(demoFixtures(now));
    expect(shifted).toContain('"2026-11-10T07:12:00Z"');
    expect(shifted).not.toContain("2026-06-");
    const { report } = await demoImport(adapterAt(now));
    expect(report.written.map((d) => d.url)).toContain(`${ROOT}health/heart-rate/2026-11-10.ttl`);
  });

  it("imports synthetic summaries, per-day samples, sleep stages and weight with provenance and stable re-imports", async () => {
    const first = run();
    const report = await first.result;
    expect(report.categories).toEqual(["health"]);
    expect(report.written.map((d) => d.url).sort()).toEqual(
      [
        `${ROOT}health/activities.ttl`,
        `${ROOT}health/daily/2026-06-08/steps.ttl`,
        `${ROOT}health/heart-rate/2026-06-08.ttl`,
        `${ROOT}health/sleep/sleep-2026-06-08T22%3A00%3A00.000Z.ttl`,
        `${ROOT}health/weight/2026-06-08.ttl`,
      ].sort(),
    );
    const cursors = cursorsOf(report.cursor);
    expect(Object.keys(cursors).sort()).toEqual([...TYPES].sort());
    expect(Object.values(cursors).every((c) => c === UNTIL)).toBe(true);
    const sleep = report.written.find((d) => d.url.includes("/sleep/"))!;
    expect(first.pod.get(sleep.url)).toContain("deep");
    expect(values(first.pod, sleep.url, `${SCHEMA}hasPart`)).toHaveLength(3);
    expect(first.pod.get(`${ROOT}health/heart-rate/2026-06-08.ttl`)).toContain("bpm");
    expect(first.pod.get(`${ROOT}health/weight/2026-06-08.ttl`)).toContain("kg");
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

  describe("non-UTC Fitbit users (legacy rows hold local wall-clock time with a Z suffix)", () => {
    const at = (offset: string) => ({
      startTime: `2026-06-08T07:12:00${offset}`,
      endTime: `2026-06-08T07:43:00${offset}`,
      exerciseSession: { activityName: "Run", distanceMeters: 5200 },
    });
    it.each([
      ["-05:00", "", "2026-06-08T12:12:00.000Z"],
      ["+10:00", "", "2026-06-07T21:12:00.000Z"],
      [
        "-05:00",
        "users/me/dataTypes/exercise-session/dataPoints/51817963271",
        "2026-06-08T12:12:00.000Z",
      ],
      [
        "+10:00",
        "users/me/dataTypes/exercise-session/dataPoints/51817963271",
        "2026-06-07T21:12:00.000Z",
      ],
      [
        "-05:00",
        "users/me/dataTypes/exercise-session/dataPoints/opaque-77",
        "2026-06-08T12:12:00.000Z",
      ],
    ])("updates the legacy row in place for UTC%s with name %j, without duplicates", async (offset, name, utc) => {
      const { pod } = await demoImport(fitbitAdapter);
      const source = provider({ "exercise-session": [{ ...at(offset), ...(name && { name }) }] });
      for (let i = 0; i < 2; i++) {
        const report = await run(source, { pod }).result;
        expect(report.skipped).toBeUndefined();
      }
      const ds = pod.dataset(ACT);
      const subjects = new Set(
        [...ds.match(null, DataFactory.namedNode(`${SCHEMA}exerciseType`), null)].map(
          (q) => q.subject.value,
        ),
      );
      expect(subjects.size).toBe(3);
      const ex = new ExerciseAction(`${ACT}#activity-51817963271`, ds, DataFactory);
      expect(ex.identifier).toBe("51817963271");
      expect(ex.startTime?.toISOString()).toBe(utc);
    });

    it("skips (never throws on) a numeric id colliding with an unrelated legacy activity", async () => {
      const { pod } = await demoImport(fitbitAdapter);
      const onWarning = vi.fn();
      const source = provider({
        "exercise-session": [
          {
            ...at("-05:00"),
            startTime: "2026-06-08T09:00:00-05:00",
            endTime: "2026-06-08T09:30:00-05:00",
            name: "users/me/dataTypes/exercise-session/dataPoints/51817991042",
          },
        ],
      });
      const report = await run(source, { pod, adapter: adapterAt(FIXTURE_NOW, { onWarning }) })
        .result;
      expect(report.skipped).toBe(1);
      expect(onWarning).toHaveBeenCalledOnce();
      expect(
        new ExerciseAction(`${ACT}#activity-51817991042`, pod.dataset(ACT), DataFactory).name,
      ).toBe("Walk");
      expect(cursorsOf(report.cursor)["exercise-session"]).toBe(UNTIL);
    });
  });

  it("keeps an old complete daily total when its own civil date has a malformed point", async () => {
    const first = run();
    const report = await first.result;
    const day = `${ROOT}health/daily/2026-06-08/steps.ttl`;
    const next = { ...STEPS, startTime: "2026-06-09T00:00:00Z", endTime: "2026-06-10T00:00:00Z" };
    const r = run(
      provider({
        steps: [
          { ...STEPS, steps: { count: 10 } },
          { ...STEPS, startTime: "2026-06-08T01:00:00Z", steps: { count: -1 } },
          { ...next, steps: { count: 4000 } },
        ],
      }),
      { pod: first.pod, cursor: report.cursor },
    );
    const second = await r.result;
    expect(second.skipped).toBe(1);
    expect(values(r.pod, day, `${SCHEMA}value`)).toEqual(["6120"]);
    expect(values(r.pod, `${ROOT}health/daily/2026-06-09/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "4000",
    ]);
    expect(cursorsOf(second.cursor).steps).toBe(UNTIL);
    // Summaries re-read two extra UTC days so a civil date left pending is complete.
    expect(requests(r.api, "steps")[0]?.searchParams.get("filter")).toBe(
      'endTime > "2026-06-06T00:00:00.000Z" AND endTime <= "2026-06-07T00:00:00.000Z"',
    );
  });

  it("drops an unattributable malformed summary point's window dates only", async () => {
    const r = run(
      provider(
        { steps: [STEPS, { ...STEPS, startTime: "2026-06-09T00:00:00Z", endTime: UNTIL }] },
        {
          extra: (type, from) =>
            type === "steps" && from === Date.parse("2026-06-08T00:00:00Z") ? [null] : [],
        },
      ),
    );
    const report = await r.result;
    expect(report.skipped).toBe(1);
    expect(r.pod.get(`${ROOT}health/daily/2026-06-08/steps.ttl`)).toBeUndefined();
    expect(r.pod.get(`${ROOT}health/daily/2026-06-09/steps.ttl`)).toBeDefined();
  });

  it("buckets civil-day summaries in the provider's offset (UTC-5) by their civil date", async () => {
    const r = run(
      provider({
        steps: [
          {
            startTime: "2026-06-07T00:00:00-05:00",
            endTime: "2026-06-08T00:00:00-05:00",
            steps: { count: 9000 },
          },
          {
            startTime: "2026-06-08T00:00:00-05:00",
            endTime: "2026-06-08T12:00:00-05:00",
            steps: { count: 300 },
          },
          {
            startTime: "2026-06-08T12:00:00-05:00",
            endTime: "2026-06-08T21:00:00-05:00",
            steps: { count: 200 },
          },
        ],
      }),
    );
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    // The 2026-06-08 civil date spans two UTC request windows and is summed whole.
    expect(values(r.pod, `${ROOT}health/daily/2026-06-07/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "9000",
    ]);
    expect(values(r.pod, `${ROOT}health/daily/2026-06-08/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "500",
    ]);
    expect(values(r.pod, `${ROOT}health/daily/2026-06-07/steps.ttl`, `${SCHEMA}startTime`)).toEqual(
      ["2026-06-07T05:00:00.000Z"],
    );
    expect(cursorsOf(report.cursor).steps).toBe(UNTIL);
  });

  it("never rebuilds a civil date that began before the re-read range", async () => {
    const r = run(
      provider({
        steps: [
          {
            startTime: "2026-06-06T23:00:00+10:00",
            endTime: "2026-06-07T00:00:00+10:00",
            steps: { count: 5 },
          },
          STEPS,
        ],
      }),
      { cursor: checkpoint({ steps: UNTIL }) },
    );
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-06/"))).toBe(false);
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-08/"))).toBe(true);
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

  it("follows 3 reconcile pages within one day and treats an empty token as completion, deduplicating repeated points", async () => {
    const hour = (h: number, count: number) => ({
      startTime: `2026-06-08T0${h}:00:00Z`,
      endTime: `2026-06-08T0${h + 1}:00:00Z`,
      steps: { count },
    });
    const r = run(
      provider(
        { steps: [hour(0, 100), hour(1, 200), hour(1, 200), hour(2, 300)] },
        { pageSize: 2 },
      ),
      {
        adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 3 }),
      },
    );
    const report = await r.result;
    const day = requests(r.api, "steps").filter((u) =>
      u.searchParams.get("filter")?.startsWith('endTime > "2026-06-08T'),
    );
    expect(day.map((u) => u.searchParams.get("pageToken"))).toEqual([null, "p2"]);
    expect(requests(r.api, "steps").every((u) => u.searchParams.get("pageSize") === "1000")).toBe(
      true,
    );
    expect(requests(r.api, "steps").every((u) => u.pathname.endsWith(":reconcile"))).toBe(true);
    expect(report.skipped).toBeUndefined();
    expect(values(r.pod, `${ROOT}health/daily/2026-06-08/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "600",
    ]);
  });

  it("uses per-type 48h overlap on one-day windows and updates replayed minutes in place", async () => {
    const initial = run();
    const first = await initial.result;
    const source = provider({
      "heart-rate": [
        { ...HEART_RATE, heartRate: { beatsPerMinute: 75 } },
        { ...HEART_RATE, time: "2026-06-09T07:12:00Z" },
      ],
    });
    const r = run(source, { cursor: first.cursor, pod: initial.pod });
    const report = await r.result;
    const hr = requests(r.api, "heart-rate");
    expect(hr.map((u) => u.searchParams.get("filter"))).toEqual([
      'time >= "2026-06-08T00:00:00.000Z" AND time < "2026-06-09T00:00:00.000Z"',
      'time >= "2026-06-09T00:00:00.000Z" AND time < "2026-06-10T00:00:00.000Z"',
    ]);
    expect(hr.every((u) => !u.pathname.includes(":reconcile"))).toBe(true);
    expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-08.ttl`, `${SCHEMA}value`)).toEqual([
      "75",
    ]);
    expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-09.ttl`, `${SCHEMA}value`)).toEqual([
      "72",
    ]);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(UNTIL);
  });

  it("aggregates phone and watch samples at the same second into one minute, never throwing", async () => {
    const phone = { platform: "ANDROID", device: { formFactor: "PHONE" } };
    const watch = { platform: "FITBIT", device: { formFactor: "WATCH" } };
    const onWarning = vi.fn();
    const r = run(
      provider({
        "heart-rate": [
          { ...HEART_RATE, dataSource: phone, heartRate: { beatsPerMinute: 72 } },
          { ...HEART_RATE, dataSource: watch, heartRate: { beatsPerMinute: 74 } },
          {
            ...HEART_RATE,
            time: "2026-06-08T07:12:30Z",
            dataSource: watch,
            heartRate: { beatsPerMinute: 80 },
          },
          // The same source sends two values for one instant: the latest update wins.
          {
            ...HEART_RATE,
            time: "2026-06-08T07:13:00Z",
            dataSource: watch,
            updateTime: "2026-06-08T08:00:00Z",
            heartRate: { beatsPerMinute: 60 },
          },
          {
            ...HEART_RATE,
            time: "2026-06-08T07:13:00Z",
            dataSource: watch,
            updateTime: "2026-06-08T07:30:00Z",
            heartRate: { beatsPerMinute: 99 },
          },
        ],
      }),
      { adapter: adapterAt(FIXTURE_NOW, { onWarning }) },
    );
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    const url = `${ROOT}health/heart-rate/2026-06-08.ttl`;
    const minute = `${url}#minute-07-12`;
    const get = (subject: string, predicate: string) =>
      [
        ...r.pod
          .dataset(url)
          .match(DataFactory.namedNode(subject), DataFactory.namedNode(predicate), null),
      ].map((q) => q.object.value);
    expect(get(minute, `${SCHEMA}value`)).toEqual(["75.33"]);
    expect(get(minute, `${SCHEMA}minValue`)).toEqual(["72"]);
    expect(get(minute, `${SCHEMA}maxValue`)).toEqual(["80"]);
    expect(get(minute, HEALTH_VOCAB.sampleCount)).toEqual(["3"]);
    expect(get(`${url}#minute-07-13`, `${SCHEMA}value`)).toEqual(["60"]);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("1 conflicting"));
  });

  it("resolves same-key conflicts without a data source deterministically (larger value)", async () => {
    for (const order of [
      [72, 74],
      [74, 72],
    ]) {
      const r = run(
        provider({
          "heart-rate": order.map((bpm) => ({ ...HEART_RATE, heartRate: { beatsPerMinute: bpm } })),
        }),
      );
      await expect(r.result).resolves.toBeDefined();
      expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-08.ttl`, `${SCHEMA}value`)).toEqual([
        "74",
      ]);
    }
  });

  it("keeps a sample keyed by data source for weight", async () => {
    const r = run(
      provider({
        weight: [
          { ...WEIGHT, dataSource: { platform: "SCALE" } },
          { ...WEIGHT, dataSource: { platform: "MANUAL" }, weight: { kilograms: 71 } },
        ],
      }),
    );
    await r.result;
    expect(values(r.pod, `${ROOT}health/weight/2026-06-08.ttl`, `${SCHEMA}value`).sort()).toEqual([
      "70",
      "71",
    ]);
  });

  it("completes 200k heart-rate points over 5 days across several budgeted runs with no gap or duplicate", async () => {
    const start = Date.parse("2026-06-01T00:00:00Z");
    const points = Array.from({ length: 200_000 }, (_, k) => ({
      time: new Date(start + k * 2160).toISOString(),
      heartRate: { beatsPerMinute: 50 + (k % 70) },
    }));
    const source = provider({ "heart-rate": points });
    const adapter = adapterAt("2026-06-06T00:00:00Z", {
      lookbackDays: 5,
      limits: { maxRequests: 512, maxItems: 100_000 },
    });
    const pod = createMemoryPod();
    let cursor: string | undefined;
    const progress: string[] = [];
    for (let i = 0; i < 4 && progress.at(-1) !== "2026-06-06T00:00:00.000Z"; i++) {
      const report = await run(source, { adapter, pod, cursor }).result;
      cursor = report.cursor;
      progress.push(cursorsOf(cursor)["heart-rate"] as string);
    }
    expect(progress).toEqual([
      "2026-06-03T00:00:00.000Z",
      "2026-06-05T00:00:00.000Z",
      "2026-06-06T00:00:00.000Z",
    ]);
    let total = 0;
    for (let d = 1; d <= 5; d++) {
      const url = `${ROOT}health/heart-rate/2026-06-0${d}.ttl`;
      const counts = values(pod, url, HEALTH_VOCAB.sampleCount).map(Number);
      expect(counts).toHaveLength(1440);
      total += counts.reduce((a, b) => a + b, 0);
    }
    expect(total).toBe(200_000);
  }, 120_000);

  it("keeps a 1 Hz heart-rate day imported twice under the 16 MiB read limit", async () => {
    const start = Date.parse("2026-06-08T00:00:00Z");
    const points = Array.from({ length: 86_400 }, (_, k) => ({
      time: new Date(start + k * 1000).toISOString(),
      heartRate: { beatsPerMinute: 50 + (k % 90) },
    }));
    const source = provider({ "heart-rate": points });
    const pod = createMemoryPod();
    const first = await run(source, { pod }).result;
    await run(source, { pod, cursor: first.cursor }).result;
    const url = `${ROOT}health/heart-rate/2026-06-08.ttl`;
    const bytes = new TextEncoder().encode(pod.get(url) ?? "").length;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(16 * 1024 * 1024);
    expect(values(pod, url, HEALTH_VOCAB.sampleCount)).toHaveLength(1440);
  }, 120_000);

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

  it("keys a named sleep session by its resource name so a revised session updates in place", async () => {
    const name = "users/me/dataTypes/sleep/dataPoints/night-1";
    const pod = createMemoryPod();
    await run(provider({ sleep: [{ ...SLEEP, name }] }), { pod }).result;
    const revised = { ...SLEEP, name, startTime: "2026-06-08T22:30:00Z", sleep: { stages: [] } };
    await run(provider({ sleep: [revised] }), { pod }).result;
    const sleepDocs = pod.urls().filter((u) => u.includes("/health/sleep/"));
    expect(sleepDocs).toEqual([`${ROOT}health/sleep/sleep-night-1.ttl`]);
    expect(values(pod, sleepDocs[0]!, `${SCHEMA}startTime`)).toEqual(["2026-06-08T22:30:00.000Z"]);
  });

  it("skips a bad sleep point once and advances the cursor; later runs import later sessions", async () => {
    const bad = {
      ...SLEEP,
      sleep: { stages: [{ ...SLEEP.sleep.stages[0], startTime: "2026-06-08T21:00:00Z" }] },
    };
    const later = {
      ...SLEEP,
      startTime: "2026-06-10T22:00:00Z",
      endTime: "2026-06-11T06:00:00Z",
      sleep: { stages: [] },
    };
    const source = provider({ sleep: [bad, later] });
    const pod = createMemoryPod();
    const first = await run(source, { pod }).result;
    expect(first.skipped).toBe(1);
    expect(cursorsOf(first.cursor).sleep).toBe(UNTIL);
    const second = await run(source, {
      pod,
      cursor: first.cursor,
      adapter: adapterAt("2026-06-12T00:00:00Z"),
    }).result;
    // Re-read once inside the 48 h overlap, never holding the cursor.
    expect(second.skipped).toBe(1);
    expect(cursorsOf(second.cursor).sleep).toBe("2026-06-12T00:00:00.000Z");
    expect(pod.urls().filter((u) => u.includes("/health/sleep/"))).toEqual([
      `${ROOT}health/sleep/sleep-2026-06-10T22%3A00%3A00.000Z.ttl`,
    ]);
    const third = await run(source, {
      pod,
      cursor: second.cursor,
      adapter: adapterAt("2026-06-15T00:00:00Z"),
    }).result;
    expect(third.skipped).toBeUndefined();
    expect(cursorsOf(third.cursor).sleep).toBe("2026-06-15T00:00:00.000Z");
  });

  it.each([
    null,
    {},
    { dataPoints: null },
    { dataPoints: [], nextPageToken: null },
    { dataPoints: [], nextPageToken: 7 },
    { dataPoints: [], nextPageToken: "x".repeat(MAX_TOKEN_CHARS + 1) },
    { dataPoints: Array(MAX_PAGE_ITEMS + 1).fill(null) },
  ])("fails malformed page %j before writing that window and preserves the checkpoint", async (json) => {
    const r = run(routes("steps", [json]), { state: prior });
    await expect(r.result).rejects.toThrow(/page/);
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it("bounds repeated and endless tokens within one day", async () => {
    for (const source of [
      [{ dataPoints: [], nextPageToken: "same" }],
      [
        { dataPoints: [], nextPageToken: "one" },
        { dataPoints: [], nextPageToken: "two" },
      ],
    ]) {
      const r = run(routes("steps", source), { adapter: adapterAt(FIXTURE_NOW, { maxPages: 2 }) });
      await expect(r.result).rejects.toThrow(/cursor|page cap/);
      expect(r.api).toHaveBeenCalledTimes(2);
    }
  });

  it("ends each type gracefully at its last written day when its own budget runs out", async () => {
    const r = run(GOOGLE_HEALTH_FIXTURES, {
      adapter: adapterAt(FIXTURE_NOW, {
        lookbackDays: 3,
        limits: { maxRequests: 2, maxItems: 100 },
      }),
    });
    const report = await r.result;
    // Windows 06-07 and 06-08 fit; 06-09 (sleep's day) does not.
    for (const type of TYPES) {
      expect(cursorsOf(report.cursor)[type]).toBe("2026-06-09T00:00:00.000Z");
      expect(requests(r.api, type)).toHaveLength(2);
    }
    expect(report.written.some((d) => d.url.includes("/sleep/"))).toBe(false);
    expect(report.written.some((d) => d.url.endsWith("/heart-rate/2026-06-08.ttl"))).toBe(true);
    // The next run continues from there.
    const next = await run(GOOGLE_HEALTH_FIXTURES, {
      pod: r.pod,
      cursor: report.cursor,
      adapter: adapterAt(FIXTURE_NOW, {
        lookbackDays: 3,
        limits: { maxRequests: 2, maxItems: 100 },
      }),
    }).result;
    expect(cursorsOf(next.cursor)["heart-rate"]).toBe(UNTIL);
    expect(next.written.some((d) => d.url.includes("/sleep/"))).toBe(true);
  });

  it("ends the run gracefully when the whole-run budget runs out, keeping untouched cursors", async () => {
    const r = run(GOOGLE_HEALTH_FIXTURES, {
      state: prior,
      adapter: adapterAt(FIXTURE_NOW, {
        lookbackDays: 3,
        runLimits: { maxRequests: 4, maxItems: 1000 },
      }),
    });
    const report = await r.result;
    const cursors = cursorsOf(report.cursor);
    expect(cursors.steps).toBe(UNTIL);
    expect(cursors.distance).toBe("2026-06-08T00:00:00.000Z");
    expect(cursors["heart-rate"]).toBe("2026-06-09T07:12:00.000Z");
    expect(cursors.sleep).toBeUndefined();
  });

  it.each([
    [{ limits: { maxRequests: 100, maxItems: 1 } }, /type budget/],
    [{ runLimits: { maxRequests: 100, maxItems: 1 } }, /run budget/],
    [{ limits: { maxRequests: 100, maxItems: 100, maxBytes: 1 } }, /type budget/],
  ] as const)("fails when not even one day fits (%j)", async (options, message) => {
    const day = {
      startTime: "2026-06-09T00:00:00Z",
      endTime: "2026-06-09T01:00:00Z",
      steps: { count: 1 },
    };
    const r = run(
      provider({
        steps: [
          day,
          { ...day, startTime: "2026-06-09T01:00:00Z", endTime: "2026-06-09T02:00:00Z" },
        ],
      }),
      {
        adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 1, ...options }),
      },
    );
    await expect(r.result).rejects.toThrow(message);
    expect(r.pod.urls().some((u) => u.includes("/health/"))).toBe(false);
  });

  it("cancels oversized JSON without parsing", async () => {
    const cancel = vi.fn();
    const r = run(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-length": String(MAX_PAGE_BYTES + 1) },
        }),
    );
    await expect(r.result).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("charges sleep stages to the type's item budget", async () => {
    const r = run(provider({ sleep: [SLEEP] }), {
      adapter: adapterAt(FIXTURE_NOW, { limits: { maxRequests: 100, maxItems: 3 } }),
    });
    const report = await r.result;
    expect(cursorsOf(report.cursor).sleep).toBe("2026-06-09T00:00:00.000Z");
    expect(r.pod.urls().some((u) => u.includes("/sleep/"))).toBe(false);
  });

  it("holds the cursor at the window of a future (transient) point; other windows advance", async () => {
    const now = "2026-06-11T07:12:00Z";
    const r = run(
      provider(
        { "heart-rate": [{ ...HEART_RATE, time: "2026-06-08T07:12:00Z" }] },
        {
          extra: (type, _from, to) =>
            type === "heart-rate" && to === Date.parse(now)
              ? [{ ...HEART_RATE, time: "2026-06-11T07:12:01Z" }]
              : [],
        },
      ),
      { cursor: checkpoint({ "heart-rate": "2026-06-09T07:12:00.000Z" }), adapter: adapterAt(now) },
    );
    const report = await r.result;
    expect(report.skipped).toBe(1);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-11T00:00:00.000Z");
    expect(report.written.some((d) => d.url.endsWith("/heart-rate/2026-06-08.ttl"))).toBe(true);
  });

  it("ignores points the provider returns for another window", async () => {
    const r = run(routes("heart-rate", [{ dataPoints: [HEART_RATE] }]), {
      adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 3 }),
    });
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    expect(
      values(r.pod, `${ROOT}health/heart-rate/2026-06-08.ttl`, HEALTH_VOCAB.sampleCount),
    ).toEqual(["1"]);
  });

  it.each([
    429, 500, 503,
  ])("backs off HTTP %i and succeeds without duplicating points", async (status) => {
    vi.useFakeTimers();
    let calls = 0;
    const fixtures = fixtureFetch("google-health", GOOGLE_HEALTH_FIXTURES);
    const r = run(
      async (input, init) =>
        ++calls === 1
          ? new Response("", { status, headers: { "retry-after": "2" } })
          : fixtures(input, init),
      { adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 3 }) },
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(r.api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await r.result).written).toHaveLength(5);
    expect(r.api).toHaveBeenCalledTimes(TYPES.length * 3 + 1);
  });

  it("caps retries and keeps the prior checkpoint on persistent throttling", async () => {
    const r = run(async () => new Response("", { status: 429, headers: { "retry-after": "0" } }), {
      state: prior,
    });
    await expect(r.result).rejects.toMatchObject({ status: 429 });
    expect(r.api).toHaveBeenCalledTimes(4);
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
  });

  it("aborts backoff promptly without another request or pod write", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const r = run(async () => new Response("", { status: 429, headers: { "retry-after": "60" } }), {
      signal: controller.signal,
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
    JSON.stringify({ version: 2, cursors: { unknown: "2026-01-01T00:00:00Z" }, fetchedAt: {} }),
    JSON.stringify({
      version: 2,
      cursors: { steps: "2026-06-09T00:00:00Z" },
      fetchedAt: { steps: "2026-06-08T00:00:00Z" },
    }),
    JSON.stringify({ version: 2, cursors: { steps: "2026-06-09T00:00:00Z" }, fetchedAt: {} }),
    JSON.stringify({ version: 3, cursors: {}, fetchedAt: {} }),
  ])("rejects invalid stored cursor %s before source traffic", async (cursor) => {
    const r = run(undefined, { cursor });
    await expect(r.result).rejects.toThrow(/checkpoint/);
    expect(r.api).not.toHaveBeenCalled();
  });

  it("continues a version 1 checkpoint from its end time", async () => {
    const r = run(provider({}), {
      cursor: JSON.stringify({ version: 1, cursors: { weight: "2026-06-09T12:00:00.000Z" } }),
    });
    await r.result;
    expect(requests(r.api, "weight")[0]?.searchParams.get("filter")).toContain(
      'time >= "2026-06-07T00:00:00.000Z"',
    );
  });

  it("refuses retired Fitbit live runs before contacting a provider", async () => {
    const api = vi.fn<typeof fetch>();
    const r = run(api, { adapter: fitbitAdapter as ReturnType<typeof createGoogleHealthAdapter> });
    await expect(r.result).rejects.toThrow(/Google Health/);
    expect(api).not.toHaveBeenCalled();
  });

  it("skips hostile individual payloads, reports the count and still advances that type cursor", async () => {
    const r = run(
      provider(
        { "heart-rate": [HEART_RATE] },
        {
          extra: (type, from) =>
            type === "heart-rate" && from === Date.parse("2026-06-08T00:00:00Z")
              ? [null, {}, { ...HEART_RATE, heartRate: { beatsPerMinute: -1 } }]
              : [],
        },
      ),
      { state: prior },
    );
    const report = await r.result;
    expect(report.skipped).toBe(3);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(UNTIL);
  });

  it("resolves inconsistent reconciled duplicates deterministically and drops overlapping days only", async () => {
    const onWarning = vi.fn();
    const r = run(provider({ steps: [STEPS, { ...STEPS, steps: { count: 3 } }] }), {
      adapter: adapterAt(FIXTURE_NOW, { onWarning }),
    });
    await r.result;
    expect(values(r.pod, `${ROOT}health/daily/2026-06-08/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "6120",
    ]);
    expect(onWarning).toHaveBeenCalledOnce();
    const p = point("steps", STEPS)!;
    const other = point("steps", { ...STEPS, startTime: "2026-06-08T12:00:00Z" })!;
    const mapper = new HealthMapper((s) => ROOT + s);
    expect(healthDocuments([p, other], (s) => ROOT + s, undefined, mapper)).toEqual([]);
    expect(mapper.skipped).toBe(2);
  });

  it("maps nameless points deterministically, keys named sessions by resource, bounds stages, and rejects unsafe names and invalid samples", () => {
    const exercise = point("exercise-session", { ...EXERCISE, name: "" })!;
    expect(exercise.key).toBe(point("exercise-session", { ...EXERCISE, name: "" })?.key);
    expect(
      point("exercise-session", {
        ...EXERCISE,
        name: "users/me/dataTypes/exercise-session/dataPoints/opaque-id",
      })?.key,
    ).toBe("google-health-exercise-opaque-id");
    expect(
      point("sleep", {
        ...SLEEP,
        sleep: { stages: Array(MAX_STAGES + 1).fill(SLEEP.sleep.stages[0]) },
      }),
    ).toBeUndefined();
    expect(point("sleep", SLEEP)?.key).toBe("sleep-2026-06-08T22:00:00.000Z");
    expect(
      point("sleep", { ...SLEEP, name: "users/me/dataTypes/sleep/dataPoints/opaque-id" })?.key,
    ).toBe("sleep-opaque-id");
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
    await expect(gh.import({ scopes: [], api } as unknown as ImportContext)).rejects.toThrow(
      /permissions/,
    );
    expect(api).not.toHaveBeenCalled();
  });

  it("receives the token's granted scopes through source auth and refuses a partial grant", async () => {
    const api = vi.fn<typeof fetch>();
    const partial = createSourceAuth(
      "google-health",
      gh,
      {
        accessToken: "fixture",
        tokenType: "Bearer",
        scope: `${ACTIVITY_SCOPE} ${SLEEP_SCOPE}`,
      },
      api,
    );
    expect(partial.scopes).toEqual([ACTIVITY_SCOPE, SLEEP_SCOPE]);
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: gh,
        mode: "live",
        sourceAuth: partial,
        podWriter: createFetchPodWriter({
          adapterId: "google-health",
          podRoot: TEST_POD_ROOT,
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          fetch: pod.fetch,
        }),
      }),
    ).rejects.toThrow(/Re-authorize/);
    expect(api).not.toHaveBeenCalled();
    const full = run(GOOGLE_HEALTH_FIXTURES, {
      scopes: [...GOOGLE_HEALTH_SCOPES, "openid"],
    });
    await expect(full.result).resolves.toBeDefined();
    expect(METRICS_SCOPE).toContain("health_metrics_and_measurements");
  });

  it("skips (never throws on) ambiguous and repeated legacy activity matches", () => {
    const ds = new Store();
    for (const id of ["1", "2"]) {
      const ex = new ExerciseAction(`${ACT}#activity-${id}`, ds, DataFactory).mark();
      ex.exerciseType = "Run";
      ex.startTime = new Date(EXERCISE.startTime);
    }
    const p = point("exercise-session", { ...EXERCISE, name: "" })!;
    const ambiguous = new HealthMapper((s) => ROOT + s);
    expect(healthDocuments([p], (s) => ROOT + s, ds, ambiguous)).toEqual([]);
    expect(ambiguous.skipped).toBe(1);
    const repeated = new HealthMapper((s) => ROOT + s);
    const [doc] = healthDocuments(
      [p, { ...p, end: "2026-06-08T07:44:00.000Z" }],
      (s) => ROOT + s,
      undefined,
      repeated,
    );
    expect(repeated.skipped).toBe(1);
    expect(
      [...doc!.dataset.match(null, DataFactory.namedNode(`${SCHEMA}duration`), null)].map(
        (q) => q.object.value,
      ),
    ).toEqual(["PT31M"]);
  });

  it("protects legacy ids even when their stored start time is absent", () => {
    const ds = new Store();
    new ExerciseAction(`${ACT}#activity-51817963271`, ds, DataFactory).mark().name = "Legacy";
    const p = point("exercise-session", EXERCISE)!;
    const mapper = new HealthMapper((s) => ROOT + s);
    expect(healthDocuments([p], (s) => ROOT + s, ds, mapper)).toEqual([]);
    expect(mapper.skipped).toBe(1);
  });

  it("serializes Google Health and Fitbit imports against their shared container", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixtures = fixtureFetch("google-health", GOOGLE_HEALTH_FIXTURES);
    const first = run(async (input, init) => {
      await blocked;
      return fixtures(input, init);
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
    const mapper = new HealthMapper((s) => ROOT + s);
    expect(healthDocuments([p], (s) => ROOT + s, ds, mapper)).toEqual([]);
    expect(mapper.skipped).toBe(1);
    new Provenance(iri, ds, DataFactory).derivedFrom.add(SOURCE_ORIGIN);
    const [doc] = healthDocuments([p], (s) => ROOT + s, ds);
    expect(new ExerciseAction(iri, doc!.dataset, DataFactory).startTime?.toISOString()).toBe(
      p.start,
    );
  });

  it("uses reconcile and existing typed measurement fields for distance and calories", async () => {
    const r = run(
      provider({
        distance: [
          { startTime: STEPS.startTime, endTime: STEPS.endTime, distance: { meters: 5200 } },
        ],
        calories: [
          { startTime: STEPS.startTime, endTime: STEPS.endTime, calories: { kilocalories: 432 } },
        ],
      }),
    );
    const report = await r.result;
    for (const [type, value, unit] of [
      ["distance", "5200", "m"],
      ["calories", "432", "kcal"],
    ]) {
      const doc = report.written.find((d) => d.url.endsWith(`/${type}.ttl`))!;
      expect(values(r.pod, doc.url, `${SCHEMA}value`)).toEqual([value]);
      expect(values(r.pod, doc.url, `${SCHEMA}unitText`)).toEqual([unit]);
    }
  });

  it("caps streamed JSON without a content-length header and cancels it", async () => {
    const cancel = vi.fn();
    let sent = false;
    const r = run(
      async () =>
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
    );
    await expect(r.result).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    401, 403,
  ])("maps API HTTP %i (after any host refresh) to re-authorisation guidance", async (status) => {
    const r = run(async () => new Response("", { status }), { state: prior });
    const error = await r.result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationAuthError);
    expect((error as Error).message).toMatch(/Re-authorize Google Health/);
    expect(r.api).toHaveBeenCalledOnce();
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
  });

  it("does not retry a nontransient API HTTP 404", async () => {
    const r = run(async () => new Response("", { status: 404 }));
    await expect(r.result).rejects.toMatchObject({ status: 404 });
    expect(r.api).toHaveBeenCalledOnce();
  });

  it("refuses a provider delay over the wait cap without waiting", async () => {
    const r = run(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "99999999999999999999" } }),
    );
    await expect(r.result).rejects.toMatchObject({ status: 429 });
    expect(r.api).toHaveBeenCalledOnce();
  });

  it("advances empty type cursors to the run's end and writes no empty documents", async () => {
    const r = run(provider({}), { state: prior });
    const report = await r.result;
    expect(report.written).toHaveLength(0);
    expect(Object.values(cursorsOf(report.cursor))).toEqual(TYPES.map(() => UNTIL));
  });

  it("validates its options", () => {
    expect(() => createGoogleHealthAdapter({ lookbackDays: 0 })).toThrow(/lookbackDays/);
    expect(() => createGoogleHealthAdapter({ maxPages: 101 })).toThrow(/maxPages/);
    expect(() => createGoogleHealthAdapter({ runLimits: { maxRequests: 0, maxItems: 1 } })).toThrow(
      /limits/,
    );
  });

  it("stores the Node checkpoint beside Fitbit's in the shared container without a stray container", () => {
    const store = (adapterId: string) =>
      createStateStore({
        podRoot: TEST_POD_ROOT,
        adapterId,
        webId: TEST_WEBID,
        fetch: vi.fn<typeof fetch>(),
      }).url;
    expect(store("google-health")).toBe(`${ROOT}state-google-health.json`);
    expect(store("fitbit")).toBe(`${ROOT}state.json`);
    expect(store("spotify")).toBe(`${TEST_POD_ROOT}integrations/spotify/state.json`);
  });
});
