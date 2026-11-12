// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  HEALTH,
  HealthCode,
  HealthInstant,
  HealthObservation,
  MAX_OBSERVATION_QUADS,
  MAX_OBSERVATIONS,
  parseObservations,
} from "@jeswr/solid-health";
import { NS } from "@jeswr/suite-vocab";
import { strToU8, zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { type ImportFile, runFileImport } from "../core/file-import.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { runImport } from "../core/import-runner.js";
import { buildAuthorizationUrl, exchangeCodeForToken } from "../core/oauth.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { PROV } from "../core/provenance.js";
import {
  createMemoryPod,
  demoImport,
  fileImport,
  type MemoryPod,
  memoryFile,
  sparseImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { CLASSES, ExerciseAction } from "../core/vocab.js";
import { fileAdapterById } from "../file-adapters.js";
import { zipDirectory } from "../google-takeout/zip-reader.js";
import { writeResource } from "../pod/resource.js";
import { TypeIndexDataset } from "../pod/type-index.js";
import { createRegistry } from "../registry.js";
import { createWhoopAdapter, whoopAdapter } from "./adapter.js";
import { createWhoopFileAdapter, MAX_WHOOP_FILE_BYTES, whoopFileAdapter } from "./file-adapter.js";
import {
  CYCLE,
  MILLISECOND_WHOOP_FIXTURES,
  RECOVERY,
  SLEEP,
  WHOOP_FIXTURES,
  WORKOUT,
} from "./fixtures.js";
import {
  API,
  MAX_RECORDS,
  MAX_STORED_OBSERVATIONS,
  MAX_STORED_QUADS,
  METRICS,
  sourceId,
  timestamp,
} from "./model.js";
import { RecordMarker } from "./vocab.js";

const ROOT = `${TEST_POD_ROOT}integrations/whoop/`;
const MONTH = `${ROOT}health/observations/2026-06.ttl`;
const WORKOUTS = `${ROOT}health/workouts/2026-06.ttl`;
const SLEEPS_CSV = `Sleep onset,Wake onset,Cycle timezone,Asleep duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Respiratory rate (rpm),Sleep performance %
2026-06-07 22:00:00,2026-06-08 06:00:00,+0000,450,240,120,90,14,90`;
const CYCLES_CSV = `Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Skin temp (celsius),Blood oxygen %,Day Strain,Energy burned (cal),Average HR (bpm),Max HR (bpm)
2026-06-08 06:00:00,2026-06-09 06:00:00,+0000,80,52,65,33.5,98,12,1000,70,150`;
const WORKOUTS_CSV = `Workout start time,Workout end time,Workout timezone,Activity name,Activity Strain,Average HR (bpm),Max HR (bpm),Energy burned (cal)
2026-06-08 08:00:00,2026-06-08 08:30:00,+0000,Running,8,130,155,300`;
const archive = (
  files: Record<string, string>,
  level: 0 | 6 = 6,
  name = "my_whoop_data_2026.zip",
) =>
  new File(
    [
      zipSync(
        Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])),
        { level },
      ),
    ],
    name,
  );
const writer = (pod: MemoryPod) =>
  createFetchPodWriter({
    adapterId: "whoop",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
const typed = (pod: MemoryPod, url: string, type: string) =>
  [...pod.dataset(url)]
    .filter((quad) => quad.predicate.value === `${NS.RDF}type` && quad.object.value === type)
    .map((quad) => quad.subject.value);
function routes(kind: string, json: unknown): FixtureRoute[] {
  return WHOOP_FIXTURES.map((route) =>
    route.url === `${API}/${kind}` ? { ...route, json } : route,
  );
}
async function csv(text: string, name = "sleeps.csv", pod?: MemoryPod) {
  return fileImport(
    whoopFileAdapter,
    memoryFile(name, text, "text/csv"),
    pod ? { pod } : undefined,
  );
}

describe("WHOOP catalogue and OAuth", () => {
  it("exposes both paths under one health catalogue id and isolates host public ids", () => {
    const registry = createRegistry({
      whoop: { clientId: "public-test-id", tokenProxyUrl: "https://proxy.test/whoop/token" },
    });
    const adapter = registry.adapterById("whoop");
    expect(registry.allCatalogEntries().filter((entry) => entry.id === "whoop")).toHaveLength(1);
    expect(adapter?.metadata.categories).toEqual(["health"]);
    expect(registry.statusOf(whoopAdapter.metadata)).toBe("live");
    expect(fileAdapterById("whoop")).toBe(whoopFileAdapter);
    expect(whoopAdapter.oauth?.clientId).toBeUndefined();
    expect(adapter?.oauth?.scopes).toEqual([
      "read:recovery",
      "read:cycles",
      "read:sleep",
      "read:workout",
      "offline",
    ]);
  });
  it("uses the shared S256 auth-code flow and proxy form contract without exposing a secret", async () => {
    const config = {
      ...whoopAdapter.oauth!,
      clientId: "public-test-id",
      tokenProxyUrl: "https://proxy.test/whoop/token",
    };
    const url = new URL(
      buildAuthorizationUrl(config, {
        state: "test-state",
        challenge: "test-challenge",
        redirectUri: "https://host.test/oauth-callback.html",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://api.prod.whoop.com/oauth/oauth2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("code_verifier")).toBe("test-verifier");
      expect(form.get("client_id")).toBe("public-test-id");
      expect(form.has("client_secret")).toBe(false);
      expect(init?.redirect).toBe("error");
      return Response.json({ access_token: "synthetic", refresh_token: "synthetic-refresh" });
    });
    const token = await exchangeCodeForToken(
      "whoop",
      config,
      {
        code: "test-code",
        verifier: "test-verifier",
        redirectUri: "https://host.test/oauth-callback.html",
      },
      transport,
    );
    expect(token.refreshToken).toBe("synthetic-refresh");
    expect(transport.mock.calls[0]?.[0]).toBe(config.tokenProxyUrl);
  });
});

describe("WHOOP mappings and identity", () => {
  it("writes canonical Health observations, stages without double-counting, and ExerciseAction", async () => {
    const { pod, report } = await demoImport(whoopAdapter);
    expect(report.categories).toEqual(["health"]);
    expect(report.cursor).toBe("2026-06-08T08:00:00.000Z");
    expect(report.unsupported).toEqual([
      "WHOOP strain",
      "WHOOP recovery score %",
      "WHOOP sleep performance %",
    ]);
    const data = pod.dataset(MONTH);
    expect(typed(pod, MONTH, HEALTH.Observation)).toHaveLength(12);
    const measurement = (root: string, metric: string) =>
      new HealthObservation(`${MONTH}#${root}/metric/${metric}`, data, DataFactory);
    expect(measurement("recovery-101", "restingHR").measuredValue).toBe(52);
    expect(measurement("recovery-101", "hrv").measuredValue).toBe(65);
    expect(measurement("recovery-101", "temperature").measuredValue).toBe(33.5);
    expect(measurement("recovery-101", "oxygen").measuredValue).toBe(98);
    expect(measurement("cycle-101", "energy").measuredValue).toBe(4184);
    expect(measurement("sleep-sleep-101", "sleep").measuredValue).toBe(27_000);
    expect(measurement("sleep-sleep-101", "deep").measuredValue).toBe(7200);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(measurement("sleep-sleep-101", "light").types.has(HEALTH.Sleep)).toBe(false);
    // QUDT MilliSEC is outside the solid-health unit inventory: UCUM only.
    expect(measurement("recovery-101", "hrv").unit).toBeUndefined();
    expect(measurement("recovery-101", "hrv").unitCode).toBe("ms");
    expect(typed(pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(1);
    const action = new ExerciseAction(
      `${WORKOUTS}#workout-workout-101/action`,
      pod.dataset(WORKOUTS),
      DataFactory,
    );
    expect(action.name).toBe("Running");
    expect(action.duration).toBe("PT1800S");
    expect(Number.parseFloat(action.calories ?? "")).toBeCloseTo(300);
    expect(pod.get(report.indexUrl)).toContain(HEALTH.Observation);
    expect(pod.get(report.indexUrl)).toContain(CLASSES.ExerciseAction);
    expect(pod.get(`${ROOT}_provenance.ttl`)).toContain(PROV);
    expect([...data].some((quad) => quad.predicate.value === `${PROV}wasDerivedFrom`)).toBe(true);
    expect(
      [...data].some((quad) => /strain|performance|recovery_score/.test(quad.predicate.value)),
    ).toBe(false);
  });
  it.each([
    0, 6,
  ] as const)("imports the full synthetic ZIP (compression %s) with bounded ranged reads", async (level) => {
    const file = archive(
      {
        "physiological_cycles.csv": CYCLES_CSV,
        "sleeps.csv": SLEEPS_CSV,
        "workouts.csv": WORKOUTS_CSV,
        "journal_entries.csv": "Question,Answer\nSynthetic,Yes",
      },
      level,
    );
    const text = vi.fn(async () => {
      throw new Error("ZIP must not call text()");
    });
    const { pod, report } = await fileImport(whoopFileAdapter, {
      name: file.name,
      size: file.size,
      type: file.type,
      text,
      stream: () => file.stream(),
      slice: (start, end) => file.slice(start, end),
    });
    expect(text).not.toHaveBeenCalled();
    expect(report.unsupported).toContain("journal_entries.csv");
    expect(typed(pod, MONTH, HEALTH.Observation)).toHaveLength(12);
    expect(typed(pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(1);
  });
  it.each([
    "CSV first",
    "API first",
  ])("deduplicates every collection in either order: %s", async (order) => {
    const file = archive({
      "physiological_cycles.csv": CYCLES_CSV,
      "sleeps.csv": SLEEPS_CSV,
      "workouts.csv": WORKOUTS_CSV,
    });
    const pod = createMemoryPod();
    if (order === "CSV first") await fileImport(whoopFileAdapter, file, { pod });
    await sparseImport(whoopAdapter, MILLISECOND_WHOOP_FIXTURES, { pod });
    await fileImport(whoopFileAdapter, file, { pod });
    await sparseImport(whoopAdapter, MILLISECOND_WHOOP_FIXTURES, { pod });
    expect(typed(pod, MONTH, HEALTH.Observation)).toHaveLength(12);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(typed(pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(1);
    expect(pod.get(MONTH)).not.toContain("#sleep-csv-");
    expect(pod.get(WORKOUTS)).not.toContain("#workout-csv-");
  });
  it("keeps CSV identities stable across row order, filename, and duplicate rows", async () => {
    const { pod } = await csv(`${SLEEPS_CSV}\n${SLEEPS_CSV.split("\n")[1]}`);
    const before = typed(pod, MONTH, HEALTH.Sleep);
    await csv(SLEEPS_CSV, "download.csv", pod);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toEqual(before);
    expect(before[0]).toContain("sleep-csv-");
  });
  it("normalizes CSV dietary calories to API kilojoules and keeps workout kcal", async () => {
    const { pod } = await csv(WORKOUTS_CSV, "workouts.csv");
    const data = pod.dataset(WORKOUTS);
    const observation = [...data].find(
      (quad) =>
        quad.predicate.value === `${NS.SCHEMA}name` && quad.object.value === "Energy burned",
    );
    expect(observation).toBeDefined();
    expect(
      new HealthObservation(observation?.subject.value as string, data, DataFactory).measuredValue,
    ).toBeCloseTo(1255.2);
    const action = new ExerciseAction(
      typed(pod, WORKOUTS, CLASSES.ExerciseAction)[0] as string,
      data,
      DataFactory,
    );
    expect(Number.parseFloat(action.calories ?? "")).toBeCloseTo(300);
    expect(
      [...data].some(
        (quad) =>
          quad.predicate.value === `${PROV}wasDerivedFrom` &&
          quad.object.value === "urn:solid:connector:whoop:export",
      ),
    ).toBe(true);
  });
  it("recognises normalized headers, BOMs, offsets and quoted multiline activity names", async () => {
    const text =
      '\uFEFF"workout_START-time","WORKOUT END TIME","Workout timezone","Activity name","Energy burned (cal)"\r\n"2026-06-08 10:00:00","2026-06-08 10:30:00","+0200","A, ""test""\nrun",300';
    const { pod } = await csv(text, "workouts.csv");
    const subject = typed(pod, WORKOUTS, CLASSES.ExerciseAction)[0] as string;
    const action = new ExerciseAction(subject, pod.dataset(WORKOUTS), DataFactory);
    expect(action.name).toBe('A, "test"\nrun');
    expect(action.startTime?.toISOString()).toBe(WORKOUT.start.replace("Z", ".000Z"));
  });
  it("replaces removed API optional fields while preserving other nights", async () => {
    const { pod } = await demoImport(whoopAdapter);
    await sparseImport(
      whoopAdapter,
      routes("recovery", { records: [{ ...RECOVERY, score: { resting_heart_rate: 55 } }] }),
      { pod },
    );
    expect(
      new HealthObservation(
        `${MONTH}#recovery-101/metric/restingHR`,
        pod.dataset(MONTH),
        DataFactory,
      ).measuredValue,
    ).toBe(55);
    expect(
      pod.dataset(MONTH).countQuads(`${MONTH}#recovery-101/metric/hrv`, null, null, null),
    ).toBe(0);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
  });
  it("retains different native events sharing a start time and does not overwrite them with CSV", async () => {
    const { pod } = await sparseImport(
      whoopAdapter,
      routes("activity/sleep", { records: [SLEEP, { ...SLEEP, id: "second-sleep" }] }),
    );
    await csv(SLEEPS_CSV, "sleeps.csv", pod);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(2);
  });
  it("keeps native ids separate from deterministic helper-node names", async () => {
    const { pod } = await sparseImport(
      whoopAdapter,
      routes("activity/sleep", {
        records: [
          SLEEP,
          { ...SLEEP, id: `${SLEEP.id}-sleep` },
          { ...SLEEP, id: `${SLEEP.id}-sleep-code` },
        ],
      }),
    );
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(3);
    expect(typed(pod, MONTH, HEALTH.Observation)).toHaveLength(22);
  });
  it("does not double-count or overwrite overnight summary/stage durations", async () => {
    const { pod } = await csv(SLEEPS_CSV.replace(",450,", ",,"));
    const total = typed(pod, MONTH, HEALTH.Sleep)[0] as string;
    expect(new HealthObservation(total, pod.dataset(MONTH), DataFactory).measuredValue).toBe(
      27_000,
    );
  });
});

describe("WHOOP API traversal and failures", () => {
  it("requests only granted collections and never fetches unmatched recoveries", async () => {
    const source = vi.fn(fixtureFetch("whoop", WHOOP_FIXTURES));
    const pod = createMemoryPod();
    const report = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(pod),
      scopes: ["read:sleep", "read:recovery"],
      sourceAuth: { fetch: source },
    });
    expect(source).toHaveBeenCalledOnce();
    expect(String(source.mock.calls[0]?.[0])).toContain("/activity/sleep?");
    expect(report.unsupported).toContain("WHOOP recovery requires read:cycles");
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(typed(pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(0);
  });
  it("drains next_token/nextToken pages for all four collections and URL-encodes tokens", async () => {
    const token = "opaque/+?&=token";
    const fixtures: FixtureRoute[] = WHOOP_FIXTURES.flatMap((route) => [
      { ...route, json: { ...(route.json as object), next_token: token } },
      { ...route, json: { records: [], nextToken: null } },
    ]);
    const source = fixtureFetch("whoop", fixtures);
    const calls: URL[] = [];
    const { cursor } = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(createMemoryPod()),
      cursor: "2026-06-08T08:00:00.000Z",
      sourceAuth: {
        fetch: async (input, init) => {
          calls.push(new URL(String(input)));
          return source(input, init);
        },
      },
    });
    expect(calls).toHaveLength(8);
    expect(calls.filter((url) => url.searchParams.get("nextToken") === token)).toHaveLength(4);
    expect(calls.every((url) => url.searchParams.get("start") === "2026-06-01T08:00:00.000Z")).toBe(
      true,
    );
    expect(cursor).toBe("2026-06-08T08:00:00.000Z");
  });
  it.each([
    {},
    null,
    [],
    { records: null },
    { records: "bad" },
    { records: Array(26).fill(CYCLE) },
    { records: [], next_token: {} },
    { records: [], next_token: "" },
    { records: [], next_token: "x".repeat(2049) },
    { records: [], next_token: "a", nextToken: "b" },
    { records: [], next_token: null, nextToken: "b" },
  ])("fails closed on malformed envelopes/tokens: %j", async (json) => {
    const pod = createMemoryPod();
    await expect(sparseImport(whoopAdapter, routes("cycle", json), { pod })).rejects.toBeInstanceOf(
      IntegrationSyncError,
    );
    expect(pod.get(MONTH)).toBeUndefined();
  });
  it("rejects a pagination cycle before writes", async () => {
    await expect(
      sparseImport(whoopAdapter, routes("cycle", { records: [], next_token: "repeat" })),
    ).rejects.toThrow(/repeated/);
  });
  it.each([
    401, 429,
  ])("preserves the previous checkpoint and documents on HTTP %s", async (status) => {
    const { pod, report } = await demoImport(whoopAdapter);
    const before = pod.get(MONTH);
    const changed: ConnectorState[] = [];
    const transport = fixtureFetch(
      "whoop",
      WHOOP_FIXTURES.map((route) =>
        route.url.endsWith("/recovery") ? { ...route, status } : route,
      ),
    );
    await expect(
      runImport({
        adapter: whoopAdapter,
        mode: "live",
        podWriter: writer(pod),
        state: report.state,
        onState: (state) => changed.push(state),
        sourceAuth: { fetch: transport },
      }),
    ).rejects.toBeInstanceOf(status === 429 ? RateLimitedError : IntegrationSyncError);
    expect(changed.at(-1)?.cursor).toBe(report.state.cursor);
    expect(changed.at(-1)?.lastOutcome).toBe("error");
    expect(pod.get(MONTH)).toBe(before);
  });
  it.each([
    { maxRequests: 0, maxItems: 100, maxBytes: 10000 },
    { maxRequests: 100, maxItems: 0, maxBytes: 10000 },
    { maxRequests: 100, maxItems: 100, maxBytes: 1 },
  ])("enforces one run budget before any data writes: %j", async (limits) => {
    const pod = createMemoryPod();
    await expect(demoImport(createWhoopAdapter(limits), { pod })).rejects.toThrow(/budget/);
    expect(pod.get(MONTH)).toBeUndefined();
  });
  it("counts malformed entries, rejects unsafe ids and does not fabricate recovery timestamps", async () => {
    const { pod, report } = await sparseImport(
      whoopAdapter,
      routes("recovery", {
        records: [
          null,
          0,
          {},
          { ...RECOVERY, cycle_id: 999 },
          { ...RECOVERY, cycle_id: "../unsafe" },
          RECOVERY,
        ],
      }),
    );
    expect(report.skipped).toBe(5);
    expect(
      new HealthObservation(
        `${MONTH}#recovery-101/metric/restingHR`,
        pod.dataset(MONTH),
        DataFactory,
      ).measuredValue,
    ).toBe(52);
  });
  it("skips unscored and impossible sleep records", async () => {
    const { report } = await sparseImport(
      whoopAdapter,
      routes("activity/sleep", {
        records: [
          { ...SLEEP, score_state: "PENDING_SCORE" },
          { ...SLEEP, end: SLEEP.start },
          {
            ...SLEEP,
            score: {
              ...SLEEP.score,
              stage_summary: {
                ...SLEEP.score.stage_summary,
                total_light_sleep_time_milli: 99_999_999,
              },
            },
          },
          SLEEP,
        ],
      }),
    );
    expect(report.skipped).toBe(3);
  });
  it("rejects invalid saved cursors before source I/O", async () => {
    await expect(demoImport(whoopAdapter, { cursor: "not-an-instant" })).rejects.toThrow(/cursor/);
  });
  it("cancels an oversized JSON body before decoding", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(32 * 1024 * 1024 + 1) },
    });
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: whoopAdapter,
        mode: "live",
        podWriter: writer(pod),
        sourceAuth: { fetch: async () => response },
      }),
    ).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pod.get(MONTH)).toBeUndefined();
  });
  it("shares request/item budgets across collections instead of resetting each endpoint", async () => {
    const requestBounded = await demoImport(
      createWhoopAdapter({ maxRequests: 3, maxItems: 20, maxBytes: 10000 }),
    );
    expect(requestBounded.report.warnings?.length).toBe(1);
    const adapter = createWhoopAdapter({ maxRequests: 20, maxItems: 3, maxBytes: 10000 });
    const first = await demoImport(adapter);
    expect(first.report.warnings).toEqual(["WHOOP import partial, re-run to continue."]);
    expect(typed(first.pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(first.pod.get(WORKOUTS)).toBeUndefined();
    const second = await demoImport(adapter, { pod: first.pod, cursor: first.report.cursor });
    expect(second.report.warnings).toBeUndefined();
    expect(second.report.cursor).toBe("2026-06-08T08:00:00.000Z");
    expect(typed(first.pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(1);
  });
  it("keeps the prior cursor on an empty increment", async () => {
    const { report } = await sparseImport(
      whoopAdapter,
      WHOOP_FIXTURES.map((route) => ({ ...route, json: { records: [] } })),
      { cursor: "2026-06-08T08:00:00Z" },
    );
    expect(report.cursor).toBe("2026-06-08T08:00:00.000Z");
  });
});

describe("WHOOP hostile files and cancellation", () => {
  it.each([
    "Sleep onset,sleep_onset,Wake onset\n2026-06-07T22:00:00Z,x,2026-06-08T06:00:00Z",
    "Unknown,Data\n1,2",
    "",
    'Sleep onset,Wake onset\n"unterminated',
    `${"x".repeat(65537)}\n1`,
  ])("rejects malformed/ambiguous headers and broken records before writes", async (text) => {
    const pod = createMemoryPod();
    await expect(csv(text, "sleeps.csv", pod)).rejects.toThrow();
    expect(pod.get(MONTH)).toBeUndefined();
  });
  it("counts invalid dates, missing zones, numbers and short/extra rows while importing valid rows", async () => {
    const head = SLEEPS_CSV.split("\n")[0];
    const row = SLEEPS_CSV.split("\n")[1] as string;
    const { pod, report } = await csv(
      [
        head,
        row.replace("2026-06-07", "2026-02-30"),
        row.replace("+0000", ""),
        "short,row",
        `${row},extra`,
        row.replace(",450,", ",999999999,"),
        row,
      ].join("\n"),
    );
    expect(report.skipped).toBe(5);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
  });
  it("bounds actual text bytes even when a host lies about size", async () => {
    await expect(
      fileImport(whoopFileAdapter, {
        ...memoryFile("sleeps.csv", "x".repeat(MAX_WHOOP_FILE_BYTES + 1)),
        size: 1,
      }),
    ).rejects.toThrow(/limit/);
  });
  it("rejects the upload byte cap but saves a partial row-budget batch", async () => {
    const file = memoryFile("sleeps.csv", SLEEPS_CSV);
    await expect(
      fileImport(whoopFileAdapter, { ...file, size: MAX_WHOOP_FILE_BYTES + 1 }),
    ).rejects.toThrow(/limit/);
    const text = `${SLEEPS_CSV.split("\n")[0]}\n${`${SLEEPS_CSV.split("\n")[1]}\n`.repeat(MAX_RECORDS + 1)}`;
    const pod = createMemoryPod();
    const { report } = await csv(text, "sleeps.csv", pod);
    expect(report.warnings).toEqual(["WHOOP import partial, re-run to continue."]);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    const next = await runFileImport({
      adapter: whoopFileAdapter,
      file: memoryFile("sleeps.csv", text),
      podWriter: writer(pod),
      state: report.state,
    });
    expect(next.warnings).toBeUndefined();
    expect(next.cursor).not.toBe(report.cursor);
  });
  it("skips oversized logical records without retaining them", async () => {
    const row = `${SLEEPS_CSV.split("\n")[1]}${"x".repeat(4 * 1024 * 1024)}`;
    const { report } = await csv(`${SLEEPS_CSV}\n${row}`);
    expect(report.skipped).toBe(1);
  });
  it.each([
    { "../sleeps.csv": SLEEPS_CSV },
    { "a/b/c/d/sleeps.csv": SLEEPS_CSV },
    { "a/sleeps.csv": SLEEPS_CSV, "b/sleeps.csv": SLEEPS_CSV },
    { "sleeps.csv": "x".repeat(16 * 1024 * 1024 + 1) },
  ])("rejects unsafe, duplicate and oversized archive entries", async (files) => {
    const pod = createMemoryPod();
    await expect(fileImport(whoopFileAdapter, archive(files), { pod })).rejects.toThrow();
    expect(pod.get(MONTH)).toBeUndefined();
  });
  it("requires binary stream/range ports and verifies the archive signature", async () => {
    await expect(
      fileImport(whoopFileAdapter, memoryFile("data.zip", "PK\u0003\u0004")),
    ).rejects.toThrow(/stream/);
    await expect(fileImport(whoopFileAdapter, new File(["not a zip"], "data.zip"))).rejects.toThrow(
      /signature/,
    );
    const file = archive({ "sleeps.csv": SLEEPS_CSV });
    await expect(
      fileImport(whoopFileAdapter, {
        name: file.name,
        size: file.size,
        type: file.type,
        text: () => file.text(),
        stream: () => file.stream(),
      }),
    ).rejects.toThrow(/slice/);
  });
  it("validates CRC before parsing and commits no earlier staged entry when a later CRC fails", async () => {
    const file = archive({ "workouts.csv": WORKOUTS_CSV, "sleeps.csv": SLEEPS_CSV }, 0);
    const entries = await zipDirectory(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = entries.find((item) => item.name === "sleeps.csv");
    bytes[(entry?.dataStart ?? 0) + 8] ^= 1;
    const pod = createMemoryPod();
    await expect(
      fileImport(whoopFileAdapter, new File([bytes], "bad.zip"), { pod }),
    ).rejects.toThrow(/crc/);
    expect(pod.get(WORKOUTS)).toBeUndefined();
  });
  it("caps ZIP directory entries before dispatch", async () => {
    const file = archive(
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`${i}.csv`, "x"])),
    );
    await expect(fileImport(whoopFileAdapter, file)).rejects.toThrow(/entr/i);
  });
  it("reports journal-only and unknown archives without inventing a health mapping", async () => {
    const { report } = await fileImport(
      whoopFileAdapter,
      archive({ "journal_entries.csv": "Question,Answer\nX,Y", "extra.txt": "synthetic" }),
    );
    expect(report.unsupported).toEqual(["journal_entries.csv", "Unrecognised WHOOP archive entry"]);
    expect(report.written).toHaveLength(0);
  });
  it("cancels before the next API or Pod operation", async () => {
    const controller = new AbortController();
    const pod = createMemoryPod();
    const transport = vi.fn<typeof fetch>(async () => {
      controller.abort(new Error("stop WHOOP"));
      return Response.json({ records: [CYCLE] });
    });
    await expect(
      runImport({
        adapter: whoopAdapter,
        mode: "live",
        podWriter: writer(pod),
        signal: controller.signal,
        sourceAuth: { fetch: transport },
      }),
    ).rejects.toThrow("stop WHOOP");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(pod.putCount).toBe(0);
  });
  it("cancels while reading a streamed CSV before any data writes", async () => {
    const controller = new AbortController();
    let openings = 0;
    const file: ImportFile = {
      ...memoryFile("sleeps.csv", SLEEPS_CSV),
      stream: () => {
        const opening = ++openings;
        return new ReadableStream({
          start(stream) {
            stream.enqueue(strToU8(SLEEPS_CSV));
            if (opening === 2) controller.abort(new Error("stop file"));
            stream.close();
          },
        });
      },
    };
    const pod = createMemoryPod();
    await expect(
      runFileImport({
        adapter: whoopFileAdapter,
        file,
        podWriter: writer(pod),
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop file");
    expect(pod.putCount).toBe(0);
  });
  it("cancels a pending file read and releases its underlying reader", async () => {
    const controller = new AbortController();
    let openings = 0;
    let ready: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const cancel = vi.fn();
    const file: ImportFile = {
      ...memoryFile("sleeps.csv", SLEEPS_CSV),
      stream: () => {
        if (++openings === 1) return new Blob([SLEEPS_CSV]).stream();
        return new ReadableStream({
          start() {
            ready();
          },
          cancel,
        });
      },
    };
    const pod = createMemoryPod();
    const running = runFileImport({
      adapter: whoopFileAdapter,
      file,
      podWriter: writer(pod),
      signal: controller.signal,
    });
    const rejected = expect(running).rejects.toThrow("cancel pending read");
    await pending;
    controller.abort(new Error("cancel pending read"));
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(pod.putCount).toBe(0);
  });
});

describe("WHOOP defensive scalar validation", () => {
  it.each(["UTC", "GMT"])("accepts the explicit %s export timezone", (zone) => {
    expect(timestamp("2026-06-07 22:00:00", zone)?.toISOString()).toBe("2026-06-07T22:00:00.000Z");
  });
  it.each([
    "2026-02-30T10:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T10:00:00",
    "2026-01-01T10:00:00Zjunk",
    null,
    4,
  ])("rejects invalid/ambiguous timestamps %j", (value) => {
    expect(timestamp(value)).toBeUndefined();
  });
  it.each([
    "../x",
    "x#y",
    "x?y",
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    {},
    "x".repeat(129),
  ])("refuses unsafe native ids %j", (value) => {
    expect(sourceId(value)).toBeUndefined();
  });
  it("keeps the mapped metric inventory explicit", () => {
    expect(Object.keys(METRICS)).toHaveLength(12);
  });
});

describe("WHOOP review regressions", () => {
  it.each([
    "CSV first",
    "API first",
  ])("matches whole seconds within +/-60 seconds: %s", async (order) => {
    for (const delta of [-60, 0, 60, 61]) {
      const pod = createMemoryPod();
      const at = new Date(Date.parse(SLEEP.start) + delta * 1000 + 777).toISOString();
      const fixtures = routes("activity/sleep", { records: [{ ...SLEEP, start: at }] });
      if (order === "CSV first") await csv(SLEEPS_CSV, "sleeps.csv", pod);
      await sparseImport(whoopAdapter, fixtures, { pod });
      await csv(SLEEPS_CSV, "sleeps.csv", pod);
      const expected = delta === 61 ? 2 : 1;
      expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(expected);
      const data = pod.dataset(MONTH);
      expect(
        new RecordMarker(`${MONTH}#sleep-${SLEEP.id}`, data, DataFactory).startTime?.toISOString(),
      ).toBe(at);
      if (expected === 1)
        expect([...data].some((q) => q.subject.value.includes("#sleep-csv-"))).toBe(false);
    }
  });
  it("uses resting HR LOINC 40443-4 and leaves source field codes without an invented scheme", async () => {
    const { pod } = await demoImport(whoopAdapter);
    const data = pod.dataset(MONTH);
    const resting = new HealthCode(
      `${MONTH}#recovery-101/metric/restingHR-code`,
      data,
      DataFactory,
    );
    expect(resting.codeValue).toBe("40443-4");
    expect(resting.scheme).toBe("http://loinc.org");
    for (const metric of ["hrv", "temperature", "oxygen"]) {
      const code = new HealthCode(`${MONTH}#recovery-101/metric/${metric}-code`, data, DataFactory);
      expect(code.scheme).toBeUndefined();
      expect(data.countQuads(code.value, `${NS.CORE}value`, null, null)).toBe(1);
    }
    expect([...data].some((q) => q.object.value === "https://developer.whoop.com")).toBe(false);
  });
  it("writes observations through the generated solid-health model (pinned output changes)", async () => {
    const { pod } = await demoImport(whoopAdapter);
    const data = pod.dataset(MONTH);
    const ids = typed(pod, MONTH, HEALTH.Observation).sort();
    // Every stored observation is a valid projection of the generated composite.
    expect(
      parseObservations(data)
        .map((observation) => observation.id)
        .sort(),
    ).toEqual(ids);
    for (const id of ids) {
      const observation = new HealthObservation(id, data, DataFactory);
      // Change: the generated model also types observations health:ClinicalEntry.
      expect(observation.types.has(`${NS.HEALTH}ClinicalEntry`)).toBe(true);
      // Change: helper nodes use solid-health's `-code` / `-time` IDs (was `/code`, `/time`).
      expect(observation.code).toBe(`${id}-code`);
      expect(observation.time).toBe(`${id}-time`);
      expect(data.countQuads(`${id}/code`, null, null, null)).toBe(0);
      expect(data.countQuads(`${id}/time`, null, null, null)).toBe(0);
      // Change: instants are also typed time:TemporalEntity.
      expect(
        new HealthInstant(`${id}-time`, data, DataFactory).types.has(`${NS.TIME}TemporalEntity`),
      ).toBe(true);
      // Change: values are xsd:decimal (was xsd:double).
      const values = data.getQuads(id, `${NS.HEALTH}value`, null, null);
      expect(
        values.map((quad) =>
          quad.object.termType === "Literal" ? quad.object.datatype.value : "",
        ),
      ).toEqual([`${NS.XSD}decimal`]);
      // Change: no schema:endTime on observations; the record marker keeps the window.
      expect(data.countQuads(id, `${NS.SCHEMA}endTime`, null, null)).toBe(0);
      // Unchanged: API observations keep their collection URL for provenance.
      expect(observation.patient).toBe(`${MONTH}#subject`);
      expect(data.countQuads(id, `${NS.SCHEMA}url`, null, null)).toBe(1);
    }
    expect(
      new RecordMarker(`${MONTH}#sleep-sleep-101`, data, DataFactory).endTime?.toISOString(),
    ).toBe("2026-06-08T06:00:00.000Z");
    // Change: QUDT units outside the profile inventory are dropped; UCUM codes remain.
    const unitOf = (root: string, metric: string) => {
      const observation = new HealthObservation(
        `${MONTH}#${root}/metric/${metric}`,
        data,
        DataFactory,
      );
      return [observation.unit, observation.unitCode];
    };
    expect(unitOf("recovery-101", "restingHR")).toEqual([`${NS.UNIT}BEAT-PER-MIN`, "/min"]);
    expect(unitOf("recovery-101", "hrv")).toEqual([undefined, "ms"]);
    expect(unitOf("recovery-101", "temperature")).toEqual([undefined, "Cel"]);
    expect(unitOf("recovery-101", "oxygen")).toEqual([undefined, "%"]);
    expect(unitOf("cycle-101", "energy")).toEqual([undefined, "kJ"]);
    expect(unitOf("sleep-sleep-101", "sleep")).toEqual([`${NS.UNIT}SEC`, "s"]);
    expect(unitOf("sleep-sleep-101", "respiratory")).toEqual([undefined, "/min"]);
    expect(unitOf("sleep-sleep-101", "light")).toEqual([`${NS.UNIT}SEC`, "s"]);
  });
  it("removes legacy `/code` and `/time` helper nodes when a record is reimported", async () => {
    const { pod } = await demoImport(whoopAdapter);
    const legacy = pod.dataset(MONTH);
    const iri = `${MONTH}#recovery-101/metric/restingHR`;
    const code = new HealthCode(`${iri}/code`, legacy, DataFactory).mark();
    code.codeValue = "40443-4";
    new HealthInstant(`${iri}/time`, legacy, DataFactory).mark().dateTime = new Date(
      "2026-06-08T06:00:00Z",
    );
    await writeResource(MONTH, legacy, { fetchImpl: pod.fetch });
    expect(pod.dataset(MONTH).countQuads(`${iri}/code`, null, null, null)).toBeGreaterThan(0);
    await sparseImport(whoopAdapter, WHOOP_FIXTURES, { pod });
    const data = pod.dataset(MONTH);
    expect(data.countQuads(`${iri}/code`, null, null, null)).toBe(0);
    expect(data.countQuads(`${iri}/time`, null, null, null)).toBe(0);
    expect(new HealthCode(`${iri}-code`, data, DataFactory).codeValue).toBe("40443-4");
  });
  it.each([
    1, 2, 3, 4,
  ])("accepts up to three minutes of rounded stage overage (%s min)", async (minutes) => {
    const { pod, report } = await csv(SLEEPS_CSV.replace(",240,", `,${240 + minutes},`));
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(minutes <= 3 ? 1 : 0);
    expect(report.skipped ?? 0).toBe(minutes <= 3 ? 0 : 1);
  });
  it("still rejects stage totals exceeding the actual sleep interval", async () => {
    const { report } = await csv(SLEEPS_CSV.replace(",450,240,120,90,", ",480,272,120,90,"));
    expect(report.skipped).toBe(1);
  });
  it.each([
    "api",
    "file",
  ])("shards %s workouts by month and keeps native or CSV ids on reimport", async (source) => {
    const pod = createMemoryPod();
    const july = `${ROOT}health/workouts/2026-07.ttl`;
    const run = () =>
      source === "api"
        ? sparseImport(
            whoopAdapter,
            routes("activity/workout", {
              records: [
                WORKOUT,
                {
                  ...WORKOUT,
                  id: "july",
                  start: "2026-07-08T08:00:00.123Z",
                  end: "2026-07-08T08:30:00.123Z",
                },
              ],
            }),
            { pod },
          )
        : fileImport(
            whoopFileAdapter,
            memoryFile(
              "workouts.csv",
              `${WORKOUTS_CSV}\n${WORKOUTS_CSV.split("\n")[1]?.replaceAll("2026-06", "2026-07")}`,
            ),
            { pod },
          );
    await run();
    const before = [
      typed(pod, WORKOUTS, CLASSES.ExerciseAction),
      typed(pod, july, CLASSES.ExerciseAction),
    ];
    expect(before.map((ids) => ids.length)).toEqual([1, 1]);
    expect(pod.get(`${ROOT}health/workouts.ttl`)).toBeUndefined();
    await run();
    expect([
      typed(pod, WORKOUTS, CLASSES.ExerciseAction),
      typed(pod, july, CLASSES.ExerciseAction),
    ]).toEqual(before);
  });
  it("resumes inside API pages without losing records and advances the high-water cursor only after all kinds", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopAdapter({ maxItems: 2, maxRequests: 50 });
    const sleeps = Array.from({ length: 5 }, (_, index) => ({
      ...SLEEP,
      id: `night-${index}`,
      start: `2026-06-0${index + 1}T22:00:00.777Z`,
      end: `2026-06-0${index + 2}T06:00:00.777Z`,
    })).reverse();
    const requests: URL[] = [];
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/sleep"))
        return Response.json(
          url.searchParams.has("nextToken")
            ? { records: sleeps.slice(3) }
            : { records: sleeps.slice(0, 3), next_token: "next/+page" },
        );
      return Response.json({ records: [] });
    };
    let cursor: string | undefined;
    for (let run = 0; run < 3; run++) {
      const report = await runImport({
        adapter,
        mode: "live",
        sourceAuth: { fetch: transport },
        podWriter: writer(pod),
        cursor,
      });
      cursor = report.cursor;
      expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(Math.min((run + 1) * 2, 5));
      expect(Boolean(report.warnings?.length)).toBe(run < 2);
    }
    expect(cursor).toBe(sleeps[0]?.start);
    expect(requests.every((url) => !url.searchParams.has("start"))).toBe(true);
    expect(requests.some((url) => url.searchParams.get("nextToken") === "next/+page")).toBe(true);
  });
  it("resolves recovery cycle timestamps after a batch ends in cycle traversal", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopAdapter({ maxItems: 1, maxRequests: 50 });
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/cycle/101")) return Response.json(CYCLE);
      const fixture = WHOOP_FIXTURES.find((route) => new URL(route.url).pathname === url.pathname);
      return Response.json(fixture?.json ?? { records: [] });
    };
    let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const report = await runImport({
        adapter,
        mode: "live",
        sourceAuth: { fetch: transport },
        podWriter: writer(pod),
        cursor,
      });
      cursor = report.cursor;
    }
    expect(cursor).toBe("2026-06-08T08:00:00.000Z");
    expect(
      new HealthObservation(
        `${MONTH}#recovery-101/metric/restingHR`,
        pod.dataset(MONTH),
        DataFactory,
      ).measuredValue,
    ).toBe(52);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(typed(pod, WORKOUTS, CLASSES.ExerciseAction)).toHaveLength(1);
  });
  it("treats the default 10000 source item cap as a resumable boundary even with malformed rows", async () => {
    const pod = createMemoryPod();
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/cycle")) return Response.json({ records: [] });
      const offset = Number(url.searchParams.get("nextToken") ?? 0);
      return Response.json({
        records: Array(Math.min(25, 10001 - offset)).fill(null),
        ...(offset + 25 < 10001 ? { next_token: String(offset + 25) } : {}),
      });
    };
    const first = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      sourceAuth: { fetch: transport },
      podWriter: writer(pod),
    });
    expect(first.skipped).toBe(10000);
    expect(first.warnings).toEqual(["WHOOP import partial, re-run to continue."]);
    const second = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      sourceAuth: { fetch: transport },
      podWriter: writer(pod),
      state: first.state,
    });
    expect(second.skipped).toBe(1);
    expect(second.warnings).toBeUndefined();
  });
  it.each([
    "csv",
    "zip",
  ])("finishes a bounded %s export newest-first over several runs", async (format) => {
    const pod = createMemoryPod();
    const adapter = createWhoopFileAdapter(2);
    const text = `${SLEEPS_CSV.split("\n")[0]}\n${[1, 3, 2, 5, 4]
      .map((day) =>
        SLEEPS_CSV.split("\n")[1]
          ?.replace("2026-06-07", `2026-06-0${day}`)
          .replace("2026-06-08", `2026-06-0${day + 1}`),
      )
      .join("\n")}`;
    const file =
      format === "csv" ? memoryFile("sleeps.csv", text) : archive({ "sleeps.csv": text });
    let state: ConnectorState | undefined;
    for (let i = 0; i < 3; i++) {
      const report = await runFileImport({ adapter, file, podWriter: writer(pod), state });
      state = report.state;
      expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(Math.min(2 * (i + 1), 5));
      expect(Boolean(report.warnings?.length)).toBe(i < 2);
      if (i === 0) {
        const times = typed(pod, MONTH, HEALTH.Sleep).map((id) =>
          new HealthInstant(`${id}-time`, pod.dataset(MONTH), DataFactory).dateTime?.toISOString(),
        );
        expect(times).toEqual(
          expect.arrayContaining(["2026-06-05T22:00:00.000Z", "2026-06-04T22:00:00.000Z"]),
        );
      }
    }
    // A finished traversal starts afresh on the next run; rewrites are idempotent.
    const again = await runFileImport({ adapter, file, podWriter: writer(pod), state });
    expect(again.written).toHaveLength(1);
    expect(again.warnings?.length).toBe(1);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(5);
    // A different export must start fresh, even when its filename and size match.
    const changed = await runFileImport({
      adapter,
      file: memoryFile("sleeps.csv", text.replaceAll("2026-06", "2026-07")),
      podWriter: writer(pod),
      state,
    });
    expect(changed.warnings?.length).toBe(1);
    expect(typed(pod, `${ROOT}health/observations/2026-07.ttl`, HEALTH.Sleep)).toHaveLength(2);
  });
  it("keeps physiological rows atomic when the file record budget has one slot left", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopFileAdapter(3);
    const text = `${CYCLES_CSV}\n${CYCLES_CSV.split("\n")[1]?.replaceAll("2026-06-08", "2026-06-07").replaceAll("2026-06-09", "2026-06-08")}`;
    const file = memoryFile("physiological_cycles.csv", text);
    const first = await runFileImport({ adapter, file, podWriter: writer(pod) });
    expect(first.warnings?.length).toBe(1);
    expect(typed(pod, MONTH, CLASSES.Dataset)).toHaveLength(2);
    const second = await runFileImport({
      adapter,
      file,
      podWriter: writer(pod),
      state: first.state,
    });
    expect(second.warnings).toBeUndefined();
    expect(typed(pod, MONTH, CLASSES.Dataset)).toHaveLength(4);
  });
});

describe("WHOOP matching at month boundaries", () => {
  it.each(["CSV first", "API first"])("reconciles adjacent monthly shards: %s", async (order) => {
    const pod = createMemoryPod();
    const text = SLEEPS_CSV.replace("2026-06-07 22:00:00", "2026-06-30 23:59:30").replace(
      "2026-06-08 06:00:00",
      "2026-07-01 08:00:00",
    );
    const fixtures = routes("activity/sleep", {
      records: [{ ...SLEEP, start: "2026-07-01T00:00:00.777Z", end: "2026-07-01T08:00:00.777Z" }],
    });
    if (order === "CSV first") await csv(text, "sleeps.csv", pod);
    await sparseImport(whoopAdapter, fixtures, { pod });
    await csv(text, "sleeps.csv", pod);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(0);
    expect(typed(pod, `${ROOT}health/observations/2026-07.ttl`, HEALTH.Sleep)).toHaveLength(1);
    expect(pod.get(MONTH)).not.toContain("#sleep-csv-");
  });
});

describe("WHOOP resumed recovery request bounds", () => {
  it("saves recovery progress when cycle lookups consume the request budget", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopAdapter({ maxRequests: 3, maxItems: 10 });
    const transport: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      const cycleId = /\/cycle\/(\d+)$/.exec(path)?.[1];
      if (cycleId) return Response.json({ ...CYCLE, id: Number(cycleId) });
      if (path.endsWith("/recovery"))
        return Response.json({
          records: [101, 102, 103, 104].map((id) => ({ ...RECOVERY, cycle_id: id })),
        });
      return Response.json({ records: [] });
    };
    let cursor: string | undefined = JSON.stringify({ v: 1, position: { index: 1, offset: 0 } });
    const first = await runImport({
      adapter,
      mode: "live",
      podWriter: writer(pod),
      cursor,
      sourceAuth: { fetch: transport },
    });
    expect(first.warnings?.length).toBe(1);
    expect(typed(pod, MONTH, HEALTH.HeartRate)).toHaveLength(2);
    cursor = first.cursor;
    const second = await runImport({
      adapter,
      mode: "live",
      podWriter: writer(pod),
      cursor,
      sourceAuth: { fetch: transport },
    });
    expect(typed(pod, MONTH, HEALTH.HeartRate)).toHaveLength(4);
    const third = await runImport({
      adapter,
      mode: "live",
      podWriter: writer(pod),
      cursor: second.cursor,
      sourceAuth: { fetch: transport },
    });
    expect(third.warnings).toBeUndefined();
    expect(third.cursor).toBe("2026-06-08T06:00:00.000Z");
  });
  it("skips a deleted recovery cycle and retains its saved timestamp rather than inventing a date", async () => {
    const pod = createMemoryPod();
    const report = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(pod),
      cursor: JSON.stringify({
        v: 1,
        newest: "2026-06-08T06:00:00.000Z",
        position: { index: 1, offset: 0 },
      }),
      sourceAuth: {
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/cycle/101")) return new Response(null, { status: 404 });
          return Response.json({ records: path.endsWith("/recovery") ? [RECOVERY] : [] });
        },
      },
    });
    expect(report.skipped).toBe(1);
    expect(report.cursor).toBe("2026-06-08T06:00:00.000Z");
    expect(typed(pod, MONTH, HEALTH.HeartRate)).toHaveLength(0);
  });
});

describe("WHOOP legacy duplicate cleanup", () => {
  it("removes an already-stored CSV duplicate when a file import finds the API winner", async () => {
    const { pod } = await csv(SLEEPS_CSV);
    const oldCsv = pod.dataset(MONTH);
    await sparseImport(whoopAdapter, MILLISECOND_WHOOP_FIXTURES, { pod });
    const mixed = pod.dataset(MONTH);
    mixed.addQuads([...oldCsv]);
    await writeResource(MONTH, mixed, { fetchImpl: pod.fetch });
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(2);
    await csv(SLEEPS_CSV, "sleeps.csv", pod);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(pod.get(MONTH)).not.toContain("#sleep-csv-");
  });
});

// AUTHORED-BY Claude Opus 5.5
describe("WHOOP review round-two regressions", () => {
  const sleepRows = (days: number[], month = "06") =>
    `${SLEEPS_CSV.split("\n")[0]}\n${days
      .map((day) =>
        SLEEPS_CSV.split("\n")[1]
          ?.replace("2026-06-07", `2026-${month}-0${day}`)
          .replace("2026-06-08", `2026-${month}-0${day + 1}`),
      )
      .join("\n")}`;
  const sleepCursor = (position: Record<string, unknown>) =>
    JSON.stringify({ v: 1, position: { index: 2, ...position } });
  const sleeps = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      ...SLEEP,
      id: `night-${index}`,
      start: `2026-06-0${index + 1}T22:00:00.000Z`,
      end: `2026-06-0${index + 2}T06:00:00.000Z`,
    }));

  it("re-imports a finished export from the start, restoring a deleted shard and removing legacy helpers", async () => {
    const pod = createMemoryPod();
    const file = memoryFile(
      "sleeps.csv",
      `${sleepRows([1, 2])}\n${sleepRows([3], "07").split("\n")[1]}`,
    );
    const july = `${ROOT}health/observations/2026-07.ttl`;
    const first = await runFileImport({ adapter: whoopFileAdapter, file, podWriter: writer(pod) });
    expect(first.warnings).toBeUndefined();
    // The completion value is distinct, so the session cannot fall back to an older cursor.
    expect(JSON.parse(first.cursor ?? "{}").before).toBe("");
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(2);
    await pod.fetch(MONTH, { method: "DELETE" });
    const legacy = pod.dataset(july);
    const [julySleep] = typed(pod, july, HEALTH.Sleep);
    new HealthCode(`${julySleep}/code`, legacy, DataFactory).mark().codeValue = "93832-4";
    new HealthInstant(`${julySleep}/time`, legacy, DataFactory).mark().dateTime = new Date(
      "2026-07-03T22:00:00Z",
    );
    await writeResource(july, legacy, { fetchImpl: pod.fetch });
    const again = await runFileImport({
      adapter: whoopFileAdapter,
      file,
      podWriter: writer(pod),
      state: first.state,
    });
    expect(again.cursor).toBe(first.cursor);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(2);
    const data = pod.dataset(july);
    expect(data.countQuads(`${julySleep}/code`, null, null, null)).toBe(0);
    expect(data.countQuads(`${julySleep}/time`, null, null, null)).toBe(0);
  });

  it("ends a bounded traversal with the completion value rather than an earlier partial cursor", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopFileAdapter(2);
    const file = memoryFile("sleeps.csv", sleepRows([1, 2, 3]));
    const first = await runFileImport({ adapter, file, podWriter: writer(pod) });
    expect(JSON.parse(first.cursor ?? "{}").before).not.toBe("");
    const second = await runFileImport({
      adapter,
      file,
      podWriter: writer(pod),
      state: first.state,
    });
    expect(second.warnings).toBeUndefined();
    expect(JSON.parse(second.state?.cursor ?? "{}").before).toBe("");
  });

  it("counts malformed source records once per traversal, not once per batch", async () => {
    const pod = createMemoryPod();
    const adapter = createWhoopFileAdapter(2);
    const oversized = `${SLEEPS_CSV.split("\n")[1]}${"x".repeat(4 * 1024 * 1024)}`;
    const file = memoryFile("sleeps.csv", `${sleepRows([1, 2, 3, 4, 5])}\n${oversized}`);
    let state: ConnectorState | undefined;
    const skipped: (number | undefined)[] = [];
    for (let run = 0; run < 3; run++) {
      const report = await runFileImport({ adapter, file, podWriter: writer(pod), state });
      state = report.state;
      skipped.push(report.skipped);
    }
    expect(skipped).toEqual([1, undefined, undefined]);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(5);
    // A new traversal after completion counts the malformed record again, once.
    const fresh = await runFileImport({ adapter, file, podWriter: writer(pod), state });
    expect(fresh.skipped).toBe(1);
  });

  it("replays a resumed API page that shrank below the saved offset instead of failing", async () => {
    const pod = createMemoryPod();
    const report = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(pod),
      cursor: sleepCursor({ offset: 20 }),
      sourceAuth: {
        fetch: async (input) =>
          Response.json({
            records: new URL(String(input)).pathname.endsWith("/sleep") ? sleeps(3) : [],
          }),
      },
    });
    expect(report.warnings).toBeUndefined();
    expect(report.cursor).toBe("2026-06-03T22:00:00.000Z");
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(3);
  });

  it.each([
    400, 404,
  ])("restarts a collection once when WHOOP rejects a resumed token (%s)", async (status) => {
    const pod = createMemoryPod();
    const requests: URL[] = [];
    const report = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(pod),
      cursor: sleepCursor({ token: "expired", offset: 3 }),
      sourceAuth: {
        fetch: async (input) => {
          const url = new URL(String(input));
          requests.push(url);
          if (url.searchParams.get("nextToken") === "expired")
            return new Response(null, { status });
          return Response.json({ records: url.pathname.endsWith("/sleep") ? sleeps(3) : [] });
        },
      },
    });
    expect(report.warnings).toBeUndefined();
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(3);
    const sleepRequests = requests.filter((url) => url.pathname.endsWith("/sleep"));
    expect(sleepRequests.map((url) => url.searchParams.get("nextToken"))).toEqual([
      "expired",
      null,
    ]);
  });

  it("does not restart for a fresh token, a second rejection or a server error", async () => {
    const run = (fetch: typeof globalThis.fetch, cursor?: string) =>
      runImport({
        adapter: whoopAdapter,
        mode: "live",
        podWriter: writer(createMemoryPod()),
        cursor,
        sourceAuth: { fetch },
      });
    const rejectTokens: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.has("nextToken")) return new Response(null, { status: 400 });
      return Response.json({
        records: url.pathname.endsWith("/sleep") ? sleeps(1) : [],
        ...(url.pathname.endsWith("/sleep") ? { next_token: "fresh" } : {}),
      });
    };
    // The restarted traversal's own next token is not a resumed token.
    await expect(run(rejectTokens, sleepCursor({ token: "expired", offset: 0 }))).rejects.toThrow(
      /400/,
    );
    await expect(run(rejectTokens)).rejects.toThrow(/400/);
    await expect(
      run(async () => new Response(null, { status: 500 }), sleepCursor({ token: "t", offset: 0 })),
    ).rejects.toThrow(/500/);
  });

  it("registers health observations for the workouts container too", async () => {
    const { pod, report } = await demoImport(whoopAdapter);
    expect(typed(pod, WORKOUTS, HEALTH.Observation).length).toBeGreaterThan(0);
    const containers = new TypeIndexDataset(pod.dataset(report.indexUrl), DataFactory)
      .locate(HEALTH.Observation)
      .map((location) => location.container);
    expect(containers).toEqual(
      expect.arrayContaining([`${ROOT}health/observations/`, `${ROOT}health/workouts/`]),
    );
  });

  it("round-trips a full API month through solid-health parseObservations", {
    timeout: 30_000,
  }, async () => {
    const pod = createMemoryPod();
    const day = (d: number) => String(d).padStart(2, "0");
    const days = Array.from({ length: 29 }, (_, i) => i + 1);
    const data: Record<string, unknown[]> = {
      cycle: days.map((d) => ({
        ...CYCLE,
        id: d,
        start: `2026-06-${day(d)}T06:00:00Z`,
        end: `2026-06-${day(d + 1)}T06:00:00Z`,
      })),
      recovery: days.map((d) => ({ ...RECOVERY, cycle_id: d })),
      sleep: days.map((d) => ({
        ...SLEEP,
        id: `night-${d}`,
        start: `2026-06-${day(d)}T22:00:00Z`,
        end: `2026-06-${day(d + 1)}T05:30:00Z`,
      })),
      workout: days.flatMap((d) =>
        [8, 18].map((hour) => ({
          ...WORKOUT,
          id: `workout-${d}-${hour}`,
          start: `2026-06-${day(d)}T${day(hour)}:00:00Z`,
          end: `2026-06-${day(d)}T${day(hour)}:45:00Z`,
        })),
      ),
    };
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const kind = url.pathname.split("/").at(-1) as string;
      const offset = Number(url.searchParams.get("nextToken") ?? 0);
      const rows = data[kind] ?? [];
      return Response.json({
        records: rows.slice(offset, offset + 25),
        ...(offset + 25 < rows.length ? { next_token: String(offset + 25) } : {}),
      });
    };
    const report = await runImport({
      adapter: whoopAdapter,
      mode: "live",
      podWriter: writer(pod),
      sourceAuth: { fetch: transport },
    });
    expect(report.warnings).toBeUndefined();
    for (const [url, expected] of [
      [MONTH, 29 * (3 + 4 + 5)],
      [WORKOUTS, 58 * 3],
    ] as const) {
      const shard = pod.dataset(url);
      expect(shard.size).toBeLessThan(MAX_OBSERVATION_QUADS);
      const parsed = parseObservations(shard);
      expect(parsed).toHaveLength(expected);
      expect(parsed).toHaveLength(typed(pod, url, HEALTH.Observation).length);
    }
    const resting = parseObservations(pod.dataset(MONTH)).find(
      (observation) => observation.id === `${MONTH}#recovery-15/metric/restingHR`,
    );
    expect(resting?.measuredValue).toBe(52);
    expect(resting?.dateTime.toISOString()).toBe("2026-06-15T06:00:00.000Z");
  });

  it("refuses a shard whose stored form would exceed the Health reader limits", async () => {
    expect(MAX_STORED_QUADS).toBe(MAX_OBSERVATION_QUADS);
    expect(MAX_STORED_OBSERVATIONS).toBe(MAX_OBSERVATIONS);
    // Unrelated records already in the shard, without provenance yet: four quads each.
    const seeded = async (markers: number) => {
      const pod = createMemoryPod();
      const dataset = pod.dataset(MONTH);
      for (let i = 0; i < markers; i++) {
        const marker = new RecordMarker(`${MONTH}#other-${i}`, dataset, DataFactory);
        marker.types.add(CLASSES.Dataset);
        marker.description = "other";
        marker.source = "Other";
        marker.startTime = new Date(Date.UTC(2026, 5, 1, 0, 0, i % 60));
      }
      await writeResource(MONTH, dataset, { fetchImpl: pod.fetch });
      return pod;
    };
    // 60k staged quads: the session's provenance keeps the stored document readable.
    const fits = await seeded(15_000);
    await csv(SLEEPS_CSV, "sleeps.csv", fits);
    const stored = fits.dataset(MONTH);
    expect(stored.size).toBeLessThanOrEqual(MAX_OBSERVATION_QUADS);
    expect(parseObservations(stored).filter((o) => o.id.includes("#sleep-"))).toHaveLength(5);
    // 80k staged quads fit, but the provenance links the session adds would not.
    const refused = await seeded(20_000);
    const before = refused.get(MONTH);
    await expect(csv(SLEEPS_CSV, "sleeps.csv", refused)).rejects.toThrow(/Health reader limit/);
    expect(refused.get(MONTH)).toBe(before);
  }, 60_000);
});
