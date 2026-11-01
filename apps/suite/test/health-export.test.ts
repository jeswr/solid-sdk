// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  civilToday,
  exportHealth,
  exportRange,
  toFhirRecords,
} from "../src/apps/health/lib/data/export";
import { addMeasurement } from "../src/apps/health/lib/data/metrics";
import {
  type ClinicalRecord,
  type RecordDraft,
  saveRecord,
} from "../src/apps/health/lib/data/records";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import type { Measurement } from "../src/apps/health/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://export.health.test/";
const OWNER = `${ROOT}profile#me`;
const at = (iso: string) => new Date(iso);
function reading(
  kind: Measurement["kind"],
  value: number,
  time: string,
  source = "Watch",
): Measurement {
  return {
    iri: `${ROOT}health/observations/x.ttl#${kind}-${time}`,
    kind,
    value,
    at: at(time),
    source,
  };
}
function record(partial: Partial<ClinicalRecord>): ClinicalRecord {
  return {
    id: "r",
    iri: `${ROOT}health/r.ttl#it`,
    etag: null,
    kind: "medications",
    name: "Example",
    note: "",
    dose: "",
    date: "2026-10-01",
    frequency: "none",
    time: "08:00",
    timeZone: "UTC",
    reminders: [],
    ...partial,
  };
}

describe("toFhirRecords", () => {
  it("maps readings, pairs blood pressure and skips what FHIR export can't carry", () => {
    const result = toFhirRecords(
      [
        reading("steps", 4000, "2026-10-02T10:00:00Z", "  "),
        reading("heartRate", 61, "2026-10-01T08:00:00Z"),
        reading("weight", 70.5, "2026-10-03T07:00:00Z"),
        reading("sleep", 25200, "2026-10-03T07:00:00Z"),
        reading("systolic", 120, "2026-10-04T09:00:00Z"),
        reading("diastolic", 80, "2026-10-04T09:00:00Z"),
        // Different sources at the same time are never paired.
        reading("systolic", 130, "2026-10-05T09:00:00Z", "Cuff"),
        reading("diastolic", 85, "2026-10-05T09:00:00Z", "Watch"),
        // Two systolic readings for one diastolic: ambiguous, so none is exported.
        reading("systolic", 118, "2026-10-06T09:00:00Z"),
        { ...reading("systolic", 119, "2026-10-06T09:00:00Z"), iri: `${ROOT}other#s` },
        reading("diastolic", 79, "2026-10-06T09:00:00Z"),
      ],
      [
        record({ name: "Daily pill", dose: "5 mg", frequency: "daily" }),
        record({ name: "Weekly shot", frequency: "weekly", time: "18:30", timeZone: " " }),
        record({ name: "Spray", frequency: "none", dose: "  " }),
        record({ name: "Undated", date: "" }),
      ],
      [
        record({ kind: "conditions", name: "Asthma", date: "2020-05-01" }),
        record({ kind: "conditions", name: "No onset", date: "2020-02-30" }),
      ],
    );
    expect(result.records.observations).toEqual([
      {
        id: "obs-1",
        metric: "heartRate",
        unit: "/min",
        value: 61,
        effective: "2026-10-01T08:00:00.000Z",
        source: "Watch",
      },
      {
        id: "obs-2",
        metric: "steps",
        unit: "{steps}",
        value: 4000,
        effective: "2026-10-02T10:00:00.000Z",
        source: "Entered in Health",
      },
      {
        id: "obs-3",
        metric: "weight",
        unit: "kg",
        value: 70.5,
        effective: "2026-10-03T07:00:00.000Z",
        source: "Watch",
      },
      {
        id: "obs-4",
        metric: "bloodPressure",
        unit: "mm[Hg]",
        value: { systolic: 120, diastolic: 80 },
        effective: "2026-10-04T09:00:00.000Z",
        source: "Watch",
      },
    ]);
    expect(result.records.medications.map((med) => med.dosageText)).toEqual([
      "5 mg, Daily at 08:00 (UTC)",
      "Weekly at 18:30",
      "As needed",
    ]);
    expect(result.records.conditions).toEqual([
      { id: "cond-1", name: "Asthma", onset: "2020-05-01" },
    ]);
    expect(result.skipped).toEqual({ sleep: 1, unpairedBloodPressure: 5, undatedRecords: 2 });
    expect(result.counts).toEqual({ observations: 4, medications: 3, conditions: 1 });
  });
});

describe("blood pressure pairing", () => {
  const saved = (kind: "systolic" | "diastolic", value: number, operation: string) => ({
    ...reading(kind, value, "2026-10-04T00:00:00Z", "Manual entry"),
    iri: `${ROOT}health/observations/2026-10.ttl#${operation}-${kind}`,
  });
  it("pairs readings saved together even when they share a time and source", () => {
    const result = toFhirRecords(
      [
        saved("systolic", 120, "a"),
        saved("diastolic", 80, "a"),
        saved("systolic", 130, "b"),
        saved("diastolic", 85, "b"),
        // An operation missing its partner falls back to matching by time and source.
        { ...saved("systolic", 140, "c"), at: at("2026-10-05T00:00:00Z") },
        { ...reading("diastolic", 90, "2026-10-05T00:00:00Z", "Manual entry"), iri: "x#y" },
        // A fragment whose suffix names the other kind is not trusted.
        { ...saved("systolic", 150, "d"), kind: "diastolic" as const },
      ],
      [],
      [],
    );
    expect(result.records.observations.map((entry) => entry.value)).toEqual([
      { systolic: 120, diastolic: 80 },
      { systolic: 130, diastolic: 85 },
      { systolic: 140, diastolic: 90 },
    ]);
    expect(result.skipped.unpairedBloodPressure).toBe(1);
  });
});

describe("exportRange", () => {
  it("turns inclusive civil dates into a half-open range in the chosen zone", () => {
    expect(exportRange("2026-01-01", "2026-01-31", "UTC")).toEqual({
      start: at("2026-01-01T00:00:00Z"),
      end: at("2026-02-01T00:00:00Z"),
    });
    expect(exportRange("2026-10-31", "2026-10-31", "Pacific/Auckland")).toEqual({
      start: at("2026-10-30T11:00:00Z"),
      end: at("2026-10-31T11:00:00Z"),
    });
    expect(exportRange("2026-11-01", "2026-11-01", "America/New_York")).toEqual({
      start: at("2026-11-01T04:00:00Z"),
      end: at("2026-11-02T05:00:00Z"),
    });
    // Midnight is skipped in Santiago when DST starts; the day starts at 01:00.
    expect(exportRange("2026-09-06", "2026-09-06", "America/Santiago").start).toEqual(
      at("2026-09-06T04:00:00Z"),
    );
  });
  it("rejects invalid, reversed or out-of-range dates", () => {
    expect(() => exportRange("2026-02-30", "2026-03-01", "UTC")).toThrow(RangeError);
    expect(() => exportRange("2026-03-01", "", "UTC")).toThrow(RangeError);
    expect(() => exportRange("2026-03-02", "2026-03-01", "UTC")).toThrow(RangeError);
    expect(() => exportRange("1999-03-02", "2026-03-01", "UTC")).toThrow(
      "Choose dates between 2000 and 2099",
    );
  });
  it("reads today's date in the chosen zone", () => {
    expect(civilToday(at("2026-10-31T20:15:00Z"), "Pacific/Auckland")).toBe("2026-11-01");
    expect(civilToday(at("2026-11-01T02:00:00Z"), "America/New_York")).toBe("2026-10-31");
  });
});

describe("exportHealth", () => {
  it("serialises a FHIR bundle from the pod for the chosen range", async () => {
    const pod = createDemoPod({ root: ROOT });
    const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
    await addMeasurement(store, "in", "weight", 70, "kg", at("2026-10-15T08:00:00Z"));
    await addMeasurement(store, "out", "weight", 71, "kg", at("2026-12-15T08:00:00Z"));
    const draft: RecordDraft = {
      name: "Example medication",
      dose: "1 tablet",
      note: "",
      date: "2026-10-01",
      time: "08:00",
      timeZone: "UTC",
      frequency: "daily",
    };
    await saveRecord(
      store,
      OWNER,
      "medications",
      "med",
      draft,
      { create: true },
      at("2026-10-01T12:00:00Z"),
    );
    let n = 0;
    const exported = await exportHealth(store, exportRange("2026-10-01", "2026-11-30", "UTC"), {
      clock: () => at("2026-11-30T12:00:00Z"),
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      unsaved: [
        reading("steps", 900, "2026-10-20T08:00:00Z"),
        reading("steps", 800, "2026-12-20T08:00:00Z"),
        reading("steps", 700, "2026-09-20T08:00:00Z"),
      ],
    });
    expect(exported.counts).toEqual({ observations: 2, medications: 1, conditions: 0 });
    const bundle = JSON.parse(exported.json);
    expect(bundle.resourceType).toBe("Bundle");
    expect(
      bundle.entry.map(
        (entry: { resource: { resourceType: string } }) => entry.resource.resourceType,
      ),
    ).toEqual(["MedicationStatement", "Observation", "Observation"]);
    expect(bundle.entry[1].resource.valueQuantity.value).toBe(70);
  });
});
