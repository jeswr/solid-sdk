// AUTHORED-BY Claude Opus 5.5
/**
 * Round-3 review regressions: points that never finish cannot pin a cursor, an odd payload
 * cannot wedge the run, legacy Fitbit rows match despite Google's generated display names,
 * method-override headers never reach Google, and a rollup range Google refuses is retried.
 * Fixtures are synthetic and follow the v4 reference shapes.
 */
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  type SyntheticHealthData,
  syntheticHealthApi,
} from "../../test-support/google-health-api.js";
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  demoImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import { ExerciseAction, SCHEMA } from "../core/vocab.js";
import { fitbitAdapter } from "../fitbit/adapter.js";
import { createGoogleHealthAdapter, type GoogleHealthOptions } from "./adapter.js";
import { parsePoint, point } from "./api.js";
import { HealthMapper, healthDocuments } from "./mapping.js";
import { createGoogleHealthSourceAuth } from "./source-auth.js";

const ROOT = `${TEST_POD_ROOT}integrations/fitbit/`;
const ACT = `${ROOT}health/activities.ttl`;
const V4 = "https://health.googleapis.com/v4/users/me/dataTypes";
const civil = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return {
    date: { year, month, day },
    time: { hours: Number(iso.slice(11, 13)), minutes: Number(iso.slice(14, 16)) },
  };
};
type Raw = Record<string, unknown>;
const exercise = (start: string, end: string, payload: Raw = {}, extra: Raw = {}): Raw => ({
  ...extra,
  exercise: {
    interval: {
      startTime: start,
      endTime: end,
      startUtcOffset: "0s",
      endUtcOffset: "0s",
      civilStartTime: civil(start),
    },
    exerciseType: "RUNNING",
    displayName: "Running",
    ...payload,
  },
});
const sleep = (start: string, end: string, sleepPayload: Raw = {}): Raw => ({
  sleep: { interval: { startTime: start, endTime: end }, ...sleepPayload },
});
const hr = (time: string, bpm: unknown = "70"): Raw => ({
  heartRate: { sampleTime: { physicalTime: time }, beatsPerMinute: bpm },
});

function run(
  source: SyntheticHealthData | typeof fetch,
  now: string,
  options: GoogleHealthOptions & { cursor?: string; pod?: ReturnType<typeof createMemoryPod> } = {},
) {
  const { cursor, pod = createMemoryPod(), ...adapterOptions } = options;
  const api = vi.fn(typeof source === "function" ? source : syntheticHealthApi(source));
  const result = runImport({
    adapter: createGoogleHealthAdapter({
      now: () => new Date(now),
      lookbackDays: 3,
      ...adapterOptions,
    }),
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
  });
  return { result, api, pod };
}
const cursorsOf = (cursor: string | undefined) =>
  (JSON.parse(cursor ?? "{}") as { cursors: Record<string, string> }).cursors;
const subjects = (pod: ReturnType<typeof createMemoryPod>) =>
  new Set(
    [...pod.dataset(ACT).match(null, DataFactory.namedNode(`${SCHEMA}exerciseType`), null)].map(
      (q) => q.subject.value,
    ),
  );

describe("points that never finish cannot pin a cursor (M-1)", () => {
  it("holds a recent unfinished exercise, then writes it as reported once it is older than the overlap", async () => {
    const data = {
      points: { exercise: [exercise("2026-06-08T07:00:00Z", "2030-01-01T00:00:00Z")] },
    };
    const first = run(data, "2026-06-10T00:00:00Z");
    const one = await first.result;
    expect(cursorsOf(one.cursor).exercise).toBe("2026-06-08T00:00:00.000Z");
    expect(first.pod.urls().some((u) => u.endsWith("activities.ttl"))).toBe(false);
    const onWarning = vi.fn();
    const later = run(data, "2026-06-20T00:00:00Z", { cursor: one.cursor, onWarning });
    const two = await later.result;
    expect(cursorsOf(two.cursor).exercise).toBe("2026-06-20T00:00:00.000Z");
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining("[google-health:stale-unfinished]"),
    );
    const ex = new ExerciseAction(
      `${ACT}#activity-google-health-exercise-2026-06-08T07:00:00.000Z-RUNNING`,
      later.pod.dataset(ACT),
      DataFactory,
    );
    expect(ex.startTime?.toISOString()).toBe("2026-06-08T07:00:00.000Z");
    const three = await run(data, "2026-07-20T00:00:00Z", { cursor: two.cursor }).result;
    expect(cursorsOf(three.cursor).exercise).toBe("2026-07-20T00:00:00.000Z");
  });

  it("holds an older unfinished exercise whose end is within 6 h of the run clock", async () => {
    const data = {
      points: { exercise: [exercise("2026-06-07T01:00:00Z", "2026-06-10T04:00:00Z")] },
    };
    const report = await run(data, "2026-06-10T00:00:00Z").result;
    expect(cursorsOf(report.cursor).exercise).toBe("2026-06-07T00:00:00.000Z");
  });

  it("holds a recent unprocessed sleep, but writes a never-processed old sleep without holding", async () => {
    const data = {
      points: {
        sleep: [
          sleep("2026-06-07T22:00:00Z", "2026-06-08T06:00:00Z", { metadata: { processed: false } }),
        ],
      },
    };
    const one = await run(data, "2026-06-10T00:00:00Z").result;
    expect(cursorsOf(one.cursor).sleep).toBe("2026-06-08T00:00:00.000Z");
    const onWarning = vi.fn();
    const later = run(data, "2026-08-10T00:00:00Z", { cursor: one.cursor, onWarning });
    const two = await later.result;
    expect(cursorsOf(two.cursor).sleep).toBe("2026-08-10T00:00:00.000Z");
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining("[google-health:stale-unprocessed]"),
    );
    expect(later.pod.urls().some((u) => u.includes("/health/sleep/"))).toBe(true);
  });

  it("ignores a point dated after the run clock instead of holding (a later window owns it)", async () => {
    const report = await run(
      syntheticHealthApi(
        {},
        {
          extra: (type, _from, to) =>
            type === "heart-rate" && to === Date.parse("2026-06-10T00:00:00Z")
              ? [hr("2026-06-10T00:00:01Z")]
              : [],
        },
      ),
      "2026-06-10T00:00:00Z",
    ).result;
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-10T00:00:00.000Z");
  });
});

describe("an odd payload cannot wedge the run (M-2)", () => {
  it("imports an exercise whose proto3-omitted exerciseType is unspecified, and refuses typeless stages as values", async () => {
    const odd = exercise("2026-06-08T07:00:00Z", "2026-06-08T07:30:00Z", {
      exerciseType: undefined,
    });
    expect(point("exercise", odd)?.exerciseType).toBe("EXERCISE_TYPE_UNSPECIFIED");
    expect(
      parsePoint(
        "exercise",
        exercise("2026-06-08T07:00:00Z", "2026-06-08T07:30:00Z", { displayName: undefined }),
      ),
    ).toBe("value");
    expect(
      parsePoint(
        "sleep",
        sleep("2026-06-07T22:00:00Z", "2026-06-08T06:00:00Z", {
          stages: [{ startTime: "2026-06-07T22:00:00Z", endTime: "2026-06-07T23:00:00Z" }],
        }),
      ),
    ).toBe("value");
    const ok = exercise("2026-06-09T07:00:00Z", "2026-06-09T07:30:00Z");
    for (const now of ["2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"]) {
      const r = run({ points: { exercise: [odd, ok] } }, now);
      const report = await r.result;
      expect(report.skipped).toBeUndefined();
      expect(subjects(r.pod).size).toBe(2);
    }
  });

  it("skips a few unrecognised points below the per-type minimum", async () => {
    const report = await run(
      syntheticHealthApi(
        { points: { "heart-rate": [hr("2026-06-09T07:00:00Z")] } },
        {
          extra: (type, from) =>
            type === "heart-rate" && from === Date.parse("2026-06-09T00:00:00Z")
              ? [{ heartRate: {} }]
              : [],
        },
      ),
      "2026-06-10T00:00:00Z",
    ).result;
    expect(report.skipped).toBe(1);
    expect(cursorsOf(report.cursor)["heart-rate"]).toBe("2026-06-10T00:00:00.000Z");
  });

  it("stops only the type whose points are unrecognised across the run, keeping its cursor, on every run", async () => {
    const bad = (type: string) =>
      type === "heart-rate" ? [{ heartRate: { beatsPerMinute: 70 } }] : [];
    const prior = JSON.stringify({
      version: 3,
      cursors: { "heart-rate": "2026-06-07T00:00:00.000Z" },
      fetchedAt: { "heart-rate": "2026-06-07T00:00:00.000Z" },
    });
    for (const now of ["2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"]) {
      const onWarning = vi.fn();
      const r = run(syntheticHealthApi({ points: { weight: [] } }, { extra: bad }), now, {
        cursor: prior,
        onWarning,
      });
      const report = await r.result;
      // One unrecognised point per day: the third reaches the minimum and stops the type.
      const cursors = cursorsOf(report.cursor);
      expect(cursors["heart-rate"]).toBe("2026-06-07T00:00:00.000Z");
      expect(cursors.weight).toBe(now.replace("Z", ".000Z"));
      expect(cursors.sleep).toBe(now.replace("Z", ".000Z"));
      expect(onWarning).toHaveBeenCalledWith(
        expect.stringContaining("[google-health:unrecognised-shape]"),
      );
      expect(r.pod.urls().some((u) => u.includes("/heart-rate/"))).toBe(false);
    }
  });

  it("stops a type once more than 10% of at least 20 points are unrecognised", async () => {
    const good = Array.from({ length: 17 }, (_, i) => hr(`2026-06-09T07:${String(10 + i)}:00Z`));
    const onWarning = vi.fn();
    const report = await run(
      syntheticHealthApi(
        { points: { "heart-rate": good } },
        {
          extra: (type, from) =>
            type === "heart-rate" && from === Date.parse("2026-06-09T00:00:00Z")
              ? [null, {}, []]
              : [],
        },
      ),
      "2026-06-10T00:00:00Z",
      { onWarning },
    ).result;
    // A first import keeps no heart-rate checkpoint, so the next run re-reads the lookback.
    expect(cursorsOf(report.cursor)["heart-rate"]).toBeUndefined();
    expect(cursorsOf(report.cursor).weight).toBe("2026-06-10T00:00:00.000Z");
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining("[google-health:unrecognised-shape]"),
    );
  });
});

describe("legacy Fitbit rows match despite Google's generated display names (M-3)", () => {
  it("updates the legacy row in place by its unique wall-clock start, ignoring the name", async () => {
    const { pod } = await demoImport(fitbitAdapter);
    const g = {
      exercise: {
        interval: {
          startTime: "2026-06-08T12:12:00Z",
          endTime: "2026-06-08T12:43:00Z",
          startUtcOffset: "-18000s",
          endUtcOffset: "-18000s",
          civilStartTime: civil("2026-06-08T07:12"),
        },
        exerciseType: "RUNNING",
        displayName: "Running",
        metricsSummary: { distanceMillimeters: 5_200_000 },
      },
    };
    for (let i = 0; i < 2; i++) {
      const report = await run({ points: { exercise: [g] } }, "2026-06-10T00:00:00Z", { pod })
        .result;
      expect(report.skipped).toBeUndefined();
    }
    expect(subjects(pod).size).toBe(3);
    const ex = new ExerciseAction(`${ACT}#activity-51817963271`, pod.dataset(ACT), DataFactory);
    expect([ex.identifier, ex.name, ex.startTime?.toISOString()]).toEqual([
      "51817963271",
      "Running",
      "2026-06-08T12:12:00.000Z",
    ]);
  });

  it("breaks a wall-clock tie with the Fitbit name → exerciseType table, and skips a tie it cannot break", () => {
    const store = (names: string[]) => {
      const ds = new Store();
      for (const [i, name] of names.entries()) {
        const ex = new ExerciseAction(`${ACT}#activity-${i + 1}`, ds, DataFactory).mark();
        ex.exerciseType = name;
        ex.startTime = new Date("2026-06-08T07:00:00Z");
      }
      return ds;
    };
    const p = parsePoint(
      "exercise",
      exercise("2026-06-08T12:00:00Z", "2026-06-08T12:30:00Z", {
        interval: {
          startTime: "2026-06-08T12:00:00Z",
          endTime: "2026-06-08T12:30:00Z",
          startUtcOffset: "-18000s",
          civilStartTime: civil("2026-06-08T07:00"),
        },
      }),
    );
    if (typeof p === "string") throw new Error(`fixture refused as ${p}`);
    const target = (names: string[]) => {
      const mapper = new HealthMapper((s) => ROOT + s);
      const docs = healthDocuments([p], (s) => ROOT + s, store(names), mapper);
      return {
        mapper,
        subjects: new Set(docs.flatMap((d) => [...d.dataset].map((q) => q.subject.value))),
      };
    };
    expect(target(["Walk", "Run"]).subjects).toEqual(new Set([`${ACT}#activity-2`]));
    expect(target(["Bike"]).subjects).toEqual(new Set([`${ACT}#activity-1`]));
    const tie = target(["Run", "Run"]);
    expect(tie.subjects.size).toBe(0);
    expect(tie.mapper.skipped).toBe(1);
  });
});

describe("Google Health transport and rollup range", () => {
  it("strips method-override headers from every forwarded request (L-1)", async () => {
    const seen: Headers[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      seen.push(
        new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
      );
      return new Response("{}");
    });
    const auth = createGoogleHealthSourceAuth({
      config: createGoogleOAuthConfig("health", {
        clientType: "desktop",
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
      }),
      token: { accessToken: "fixture-access", tokenType: "Bearer" },
      fetch: transport,
    });
    const override = {
      "X-HTTP-Method-Override": "DELETE",
      "X-HTTP-Method": "DELETE",
      "X-Method-Override": "DELETE",
      Accept: "application/json",
    };
    await auth.fetch(`${V4}/steps/dataPoints:dailyRollUp`, {
      method: "POST",
      body: "{}",
      headers: override,
    });
    await auth.fetch(`${V4}/weight/dataPoints`, { headers: new Headers(override) });
    await auth.fetch(new Request(`${V4}/weight/dataPoints`, { headers: override }));
    expect(seen).toHaveLength(3);
    for (const headers of seen) {
      for (const name of ["x-http-method-override", "x-http-method", "x-method-override"])
        expect(headers.has(name)).toBe(false);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("authorization")).toBe("Bearer fixture-access");
    }
  });

  it("retries a dailyRollUp range Google refuses once, ending the day after the run's UTC date (L-2)", async () => {
    const inner = syntheticHealthApi({ rollups: { steps: { "2026-06-10": { countSum: "12" } } } });
    const refuse = (message: string) =>
      new Response(JSON.stringify({ error: { code: 400, message, status: "INVALID_ARGUMENT" } }), {
        status: 400,
      });
    const ends = (api: ReturnType<typeof vi.fn>) =>
      api.mock.calls
        .filter(([url]) => String(url).includes("/steps/"))
        .map(
          ([, init]) =>
            (
              JSON.parse(String((init as RequestInit).body)) as {
                range: { end: { date: { day: number } } };
              }
            ).range.end.date.day,
        );
    const future: typeof fetch = async (input, init) => {
      const body = String(input).includes(":dailyRollUp")
        ? JSON.parse(String(init?.body))
        : undefined;
      return body?.range.end.date.day > 11
        ? refuse("Invalid range: end time is in the future.")
        : inner(input, init);
    };
    const r = run(future, "2026-06-10T12:00:00Z", { lookbackDays: 1 });
    await r.result;
    expect(ends(r.api)).toEqual([12, 11]);
    expect(r.pod.urls().some((u) => u.endsWith("/daily/2026-06-10/steps.ttl"))).toBe(true);
    const always = run(
      async (input, init) =>
        String(input).includes(":dailyRollUp") ? refuse("range end invalid") : inner(input, init),
      "2026-06-10T12:00:00Z",
      { lookbackDays: 1 },
    );
    await expect(always.result).rejects.toMatchObject({ status: 400 });
    expect(ends(always.api)).toEqual([12, 11]);
    const other = run(
      async (input, init) =>
        String(input).includes(":dailyRollUp") ? refuse("pageSize is invalid") : inner(input, init),
      "2026-06-10T12:00:00Z",
      { lookbackDays: 1 },
    );
    await expect(other.result).rejects.toMatchObject({ status: 400 });
    expect(ends(other.api)).toEqual([12]);
  });
});
