// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { ensureSample, sampleGpx } from "../src/apps/health/demo/sample";
import { loadDashboard } from "../src/apps/health/lib/data/dashboard";
import { importHealth, PartialImportError, writeSamples } from "../src/apps/health/lib/data/import";
import {
  addMeasurement,
  canonicalValue,
  displayValue,
  formatMetric,
  loadMeasurements,
  loadMetric,
  metricRange,
  readShard,
  summarizeMetric,
} from "../src/apps/health/lib/data/metrics";
import {
  type ClinicalRecord,
  dueMedications,
  isRecordDate,
  loadRecords,
  nextDose,
  type RecordDraft,
  saveRecord,
  scheduleFor,
} from "../src/apps/health/lib/data/records";
import { createHealthDataStore, healthTransport } from "../src/apps/health/lib/data/store";
import {
  importGpx,
  listWorkouts,
  loadWorkout,
  previewGpx,
} from "../src/apps/health/lib/data/workouts";
import {
  addRecord,
  emptyHealthDocument,
  type Measurement,
  RecordDetails,
  Reminder,
  type WorkoutSummary,
} from "../src/apps/health/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://health.test/",
  OWNER = `${ROOT}profile#me`;
const NOW = new Date("2026-11-01T12:00:00Z");
const RANGE = { start: new Date("2026-10-01Z"), end: new Date("2026-12-01Z") };
function fixture(
  transform?: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    fetch: typeof globalThis.fetch,
  ) => Promise<Response>,
) {
  const pod = createDemoPod({ root: ROOT });
  const fetch: typeof globalThis.fetch = transform
    ? (input, init) => transform(input, init, pod.fetch)
    : pod.fetch;
  const store = createHealthDataStore(fetch, ROOT, OWNER);
  return { pod, fetch, store };
}
function sample(id: string, kind: Measurement["kind"], at: string, value: number): Measurement {
  return {
    iri: `${ROOT}health/observations/samples#${id}`,
    kind,
    at: new Date(at),
    value,
    source: "Apple Health",
  };
}
async function* chunks(...parts: string[]) {
  yield* parts;
}
const fingerprint = async (text: string) => createHash("sha256").update(text).digest("hex");
function apple(value = "70", kind = "BodyMass", date = "2026-11-01 08:00:00 +0000", unit = "kg") {
  return `<Record type="HKQuantityTypeIdentifier${kind}" unit="${unit}" value="${value}" startDate="${date}" sourceName="Apple Health"/>`;
}
const DRAFT: RecordDraft = {
  name: "Example medication",
  note: "A note",
  dose: "1 tablet",
  date: "2026-11-01",
  frequency: "daily",
  time: "08:00",
  timeZone: "UTC",
};
const EMPTY_WORKOUT: WorkoutSummary = {
  iri: `${ROOT}health/workouts/summary.ttl#it`,
  name: undefined,
  activity: undefined,
  start: undefined,
  end: undefined,
  distance: undefined,
  gpx: undefined,
  source: undefined,
};

describe("Health metric data over an in-memory pod", () => {
  it("validates units, writes canonical manual entries and aggregates sum versus mean", async () => {
    const { store } = fixture();
    expect(canonicalValue("weight", 150, "lb")).toBeCloseTo(68.0388555);
    expect(canonicalValue("sleep", 8, "h")).toBe(28800);
    expect(canonicalValue("systolic", 120, "mmHg")).toBe(120);
    expect(canonicalValue("diastolic", 80, "mm[Hg]")).toBe(80);
    expect(canonicalValue("heartRate", 65, "/min")).toBe(65);
    expect(() => canonicalValue("steps", 2, "kg")).toThrow("supported unit");
    expect(() => canonicalValue("weight", 2, "km")).toThrow();
    expect(formatMetric("steps", 1234)).toBe("1,234");
    expect(formatMetric("sleep", 28800)).toBe("8");
    expect(displayValue("weight", 72)).toBe(72);
    await addMeasurement(store, "w1", "weight", 150, "lb", NOW);
    await addMeasurement(
      store,
      "w2",
      "weight",
      70,
      "kg",
      new Date("2026-11-01T13:00:00Z"),
      "After lunch",
    );
    await addMeasurement(store, "s1", "steps", 100, "1", NOW);
    await addMeasurement(store, "s2", "steps", 200, "1", NOW);
    const weight = await loadMetric(store, "weight", RANGE);
    expect(weight.latest?.source).toBe("Manual entry");
    expect(weight.latest?.note).toBe("After lunch");
    expect(weight.entries).toHaveLength(2);
    expect(weight.average).toBeCloseTo((68.0388555 + 70) / 2);
    expect(weight.min).toBe(weight.max);
    expect((await loadMetric(store, "steps", RANGE, "week")).buckets[0]).toMatchObject({
      key: "2026-10-26",
      value: 300,
      count: 2,
    });
    expect((await loadMetric(store, "sleep", RANGE)).average).toBeNull();
    expect(summarizeMetric([], "weight", "day")).toMatchObject({
      latest: undefined,
      min: null,
      max: null,
      average: null,
    });
    await expect(addMeasurement(store, "bad", "steps", 2.5, "1", NOW)).rejects.toThrow();
    const ties = summarizeMetric(
      [sample("b", "weight", NOW.toISOString(), 2), sample("a", "weight", NOW.toISOString(), 1)],
      "weight",
      "day",
    );
    expect(ties.entries.map((item) => item.value)).toEqual([2, 1]);
  });
  it("uses calendar ranges and reads only the two dashboard month documents", async () => {
    const reads: string[] = [];
    const { store } = fixture(async (input, init, fetch) => {
      if (!init?.method) reads.push(String(input));
      return fetch(input, init);
    });
    await writeSamples(
      store,
      [
        sample("old", "weight", "2026-10-25T08:00:00Z", 80),
        sample("new", "weight", "2026-11-01T08:00:00Z", 72),
        sample("bp", "systolic", "2026-11-01T08:00:00Z", 120),
        sample("bp2", "diastolic", "2026-11-01T08:00:00Z", 80),
      ],
      OWNER,
      () => {},
    );
    reads.length = 0;
    const dashboard = await loadDashboard(store, NOW);
    expect(reads).toEqual([
      `${ROOT}health/observations/2026-10.ttl`,
      `${ROOT}health/observations/2026-11.ttl`,
    ]);
    expect(dashboard[3]).toMatchObject({ latest: { value: 72 }, change: -10 });
    expect(dashboard[4]?.secondary?.value).toBe(80);
    expect(dashboard[0]?.change).toBeNull();
    expect((await loadMeasurements(store, RANGE)).length).toBe(4);
    expect(metricRange("7d", NOW).start.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(metricRange("30d", NOW).start.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(metricRange("1y", NOW).start.toISOString()).toBe("2025-11-02T00:00:00.000Z");
    const empty = await loadDashboard(fixture().store, NOW);
    expect(empty.every((card) => !card.latest)).toBe(true);
  });
  it("propagates storage, privacy and conflict failures without overwriting a shard", async () => {
    const { store } = fixture(async (input, init, fetch) =>
      String(input).endsWith("2026-10.ttl")
        ? new Response(null, { status: 500 })
        : fetch(input, init),
    );
    await expect(readShard(store, "observations/2026-10.ttl")).rejects.toMatchObject({
      status: 500,
    });
    const noAcl = fixture(async (input, init, fetch) =>
      init?.method === "PUT" && String(input).endsWith(".acl")
        ? new Response(null, { status: 403 })
        : fetch(input, init),
    );
    await expect(addMeasurement(noAcl.store, "private", "weight", 70, "kg", NOW)).rejects.toThrow();
    expect(noAcl.pod.has(`${ROOT}health/observations/2026-11.ttl`)).toBe(false);
    let conflict = false;
    const conflicting = fixture(async (input, init, fetch) =>
      conflict && init?.method === "PUT" && String(input).endsWith("2026-11.ttl")
        ? new Response(null, { status: 412 })
        : fetch(input, init),
    );
    await addMeasurement(conflicting.store, "w", "weight", 70, "kg", NOW);
    conflict = true;
    await expect(
      addMeasurement(conflicting.store, "w2", "weight", 71, "kg", NOW),
    ).rejects.toMatchObject({ status: 412 });
    expect((await loadMetric(conflicting.store, "weight", RANGE)).entries).toHaveLength(1);
  });
});

describe("Apple Health preview and streaming writes", () => {
  it("deduplicates reselected, reordered and overlapping exports by source record, not filename or index", async () => {
    const { store } = fixture();
    const step = apple("1200", "StepCount", "2026-11-01 08:00:00 +0000", "count");
    const weight = apple("76.3");
    const importText = (text: string) =>
      importHealth(store, OWNER, chunks(text), { preview: false, fingerprint });
    await importText(`<HealthData>${step}${weight}</HealthData>`);
    const original = (await loadMetric(store, "steps", RANGE)).entries[0]?.iri;
    // A new File object / export name has no role in the identity.
    await importText(`<HealthData>${step}${weight}</HealthData>`);
    expect((await loadMetric(store, "steps", RANGE)).buckets[0]?.value).toBe(1200);
    // Reordered attributes, records and a newly supported record don't shift IDs.
    const reordered =
      '<Record sourceName="Apple Health" startDate="2026-11-01 08:00:00 +0000" value="1200" unit="count" type="HKQuantityTypeIdentifierStepCount"/>';
    await importText(
      `<HealthData>${apple("65", "HeartRate", undefined, "count/min")}${weight}${reordered}${apple("84.1", "BodyMass", "2026-11-02 08:00:00 +0000")}</HealthData>`,
    );
    expect((await loadMetric(store, "steps", RANGE)).entries.map((entry) => entry.iri)).toEqual([
      original,
    ]);
    expect((await loadMetric(store, "weight", RANGE)).entries).toHaveLength(2);
    // Equal values/times with distinct source metadata remain distinct readings.
    await importText(
      `<HealthData>${step.replace("Apple Health", "Watch")}${step.replace("/>", ' endDate="2026-11-01 08:05:00 +0000"/>')}${step.replace("/>", ' creationDate="2026-11-01 08:06:00 +0000"/>')}</HealthData>`,
    );
    expect((await loadMetric(store, "steps", RANGE)).buckets[0]).toMatchObject({
      value: 4800,
      count: 4,
    });
    const shard = await store.read("observations/2026-11.ttl");
    expect(
      [...shard.document.observations].every((entry) => /#apple-[a-f0-9]{64}$/.test(entry.value)),
    ).toBe(true);
  });
  it("previews counts and date bounds without writing, then batches and merges conditionally", async () => {
    const { pod, store } = fixture();
    const text = `<HealthData>${apple()}${apple("1200", "StepCount", "2026-10-30 08:00:00 +0000", "count")}${apple("71", "BodyMass", "2026-11-02 08:00:00 +0000")}</HealthData>`;
    const preview = await importHealth(store, OWNER, chunks(text.slice(0, 200), text.slice(200)), {
      preview: true,
      fingerprint,
    });
    expect(preview).toMatchObject({
      samplesRead: 3,
      samplesWritten: 0,
      counts: { weight: 2, steps: 1 },
      start: "2026-10-30T08:00:00.000Z",
      end: "2026-11-02T08:00:00.000Z",
    });
    expect(pod.has(`${ROOT}health/`)).toBe(false);
    const events: number[] = [];
    const imported = await importHealth(store, OWNER, chunks(text), {
      preview: false,
      fingerprint,
      onProgress: (value) => events.push(value.samplesWritten),
    });
    expect(imported).toMatchObject({ samplesRead: 3, samplesWritten: 3, shardsWritten: 2 });
    expect(events).toContain(3);
    await importHealth(store, OWNER, chunks(text), { preview: false, fingerprint });
    expect((await loadMetric(store, "weight", RANGE)).entries).toHaveLength(2);
    const latestWeight = (await loadMetric(store, "weight", RANGE)).entries[0];
    if (!latestWeight) throw new Error("Missing imported weight");
    expect(
      (await store.read("observations/2026-11.ttl")).document.observation(latestWeight.iri).patient,
    ).toBe(OWNER);
    const empty = await importHealth(store, OWNER, chunks("<HealthData/>"), {
      preview: true,
      fingerprint,
    });
    expect(empty.start).toBeNull();
    expect(empty.end).toBeNull();
  });
  it("reports exactly the committed samples after malformed late XML, a failed shard and a network failure", async () => {
    const { store } = fixture();
    const first = Array.from({ length: 250 }, (_, index) => apple(String(70 + index / 100))).join(
      "",
    );
    const error = await importHealth(
      store,
      OWNER,
      chunks(`<HealthData>${first}`, apple(), "<broken></HealthData>"),
      { preview: false, fingerprint },
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PartialImportError);
    expect((error as PartialImportError).progress).toMatchObject({
      samplesRead: 251,
      samplesWritten: 250,
      shardsWritten: 1,
    });
    expect((await loadMetric(store, "weight", RANGE)).entries).toHaveLength(250);
    const failed = fixture(async (input, init, fetch) =>
      init?.method === "PUT" && String(input).endsWith("2026-11.ttl")
        ? new Response(null, { status: 500 })
        : fetch(input, init),
    );
    const failure = await importHealth(
      failed.store,
      OWNER,
      chunks(
        `<HealthData>${apple("70", "BodyMass", "2026-10-31 08:00:00 +0000")}${apple()}</HealthData>`,
      ),
      { preview: false, fingerprint },
    ).catch((cause: unknown) => cause as PartialImportError);
    expect((failure as PartialImportError).progress).toMatchObject({
      samplesWritten: 1,
      shardsWritten: 1,
    });
    const network = fixture(async () => {
      throw new TypeError("Offline");
    });
    await expect(
      importHealth(network.store, OWNER, chunks(`<HealthData>${apple()}</HealthData>`), {
        preview: false,
        fingerprint,
      }),
    ).rejects.toBeInstanceOf(PartialImportError);
    await expect(
      importHealth(store, OWNER, chunks("<wrong/>"), { preview: true, fingerprint }),
    ).rejects.toMatchObject({ progress: { samplesWritten: 0 } });
  });
  it("rejects a shard with no ETag and preserves existing metadata", async () => {
    let strip = false;
    const { store } = fixture(async (input, init, fetch) => {
      const response = await fetch(input, init);
      if (strip && !init?.method && String(input).endsWith("2026-11.ttl")) {
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(await response.text(), { status: response.status, headers });
      }
      return response;
    });
    await addMeasurement(store, "initial", "weight", 70, "kg", NOW, "Keep me");
    await writeSamples(store, [sample("new", "weight", NOW.toISOString(), 71)], OWNER, () => {});
    expect(
      (await loadMetric(store, "weight", RANGE)).entries.find((entry) =>
        entry.iri.endsWith("#initial"),
      )?.note,
    ).toBe("Keep me");
    strip = true;
    await expect(
      writeSamples(store, [sample("next", "weight", NOW.toISOString(), 72)], OWNER, () => {}),
    ).rejects.toThrow("strong ETag");
  });
});

describe("clinical records and reminders", () => {
  it("validates historical record dates separately from medication schedules", async () => {
    const { store } = fixture();
    for (const [kind, date] of [
      ["conditions", "1987-04-11"],
      ["immunisations", "1964-02-29"],
    ] as const) {
      await saveRecord(store, OWNER, kind, "history", { ...DRAFT, date }, { create: true }, NOW);
      expect((await loadRecords(store, kind))[0]).toMatchObject({ date, reminders: [] });
    }
    for (const date of ["0001-01-01", "1600-02-29", "9999-12-31"])
      expect(isRecordDate(date)).toBe(true);
    for (const date of [
      "",
      "0000-01-01",
      "1900-02-29",
      "1987-04-31",
      "1964-13-01",
      "1964-00-00",
      "64-01-01",
    ]) {
      expect(isRecordDate(date)).toBe(false);
      await expect(
        saveRecord(
          store,
          OWNER,
          "conditions",
          "invalid",
          { ...DRAFT, date },
          { create: true },
          NOW,
        ),
      ).rejects.toThrow("Choose a valid date");
    }
    await expect(
      saveRecord(
        store,
        OWNER,
        "medications",
        "old",
        { ...DRAFT, date: "1987-04-11" },
        { create: true },
        NOW,
      ),
    ).rejects.toThrow();
  });
  it("edits the loaded document and subject, preserving other subjects and preconditions", async () => {
    const { store } = fixture();
    await store.initialize();
    const path = "conditions/legacy.record.ttl";
    const iri = `${store.base}${path}#condition`;
    const document = emptyHealthDocument();
    for (const subject of [iri, `${store.base}${path}#other`])
      addRecord(document, {
        iri: subject,
        kind: "conditions",
        patient: OWNER,
        name: "Original",
        reference: `${subject}-concept`,
        note: "Keep history",
        reminders: [],
      });
    await store.write(path, document, { create: true });
    const loaded = await store.read(path);
    await saveRecord(
      store,
      OWNER,
      "conditions",
      "legacy.record",
      { ...DRAFT, name: "Updated", date: "1987-04-11" },
      { etag: loaded.etag as string },
      NOW,
      iri,
    );
    const changed = await store.read(path);
    expect(new RecordDetails(iri, changed.document, DataFactory).name).toBe("Updated");
    expect(
      new RecordDetails(`${store.base}${path}#other`, changed.document, DataFactory).name,
    ).toBe("Original");
    expect([...changed.document.conditions].map((entry) => entry.value).sort()).toEqual(
      [iri, `${store.base}${path}#other`].sort(),
    );
    expect(await readShard(store, "conditions/legacy.ttl")).toBeNull();
    await expect(
      saveRecord(
        store,
        OWNER,
        "conditions",
        "legacy.record",
        DRAFT,
        { etag: loaded.etag as string },
        NOW,
        iri,
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("round trips editable records and schedules using strong preconditions", async () => {
    const { store } = fixture();
    expect(await loadRecords(store, "conditions")).toEqual([]);
    await saveRecord(store, OWNER, "medications", "daily", DRAFT, { create: true }, NOW);
    await saveRecord(
      store,
      OWNER,
      "medications",
      "weekly",
      { ...DRAFT, name: "A weekly record", frequency: "weekly" },
      { create: true },
      NOW,
    );
    await saveRecord(
      store,
      OWNER,
      "conditions",
      "condition",
      { ...DRAFT, name: "Hay fever", frequency: "none" },
      { create: true },
      NOW,
    );
    await saveRecord(
      store,
      OWNER,
      "immunisations",
      "vaccine",
      { ...DRAFT, name: "Vaccine", frequency: "none" },
      { create: true },
      NOW,
    );
    const loaded = await loadRecords(store, "medications");
    expect(loaded.map((record) => record.name)).toEqual(["A weekly record", DRAFT.name]);
    const daily = loaded[1] as ClinicalRecord;
    expect(daily).toMatchObject(DRAFT);
    expect(daily.reminders).toHaveLength(90);
    expect(dueMedications(loaded, NOW)).toHaveLength(2);
    expect(nextDose(daily, NOW)?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    await saveRecord(
      store,
      OWNER,
      "medications",
      daily.id,
      { ...daily, name: "Updated", frequency: "none" },
      { etag: daily.etag as string },
      NOW,
    );
    const updated = (await loadRecords(store, "medications")).find(
      (record) => record.id === "daily",
    ) as ClinicalRecord;
    expect(updated.name).toBe("Updated");
    expect(updated.reminders).toEqual([]);
    expect(nextDose(updated, NOW)).toBeNull();
    expect((await loadRecords(store, "conditions"))[0]?.name).toBe("Hay fever");
    expect((await loadRecords(store, "immunisations"))[0]?.date).toBe(DRAFT.date);
    await expect(
      saveRecord(store, OWNER, "medications", daily.id, DRAFT, { etag: daily.etag as string }, NOW),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      saveRecord(store, OWNER, "conditions", "bad/id", DRAFT, { create: true }, NOW),
    ).rejects.toThrow("Invalid record ID");
    await expect(
      saveRecord(
        store,
        OWNER,
        "conditions",
        "blank",
        { ...DRAFT, name: " " },
        { create: true },
        NOW,
      ),
    ).rejects.toThrow("Enter a name");
    expect(scheduleFor("prn", { ...DRAFT, frequency: "none" }).kind).toBe("as-needed");
    expect(dueMedications([], NOW)).toEqual([]);
  });
  it("reads model-only records with missing optional fields and timestamp-only reminders", async () => {
    const { store } = fixture();
    await store.saveRecord(
      "legacy",
      {
        kind: "medications",
        name: "Legacy",
        patient: OWNER,
        reference: `${ROOT}medicine`,
        reminders: [
          { iri: `${ROOT}health/medications/legacy.ttl#r`, at: new Date("2026-11-01T08:00:00Z") },
          {
            iri: `${ROOT}health/medications/legacy.ttl#future`,
            at: new Date("2026-11-02T08:00:00Z"),
          },
        ],
      },
      { create: true },
    );
    const existing = await store.read("medications/legacy.ttl");
    const details = new RecordDetails(
      `${ROOT}health/medications/legacy.ttl#it`,
      existing.document,
      DataFactory,
    );
    details.name = undefined;
    details.reminders.add(`${ROOT}health/medications/legacy.ttl#undated`);
    new Reminder(
      `${ROOT}health/medications/legacy.ttl#undated`,
      existing.document,
      DataFactory,
    ).at = undefined;
    await store.write("medications/legacy.ttl", existing.document, {
      etag: existing.etag as string,
    });
    const legacy = (await loadRecords(store, "medications"))[0] as ClinicalRecord;
    expect(legacy).toMatchObject({
      name: "Unnamed record",
      dose: "",
      note: "",
      date: "",
      frequency: "none",
      time: "08:00",
      timeZone: "UTC",
    });
    expect(legacy.reminders).toHaveLength(2);
    expect(dueMedications([legacy], NOW)).toHaveLength(1);
    expect(nextDose(legacy, NOW)?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(nextDose({ ...legacy, reminders: [] }, NOW)).toBeNull();
    expect(
      dueMedications(
        [{ ...legacy, reminders: [new Date("2026-10-31Z"), new Date("2026-11-03Z")] }],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("GPX workouts", () => {
  it("previews segmented routes and loads the native workout without any map request", async () => {
    const { store, fetch } = fixture();
    expect(await listWorkouts(store, fetch)).toEqual([]);
    const xml = sampleGpx(new Date("2026-10-30Z"));
    const route = previewGpx(xml);
    expect(route.points).toHaveLength(14);
    expect(route.distance).toBeGreaterThan(500);
    expect(route.elevationGain).toBeGreaterThan(0);
    await importGpx(store, "run1", xml);
    await importGpx(store, "run2", sampleGpx(new Date("2026-11-01Z")));
    const workouts = await listWorkouts(store, fetch);
    expect(workouts[0]?.start?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(
      (await loadWorkout(store, workouts[0] as WorkoutSummary, fetch)).route?.points,
    ).toHaveLength(14);
    expect(await loadWorkout(store, EMPTY_WORKOUT, fetch)).toEqual({
      workout: EMPTY_WORKOUT,
      route: null,
    });
    const sparse = previewGpx(
      '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.001" lon="2.001"><ele>10</ele></trkpt></trkseg><trkseg><trkpt lat="5" lon="6"><ele>20</ele></trkpt></trkseg></trk></gpx>',
    );
    expect(sparse.profile[0]?.elevation).toBeNull();
    expect(sparse.elevationGain).toBe(0);
    expect(sparse.distance).toBeLessThan(200);
    expect(() => previewGpx("<gpx/>")).toThrow("no track points");
    await expect(importGpx(store, "bad", "broken")).rejects.toThrow();
  });
  it("handles optional dates, rejects unsafe route URLs and propagates route failures", async () => {
    const { store, fetch } = fixture();
    await importGpx(store, "undated1", '<gpx><trkpt lat="1" lon="1"/></gpx>');
    await importGpx(store, "undated2", '<gpx><trkpt lat="1" lon="1"/></gpx>');
    expect(await listWorkouts(store, fetch)).toHaveLength(2);
    const document = emptyHealthDocument();
    document.mintWorkout(`${ROOT}health/workouts/summary.ttl#it`);
    await store.write("workouts/summary.ttl", document, { create: true });
    expect(
      (await listWorkouts(store, fetch)).find((item) => item.iri.endsWith("summary.ttl#it"))
        ?.elevationGain,
    ).toBeNull();
    for (const gpx of [
      "https://evil.test/health/workouts/route.gpx",
      `${ROOT}drive/route.gpx`,
      `${ROOT}health/workouts/%2fescape.gpx`,
      `${ROOT}health/workouts/%5cescape.gpx`,
      `${ROOT}health/workouts/route.gpx?q=1`,
      `${ROOT}health/workouts/route.gpx#fragment`,
      "https://name:secret@health.test/health/workouts/route.gpx",
    ])
      await expect(loadWorkout(store, { ...EMPTY_WORKOUT, gpx }, fetch)).rejects.toThrow("outside");
    await expect(
      loadWorkout(store, { ...EMPTY_WORKOUT, gpx: `${ROOT}health/workouts/missing.gpx` }, fetch),
    ).rejects.toThrow("Couldn't load");
  });
});

it("seeds realistic demo data once through the data writers and leaves existing pods alone", async () => {
  const { pod, fetch, store } = fixture();
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await Promise.all([ensureSample(session, NOW), ensureSample(session, NOW)]);
  const before = pod.snapshot();
  await ensureSample(session, NOW);
  expect(pod.snapshot()).toEqual(before);
  await ensureSample({ ...session, fetch: (input, init) => fetch(input, init) }, NOW);
  expect(pod.snapshot()).toEqual(before);
  expect(
    (
      await loadMetric(store, "steps", {
        start: new Date("2026-09-01Z"),
        end: new Date("2026-12-01Z"),
      })
    ).entries,
  ).toHaveLength(60);
  expect(await loadRecords(store, "medications")).toHaveLength(2);
  expect(await loadRecords(store, "conditions")).toHaveLength(1);
  expect(await loadRecords(store, "immunisations")).toHaveLength(2);
  expect(await listWorkouts(store, fetch)).toHaveLength(3);
  const broken: PodSession = { ...session, fetch: async () => new Response(null, { status: 500 }) };
  await expect(ensureSample(broken, NOW)).rejects.toThrow("Couldn't check");
  await expect(ensureSample(broken, NOW)).rejects.toThrow();
});

it("contains no retired placeholder namespace anywhere under the Health app", async () => {
  const root = fileURLToPath(new URL("../src/apps/health/", import.meta.url));
  async function inspect(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const filename = `${path}/${entry.name}`;
      if (entry.isDirectory()) await inspect(filename);
      else
        expect(await readFile(filename, "utf8"), filename).not.toContain(
          ["TBD", "example"].join("."),
        );
    }
  }
  await inspect(root);
});

it("normalizes only explicitly marked demo metadata and refuses incomplete creation metadata", async () => {
  const pod = createDemoPod({ root: ROOT });
  const transport = healthTransport(pod.fetch);
  const absent = await transport(new Request(`${ROOT}health/not-here`, { method: "HEAD" }));
  expect(absent.headers.get("link")).toBe(`<${ROOT}health/not-here.acl>; rel="acl"`);
  for (const status of [200, 500]) {
    const faulty: typeof globalThis.fetch = async (input, init) =>
      init?.method === "HEAD" ? new Response(null, { status }) : pod.fetch(input, init);
    await expect(
      healthTransport(faulty)(`${ROOT}health/new-${status}/`, {
        method: "PUT",
        headers: { "if-none-match": "*" },
      }),
    ).rejects.toThrow("Couldn't inspect");
  }
});
