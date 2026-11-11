// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { strToU8, zipSync } from "fflate";
import { DataFactory, type Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { type ImportFile, MAX_FILE_BYTES, runFileImport } from "../core/file-import.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fileImport,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import { CLASSES, ExerciseAction, TravelAction } from "../core/vocab.js";
import { zipDirectory } from "../google-takeout/zip-reader.js";
import { GARMIN_ARCHIVE_LIMITS, garminInput, garminProduct } from "./archive.js";
import { createGarminFileAdapter, garminFileAdapter } from "./file-adapter.js";
import { HEALTH, HealthObservation } from "./health-vocab.js";

const ROOT = `${TEST_POD_ROOT}integrations/garmin/`;
const FITNESS = "account@example.test/DI_CONNECT/DI-Connect-Fitness/";
const DAILY =
  "account@example.test/DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-06-01_2026-06-30.json";
const WELLNESS = "account@example.test/DI_CONNECT/DI-Connect-Wellness/";
const ACTIVITY = `${FITNESS}123_summarizedActivities_20260601_20260630.json`;
const start = Date.parse("2026-06-01T06:30:00Z");
const run = {
  activityId: 123,
  activityType: "running",
  name: "Morning run",
  beginTimestamp: start,
  duration: 1_985_000,
  distance: 543_000,
  calories: 1444.148,
  avgHr: 150,
  maxHr: 176,
  elevationGain: 1800,
};

function binaryFile(bytes: Uint8Array, name = "arbitrary-name.bin"): ImportFile {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  return {
    name,
    type: "application/octet-stream",
    size: bytes.length,
    text: vi.fn(async () => {
      throw new Error("Archive text() forbidden");
    }),
    stream: () => blob.stream(),
    slice: (a, b) => blob.slice(a, b),
  };
}
function zip(files: Record<string, unknown>, level: 0 | 6 = 6): ImportFile {
  return binaryFile(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [
          name,
          strToU8(typeof value === "string" ? value : JSON.stringify(value)),
        ]),
      ),
      { level },
    ),
  );
}
function subjects(store: Store, type = HEALTH.Observation): string[] {
  return [...store.match(null, DataFactory.namedNode(`${NS.RDF}type`), DataFactory.namedNode(type))]
    .map((q) => q.subject.value)
    .sort();
}
function metricUrl(metric: string, month = "2026-06"): string {
  return `${ROOT}health/observations/${metric}/${month}.ttl`;
}
function observation(store: Store): HealthObservation {
  const ids = subjects(store);
  expect(ids).toHaveLength(1);
  return new HealthObservation(ids[0] as string, store, DataFactory);
}
function fixture(): ImportFile {
  return zip({
    [ACTIVITY]: [{ summarizedActivitiesExport: [run] }],
    [`${FITNESS}456_summarizedActivities_20260701.json`]: [
      {
        ...run,
        activityId: "456",
        activityType: { typeKey: "road_biking" },
        startTimeGmt: "2026-06-02 10:00:00",
        name: "Ride",
      },
      { ...run, activityId: 457, activityType: "indoor_cycling" },
    ],
    [DAILY]: [
      {
        calendarDate: "2026-06-01",
        totalSteps: 12345,
        totalDistanceMeters: 9000.5,
        restingHeartRate: 51,
        minHeartRate: 42,
        maxHeartRate: 176,
        averageHeartRate: 68,
        activeKilocalories: 567,
        floorsAscended: 9,
        averageStressLevel: 27,
        allDayStress: 24,
        bodyBatteryHighestValue: 92,
        moderateIntensityMinutes: 30,
        vigorousIntensityMinutes: 10,
      },
    ],
    [`${WELLNESS}123_sleepData_20260601_20260630.json`]: [
      {
        dailySleepDTO: {
          calendarDate: "2026-06-01",
          sleepStartTimestampGMT: start - 8 * 3600000,
          sleepEndTimestampGMT: start,
          deepSleepSeconds: 5400,
          lightSleepSeconds: 14400,
          remSleepSeconds: 3600,
          awakeSleepSeconds: 900,
          sleepScores: { overallScore: 82 },
        },
      },
    ],
    [`${WELLNESS}123_hrv_20260601.json`]: {
      hrvSummaries: [{ calendarDate: "2026-06-01", hrvSummary: { lastNightAvg: 54 } }],
    },
    "DI_CONNECT/DI-Connect-Metrics/123_MetricsMaxMetData_20260601.json": [
      {
        metricsDate: "2026-06-01T00:00:00Z",
        generic: { vo2MaxPreciseValue: 51.2 },
        cycling: { vo2MaxValue: 53 },
      },
    ],
    "DI_CONNECT/DI-Connect-Uploaded-Files/123_uploaded_01.zip":
      "NOT a real nested zip: never opened",
    "DI_CONNECT/DI-Connect-Unknown/private.json": { unrecognized: true },
  });
}

describe("Garmin full account ZIP", () => {
  it("detects entries independent of filename and maps both activity envelopes and canonical metric units", async () => {
    const file = fixture();
    const { pod, report } = await fileImport(garminFileAdapter, file);
    expect(file.text).not.toHaveBeenCalled();
    const exUrl = `${ROOT}health/activities.ttl`,
      travelUrl = `${ROOT}mobility/journeys.ttl`;
    const action = new ExerciseAction(`${exUrl}#activity-123`, pod.dataset(exUrl), DataFactory);
    expect(action.name).toBe("Morning run");
    expect(action.identifier).toBe("123");
    expect(action.exerciseType).toBe("running");
    expect(action.startTime?.getTime()).toBe(start);
    expect(action.duration).toBe("PT33M5S");
    expect(action.distance).toBe("5430 m");
    expect(action.calories).toBe("345.2 kcal");
    expect(action.description).toBe("avgHr: 150 bpm; maxHr: 176 bpm; elevationGain: 18 m");
    expect(subjects(pod.dataset(exUrl), CLASSES.ExerciseAction)).toHaveLength(2);
    const ride = new TravelAction(`${travelUrl}#journey-456`, pod.dataset(travelUrl), DataFactory);
    expect(ride.name).toBe("Ride");
    expect(ride.startTime?.toISOString()).toBe("2026-06-02T10:00:00.000Z");
    for (const [metric, value, unitCode] of [
      ["steps", 12345, "1"],
      ["distance", 9000.5, "m"],
      ["resting-heart-rate", 51, "/min"],
      ["minimum-heart-rate", 42, "/min"],
      ["maximum-heart-rate", 176, "/min"],
      ["heart-rate", 68, "/min"],
      ["active-energy", 567, "kcal"],
      ["floors", 9, "1"],
      ["sleep", 23400, "s"],
      ["hrv", 54, "ms"],
      ["vo2max-running", 51.2, "mL/(kg.min)"],
      ["vo2max-cycling", 53, "mL/(kg.min)"],
    ] as const) {
      const ds = pod.dataset(metricUrl(metric));
      const sample = observation(ds);
      expect(sample.measuredValue, metric).toBe(value);
      expect(sample.unitCode, metric).toBe(unitCode);
      expect(subjects(ds, HEALTH.Record)).toEqual([metricUrl(metric)]);
      expect(
        [
          ...ds.match(
            DataFactory.namedNode(sample.value),
            DataFactory.namedNode(`${NS.HEALTH}patient`),
          ),
        ][0]?.object.value,
      ).toBe(`${metricUrl(metric)}#subject`);
      expect(
        [...ds].some((q) => q.subject.value === TEST_WEBID || q.object.value === TEST_WEBID),
      ).toBe(false);
      expect(
        [...ds.match(null, DataFactory.namedNode(`${NS.CORE}inScheme`))].map((q) => q.object.value),
      ).toEqual(["steps", "heart-rate", "sleep"].includes(metric) ? ["http://loinc.org"] : []);
      expect(
        [...ds].some(
          (q) =>
            q.predicate.value === `${NS.TIME}inXSDDateTimeStamp` &&
            q.object.value === "2026-06-01T00:00:00.000Z",
        ),
      ).toBe(true);
    }
    const sleep = observation(pod.dataset(metricUrl("sleep")));
    expect(sleep.description).toContain("awakeSleepSeconds: 900 s");
    expect(sleep.description).toContain("Sleep score: 82");
    expect(observation(pod.dataset(metricUrl("steps"))).unit).toBe(`${NS.UNIT}NUM`);
    expect(observation(pod.dataset(metricUrl("sleep"))).unit).toBe(`${NS.UNIT}SEC`);
    expect(observation(pod.dataset(metricUrl("resting-heart-rate"))).unit).toBe(
      `${NS.UNIT}BEAT-PER-MIN`,
    );
    expect(report.categories.sort()).toEqual(["health", "mobility"]);
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(15);
    expect(report.unsupported?.join(" ")).toMatch(/nested-FIT-zip.*activity-files/);
    expect(report.unsupported?.join(" ")).toContain("vocabulary-gap-Body-Battery");
    expect(report.unsupported?.join(" ")).toContain("vocabulary-gap-intensity-minutes");
    expect(report.unsupported?.join(" ")).not.toContain("account@example");
    expect(pod.get(report.indexUrl)).toContain(HEALTH.Observation);
    expect(pod.get(report.indexUrl)).toContain(CLASSES.ExerciseAction);
  });

  it("reimports deterministically and merges overlapping, differently named exports without losing older days/months", async () => {
    const { pod } = await fileImport(garminFileAdapter, fixture());
    const before = subjects(pod.dataset(metricUrl("steps")));
    const beforeSize = pod.dataset(metricUrl("steps")).size;
    await fileImport(garminFileAdapter, fixture(), { pod });
    expect(subjects(pod.dataset(metricUrl("steps")))).toEqual(before);
    expect(pod.dataset(metricUrl("steps")).size).toBe(beforeSize);
    await fileImport(
      garminFileAdapter,
      zip({
        [DAILY.replace("2026-06-30", "2026-07-01")]: [
          { calendarDate: "2026-06-01", totalSteps: 12346 },
          { calendarDate: "2026-06-02", totalSteps: 2 },
          { calendarDate: "2026-07-01", totalSteps: 3 },
        ],
      }),
      { pod },
    );
    expect(subjects(pod.dataset(metricUrl("steps")))).toHaveLength(2);
    expect(subjects(pod.dataset(metricUrl("steps", "2026-07")))).toHaveLength(1);
    const existing = new HealthObservation(
      before[0] as string,
      pod.dataset(metricUrl("steps")),
      DataFactory,
    );
    expect(existing.measuredValue).toBe(12346);
    // A smaller second export cannot delete other metrics or activities.
    expect(observation(pod.dataset(metricUrl("sleep"))).measuredValue).toBe(23400);
    expect(
      subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
    ).toHaveLength(2);
  });

  it("streams wrapped arrays larger than the shared per-record cap, without treating the wrapper as a single record", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      ...run,
      activityId: i,
      ignoredPadding: "x".repeat(12000),
    }));
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({ [ACTIVITY]: [{ summarizedActivitiesExport: rows }] }, 0),
    );
    expect(
      subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
    ).toHaveLength(400);
    expect(report.skipped).toBeUndefined();
  }, 30000);

  it("flushes bounded monthly batches and merges a later correction without duplicating or losing earlier observations", async () => {
    const rows = Array.from({ length: 365 }, (_, i) => ({
      calendarDate: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      totalSteps: i,
      restingHeartRate: 50,
    }));
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({
        [DAILY]: rows,
        [DAILY.replace("UDSFile_", "later_UDSFile_")]: [
          { calendarDate: "2026-01-01", totalSteps: 9999 },
        ],
      }),
    );
    expect(report.written).toHaveLength(24);
    let total = 0;
    for (const written of report.written) {
      const count = subjects(pod.dataset(written.url)).length;
      expect(count).toBeLessThanOrEqual(31);
      total += count;
    }
    expect(total).toBe(730);
    const url = metricUrl("steps", "2026-01");
    const corrected = new HealthObservation(
      `${url}#garmin-steps-2026-01-01`,
      pod.dataset(url),
      DataFactory,
    );
    expect(corrected.measuredValue).toBe(9999);
    expect(report.skipped).toBeUndefined();
  });

  it("accepts single-object, object-wrapped and BOM JSON variants, numeric strings, and zero counts", async () => {
    const { pod } = await fileImport(
      garminFileAdapter,
      zip({
        [ACTIVITY]: {
          summarizedActivitiesExport: [
            {
              ...run,
              activityId: "789",
              startTimeGmt: "2026-06-01T08:30:00+02:00",
              activityType: "commuting",
            },
          ],
        },
        [DAILY.replace("UDSFile_", "123_UDSFile_")]:
          '\uFEFF{"calendarDate":"2026-06-01","totalSteps":"0","restingHeartRate":"50"}',
        [`${WELLNESS}healthStatusData_2026-06.json`]: [
          { calendarDate: "2026-06-01", hrvValue: "55" },
        ],
      }),
    );
    expect(observation(pod.dataset(metricUrl("steps"))).measuredValue).toBe(0);
    expect(observation(pod.dataset(metricUrl("hrv"))).measuredValue).toBe(55);
    const url = `${ROOT}mobility/journeys.ttl`;
    expect(
      new TravelAction(`${url}#journey-789`, pod.dataset(url), DataFactory).startTime?.getTime(),
    ).toBe(start);
  });

  it("keeps hostile values as literals, rejects unsafe IDs and invalid dates, and never invents sleep from time in bed", async () => {
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({
        [ACTIVITY]: [
          run,
          { ...run, activityId: "../unsafe" },
          {
            ...run,
            activityId: 3,
            name: '<x>"; DROP',
            distance: "infinite",
            duration: null,
            calories: -1,
          },
        ],
        [DAILY]: [
          { calendarDate: "2026-02-30", totalSteps: 1 },
          { calendarDate: "2026-06-01", totalSteps: 1.2 },
          { calendarDate: "2026-06-02", totalSteps: 1 },
        ],
        [`${WELLNESS}sleepData.json`]: [
          {
            calendarDate: "2026-06-01",
            sleepStartTimestampGMT: start - 1000,
            sleepEndTimestampGMT: start,
            awakeSleepSeconds: 1,
          },
        ],
      }),
    );
    expect(report.skipped).toBe(4);
    expect(pod.get(metricUrl("sleep"))).toBeUndefined();
    const url = `${ROOT}health/activities.ttl`,
      ds = pod.dataset(url);
    const inert = new ExerciseAction(`${url}#activity-3`, ds, DataFactory);
    expect(inert.name).toBe('<x>"; DROP');
    expect(inert.distance).toBeUndefined();
    expect(inert.duration).toBeUndefined();
    expect(inert.calories).toBeUndefined();
    expect(
      [...ds].some((q) => q.object.termType === "NamedNode" && q.object.value.includes("<")),
    ).toBe(false);
  });

  it("rejects a non-Garmin or structurally invalid ZIP cleanly", async () => {
    await expect(
      fileImport(garminFileAdapter, zip({ "Takeout/anything.json": [run] })),
    ).rejects.toThrow(/not a recognized Garmin/);
    await expect(
      fileImport(garminFileAdapter, binaryFile(new Uint8Array([80, 75, 3, 4, 0]))),
    ).rejects.toThrow(/central-directory/);
  });

  it("reports unknown-only and FIT-only Garmin archives without attempting nested decompression", async () => {
    const { report } = await fileImport(
      garminFileAdapter,
      zip({ "DI-Connect-Uploaded-Files/anything.zip": "not a zip" }),
    );
    expect(report.written).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(report.unsupported?.join(" ")).toContain("activity-files");
    const unknown = await fileImport(
      garminFileAdapter,
      zip({ "DI_CONNECT/DI-Connect-Unknown/data.json": {} }),
    );
    expect(unknown.report.skipped).toBeUndefined();
    expect(unknown.report.unsupported?.join(" ")).toContain("unrecognized-file");
  });

  it("handles arrays grouped by sport in MetricsMaxMetData", async () => {
    const { pod } = await fileImport(
      garminFileAdapter,
      zip({
        "DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData.json": {
          generic: [{ calendarDate: "2026-06-01", vo2MaxPreciseValue: 52 }],
          cycling: [{ calendarDate: "2026-06-01", vo2MaxValue: 53 }],
        },
      }),
    );
    expect(observation(pod.dataset(metricUrl("vo2max-running"))).measuredValue).toBe(52);
    expect(observation(pod.dataset(metricUrl("vo2max-cycling"))).measuredValue).toBe(53);
  });

  it("keeps flat uppercase running and cycling VO2max rows distinct on the same day with distinct source codes", async () => {
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({
        "DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData.json": [
          { calendarDate: "2026-06-01", sport: "RUNNING", vo2MaxValue: 51 },
          { calendarDate: "2026-06-01", sport: "CYCLING", vo2MaxValue: 53 },
        ],
      }),
    );
    const codes = [];
    for (const [metric, value] of [
      ["vo2max-running", 51],
      ["vo2max-cycling", 53],
    ] as const) {
      const ds = pod.dataset(metricUrl(metric));
      expect(observation(ds).measuredValue).toBe(value);
      codes.push([...ds.match(null, DataFactory.namedNode(`${NS.CORE}value`))][0]?.object.value);
      expect([...ds.match(null, DataFactory.namedNode(`${NS.CORE}inScheme`))]).toEqual([]);
    }
    expect(codes).toEqual(["running.vo2MaxValue", "cycling.vo2MaxValue"]);
    expect(report.state?.counts.items).toBe(2);
  });

  it.each([
    { overallScore: 82, overall: { value: 11 } },
    { overall: { value: 82 } },
    { overall: 82 },
  ])("reads export and API sleep score shapes, preferring overallScore: %j", async (sleepScores) => {
    const { pod } = await fileImport(
      garminFileAdapter,
      zip({
        [`${WELLNESS}sleepData.json`]: [
          { calendarDate: "2026-06-01", deepSleepSeconds: 100, sleepScores },
        ],
      }),
    );
    expect(observation(pod.dataset(metricUrl("sleep"))).description).toContain("Sleep score: 82");
  });

  it("counts each vocabulary gap once per file and reports distinct affected days without skipped records", async () => {
    const row = {
      calendarDate: "2026-06-01",
      totalSteps: 1,
      averageStressLevel: 0,
      bodyBatteryHighestValue: 90,
      moderateIntensityMinutes: 0,
    };
    const { report } = await fileImport(
      garminFileAdapter,
      zip({
        [DAILY]: [row, row, { ...row, calendarDate: "2026-06-02" }],
        [DAILY.replace("UDSFile_", "second_UDSFile_")]: [row],
        [DAILY.replace("UDSFile_", "gap_only_UDSFile_")]: [
          {
            calendarDate: "2026-06-01",
            averageStressLevel: 0,
            bodyBatteryHighestValue: 90,
            moderateIntensityMinutes: 0,
          },
        ],
      }),
    );
    expect(report.skipped).toBeUndefined();
    for (const gap of ["stress", "Body-Battery", "intensity-minutes"])
      expect(report.unsupported).toContain(
        `Garmin vocabulary-gap-${gap}: 3 files; 4 affected days.`,
      );
  });

  it("does not count concept/time/subject fragments as imported items, including on reimport", async () => {
    const file = zip({ [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1 }] });
    const { pod, report } = await fileImport(garminFileAdapter, file);
    expect(report.state?.counts.items).toBe(1);
    expect(subjects(pod.dataset(metricUrl("steps")), HEALTH.Code)).toHaveLength(1);
    expect(subjects(pod.dataset(metricUrl("steps")), HEALTH.Instant)).toHaveLength(1);
    const repeated = await fileImport(garminFileAdapter, file, { pod });
    expect(repeated.report.state?.counts.items).toBe(1);
    expect(subjects(pod.dataset(metricUrl("steps")), HEALTH.Code)).toHaveLength(1);
    expect(subjects(pod.dataset(metricUrl("steps")), HEALTH.Instant)).toHaveLength(1);
  });

  it("rejects sentinel, date-like, seconds-only and out-of-range epochs, accepting milliseconds at both bounds", async () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const minimum = Date.parse("2000-01-01T00:00:00Z");
      const invalid = [
        0,
        "0",
        20260601,
        "20260601",
        start / 1000,
        String(start / 1000),
        minimum - 1,
        now + 86400001,
      ];
      const { pod, report } = await fileImport(
        garminFileAdapter,
        zip({
          [ACTIVITY]: [...invalid, minimum, now + 86400000].map((beginTimestamp, activityId) => ({
            ...run,
            beginTimestamp,
            activityId,
          })),
          [DAILY]: [...invalid, minimum, String(start)].map((timestamp) => ({
            timestamp,
            totalSteps: 1,
          })),
        }),
      );
      expect(report.skipped).toBe(invalid.length * 2);
      expect(
        subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
      ).toHaveLength(2);
      expect(observation(pod.dataset(metricUrl("steps", "2000-01"))).measuredValue).toBe(1);
      expect(observation(pod.dataset(metricUrl("steps"))).measuredValue).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("buckets timestamp-only daily metrics by their own offset date across month boundaries", async () => {
    const { pod } = await fileImport(
      garminFileAdapter,
      zip({
        [DAILY]: [
          { timestamp: "2026-06-01T00:30:00+14:00", totalSteps: 1 },
          { timestamp: "2026-05-31T23:30:00-12:00", totalSteps: 2 },
          { calendarDate: "2026-06-02", timestamp: "2026-06-01T23:30:00-12:00", totalSteps: 3 },
        ],
      }),
    );
    const may = observation(pod.dataset(metricUrl("steps", "2026-05")));
    expect(may.value).toContain("2026-05-31");
    expect(may.measuredValue).toBe(2);
    const june = pod.dataset(metricUrl("steps"));
    expect(
      new HealthObservation(`${metricUrl("steps")}#garmin-steps-2026-06-01`, june, DataFactory)
        .measuredValue,
    ).toBe(1);
    expect(
      new HealthObservation(`${metricUrl("steps")}#garmin-steps-2026-06-02`, june, DataFactory)
        .measuredValue,
    ).toBe(3);
  });

  it.each([
    "sleep",
    "hrv",
  ] as const)("reports unmatched flat %s rows around first-pass wrappers", async (kind) => {
    const wrapped =
      kind === "sleep"
        ? { dailySleepDTO: { calendarDate: "2026-06-01", deepSleepSeconds: 100 } }
        : { hrvSummaries: [{ calendarDate: "2026-06-01", lastNightAvg: 54 }] };
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({
        [`${WELLNESS}${kind === "sleep" ? "sleepData" : "hrv"}.json`]: [
          { unknown: 1 },
          wrapped,
          { unknown: 2 },
        ],
      }),
    );
    expect(observation(pod.dataset(metricUrl(kind))).measuredValue).toBe(
      kind === "sleep" ? 100 : 54,
    );
    expect(report.skipped).toBe(2);
    expect(report.unsupported).toContain("Garmin unrecognized-or-invalid-record: 2 skipped.");
  });

  it("continues to stream array-valued dailySleepDTO wrappers", async () => {
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip({
        [`${WELLNESS}sleepData.json`]: [
          { dailySleepDTO: [{ calendarDate: "2026-06-01", deepSleepSeconds: 100 }] },
          { unexpected: true },
        ],
      }),
    );
    expect(observation(pod.dataset(metricUrl("sleep"))).measuredValue).toBe(100);
    expect(report.skipped).toBe(1);
  });

  it("bypasses the whole-upload cap using bounded sparse archive ranges", async () => {
    const original = zipSync({ [ACTIVITY]: strToU8(JSON.stringify([run])) }, { level: 0 });
    const view = new DataView(original.buffer);
    const directory = view.getUint32(original.length - 6, true);
    const padding = MAX_FILE_BYTES + 1;
    const tail = original.slice(directory);
    new DataView(tail.buffer).setUint32(tail.length - 6, directory + padding, true);
    const base = binaryFile(original);
    const file: ImportFile = {
      ...base,
      size: original.length + padding,
      slice(a, b) {
        expect(b - a).toBeLessThanOrEqual(65536);
        const bytes = new Uint8Array(b - a);
        for (const [offset, section] of [
          [0, original.subarray(0, directory)],
          [directory + padding, tail],
        ] as const) {
          const left = Math.max(a, offset),
            right = Math.min(b, offset + section.length);
          if (left < right) bytes.set(section.subarray(left - offset, right - offset), left - a);
        }
        return new Blob([bytes]);
      },
    };
    expect((await fileImport(garminFileAdapter, file)).report.written).toHaveLength(1);
    expect(file.text).not.toHaveBeenCalled();
  });
});

describe("Garmin archive budgets and cancellation", () => {
  it.each([
    ["maxEntryBytes", 1, "entry-decompressed-byte-cap"],
    ["maxJsonBytes", 1, "entry-JSON-byte-cap"],
    ["maxTotalBytes", 1, "total-decompressed-byte-cap"],
    ["maxCompressionRatio", 1, "zip-compression-ratio-cap"],
  ] as const)("reports %s truncation without writing observations", async (key, limit, warning) => {
    const { report } = await fileImport(
      createGarminFileAdapter({ [key]: limit }),
      zip({ [ACTIVITY]: Array.from({ length: 20 }, () => run) }),
    );
    expect(report.written).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(report.unsupported?.join(" ")).toContain(warning);
  });

  it("caps entries, records including invalid rows, and total observations", async () => {
    const { report, pod } = await fileImport(
      createGarminFileAdapter({ maxEntries: 1, maxRecordsPerFile: 2 }),
      zip({
        [ACTIVITY]: [{ invalid: true }, run, { ...run, activityId: 2 }],
        [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1 }],
      }),
    );
    expect(
      subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
    ).toHaveLength(1);
    expect(report.skipped).toBe(3);
    expect(report.unsupported?.join(" ")).toContain("records-per-file-cap");
    expect(report.unsupported?.join(" ")).toContain("entry-count-cap");
    const limited = await fileImport(
      createGarminFileAdapter({ maxObservations: 1 }),
      zip({ [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1, restingHeartRate: 50 }] }),
    );
    expect(limited.report.written).toHaveLength(1);
    expect(limited.report.unsupported?.join(" ")).toContain("total-observation-cap");
  });

  it("bounds large arrays and rejects deep or malformed JSON while retaining earlier valid data", async () => {
    const { pod, report } = await fileImport(
      createGarminFileAdapter({ maxRecordsPerFile: 3 }),
      zip({
        [ACTIVITY]: Array.from({ length: 10000 }, (_, i) => ({ ...run, activityId: i })),
        [`${FITNESS}deep_summarizedActivities.json`]: `${"[".repeat(70)}0${"]".repeat(70)}`,
        [DAILY]: '[{"calendarDate":"2026-06-01","totalSteps":5},invalid]',
      }),
    );
    expect(
      subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
    ).toHaveLength(3);
    expect(report.unsupported?.join(" ")).toContain("invalid-or-too-deep-JSON");
    expect(report.unsupported?.join(" ")).toContain("records-per-file-cap");
  }, 30000);

  it("skips oversized record strings without retaining them or fetching embedded URLs", async () => {
    const { pod, report } = await fileImport(
      garminFileAdapter,
      zip(
        {
          [ACTIVITY]: [
            { ...run, name: "x".repeat(1024 * 1024 + 1) },
            { ...run, activityId: 2, url: "https://never-fetch.test" },
          ],
        },
        0,
      ),
    );
    expect(
      subjects(pod.dataset(`${ROOT}health/activities.ttl`), CLASSES.ExerciseAction),
    ).toHaveLength(1);
    expect(report.unsupported?.join(" ")).toContain("JSON-record-byte-cap");
  });

  it("skips CRC failures before mapping anything from that entry", async () => {
    const bytes = zipSync({ [ACTIVITY]: strToU8(JSON.stringify([run])) });
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 6, true);
    view.setUint32(directory + 16, 0, true);
    const { report } = await fileImport(garminFileAdapter, binaryFile(bytes));
    expect(report.written).toEqual([]);
    expect(report.unsupported?.join(" ")).toContain("invalid-zip-entry");
  });

  it("caps actual output even when a bomb lies about its declared size", async () => {
    const bytes = zipSync({
      [ACTIVITY]: strToU8(JSON.stringify([{ ...run, ignored: "x".repeat(100000) }])),
    });
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 6, true);
    view.setUint32(directory + 24, 1, true);
    const { report } = await fileImport(
      createGarminFileAdapter({ maxTotalBytes: 1000 }),
      binaryFile(bytes),
    );
    expect(report.written).toEqual([]);
    expect(report.unsupported?.join(" ")).toContain("total-decompressed-byte-cap");
  });

  it("counts directories and unknown files as unrecognized after exhausting actual inflation", async () => {
    const bytes = zipSync({
      [ACTIVITY]: strToU8(JSON.stringify([{ ...run, ignored: "x".repeat(100000) }])),
      "DI_CONNECT/": new Uint8Array(),
      "DI_CONNECT/DI-Connect-Unknown/data.json": strToU8("{}"),
      [DAILY]: strToU8('[{"calendarDate":"2026-06-01","totalSteps":1}]'),
    });
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 6, true);
    view.setUint32(directory + 24, 1, true);
    const { report } = await fileImport(
      createGarminFileAdapter({ maxTotalBytes: 1000 }),
      binaryFile(bytes),
    );
    expect(report.skipped).toBe(2);
    expect(report.unsupported).toContain("Garmin total-decompressed-byte-cap-exceeded: 2 skipped.");
    expect(report.unsupported).toContain("Garmin unrecognized-file: 2 unrecognized.");
  });

  it("aborts decoder exceptions instead of continuing with unaccounted inflater work", async () => {
    const bytes = zipSync({ [ACTIVITY]: strToU8(JSON.stringify([run])) });
    const [entry] = await zipDirectory(binaryFile(bytes));
    if (!entry) throw new Error("Fixture entry missing");
    bytes[entry.dataStart] = 7; // BFINAL + reserved DEFLATE block type.
    await expect(fileImport(garminFileAdapter, binaryFile(bytes))).rejects.toThrow(
      /ZIP decoder failed/,
    );
  });

  it("counts oversized records toward the file row ceiling", async () => {
    const { report } = await fileImport(
      createGarminFileAdapter({ maxRecordsPerFile: 1 }),
      zip(
        {
          [ACTIVITY]: [{ ...run, ignored: "x".repeat(1024 * 1024 + 1) }, run],
        },
        0,
      ),
    );
    expect(report.written).toEqual([]);
    expect(report.unsupported?.join(" ")).toContain("records-per-file-cap");
  });

  it("bounds total attempted records even when every record is malformed", async () => {
    const { report } = await fileImport(
      createGarminFileAdapter({ maxRecordsPerRun: 2 }),
      zip({
        [ACTIVITY]: [{ invalid: true }, { invalid: true }, run],
        [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1 }],
      }),
    );
    expect(report.written).toEqual([]);
    expect(report.skipped).toBe(4);
    expect(report.unsupported?.join(" ")).toContain("total-record-cap-exceeded: 2 skipped");
  });

  it("charges unmatched first-pass rows to the shared attempted-record budget", async () => {
    const { report } = await fileImport(
      createGarminFileAdapter({ maxRecordsPerRun: 1 }),
      zip({
        [`${WELLNESS}hrv.json`]: [
          { unexpected: 1 },
          { hrvSummaries: [{ calendarDate: "2026-06-01", lastNightAvg: 54 }] },
          { unexpected: 2 },
        ],
      }),
    );
    expect(report.written).toEqual([]);
    expect(report.skipped).toBe(2);
    expect(report.unsupported).toContain("Garmin unrecognized-or-invalid-record: 1 skipped.");
    expect(report.unsupported).toContain("Garmin total-record-cap-exceeded: 1 skipped.");
  });

  it("returns a counted note for empty or unsupported JSON envelopes", async () => {
    const { report } = await fileImport(garminFileAdapter, zip({ [ACTIVITY]: [] }));
    expect(report.skipped).toBe(1);
    expect(report.unsupported?.join(" ")).toContain("empty-or-unrecognized-JSON");
  });

  it("never reads a nested archive body", async () => {
    const file = zip({
      [ACTIVITY]: [run],
      "DI-Connect-Uploaded-Files/a.zip": "secret nested bytes",
    });
    const entries = await zipDirectory(file);
    const nested = entries[1];
    const originalSlice = file.slice;
    if (!nested || !originalSlice) throw new Error("Fixture ZIP ranges missing");
    const guarded = {
      ...file,
      slice(a: number, b: number) {
        if (a === nested.dataStart && b === nested.dataStart + nested.compressedSize)
          throw new Error("Nested body read");
        return originalSlice(a, b);
      },
    };
    expect((await fileImport(garminFileAdapter, guarded)).report.skipped).toBe(1);
  });

  it("honours cancellation between entries and never swallows Pod failures", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const reason = new Error("cancelled by test");
    const writer = createFetchPodWriter({
      adapterId: "garmin",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    await expect(
      runFileImport({
        adapter: garminFileAdapter,
        file: fixture(),
        podWriter: writer,
        signal: controller.signal,
        onProgress(p) {
          if (p.label === "Reading Garmin account archive…" && p.done === 1)
            controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(pod.putCount).toBe(0);
    await expect(
      runFileImport({
        adapter: garminFileAdapter,
        file: zip({ [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1 }] }),
        podWriter: {
          ...writer,
          write: async () => {
            throw new Error("Pod write failed");
          },
        },
      }),
    ).rejects.toThrow("Pod write failed");
  });

  it.each([
    "metrics",
    "activities",
  ] as const)("checks cancellation between %s writes in final flush", async (kind) => {
    const controller = new AbortController();
    const reason = new Error("cancelled during flush");
    const write = vi.fn(async (doc) => {
      controller.abort(reason);
      return { url: `${ROOT}${doc.slug}`, category: doc.category, forClass: doc.forClass };
    });
    const file =
      kind === "metrics"
        ? zip({ [DAILY]: [{ calendarDate: "2026-06-01", totalSteps: 1, restingHeartRate: 50 }] })
        : zip({ [ACTIVITY]: [run, { ...run, activityId: 124, activityType: "cycling" }] });
    // Bypass the runner's own abort wrapper to exercise the adapter's flush boundary.
    await expect(
      garminFileAdapter.importFile(file, {
        signal: controller.signal,
        maxRows: 100000,
        webId: TEST_WEBID,
        resolve: (slug) => `${ROOT}${slug}`,
        read: async () => undefined,
        write,
        writeBinary: vi.fn(),
        remove: vi.fn(),
        progress: vi.fn(),
        skip: vi.fn(),
      }),
    ).rejects.toBe(reason);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("validates lowering-only limits and bounds legacy text after opting into streaming", async () => {
    for (const value of [
      0,
      -1,
      1.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      GARMIN_ARCHIVE_LIMITS.maxEntries + 1,
    ])
      expect(() => createGarminFileAdapter({ maxEntries: value })).toThrow(RangeError);
    await expect(
      garminInput({ ...memoryFile("a.csv", "ignored"), size: MAX_FILE_BYTES + 1 }),
    ).rejects.toThrow(/64 MiB/);
    await expect(garminInput(memoryFile("garmin.zip", "PK\x03\x04"))).rejects.toThrow(
      /file.stream/,
    );
    await expect(garminInput({ ...fixture(), slice: undefined })).rejects.toThrow(/file.slice/);
    expect((await garminInput(memoryFile("Activities.csv", "Activity Type,Date"))).zip).toBe(false);
  });

  it.each([
    "../DI_CONNECT/DI-Connect-Fitness/summarizedActivities.json",
    "/DI_CONNECT/DI-Connect-Fitness/summarizedActivities.json",
    "DI_CONNECT/DI-Connect-Fitness/a\\summarizedActivities.json",
    "DI_CONNECT/DI-Connect-Fitness/a\u0000summarizedActivities.json",
    "garbage/summarizedActivities.json",
  ])("rejects unsafe or ambiguous path %s", (name) => {
    expect(garminProduct(name)).toBeUndefined();
  });
});
