// AUTHORED-BY Codex GPT-6.1-Sol
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
import { createRegistry } from "../registry.js";
import { createWhoopAdapter, whoopAdapter } from "./adapter.js";
import { MAX_WHOOP_FILE_BYTES, whoopFileAdapter } from "./file-adapter.js";
import { CYCLE, RECOVERY, SLEEP, WHOOP_FIXTURES, WORKOUT } from "./fixtures.js";
import { API, MAX_RECORDS, METRICS, sourceId, timestamp } from "./model.js";
import { HEALTH, HealthNode } from "./vocab.js";

const ROOT = `${TEST_POD_ROOT}integrations/whoop/`;
const MONTH = `${ROOT}health/observations/2026-06.ttl`;
const WORKOUTS = `${ROOT}health/workouts.ttl`;
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
      "read:profile",
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
      new HealthNode(`${MONTH}#${root}/metric/${metric}`, data, DataFactory);
    expect(measurement("recovery-101", "restingHR").measuredValue).toBe(52);
    expect(measurement("recovery-101", "hrv").measuredValue).toBe(65);
    expect(measurement("recovery-101", "temperature").measuredValue).toBe(33.5);
    expect(measurement("recovery-101", "oxygen").measuredValue).toBe(98);
    expect(measurement("cycle-101", "energy").measuredValue).toBe(4184);
    expect(measurement("sleep-sleep-101", "sleep").measuredValue).toBe(27_000);
    expect(measurement("sleep-sleep-101", "deep").measuredValue).toBe(7200);
    expect(typed(pod, MONTH, HEALTH.Sleep)).toHaveLength(1);
    expect(measurement("sleep-sleep-101", "light").types.has(HEALTH.Sleep)).toBe(false);
    expect(measurement("recovery-101", "hrv").linked(HEALTH.hasUnit)).toBe(`${NS.UNIT}MilliSEC`);
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
    await demoImport(whoopAdapter, { pod });
    await fileImport(whoopFileAdapter, file, { pod });
    await demoImport(whoopAdapter, { pod });
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
      new HealthNode(observation?.subject.value as string, data, DataFactory).measuredValue,
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
      new HealthNode(`${MONTH}#recovery-101/metric/restingHR`, pod.dataset(MONTH), DataFactory)
        .measuredValue,
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
    expect(new HealthNode(total, pod.dataset(MONTH), DataFactory).measuredValue).toBe(27_000);
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
      new HealthNode(`${MONTH}#recovery-101/metric/restingHR`, pod.dataset(MONTH), DataFactory)
        .measuredValue,
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
    await expect(
      demoImport(createWhoopAdapter({ maxRequests: 3, maxItems: 20, maxBytes: 10000 })),
    ).rejects.toThrow(/request budget/);
    await expect(
      demoImport(createWhoopAdapter({ maxRequests: 20, maxItems: 3, maxBytes: 10000 })),
    ).rejects.toThrow(/item budget/);
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
  it("rejects the upload byte cap and row cap before storing partial results", async () => {
    const file = memoryFile("sleeps.csv", SLEEPS_CSV);
    await expect(
      fileImport(whoopFileAdapter, { ...file, size: MAX_WHOOP_FILE_BYTES + 1 }),
    ).rejects.toThrow(/limit/);
    const text = `${SLEEPS_CSV.split("\n")[0]}\n${`${SLEEPS_CSV.split("\n")[1]}\n`.repeat(MAX_RECORDS + 1)}`;
    const pod = createMemoryPod();
    await expect(csv(text, "sleeps.csv", pod)).rejects.toThrow(/cap/);
    expect(pod.get(MONTH)).toBeUndefined();
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
