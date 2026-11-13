// AUTHORED-BY Claude Opus 5.5
/**
 * Regression tests for the round-2 review of the Google Health adapter: every request and
 * payload shape here follows the v4 reference (discovery revision 20261110), not a synthetic
 * profile. Fixtures are synthetic and contain no personal data.
 */
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  type SyntheticHealthData,
  syntheticHealthApi,
} from "../../test-support/google-health-api.js";
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { IntegrationAuthError, RateLimitedError } from "../core/errors.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  demoImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState } from "../core/types.js";
import { ExerciseAction, SCHEMA } from "../core/vocab.js";
import { fitbitAdapter } from "../fitbit/adapter.js";
import { createGoogleHealthAdapter, type GoogleHealthOptions } from "./adapter.js";
import { point } from "./api.js";
import { createGoogleHealthSourceAuth } from "./source-auth.js";

const V4 = "https://health.googleapis.com/v4/users/me/dataTypes";
const ROOT = `${TEST_POD_ROOT}integrations/fitbit/`;
const ACT = `${ROOT}health/activities.ttl`;
const NOW = "2026-06-10T00:00:00Z";
const date = (d: string) => {
  const [year, month, day] = d.split("-").map(Number);
  return { year, month, day };
};
const civil = (d: string, hours = 0, minutes = 0) => ({
  date: date(d),
  time: { hours, minutes },
});
/** A heart-rate DataPoint in the documented shape. */
const hr = (physicalTime: string, bpm: unknown, utcOffset = "0s") => ({
  dataSource: { platform: "FITBIT", device: { formFactor: "WATCH" } },
  heartRate: { sampleTime: { physicalTime, utcOffset }, beatsPerMinute: bpm },
});
/** An exercise DataPoint in the documented shape: 07:12 local, UTC-5. */
const run5 = (overrides: Record<string, unknown> = {}) => ({
  exercise: {
    interval: {
      startTime: "2026-06-08T12:12:00Z",
      endTime: "2026-06-08T12:43:00Z",
      startUtcOffset: "-18000s",
      endUtcOffset: "-18000s",
      civilStartTime: civil("2026-06-08", 7, 12),
      civilEndTime: civil("2026-06-08", 7, 43),
    },
    exerciseType: "RUNNING",
    displayName: "Running",
    metricsSummary: { distanceMillimeters: 5_200_000 },
    ...overrides,
  },
});
const SLEEP = {
  name: "users/me/dataTypes/sleep/dataPoints/a1b2c3d4-e5f6-7890-1234-567890abcdef",
  sleep: {
    interval: {
      startTime: "2026-06-08T22:00:00Z",
      endTime: "2026-06-09T06:00:00Z",
      startUtcOffset: "0s",
      endUtcOffset: "0s",
    },
    type: "STAGES",
    stages: [
      {
        type: "LIGHT",
        startTime: "2026-06-08T22:00:00Z",
        endTime: "2026-06-09T00:00:00Z",
        startUtcOffset: "0s",
        endUtcOffset: "0s",
      },
      {
        type: "DEEP",
        startTime: "2026-06-09T00:00:00Z",
        endTime: "2026-06-09T06:00:00Z",
        startUtcOffset: "0s",
        endUtcOffset: "0s",
      },
    ],
    metadata: { processed: true },
  },
};

const prior: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00Z",
  lastSync: "2026-06-09T00:00:00Z",
  cursor: JSON.stringify({
    version: 3,
    cursors: { "heart-rate": "2026-06-09T00:00:00.000Z" },
    fetchedAt: { "heart-rate": "2026-06-09T00:00:00.000Z" },
  }),
  lastOutcome: "success",
  counts: { documents: 1, items: 1, skipped: 0 },
};

function run(
  source: typeof fetch,
  options: GoogleHealthOptions & {
    now?: string;
    cursor?: string;
    state?: ConnectorState;
    pod?: ReturnType<typeof createMemoryPod>;
  } = {},
) {
  const { now = NOW, cursor, state, pod = createMemoryPod(), ...adapterOptions } = options;
  const api = vi.fn(source);
  const onState = vi.fn();
  const result = runImport({
    adapter: createGoogleHealthAdapter({ now: () => new Date(now), ...adapterOptions }),
    mode: "live",
    sourceAuth: { fetch: api },
    podWriter: createFetchPodWriter({
      adapterId: "google-health",
      podRoot: TEST_POD_ROOT,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      fetch: pod.fetch,
    }),
    cursor,
    state,
    onState,
  });
  return { result, api, pod, onState };
}
const synthetic = (data: SyntheticHealthData, options?: Parameters<typeof syntheticHealthApi>[1]) =>
  syntheticHealthApi(data, options);
const values = (pod: ReturnType<typeof createMemoryPod>, url: string, predicate: string) =>
  [...pod.dataset(url).match(null, DataFactory.namedNode(predicate), null)].map(
    (q) => q.object.value,
  );
const cursorsOf = (cursor: string | undefined) =>
  (JSON.parse(cursor ?? "{}") as { version: number; cursors: Record<string, string> }).cursors;
const calls = (api: ReturnType<typeof vi.fn>, type: string) =>
  api.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), init: init as RequestInit }))
    .filter(({ url }) => url.pathname.includes(`/dataTypes/${type}/`));

describe("Google Health v4 request grammar (R1)", () => {
  it("uses the documented filter field for each type, never mixing physical and civil bounds", async () => {
    const r = run(synthetic({}), { lookbackDays: 1 });
    await r.result;
    const list = (type: string) => calls(r.api, type).map(({ url }) => url);
    const [heart] = list("heart-rate");
    expect(heart?.pathname).toBe("/v4/users/me/dataTypes/heart-rate/dataPoints");
    expect(heart?.searchParams.get("filter")).toBe(
      'heart_rate.sample_time.physical_time >= "2026-06-09T00:00:00Z" AND heart_rate.sample_time.physical_time < "2026-06-10T00:00:00Z"',
    );
    expect(list("weight")[0]?.searchParams.get("filter")).toBe(
      'weight.sample_time.physical_time >= "2026-06-09T00:00:00Z" AND weight.sample_time.physical_time < "2026-06-10T00:00:00Z"',
    );
    // Sleep filters only on its end time; exercise only on its civil start time (widened by
    // the largest civil offsets so every session starting in the UTC window is returned).
    const [sleep] = list("sleep");
    expect(sleep?.searchParams.get("filter")).toBe(
      'sleep.interval.end_time >= "2026-06-09T00:00:00Z" AND sleep.interval.end_time < "2026-06-10T00:00:00Z"',
    );
    expect(sleep?.searchParams.get("pageSize")).toBe("25");
    const [exercise] = list("exercise");
    expect(exercise?.pathname).toBe("/v4/users/me/dataTypes/exercise/dataPoints");
    expect(exercise?.searchParams.get("filter")).toBe(
      'exercise.interval.civil_start_time >= "2026-06-08T10:00:00" AND exercise.interval.civil_start_time < "2026-06-10T14:00:00"',
    );
    expect(exercise?.searchParams.get("pageSize")).toBe("25");
  });

  it("reads civil-day totals from dailyRollUp with a civil date range and the documented page size", async () => {
    const r = run(synthetic({}), { lookbackDays: 1 });
    await r.result;
    for (const [type, pageSize] of [
      ["steps", 90],
      ["distance", 90],
      ["total-calories", 14],
    ] as const) {
      const [call] = calls(r.api, type);
      expect(call?.url.href).toBe(`${V4}/${type}/dataPoints:dailyRollUp`);
      expect(call?.init.method).toBe("POST");
      expect(JSON.parse(String(call?.init.body))).toEqual({
        range: { start: { date: date("2026-06-09") }, end: { date: date("2026-06-11") } },
        windowSizeDays: 1,
        pageSize,
      });
    }
    expect(calls(r.api, "calories")).toHaveLength(0);
    expect(calls(r.api, "exercise-session")).toHaveLength(0);
  });

  it("writes rollup totals per civil date, including 25 h and 23 h DST days, and skips no-data days (R4, R5)", async () => {
    const r = run(
      synthetic({
        rollups: {
          steps: { "2026-11-01": { countSum: "9000" }, "2026-11-02": { countSum: "0" } },
          distance: { "2026-11-01": { millimetersSum: "5200000" } },
          "total-calories": { "2026-11-01": { kcalSum: 2100.5 } },
        },
      }),
      { now: "2026-11-04T00:00:00Z", lookbackDays: 5 },
    );
    const report = await r.result;
    expect(report.skipped).toBeUndefined();
    const day = (d: string, type: string) => `${ROOT}health/daily/${d}/${type}.ttl`;
    expect(values(r.pod, day("2026-11-01", "steps"), `${SCHEMA}value`)).toEqual(["9000"]);
    expect(values(r.pod, day("2026-11-02", "steps"), `${SCHEMA}value`)).toEqual(["0"]);
    expect(values(r.pod, day("2026-11-01", "distance"), `${SCHEMA}value`)).toEqual(["5200"]);
    expect(values(r.pod, day("2026-11-01", "distance"), `${SCHEMA}unitText`)).toEqual(["m"]);
    expect(values(r.pod, day("2026-11-01", "total-calories"), `${SCHEMA}value`)).toEqual([
      "2100.5",
    ]);
    expect(report.written.some((d) => d.url.includes("/daily/2026-11-03/"))).toBe(false);
    // Final civil days end everywhere (UTC-14 … UTC+14) before the checkpoint.
    expect(cursorsOf(report.cursor).steps).toBe("2026-11-03T00:00:00.000Z");
  });
});

describe("Google Health v4 point shape (R1)", () => {
  it("reads nested sample times and int64 values sent as numbers or bounded digit strings", () => {
    expect(point("heart-rate", hr("2026-06-08T07:12:00Z", "72"))).toMatchObject({
      start: "2026-06-08T07:12:00.000Z",
      value: 72,
    });
    expect(point("heart-rate", hr("2026-06-08T07:12:00.123456789Z", 72))?.start).toBe(
      "2026-06-08T07:12:00.123Z",
    );
    for (const bpm of ["NaN", "Infinity", "-72", "7e1", "72.0", " 72", "0x48", "1".repeat(20)])
      expect(point("heart-rate", hr("2026-06-08T07:12:00Z", bpm))).toBeUndefined();
    expect(
      point("weight", {
        weight: { sampleTime: { physicalTime: "2026-06-08T07:00:00Z" }, weightGrams: 70_500 },
      })?.value,
    ).toBe(70.5);
  });

  it("rejects 0 bpm and out-of-range heart rates (R9)", () => {
    expect(point("heart-rate", hr("2026-06-08T07:12:00Z", "0"))).toBeUndefined();
    expect(point("heart-rate", hr("2026-06-08T07:12:00Z", "301"))).toBeUndefined();
    expect(point("heart-rate", hr("2026-06-08T07:12:00Z", "1"))?.value).toBe(1);
    expect(point("heart-rate", hr("2026-06-08T07:12:00Z", 300))?.value).toBe(300);
  });

  it("reads nested exercise intervals: exerciseType enum, displayName and millimetre distance", () => {
    expect(point("exercise", run5())).toMatchObject({
      start: "2026-06-08T12:12:00.000Z",
      end: "2026-06-08T12:43:00.000Z",
      activity: "Running",
      exerciseType: "RUNNING",
      distanceKm: 5.2,
      wallStart: "2026-06-08T07:12:00.000Z",
    });
    expect(point("exercise", run5({ exerciseType: "running" }))).toBeUndefined();
  });

  it("builds the legacy wall clock from civilTime or physicalTime + utcOffset, never the string's own offset (M3)", () => {
    const { civilStartTime: _, ...noCivil } = run5().exercise.interval;
    expect(point("exercise", run5({ interval: noCivil }))?.wallStart).toBe(
      "2026-06-08T07:12:00.000Z",
    );
    // An offset-bearing physical time is an instant; the wall clock still comes from utcOffset.
    const offsetString = { ...noCivil, startTime: "2026-06-08T07:12:00-05:00" };
    expect(point("exercise", run5({ interval: offsetString }))?.wallStart).toBe(
      "2026-06-08T07:12:00.000Z",
    );
    const zero = { ...noCivil, startTime: "2026-06-08T07:12:00-05:00", startUtcOffset: "0s" };
    expect(point("exercise", run5({ interval: zero }))?.wallStart).toBe("2026-06-08T12:12:00.000Z");
    for (const startUtcOffset of ["-18000", "5h", "-50401s", "1e3s"])
      expect(point("exercise", run5({ interval: { ...noCivil, startUtcOffset } }))).toBeUndefined();
  });

  it("reads documented sleep stage types and the processed flag", () => {
    const p = point("sleep", SLEEP);
    expect(p?.key).toBe("sleep-a1b2c3d4-e5f6-7890-1234-567890abcdef");
    expect(p?.stages?.map((s) => s.label)).toEqual(["light", "deep"]);
    expect(p?.pending).toBe(false);
    expect(
      point("sleep", { ...SLEEP, sleep: { ...SLEEP.sleep, metadata: { processed: false } } })
        ?.pending,
    ).toBe(true);
    const unknownStage = { ...SLEEP.sleep.stages[0], type: "DOZING" };
    expect(
      point("sleep", { ...SLEEP, sleep: { ...SLEEP.sleep, stages: [unknownStage] } }),
    ).toBeUndefined();
  });
});

describe("Google Health import behaviour", () => {
  it("updates a non-UTC legacy Fitbit row in place from the documented exercise shape (M3)", async () => {
    const { pod } = await demoImport(fitbitAdapter);
    for (let i = 0; i < 2; i++) {
      const report = await run(synthetic({ points: { exercise: [run5()] } }), { pod }).result;
      expect(report.skipped).toBeUndefined();
    }
    const ex = new ExerciseAction(`${ACT}#activity-51817963271`, pod.dataset(ACT), DataFactory);
    expect(ex.identifier).toBe("51817963271");
    expect(ex.startTime?.toISOString()).toBe("2026-06-08T12:12:00.000Z");
    expect(ex.distance).toBe("5.2 km");
    expect(values(pod, ACT, `${SCHEMA}exerciseType`)).toHaveLength(3);
  });

  it("keys an unmatched numeric Google id as google-health-exercise-<id>, never blocked by an unrelated Fitbit logId", async () => {
    const { pod } = await demoImport(fitbitAdapter);
    const named = {
      name: "users/me/dataTypes/exercise/dataPoints/51817991042",
      ...run5({
        interval: {
          ...run5().exercise.interval,
          startTime: "2026-06-08T14:00:00Z",
          endTime: "2026-06-08T14:30:00Z",
          civilStartTime: civil("2026-06-08", 9),
        },
      }),
    };
    const report = await run(synthetic({ points: { exercise: [named] } }), { pod }).result;
    expect(report.skipped).toBeUndefined();
    const ds = pod.dataset(ACT);
    expect(new ExerciseAction(`${ACT}#activity-51817991042`, ds, DataFactory).name).toBe("Walk");
    const google = new ExerciseAction(
      `${ACT}#activity-google-health-exercise-51817991042`,
      ds,
      DataFactory,
    );
    expect(google.identifier).toBe("51817991042");
    expect(google.startTime?.toISOString()).toBe("2026-06-08T14:00:00.000Z");
  });

  it("holds the cursor for an exercise that starts in the window but ends after the run clock", async () => {
    const now = "2026-06-09T12:30:00Z";
    const live = run5({
      interval: {
        ...run5().exercise.interval,
        startTime: "2026-06-09T12:12:00Z",
        endTime: "2026-06-09T12:43:00Z",
        civilStartTime: civil("2026-06-09", 7, 12),
      },
    });
    const r = run(synthetic({ points: { exercise: [live] } }), {
      now,
      cursor: JSON.stringify({
        version: 3,
        cursors: { exercise: "2026-06-09T00:00:00.000Z" },
        fetchedAt: { exercise: "2026-06-09T00:00:00.000Z" },
      }),
    });
    const report = await r.result;
    expect(r.pod.urls().some((u) => u.endsWith("health/activities.ttl"))).toBe(false);
    expect(cursorsOf(report.cursor).exercise).toBe("2026-06-09T00:00:00.000Z");
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe(now.replace("Z", ".000Z"));
  });

  it("holds sleep while Google is still processing its stages", async () => {
    const pending = { ...SLEEP, sleep: { ...SLEEP.sleep, metadata: { processed: false } } };
    const report = await run(synthetic({ points: { sleep: [pending] } })).result;
    expect(report.written.some((d) => d.url.includes("/health/sleep/"))).toBe(true);
    expect(cursorsOf(report.cursor).sleep).toBe("2026-06-09T00:00:00.000Z");
  });

  describe("unrecognised response shape (R2)", () => {
    it("stops only that type, keeping its checkpoint, when its points do not parse at all", async () => {
      // The synthetic profile the adapter used to expect is not the documented shape.
      const legacyShape = { time: "2026-06-09T07:12:00Z", heartRate: { beatsPerMinute: 72 } };
      const onWarning = vi.fn();
      const r = run(
        synthetic({}, { extra: (type) => (type === "heart-rate" ? [legacyShape] : []) }),
        { state: prior, onWarning },
      );
      const report = await r.result;
      const cursors = cursorsOf(report.cursor);
      expect(cursors["heart-rate"]).toBe("2026-06-09T00:00:00.000Z");
      expect(cursors.weight).toBe("2026-06-10T00:00:00.000Z");
      expect(onWarning).toHaveBeenCalledWith(
        expect.stringContaining("[google-health:unrecognised-shape]"),
      );
      expect(r.onState).toHaveBeenLastCalledWith(
        expect.objectContaining({ lastOutcome: "success" }),
      );
      expect(r.pod.urls().some((u) => u.includes("/heart-rate/"))).toBe(false);
    });

    it("stops a type once its unrecognised points this run pass the threshold, and skips fewer", async () => {
      const good = Array.from({ length: 9 }, (_, i) =>
        hr(`2026-06-09T07:${String(10 + i)}:00Z`, "70"),
      );
      const many = run(
        synthetic(
          { points: { "heart-rate": good } },
          { extra: (type) => (type === "heart-rate" ? [{ heartRate: {} }, null] : []) },
        ),
        { state: prior },
      );
      expect(cursorsOf((await many.result).cursor)["heart-rate"]).toBe("2026-06-09T00:00:00.000Z");
      const few = run(
        synthetic(
          { points: { "heart-rate": [...good, hr("2026-06-09T08:00:00Z", "71")] } },
          {
            extra: (type, from) =>
              type === "heart-rate" && from === Date.parse("2026-06-09T00:00:00Z") ? [null] : [],
          },
        ),
        { state: prior },
      );
      const report = await few.result;
      expect(report.skipped).toBe(1);
      expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-10T00:00:00.000Z");
    });

    it("writes parser version 3 and restarts an older checkpoint at the lookback window", async () => {
      const v2 = JSON.stringify({
        version: 2,
        cursors: { "heart-rate": "2026-06-09T00:00:00.000Z" },
        fetchedAt: { "heart-rate": "2026-06-09T00:00:00.000Z" },
      });
      const r = run(synthetic({}), { cursor: v2, lookbackDays: 5 });
      const report = await r.result;
      expect(JSON.parse(report.cursor ?? "{}").version).toBe(3);
      expect(calls(r.api, "heart-rate")[0]?.url.searchParams.get("filter")).toContain(
        '>= "2026-06-05T00:00:00Z"',
      );
    });
  });

  describe("page cap (R3)", () => {
    const capped = (endlessAbove: number): typeof fetch => {
      const inner = synthetic({ points: { "heart-rate": [hr("2026-06-09T01:30:00Z", "60")] } });
      return async (input, init) => {
        const url = new URL(String(input));
        const filter = url.searchParams.get("filter") ?? "";
        const bounds = [...filter.matchAll(/"([^"]+)"/g)].map((m) => Date.parse(m[1] as string));
        const span = (bounds[1] ?? 0) - (bounds[0] ?? 0);
        if (url.pathname.includes("/heart-rate/") && span > endlessAbove)
          return new Response(
            JSON.stringify({
              dataPoints: [],
              nextPageToken: `t${url.searchParams.get("pageToken") ?? ""}x`,
            }),
          );
        return inner(input, init);
      };
    };

    it("splits a capped window into 12 h, 6 h, 3 h and 1 h windows and records progress", async () => {
      const r = run(capped(6 * 3600_000), { lookbackDays: 1, maxPages: 2 });
      const report = await r.result;
      const spans = calls(r.api, "heart-rate").map(({ url }) => {
        const [a, b] = [...(url.searchParams.get("filter") ?? "").matchAll(/"([^"]+)"/g)].map((m) =>
          Date.parse(m[1] as string),
        );
        return ((b as number) - (a as number)) / 3600_000;
      });
      expect([...new Set(spans)]).toEqual([24, 12, 6]);
      expect(values(r.pod, `${ROOT}health/heart-rate/2026-06-09.ttl`, `${SCHEMA}value`)).toEqual([
        "60",
      ]);
      expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-10T00:00:00.000Z");
    });

    it("stops only that type gracefully when even a 1 h window is over the cap", async () => {
      const onWarning = vi.fn();
      const r = run(capped(0), { lookbackDays: 1, maxPages: 2, onWarning, state: prior });
      const report = await r.result;
      expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/page cap/));
      expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-09T00:00:00.000Z");
      expect(cursorsOf(report.cursor).weight).toBe("2026-06-10T00:00:00.000Z");
      expect(cursorsOf(report.cursor).steps).toBeDefined();
    });
  });

  it("retries a 403 whose reason is a rate or quota limit, then reports RateLimitedError (R7)", async () => {
    vi.useFakeTimers();
    try {
      const quota = () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              errors: [{ reason: "rateLimitExceeded", domain: "usageLimits" }],
            },
          }),
          { status: 403, headers: { "retry-after": "1" } },
        );
      const inner = synthetic({});
      let n = 0;
      const once = run(async (input, init) => (++n === 1 ? quota() : inner(input, init)), {
        lookbackDays: 1,
      });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(once.result).resolves.toBeDefined();
      const always = run(async () => quota(), { lookbackDays: 1 });
      const error = always.result.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await error).toBeInstanceOf(RateLimitedError);
      expect(always.api).toHaveBeenCalledTimes(4);
      const denied = run(
        async () => new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 }),
      );
      expect(await denied.result.catch((e: unknown) => e)).toBeInstanceOf(IntegrationAuthError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Google Health transport", () => {
  const config = createGoogleOAuthConfig("health", {
    clientType: "desktop",
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
  });
  const token = {
    accessToken: "fixture-access",
    tokenType: "Bearer",
    refreshToken: "fixture-refresh",
  };
  it("allows only a JSON-string dailyRollUp POST besides reads, and replays its body after a refresh", async () => {
    const bodies: unknown[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === config.tokenEndpoint)
        return new Response(JSON.stringify({ access_token: "fixture-new" }));
      bodies.push(init?.body);
      return new Response("{}", { status: bodies.length === 1 ? 401 : 200 });
    });
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    const rollup = `${V4}/steps/dataPoints:dailyRollUp`;
    const body = JSON.stringify({ windowSizeDays: 1 });
    const res = await auth.fetch(rollup, { method: "POST", body });
    expect(res.status).toBe(200);
    expect(bodies).toEqual([body, body]);
    for (const [url, init] of [
      [`${V4}/steps/dataPoints`, { method: "POST", body }],
      [`${V4}/steps/dataPoints:batchDelete`, { method: "POST", body }],
      [`${V4}/steps/dataPoints:rollUp`, { method: "POST", body }],
      [`${rollup}?x=1`, { method: "POST", body }],
      [rollup, { method: "POST", body: new Blob([body]) }],
      [rollup, { method: "POST", body: "x".repeat(4097) }],
      [rollup, { method: "PATCH", body }],
    ] as const)
      await expect(auth.fetch(url, init as RequestInit)).rejects.toThrow(/reads only/);
  });
});
