// AUTHORED-BY Codex GPT-6.1-Sol
import {
  DEFAULT_MAX_OBSERVATIONS,
  observationDocPath,
  PROPERTY,
  PROPERTY_UNITS,
  parseObservations,
  parseSensor,
  SOSA,
  sensorDocPath,
} from "@jeswr/solid-environment";
import { LiteralFrom, OptionalAs } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { PodWriter } from "../core/types.js";
import { PodThing } from "../core/vocab.js";
import {
  createVeSyncAdapter,
  familyOf,
  hasAirSensor,
  measurements,
  sensorSlug,
  type VeSyncFamily,
} from "./adapter.js";
import {
  BYPASS,
  DETAIL,
  DEVICES,
  MAX_DEVICES,
  MAX_RESPONSE_BYTES,
  text,
  VESYNC_API,
} from "./api.js";
import { coreStatus, devices, legacyStatus, vitalStatus } from "./fixtures.js";

const time = "2026-11-11T23:59:59Z";
function setup(list: unknown[] = [...devices], status: unknown = coreStatus) {
  const pod = createMemoryPod();
  const conditions: { url: string; headers: Headers }[] = [];
  const podFetch: typeof fetch = async (input, init) => {
    if (init?.method === "PUT")
      conditions.push({ url: String(input), headers: new Headers(init.headers) });
    return pod.fetch(input, init);
  };
  const writer = createFetchPodWriter({
    adapterId: "vesync",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: podFetch,
  });
  const api = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const url = String(input);
    if (url === VESYNC_API + DEVICES) return Response.json({ code: 0, result: { list } });
    if (url === VESYNC_API + DETAIL) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ uuid: devices[4]?.uuid });
      return Response.json(legacyStatus);
    }
    expect(url).toBe(VESYNC_API + BYPASS);
    const body = JSON.parse(String(init?.body));
    expect(body.payload).toEqual({ method: "getPurifierStatus", source: "APP", data: {} });
    return Response.json(body.cid === devices[3]?.cid ? vitalStatus : status);
  });
  const run = (at = time, opts = {}, override: Partial<PodWriter> = {}) =>
    runImport({
      adapter: createVeSyncAdapter({ now: () => new Date(at), ...opts }),
      mode: "live",
      podWriter: { ...writer, ...override },
      sourceAuth: { fetch: api },
    });
  return { pod, writer, run, api, conditions };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("maps Core 300S/400S/600S, Vital 200S and v1 LV-PUR131S without disclosing identifiers", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Global network forbidden");
  });
  const { pod, run, conditions } = setup();
  const report = await run(time, { room: "Office" });
  expect(report.written).toHaveLength(15);
  for (const [i, device] of devices.entries()) {
    const slug = await sensorSlug(device.cid);
    const sensorUrl = new URL(`integrations/vesync/${sensorDocPath(slug)}`, TEST_POD_ROOT).href;
    const sensor = parseSensor(`${sensorUrl}#sensor`, pod.dataset(sensorUrl));
    expect(sensor).toMatchObject({
      label: device.deviceName,
      model: device.deviceType,
      manufacturer: "Levoit",
    });
    const url = new URL(`integrations/vesync/${observationDocPath(slug, time)}`, TEST_POD_ROOT)
      .href;
    const readings = parseObservations(url, pod.dataset(url));
    expect(readings.length).toBe(i === 4 ? 2 : 4);
    for (const reading of readings) {
      expect(reading.sensor).toBe(`${sensorUrl}#sensor`);
      expect(reading.resultTime).toBe("2026-11-11T23:59:00.000Z");
      expect(reading.unit).toBe(PROPERTY_UNITS[reading.property]);
      expect(reading.featureOfInterest).toContain(
        reading.property === PROPERTY.FanSpeedLevel ||
          reading.property === PROPERTY.FilterLifeRemaining
          ? "sensor.ttl#sensor"
          : "room.ttl#room",
      );
    }
    const persisted = pod
      .urls()
      .map((url) => pod.get(url))
      .join("\n");
    expect(persisted).not.toContain(device.cid);
    expect(persisted).not.toContain(device.uuid);
    expect(persisted).toContain("Office");
  }
  const index = report.indexUrl;
  const registered = pod.get(index);
  expect(registered).toContain(`${SOSA}Sensor`);
  expect(registered).toContain(`${SOSA}Observation`);
  expect(registered).toContain(`${SOSA}FeatureOfInterest`);
  expect(conditions.filter(({ url }) => url.endsWith("/11.ttl"))).toHaveLength(5);
  expect(
    conditions
      .filter(({ url }) => url.endsWith("/11.ttl"))
      .every(({ headers }) => headers.get("if-none-match") === "*"),
  ).toBe(true);
});

it("is idempotent within a minute, appends later minutes and rolls over at UTC midnight", async () => {
  const { run, pod, conditions } = setup([devices[0]]);
  const slug = await sensorSlug(devices[0]?.cid ?? "");
  const day = new URL(`integrations/vesync/${observationDocPath(slug, time)}`, TEST_POD_ROOT).href;
  await run();
  await run("2026-11-11T23:59:01Z");
  expect(parseObservations(day, pod.dataset(day))).toHaveLength(4);
  expect(
    conditions
      .filter(({ url }) => url === day)
      .at(-1)
      ?.headers.get("if-match"),
  ).toBe('"v1"');
  await run("2026-11-11T23:58:40Z");
  expect(parseObservations(day, pod.dataset(day))).toHaveLength(8);
  await run("2026-11-12T00:00:00Z");
  const tomorrow = new URL(
    `integrations/vesync/${observationDocPath(slug, "2026-11-12")}`,
    TEST_POD_ROOT,
  ).href;
  expect(parseObservations(tomorrow, pod.dataset(tomorrow))).toHaveLength(4);
  expect(parseObservations(day, pod.dataset(day))).toHaveLength(8);
});

it("supports per-sensor rooms and defaults to the device name", async () => {
  const { run, pod } = setup([devices[0]]);
  const slug = await sensorSlug(devices[0]?.cid ?? "");
  await run(time, { room: { [slug]: "Bedroom" } });
  const room = pod.urls().find((url) => url.endsWith("/room.ttl")) ?? "";
  expect(pod.get(room)).toContain("Bedroom");
  await run();
  expect(pod.get(room)).toContain("Purifier 1");
});

it("skips absent, wrong-type, NaN, infinite, negative and out-of-range measurements", async () => {
  for (const value of [
    undefined,
    null,
    "12",
    true,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    100001,
  ])
    expect(
      measurements(
        {
          air_quality: value,
          air_quality_value: value,
          level: value,
          filter_life: value,
        },
        "core",
      ),
    ).toEqual([]);
  expect(measurements({ filter_life: 101, level: 101 }, "core")).toEqual([]);
  const { run, pod } = setup(
    [
      null,
      {},
      { ...devices[0], deviceName: [] },
      { ...devices[0], deviceType: "Unknown" },
      devices[0],
      devices[0],
    ],
    { code: 0, result: { result: { mode: "auto", air_quality: "excellent", enabled: true } } },
  );
  const report = await run();
  expect(report.skipped).toBe(6);
  expect(pod.urls().some((url) => url.endsWith("sensor.ttl"))).toBe(true);
  expect(pod.urls().some((url) => url.endsWith("/11.ttl"))).toBe(false);
});

it("rejects oversized device lists and malformed/huge envelopes before writes", async () => {
  const s = setup(Array.from({ length: MAX_DEVICES + 1 }, () => devices[0]));
  await expect(s.run()).rejects.toThrow("device cap");
  for (const json of [
    { code: 0 },
    { code: 0, result: { list: "bad" } },
    { code: 0, result: { list: [], total: 51 } },
    { code: "0", result: { list: [] } },
  ]) {
    s.api.mockImplementationOnce(async () => Response.json(json));
    await expect(s.run()).rejects.toThrow();
  }
  s.api.mockImplementationOnce(
    async () =>
      new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
  );
  await expect(s.run()).rejects.toThrow("VeSync reading failed");
  expect(s.pod.urls().some((url) => url.includes("environment/"))).toBe(false);
});

it("skips a capped day without growing it and logs a fixed safe message", async () => {
  const s = setup([devices[0]]);
  const slug = await sensorSlug(devices[0]?.cid ?? "");
  const path = observationDocPath(slug, time),
    url = s.writer.resolve(path);
  // Malformed typed roots still consume the model's observation allowance.
  const dataset = new Store();
  for (let i = 0; i < DEFAULT_MAX_OBSERVATIONS; i++)
    new PodThing(`${url}#old-${i}`, dataset, DataFactory).types.add(`${SOSA}Observation`);
  await s.writer.write({
    slug: path,
    category: "environment",
    forClass: `${SOSA}Observation`,
    dataset,
  });
  const before = s.pod.get(url),
    progress = vi.fn();
  const report = await runImport({
    adapter: createVeSyncAdapter({ now: () => new Date(time) }),
    mode: "live",
    podWriter: s.writer,
    sourceAuth: { fetch: s.api },
    onProgress: progress,
  });
  expect(report.skipped).toBe(4);
  expect(s.pod.get(url)).toBe(before);
  expect(
    progress.mock.calls
      .flat()
      .map((p) => p.label)
      .join(" "),
  ).toContain("cap reached");
}, 30000);

it("refuses missing/weak ETags and preserves a concurrent day update", async () => {
  const s = setup([devices[0]]);
  await s.run();
  for (const etag of [null, 'W/"weak"', '"has space"', '"bad\nheader"', "unquoted", '"Ā"'])
    await expect(
      s.run(
        time,
        {},
        {
          read: async (path) => {
            const found = await s.writer.read(path);
            return found ? { ...found, etag } : undefined;
          },
        },
      ),
    ).rejects.toThrow("strong ETag");
  await expect(
    s.run(
      "2026-11-11T23:58:00Z",
      {},
      {
        write: async (doc, conditions) => {
          if (doc.slug.endsWith("/11.ttl")) await s.writer.write(doc);
          return s.writer.write(doc, conditions);
        },
      },
    ),
  ).rejects.toThrow();
});

it("bounds watch history without pruning unrelated provenance or failing on malformed old timestamps", async () => {
  const s = setup([devices[0]]);
  const { Provenance, PROV } = await import("../core/provenance.js");
  const runs = s.writer.resolve("_provenance.ttl");
  const history = new Store();
  for (const subject of [
    "https://unrelated.example/activity",
    `${runs}#metadata`,
    `${runs}#run-custom`,
  ]) {
    const entry = new Provenance(subject, history, DataFactory);
    entry.associatedWith = "urn:solid:connector:vesync";
    entry.name = "Preserve this metadata";
    if (!subject.endsWith("#metadata")) entry.types.add(`${PROV}Activity`);
    entry.endedAt = new Date(0);
  }
  const malformed = `${runs}#run-00000000-0000-4000-8000-000000000000`;
  const old = new Provenance(malformed, history, DataFactory);
  old.types.add(`${PROV}Activity`);
  old.associatedWith = "urn:solid:connector:vesync";
  OptionalAs.object(old, `${PROV}endedAtTime`, "not-a-date", LiteralFrom.string);
  await s.writer.write({
    slug: "_provenance.ttl",
    category: "provenance",
    forClass: `${PROV}Activity`,
    dataset: history,
    skipRegistration: true,
  });
  for (let minute = 1; minute <= 4; minute++) {
    const adapter = {
      ...createVeSyncAdapter({ now: () => new Date(`2026-11-11T01:0${minute}:00Z`) }),
      maxRunActivities: 2,
    };
    await runImport({ adapter, mode: "live", podWriter: s.writer, sourceAuth: { fetch: s.api } });
  }
  const provenance = s.pod.dataset(s.writer.resolve("_provenance.ttl"));
  const activities = provenance.getSubjects(null, `${PROV}Activity`, null);
  expect(activities).toHaveLength(4);
  expect(new Provenance(malformed, provenance, DataFactory).associatedWith).toBeUndefined();
  for (const subject of [
    "https://unrelated.example/activity",
    `${runs}#metadata`,
    `${runs}#run-custom`,
  ])
    expect(new Provenance(subject, provenance, DataFactory).name).toBe("Preserve this metadata");
  for (const subject of activities)
    expect(new Provenance(subject, provenance, DataFactory).endedAt).toBeInstanceOf(Date);
});

it("keeps a hostile large literal from growing a day past its byte cap", async () => {
  const s = setup([devices[0]]);
  const slug = await sensorSlug(devices[0]?.cid ?? "");
  const path = observationDocPath(slug, time),
    url = s.writer.resolve(path);
  const large = new Store();
  new PodThing(url, large, DataFactory).name = "x".repeat(8 * 1024 * 1024);
  const report = await s.run(
    time,
    {},
    {
      read: async (slug) =>
        slug === path ? { dataset: large, etag: '"large"' } : s.writer.read(slug),
    },
  );
  expect(report.skipped).toBe(4);
  expect(s.conditions.some((entry) => entry.url === url)).toBe(false);
});

it("rejects malformed Unicode before identifier hashing or RDF labels", async () => {
  for (const value of ["", " ", "\ud800", "\udfff", "Name\udc00"])
    expect(text(value)).toBeUndefined();
  expect(text("Office 😀")).toBe("Office 😀");
  const s = setup([
    { ...devices[0], cid: "\ud800", uuid: undefined },
    { ...devices[0], deviceName: "Name\udc00" },
  ]);
  const report = await s.run();
  expect(report.skipped).toBe(2);
  expect(report.written).toHaveLength(0);
  expect(s.api).toHaveBeenCalledTimes(1);
});

it("refuses to prune run history without a strong ETag", async () => {
  const s = setup([devices[0]]);
  await s.run();
  const url = s.writer.resolve("_provenance.ttl"),
    before = s.pod.get(url);
  await expect(
    s.run(
      time,
      {},
      {
        read: async (slug) => {
          const existing = await s.writer.read(slug);
          return existing && slug === "_provenance.ttl" ? { ...existing, etag: null } : existing;
        },
      },
    ),
  ).rejects.toThrow("strong ETag");
  expect(s.pod.get(url)).toBe(before);
});

// AUTHORED-BY Claude Opus 5.5
it("reads pyvesync's per-family status keys and ignores Core 200S air placeholders", async () => {
  const values = (status: Record<string, unknown>, ...args: [VeSyncFamily, boolean?]) =>
    Object.fromEntries(measurements(status, ...args).map(({ key, value }) => [key, value]));
  expect(values(coreStatus.result.result, "core")).toEqual({
    pm25: 12,
    aqi: 2,
    fan: 2,
    filter: 87,
  });
  // Snake-case fan aliases are not Core keys; camelCase keys are Vital-only.
  expect(values({ fan_speed_level: 3, fan_level: 3, PM25: 9 }, "core")).toEqual({});
  expect(values(vitalStatus.result.result, "vital")).toEqual({
    pm25: 7,
    aqi: 1,
    fan: 1,
    filter: 95,
  });
  expect(values({ air_quality_value: 9, level: 2, filter_life: 50 }, "vital")).toEqual({});
  expect(values(legacyStatus, "legacy")).toEqual({ fan: 1, filter: 72 });
  expect(values({ ...coreStatus.result.result }, "core", false)).toEqual({ fan: 2, filter: 87 });
  expect(familyOf("LAP-V102S-WUS")).toBe("vital");
  expect(familyOf("Core400S")).toBe("core");
  expect(familyOf("lv-pur131s")).toBe("legacy");
  expect(hasAirSensor("LAP-C201S-AUSR")).toBe(false);
  expect(hasAirSensor("Core200S")).toBe(false);
  expect(hasAirSensor("LAP-C401S-WUSR")).toBe(true);
});

it("records no readings when the device's nested bypass code reports a failure", async () => {
  const { run, pod } = setup([devices[0]], {
    code: 0,
    result: { code: -11300030, result: coreStatus.result.result },
  });
  const report = await run();
  expect(report.skipped).toBe(1);
  expect(pod.urls().some((url) => url.endsWith("/11.ttl"))).toBe(false);
});

it("skips an LV-PUR131S without a uuid before any status request", async () => {
  const { run, api } = setup([{ ...devices[4], uuid: undefined }]);
  const report = await run();
  expect(report.skipped).toBe(1);
  expect(api.mock.calls.map(([url]) => String(url))).toEqual([VESYNC_API + DEVICES]);
});
