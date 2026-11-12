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
  summary,
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
} from "./fixtures.js";
import { HealthMapper, healthDocuments } from "./mapping.js";
import { syntheticHealthApi } from "./testing.js";
import { HEALTH_VOCAB } from "./vocab-map.js";

const ROOT = `${TEST_POD_ROOT}integrations/fitbit/`;
const ACT = `${ROOT}health/activities.ttl`;
const UNTIL = FIXTURE_NOW.toISOString();
/** Daily totals are final once their civil date has ended in every offset (UTC+14). */
const FINAL = "2026-06-09T00:00:00.000Z";
const LIST_TYPES = TYPES.filter((t) => !summary(t));
const adapterAt = (now: Date | string = FIXTURE_NOW, options: GoogleHealthOptions = {}) =>
  createGoogleHealthAdapter({ now: () => new Date(now), ...options });
const gh = adapterAt();
/** Version 3 checkpoint whose windows were read at their own end. */
const checkpoint = (cursors: Partial<Record<HealthType, string>>) =>
  JSON.stringify({ version: 3, cursors, fetchedAt: cursors });
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
/** The demo fixtures with one type answered by `pages` in order. */
const routes = (type: HealthType, pages: unknown[]): FixtureRoute[] => [
  ...GOOGLE_HEALTH_FIXTURES.filter((r) => r.url !== endpoint(type)),
  ...pages.map((json) => ({ url: endpoint(type), json, ...(summary(type) && { method: "POST" }) })),
];

type Raw = Record<string, unknown>;
const civil = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return {
    date: { year, month, day },
    time: { hours: Number(iso.slice(11, 13)), minutes: Number(iso.slice(14, 16)) },
  };
};
const offsetText = (offset: string) => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h, m] = offset.slice(1).split(":").map(Number);
  return `${sign * ((h as number) * 3600 + (m as number) * 60)}s`;
};
/** A heart-rate DataPoint at `time` (UTC) with `bpm` and optional extra members. */
const hr = (time: string, bpm: unknown = "72", extra: Raw = {}): Raw => ({
  ...extra,
  heartRate: { sampleTime: { physicalTime: time, utcOffset: "0s" }, beatsPerMinute: bpm },
});
const weightAt = (time: string, grams: number, extra: Raw = {}): Raw => ({
  ...extra,
  weight: { sampleTime: { physicalTime: time, utcOffset: "0s" }, weightGrams: grams },
});
/** An exercise at local wall-clock `local` in `offset` (e.g. "-05:00"), lasting 31 minutes. */
const exerciseAt = (local: string, offset = "+00:00", extra: Raw = {}, payload: Raw = {}): Raw => {
  const start = new Date(`${local}${offset}`);
  const end = new Date(start.getTime() + 31 * 60_000);
  const localEnd = new Date(Date.parse(`${local}Z`) + 31 * 60_000).toISOString();
  return {
    ...extra,
    exercise: {
      interval: {
        startTime: start.toISOString().replace(".000Z", "Z"),
        endTime: end.toISOString().replace(".000Z", "Z"),
        startUtcOffset: offsetText(offset),
        endUtcOffset: offsetText(offset),
        civilStartTime: civil(local),
        civilEndTime: civil(localEnd),
      },
      exerciseType: "RUNNING",
      displayName: "Run",
      metricsSummary: { distanceMillimeters: 5_200_000 },
      ...payload,
    },
  };
};
type SleepPayload = typeof SLEEP.sleep;
const sleepWith = (sleep: Partial<SleepPayload> & Raw, extra: Raw = {}): Raw => ({
  ...SLEEP,
  ...extra,
  sleep: { ...SLEEP.sleep, ...sleep },
});
const sleepAt = (start: string, end: string, extra: Raw = {}): Raw =>
  sleepWith(
    {
      interval: {
        ...SLEEP.sleep.interval,
        startTime: start,
        endTime: end,
        civilStartTime: civil(start),
        civilEndTime: civil(end),
      },
      stages: [],
    },
    extra,
  );

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
    .map(([url, init]) =>
      Object.assign(new URL(String(url)), { init: init as RequestInit | undefined }),
    )
    .filter((u) => u.pathname.includes(`/dataTypes/${type}/`));
const rollupBody = (u: { init?: RequestInit }) => JSON.parse(String(u.init?.body)) as Raw;
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

  it("updates an equivalent legacy Fitbit exercise in place with the same id and fields, preserving other legacy items", async () => {
    const { pod: legacy } = await demoImport(fitbitAdapter);
    const fields = (ex: ExerciseAction) => [
      ex.name,
      ex.identifier,
      ex.exerciseType,
      ex.duration,
      ex.distance,
      ex.startTime,
    ];
    const iri = `${ACT}#activity-51817963271`;
    const before = fields(new ExerciseAction(iri, legacy.dataset(ACT), DataFactory));
    await demoImport(gh, { pod: legacy });
    const after = new ExerciseAction(iri, legacy.dataset(ACT), DataFactory);
    expect(after.types.has(CLASSES.ExerciseAction)).toBe(true);
    expect(fields(after)).toEqual(before);
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
    // Without a legacy row, a numeric Google id keeps its own subject.
    const { pod: fresh } = await demoImport(gh);
    const own = new ExerciseAction(
      `${ACT}#activity-google-health-exercise-51817963271`,
      fresh.dataset(ACT),
      DataFactory,
    );
    expect([own.identifier, own.name, own.distance]).toEqual(["51817963271", "Run", "5.2 km"]);
  });

  it("moves demo fixtures (instants and civil dates) by whole days into the first-import lookback", async () => {
    const now = new Date("2026-11-12T09:30:00Z");
    expect(demoFixtures(FIXTURE_NOW)).toBe(GOOGLE_HEALTH_FIXTURES);
    const shifted = JSON.stringify(demoFixtures(now));
    expect(shifted).toContain('"2026-11-10T07:12:00Z"');
    expect(shifted).toContain('{"year":2026,"month":11,"day":10}');
    expect(shifted).not.toContain("2026-06-");
    expect(shifted).not.toContain('"month":6');
    const { report } = await demoImport(adapterAt(now));
    const urls = report.written.map((d) => d.url);
    expect(urls).toContain(`${ROOT}health/heart-rate/2026-11-10.ttl`);
    expect(urls).toContain(`${ROOT}health/daily/2026-11-10/steps.ttl`);
  });

  it("imports daily totals, per-day samples, sleep stages and weight with provenance and stable re-imports", async () => {
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
    for (const type of TYPES) expect(cursors[type]).toBe(summary(type) ? FINAL : UNTIL);
    const sleep = report.written.find((d) => d.url.includes("/sleep/"))!;
    expect(first.pod.get(sleep.url)).toContain("deep");
    expect(values(first.pod, sleep.url, `${SCHEMA}hasPart`)).toHaveLength(3);
    expect(first.pod.get(`${ROOT}health/heart-rate/2026-06-08.ttl`)).toContain("bpm");
    expect(values(first.pod, `${ROOT}health/weight/2026-06-08.ttl`, `${SCHEMA}value`)).toEqual([
      "70",
    ]);
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
    "users/me/dataTypes/exercise/dataPoints/google-new-id",
  ])("retains a stored Fitbit id when Google supplies %j", async (name) => {
    const { pod } = await demoImport(fitbitAdapter);
    const r = run(routes("exercise", [{ dataPoints: [{ ...EXERCISE, name }] }]), { pod });
    await r.result;
    const ds = pod.dataset(ACT);
    const ex = new ExerciseAction(`${ACT}#activity-51817963271`, ds, DataFactory);
    expect(ex.identifier).toBe("51817963271");
    expect([...ds.match(null, DataFactory.namedNode(`${SCHEMA}startTime`), null)]).toHaveLength(3);
  });

  describe("non-UTC Fitbit users (legacy rows hold local wall-clock time with a Z suffix)", () => {
    it.each([
      ["-05:00", "", "2026-06-08T12:12:00.000Z"],
      ["+10:00", "", "2026-06-07T21:12:00.000Z"],
      ["-05:00", "users/me/dataTypes/exercise/dataPoints/51817963271", "2026-06-08T12:12:00.000Z"],
      ["+10:00", "users/me/dataTypes/exercise/dataPoints/51817963271", "2026-06-07T21:12:00.000Z"],
      ["-05:00", "users/me/dataTypes/exercise/dataPoints/opaque-77", "2026-06-08T12:12:00.000Z"],
    ])("updates the legacy row in place for UTC%s with name %j, without duplicates", async (offset, name, utc) => {
      const { pod } = await demoImport(fitbitAdapter);
      const source = syntheticHealthApi({
        points: { exercise: [exerciseAt("2026-06-08T07:12:00", offset, name ? { name } : {})] },
      });
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

    it("imports a numeric id colliding with an unrelated legacy activity under its own subject", async () => {
      const { pod } = await demoImport(fitbitAdapter);
      const source = syntheticHealthApi({
        points: {
          exercise: [
            exerciseAt("2026-06-08T09:00:00", "-05:00", {
              name: "users/me/dataTypes/exercise/dataPoints/51817991042",
            }),
          ],
        },
      });
      const report = await run(source, { pod }).result;
      expect(report.skipped).toBeUndefined();
      expect(
        new ExerciseAction(`${ACT}#activity-51817991042`, pod.dataset(ACT), DataFactory).name,
      ).toBe("Walk");
      expect(
        new ExerciseAction(
          `${ACT}#activity-google-health-exercise-51817991042`,
          pod.dataset(ACT),
          DataFactory,
        ).name,
      ).toBe("Run");
      expect(cursorsOf(report.cursor).exercise).toBe(UNTIL);
    });
  });

  it("keeps an old daily total when its own civil date's rollup value is invalid", async () => {
    const first = run();
    const report = await first.result;
    const day = `${ROOT}health/daily/2026-06-08/steps.ttl`;
    const r = run(
      syntheticHealthApi({
        rollups: {
          steps: { "2026-06-08": { countSum: "-1" }, "2026-06-09": { countSum: "4000" } },
        },
      }),
      { pod: first.pod, cursor: report.cursor },
    );
    const second = await r.result;
    expect(second.skipped).toBe(1);
    expect(values(r.pod, day, `${SCHEMA}value`)).toEqual(["6120"]);
    expect(values(r.pod, `${ROOT}health/daily/2026-06-09/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "4000",
    ]);
    expect(cursorsOf(second.cursor).steps).toBe(FINAL);
    // Totals re-read from 48 h before the previous read, through UTC+14's civil today.
    expect(rollupBody(requests(r.api, "steps")[0]!).range).toEqual({
      start: { date: { year: 2026, month: 6, day: 8 } },
      end: { date: { year: 2026, month: 6, day: 11 } },
    });
  });

  it("refuses a rollup bucket that is not one civil day and ignores buckets outside the range", async () => {
    const outside = {
      ...STEPS,
      civilStartTime: { date: { year: 2026, month: 6, day: 1 } },
      civilEndTime: { date: { year: 2026, month: 6, day: 2 } },
    };
    const twoDays = { ...STEPS, civilEndTime: { date: { year: 2026, month: 6, day: 10 } } };
    const r = run(
      routes("steps", [
        {
          rollupDataPoints: [
            outside,
            twoDays,
            {
              ...STEPS,
              civilStartTime: { date: { year: 2026, month: 6, day: 9 } },
              civilEndTime: { date: { year: 2026, month: 6, day: 10 } },
            },
          ],
        },
      ]),
      { cursor: checkpoint({ steps: UNTIL }) },
    );
    const report = await r.result;
    expect(report.skipped).toBe(1);
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-01/"))).toBe(false);
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-08/"))).toBe(false);
    expect(report.written.some((d) => d.url.includes("/daily/2026-06-09/"))).toBe(true);
  });

  it("names a daily total by its civil date without inventing a UTC instant", async () => {
    const r = run(syntheticHealthApi({ rollups: { steps: { "2026-06-07": { countSum: 9000 } } } }));
    await r.result;
    const url = `${ROOT}health/daily/2026-06-07/steps.ttl`;
    expect(values(r.pod, url, `${SCHEMA}value`)).toEqual(["9000"]);
    expect(values(r.pod, url, `${SCHEMA}identifier`)).toEqual(["2026-06-07"]);
    expect(values(r.pod, url, `${SCHEMA}startTime`)).toEqual([]);
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

  it("follows list and rollup pages, treats an absent token as completion and deduplicates repeated points", async () => {
    const r = run(
      syntheticHealthApi(
        {
          points: {
            "heart-rate": [
              hr("2026-06-08T07:12:00Z", "70"),
              hr("2026-06-08T07:12:30Z", "80"),
              hr("2026-06-08T07:12:30Z", "80"),
              hr("2026-06-08T07:13:00Z", "90"),
            ],
          },
          rollups: { steps: { "2026-06-07": { countSum: "1" }, "2026-06-08": { countSum: "2" } } },
        },
        { pageSize: 2 },
      ),
      { adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 3 }) },
    );
    const report = await r.result;
    const day = requests(r.api, "heart-rate").filter((u) =>
      u.searchParams.get("filter")?.includes('>= "2026-06-08T'),
    );
    expect(day.map((u) => u.searchParams.get("pageToken"))).toEqual([null, "p2"]);
    expect(
      requests(r.api, "heart-rate").every(
        (u) =>
          u.searchParams.get("pageSize") === String(MAX_PAGE_ITEMS) && !u.pathname.includes(":"),
      ),
    ).toBe(true);
    expect(requests(r.api, "steps").map((u) => rollupBody(u).pageToken)).toEqual([undefined, "r2"]);
    expect(report.skipped).toBeUndefined();
    const url = `${ROOT}health/heart-rate/2026-06-08.ttl`;
    expect(values(r.pod, url, `${SCHEMA}value`).sort()).toEqual(["75", "90"]);
    expect(values(r.pod, url, HEALTH_VOCAB.sampleCount).sort()).toEqual(["1", "2"]);
    expect(values(r.pod, `${ROOT}health/daily/2026-06-08/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "2",
    ]);
  });

  it("uses per-type 48h overlap on one-day windows and updates replayed minutes in place", async () => {
    const initial = run();
    const first = await initial.result;
    const source = syntheticHealthApi({
      points: {
        "heart-rate": [hr("2026-06-08T07:12:00Z", "75"), hr("2026-06-09T07:12:00Z", "72")],
      },
    });
    const r = run(source, { cursor: first.cursor, pod: initial.pod });
    const report = await r.result;
    const field = "heart_rate.sample_time.physical_time";
    expect(requests(r.api, "heart-rate").map((u) => u.searchParams.get("filter"))).toEqual([
      `${field} >= "2026-06-08T00:00:00Z" AND ${field} < "2026-06-09T00:00:00Z"`,
      `${field} >= "2026-06-09T00:00:00Z" AND ${field} < "2026-06-10T00:00:00Z"`,
    ]);
    expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-08.ttl`, `${SCHEMA}value`)).toEqual([
      "75",
    ]);
    expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-09.ttl`, `${SCHEMA}value`)).toEqual([
      "72",
    ]);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(UNTIL);
  });

  it("aggregates phone and watch samples at the same second into one minute, never throwing", async () => {
    const phone = { dataSource: { platform: "HEALTH_CONNECT", device: { formFactor: "PHONE" } } };
    const watch = { dataSource: { platform: "FITBIT", device: { formFactor: "WATCH" } } };
    const onWarning = vi.fn();
    const r = run(
      syntheticHealthApi({
        points: {
          "heart-rate": [
            hr("2026-06-08T07:12:00Z", "72", phone),
            hr("2026-06-08T07:12:00Z", "74", watch),
            hr("2026-06-08T07:12:30Z", "80", watch),
            // The same source sends two values for one instant: the larger value wins.
            hr("2026-06-08T07:13:00Z", "60", watch),
            hr("2026-06-08T07:13:00Z", "99", watch),
          ],
        },
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
    expect(get(`${url}#minute-07-13`, `${SCHEMA}value`)).toEqual(["99"]);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("1 conflicting"));
  });

  it("resolves same-key conflicts without a data source deterministically (larger value)", async () => {
    for (const order of [
      ["72", "74"],
      ["74", "72"],
    ]) {
      const r = run(
        syntheticHealthApi({
          points: { "heart-rate": order.map((bpm) => hr("2026-06-08T07:12:00Z", bpm)) },
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
      syntheticHealthApi({
        points: {
          weight: [
            weightAt("2026-06-08T07:00:00Z", 70_000, { dataSource: { platform: "FITBIT" } }),
            weightAt("2026-06-08T07:00:00Z", 71_000, { dataSource: { platform: "HEALTH_KIT" } }),
          ],
        },
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
    const points = Array.from({ length: 200_000 }, (_, k) =>
      hr(new Date(start + k * 2160).toISOString(), 50 + (k % 70)),
    );
    const source = syntheticHealthApi({ points: { "heart-rate": points } });
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
    const points = Array.from({ length: 86_400 }, (_, k) =>
      hr(new Date(start + k * 1000).toISOString(), 50 + (k % 90)),
    );
    const source = syntheticHealthApi({ points: { "heart-rate": points } });
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
      routes("sleep", [{ dataPoints: [sleepWith({ stages: SLEEP.sleep.stages.slice(0, 1) })] }]),
      { pod: first.pod },
    );
    const report = await r.result;
    const doc = report.written.find((d) => d.url.includes("/sleep/"))!;
    expect(r.pod.get(doc.url)).not.toContain("#stage-2");
  });

  it("keys a named sleep session by its resource name so a revised session updates in place", async () => {
    const name = "users/me/dataTypes/sleep/dataPoints/night-1";
    const pod = createMemoryPod();
    await run(syntheticHealthApi({ points: { sleep: [{ ...SLEEP, name }] } }), { pod }).result;
    const revised = sleepAt("2026-06-08T22:30:00Z", "2026-06-09T06:00:00Z", { name });
    await run(syntheticHealthApi({ points: { sleep: [revised] } }), { pod }).result;
    const sleepDocs = pod.urls().filter((u) => u.includes("/health/sleep/"));
    expect(sleepDocs).toEqual([`${ROOT}health/sleep/sleep-night-1.ttl`]);
    expect(values(pod, sleepDocs[0]!, `${SCHEMA}startTime`)).toEqual(["2026-06-08T22:30:00.000Z"]);
  });

  it("skips an invalid sleep point once and advances the cursor; later runs import later sessions", async () => {
    const bad = sleepWith({
      stages: [{ ...SLEEP.sleep.stages[0]!, startTime: "2026-06-08T21:00:00Z" }],
    });
    const later = sleepAt("2026-06-10T22:00:00Z", "2026-06-11T06:00:00Z");
    const source = syntheticHealthApi({ points: { sleep: [bad, later] } });
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
    ["heart-rate", null],
    ["heart-rate", []],
    ["heart-rate", { dataPoints: null }],
    ["heart-rate", { dataPoints: [], nextPageToken: null }],
    ["heart-rate", { dataPoints: [], nextPageToken: 7 }],
    ["heart-rate", { dataPoints: [], nextPageToken: "x".repeat(MAX_TOKEN_CHARS + 1) }],
    ["heart-rate", { dataPoints: Array(MAX_PAGE_ITEMS + 1).fill(null) }],
    ["sleep", { dataPoints: Array(26).fill(null) }],
    ["steps", { rollupDataPoints: {} }],
    ["total-calories", { rollupDataPoints: Array(15).fill(null) }],
  ] as const)("fails a malformed %s page %j before writing that window and preserves the checkpoint", async (type, json) => {
    const r = run(routes(type, [json]), { state: prior });
    await expect(r.result).rejects.toThrow(/page/);
    expect(r.onState).toHaveBeenLastCalledWith({ ...prior, lastOutcome: "error" });
  });

  it("accepts proto3 empty pages that omit their list and token", async () => {
    const r = run(routes("heart-rate", [{}]), { state: prior });
    const report = await r.result;
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(UNTIL);
  });

  it("fails on a repeated page token and stops a type at the page cap without failing the run", async () => {
    const repeated = run(routes("steps", [{ nextPageToken: "same" }]), {
      adapter: adapterAt(FIXTURE_NOW, { maxPages: 2 }),
    });
    await expect(repeated.result).rejects.toThrow(/repeated page cursor/);
    expect(repeated.api).toHaveBeenCalledTimes(2);
    let n = 0;
    const onWarning = vi.fn();
    const fixtures = fixtureFetch("google-health", GOOGLE_HEALTH_FIXTURES);
    const endless = run(
      async (input, init) =>
        String(input).includes("/steps/")
          ? new Response(JSON.stringify({ nextPageToken: `t${++n}` }))
          : fixtures(input, init),
      {
        adapter: adapterAt(FIXTURE_NOW, { maxPages: 2, lookbackDays: 1, onWarning }),
        state: prior,
      },
    );
    const report = await endless.result;
    // The two-day range splits into single days; the first one alone exceeds the cap.
    expect(requests(endless.api, "steps")).toHaveLength(4);
    expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/steps reached the 2-page cap/));
    expect(cursorsOf(report.cursor).steps).toBeUndefined();
    expect(cursorsOf(report.cursor).weight).toBe(UNTIL);
  });

  it("ends each type gracefully at its last written window when its own budget runs out", async () => {
    const options = { lookbackDays: 3, limits: { maxRequests: 2, maxItems: 100 } };
    const r = run(GOOGLE_HEALTH_FIXTURES, { adapter: adapterAt(FIXTURE_NOW, options) });
    const report = await r.result;
    // List windows 06-07 and 06-08 fit; 06-09 (sleep's day) does not. A rollup is one request.
    for (const type of TYPES) {
      expect(cursorsOf(report.cursor)[type]).toBe("2026-06-09T00:00:00.000Z");
      expect(requests(r.api, type)).toHaveLength(summary(type) ? 1 : 2);
    }
    expect(report.written.some((d) => d.url.includes("/sleep/"))).toBe(false);
    expect(report.written.some((d) => d.url.endsWith("/heart-rate/2026-06-08.ttl"))).toBe(true);
    // The next run continues from there.
    const next = await run(GOOGLE_HEALTH_FIXTURES, {
      pod: r.pod,
      cursor: report.cursor,
      adapter: adapterAt(FIXTURE_NOW, options),
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
    expect([cursors.steps, cursors.distance, cursors["total-calories"]]).toEqual([
      FINAL,
      FINAL,
      FINAL,
    ]);
    expect(cursors.exercise).toBe("2026-06-08T00:00:00.000Z");
    expect(cursors["heart-rate"]).toBe("2026-06-09T07:12:00.000Z");
    expect(cursors.sleep).toBeUndefined();
  });

  it.each([
    [{ limits: { maxRequests: 100, maxItems: 1 } }, /type budget/],
    [{ runLimits: { maxRequests: 100, maxItems: 1 } }, /run budget/],
    [{ limits: { maxRequests: 100, maxItems: 100, maxBytes: 1 } }, /type budget/],
  ] as const)("fails when not even one window fits (%j)", async (options, message) => {
    const r = run(
      syntheticHealthApi({
        points: { "heart-rate": [hr("2026-06-09T00:00:00Z"), hr("2026-06-09T01:00:00Z")] },
      }),
      { adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 1, ...options }) },
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
    const r = run(syntheticHealthApi({ points: { sleep: [SLEEP] } }), {
      adapter: adapterAt(FIXTURE_NOW, {
        lookbackDays: 2,
        limits: { maxRequests: 100, maxItems: 3 },
      }),
    });
    const report = await r.result;
    expect(cursorsOf(report.cursor).sleep).toBe("2026-06-09T00:00:00.000Z");
    expect(r.pod.urls().some((u) => u.includes("/sleep/"))).toBe(false);
  });

  it("holds the cursor at the window of a future (transient) point; other windows advance", async () => {
    const now = "2026-06-11T07:12:00Z";
    const r = run(
      syntheticHealthApi(
        { points: { "heart-rate": [hr("2026-06-08T07:12:00Z")] } },
        {
          extra: (type, _from, to) =>
            type === "heart-rate" && to === Date.parse(now) ? [hr("2026-06-11T07:12:01Z")] : [],
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
    // Three one-day windows per list type, one rollup range per summary type, one retry.
    expect(r.api).toHaveBeenCalledTimes(
      LIST_TYPES.length * 3 + (TYPES.length - LIST_TYPES.length) + 1,
    );
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
    JSON.stringify({ version: 3, cursors: { unknown: "2026-01-01T00:00:00Z" }, fetchedAt: {} }),
    JSON.stringify({ version: 3, cursors: { calories: "2026-06-09T00:00:00Z" }, fetchedAt: {} }),
    JSON.stringify({
      version: 3,
      cursors: { steps: "2026-06-09T00:00:00Z" },
      fetchedAt: { steps: "2026-06-08T00:00:00Z" },
    }),
    JSON.stringify({ version: 3, cursors: { steps: "2026-06-09T00:00:00Z" }, fetchedAt: {} }),
    JSON.stringify({ version: 3, cursors: {} }),
    JSON.stringify({ version: 4, cursors: {}, fetchedAt: {} }),
  ])("rejects invalid stored cursor %s before source traffic", async (cursor) => {
    const r = run(undefined, { cursor });
    await expect(r.result).rejects.toThrow(/checkpoint/);
    expect(r.api).not.toHaveBeenCalled();
  });

  it.each([
    JSON.stringify({ version: 1, cursors: { weight: "2026-06-09T12:00:00.000Z" } }),
    JSON.stringify({
      version: 2,
      cursors: { calories: "2026-06-09T00:00:00.000Z" },
      fetchedAt: {},
    }),
  ])("restarts the pre-v3 checkpoint %s at the lookback window with a warning", async (cursor) => {
    const onWarning = vi.fn();
    const r = run(syntheticHealthApi({}), {
      cursor,
      adapter: adapterAt(FIXTURE_NOW, { lookbackDays: 2, onWarning }),
    });
    await r.result;
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("parser version 3"));
    expect(requests(r.api, "weight")[0]?.searchParams.get("filter")).toContain(
      '>= "2026-06-08T00:00:00Z"',
    );
  });

  it("refuses retired Fitbit live runs before contacting a provider", async () => {
    const api = vi.fn<typeof fetch>();
    const r = run(api, { adapter: fitbitAdapter as ReturnType<typeof createGoogleHealthAdapter> });
    await expect(r.result).rejects.toThrow(/Google Health/);
    expect(api).not.toHaveBeenCalled();
  });

  it("skips invalid sample values, reports the count and still advances that type cursor", async () => {
    const good = Array.from({ length: 30 }, (_, i) => hr(`2026-06-08T07:${String(10 + i)}:00Z`));
    const r = run(
      syntheticHealthApi(
        { points: { "heart-rate": good } },
        {
          extra: (type, from) =>
            type === "heart-rate" && from === Date.parse("2026-06-08T00:00:00Z")
              ? [
                  hr("2026-06-08T09:00:00Z", "0"),
                  hr("2026-06-08T09:01:00Z", "-1"),
                  hr("2026-06-08T09:02:00Z", 301),
                  { ...hr("2026-06-08T09:03:00Z"), name: "users/me/dataTypes/weight/dataPoints/1" },
                ]
              : [],
        },
      ),
      { state: prior },
    );
    const report = await r.result;
    expect(report.skipped).toBe(4);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(UNTIL);
  });

  it("resolves conflicting rollup buckets for one date deterministically (larger value)", async () => {
    const onWarning = vi.fn();
    const r = run(
      routes("steps", [{ rollupDataPoints: [STEPS, { ...STEPS, steps: { countSum: "3" } }] }]),
      {
        adapter: adapterAt(FIXTURE_NOW, { onWarning }),
      },
    );
    await r.result;
    expect(values(r.pod, `${ROOT}health/daily/2026-06-08/steps.ttl`, `${SCHEMA}value`)).toEqual([
      "6120",
    ]);
    expect(onWarning).toHaveBeenCalledOnce();
  });

  it("maps nameless points deterministically, keys named sessions by resource, bounds stages, and rejects unsafe names and invalid samples", () => {
    const exercise = point("exercise", { ...EXERCISE, name: "" })!;
    expect(exercise.key).toBe("google-health-exercise-2026-06-08T07:12:00.000Z-RUNNING");
    expect(point("exercise", { ...EXERCISE, name: "" })?.key).toBe(exercise.key);
    expect(
      point("exercise", { ...EXERCISE, name: "users/me/dataTypes/exercise/dataPoints/opaque-id" })
        ?.key,
    ).toBe("google-health-exercise-opaque-id");
    expect(point("exercise", EXERCISE)?.key).toBe("google-health-exercise-51817963271");
    expect(
      point("sleep", sleepWith({ stages: Array(MAX_STAGES + 1).fill(SLEEP.sleep.stages[0]) })),
    ).toBeUndefined();
    expect(point("sleep", SLEEP)?.key).toBe("sleep-2026-06-08T22:00:00.000Z");
    expect(
      point("sleep", { ...SLEEP, name: "users/me/dataTypes/sleep/dataPoints/opaque-id" })?.key,
    ).toBe("sleep-opaque-id");
    expect(
      point("sleep", sleepWith({ stages: [SLEEP.sleep.stages[0]!, SLEEP.sleep.stages[0]!] })),
    ).toBeUndefined();
    expect(point("weight", weightAt("invalid", 70_000))).toBeUndefined();
    expect(
      point("weight", weightAt("2026-06-08T07:00:00Z", Number.POSITIVE_INFINITY)),
    ).toBeUndefined();
    expect(
      point("exercise", {
        ...EXERCISE,
        name: "users/me/dataTypes/exercise/dataPoints/../../bad",
      }),
    ).toBeUndefined();
    expect(
      point("exercise", {
        ...EXERCISE,
        exercise: { ...EXERCISE.exercise, displayName: "a".repeat(257) },
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
      ex.startTime = new Date(EXERCISE.exercise.interval.startTime);
    }
    const p = point("exercise", { ...EXERCISE, name: "" })!;
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

  it("matches a numeric Google id to a legacy logId only with the same type within 14 h, never overwriting another row", () => {
    const iri = `${ACT}#activity-51817963271`;
    const own = `${ACT}#activity-google-health-exercise-51817963271`;
    const p = point("exercise", EXERCISE)!;
    const subjects = (legacy: (ex: ExerciseAction, ds: Store) => void) => {
      const ds = new Store();
      legacy(new ExerciseAction(iri, ds, DataFactory).mark(), ds);
      const mapper = new HealthMapper((s) => ROOT + s);
      const [doc] = healthDocuments([p], (s) => ROOT + s, ds, mapper);
      expect(mapper.skipped).toBe(0);
      return new Set([...doc!.dataset].map((q) => q.subject.value));
    };
    // No stored start, another type, too far apart, or a Google-derived row: a new subject.
    expect(subjects((ex) => (ex.name = "Legacy"))).toEqual(new Set([own]));
    for (const [type, start] of [
      ["Walk", "2026-06-08T07:12:00Z"],
      ["Run", "2026-06-07T07:12:00Z"],
    ])
      expect(
        subjects((ex) => {
          ex.exerciseType = type;
          ex.startTime = new Date(start as string);
        }),
      ).toEqual(new Set([own]));
    expect(
      subjects((ex, ds) => {
        ex.exerciseType = "Run";
        ex.startTime = new Date("2026-06-07T21:12:00Z");
        new Provenance(iri, ds, DataFactory).derivedFrom.add(SOURCE_ORIGIN);
      }),
    ).toEqual(new Set([own]));
    // The same type within any civil offset of the legacy wall clock: the legacy row.
    expect(
      subjects((ex) => {
        ex.exerciseType = "Run";
        ex.startTime = new Date("2026-06-08T02:12:00Z");
      }),
    ).toEqual(new Set([iri]));
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

  it("uses dailyRollUp and existing typed measurement fields for distance and total calories", async () => {
    const r = run(
      syntheticHealthApi({
        rollups: {
          distance: { "2026-06-08": { millimetersSum: "5200000" } },
          "total-calories": { "2026-06-08": { kcalSum: 432 } },
        },
      }),
    );
    const report = await r.result;
    for (const [type, value, unit] of [
      ["distance", "5200", "m"],
      ["total-calories", "432", "kcal"],
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

  it("advances empty type cursors to the run's end (totals to their last final date) and writes no empty documents", async () => {
    const r = run(syntheticHealthApi({}), { state: prior });
    const report = await r.result;
    expect(report.written).toHaveLength(0);
    expect(Object.values(cursorsOf(report.cursor))).toEqual(
      TYPES.map((t) => (summary(t) ? FINAL : UNTIL)),
    );
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
