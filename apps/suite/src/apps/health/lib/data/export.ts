// AUTHORED-BY Claude Opus 5.5
import {
  type ConditionInput,
  type HealthRecords,
  type MedicationInput,
  type ObservationInput,
  serialiseFhirBundle,
} from "../fhir";
import type { Measurement, Range } from "../model";
import type { HealthStore } from "./metrics";
import { loadMeasurements } from "./metrics";
import { type ClinicalRecord, isRecordDate, loadRecords } from "./records";

/** Why readings or records were left out of an export. */
export interface ExportSkips {
  /** FHIR has no export mapping for sleep here yet. */
  sleep: number;
  /** A systolic or diastolic reading without exactly one partner at the same time and source. */
  unpairedBloodPressure: number;
  /** Medications or conditions without a valid start/onset date. */
  undatedRecords: number;
}
export interface ExportCounts {
  observations: number;
  medications: number;
  conditions: number;
}

const SIMPLE = {
  heartRate: { metric: "heartRate", unit: "/min" },
  steps: { metric: "steps", unit: "{steps}" },
  weight: { metric: "weight", unit: "kg" },
} as const;

function schedule(record: ClinicalRecord) {
  if (record.frequency === "daily") return `Daily at ${record.time}`;
  if (record.frequency === "weekly") return `Weekly at ${record.time}`;
  return "As needed";
}
const sourceOf = (entry: Measurement) => entry.source.trim() || "Entered in Health";

/**
 * Maps app data onto the FHIR export library's inputs. Systolic and diastolic
 * readings become one blood-pressure Observation only when exactly one of each
 * shares a timestamp and source; nothing is guessed or paired across times.
 */
export function toFhirRecords(
  entries: readonly Measurement[],
  medications: readonly ClinicalRecord[],
  conditions: readonly ClinicalRecord[],
): { records: HealthRecords; skipped: ExportSkips; counts: ExportCounts } {
  const skipped: ExportSkips = { sleep: 0, unpairedBloodPressure: 0, undatedRecords: 0 };
  const observations: ObservationInput[] = [];
  const pressure = new Map<string, { systolic: Measurement[]; diastolic: Measurement[] }>();
  const ordered = [...entries].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.iri.localeCompare(b.iri),
  );
  for (const entry of ordered) {
    if (entry.kind === "sleep") skipped.sleep += 1;
    else if (entry.kind === "systolic" || entry.kind === "diastolic") {
      const key = `${entry.at.toISOString()}\u0000${sourceOf(entry)}`;
      const group = pressure.get(key) ?? { systolic: [], diastolic: [] };
      group[entry.kind].push(entry);
      pressure.set(key, group);
    } else {
      const mapping = SIMPLE[entry.kind];
      observations.push({
        id: `obs-${observations.length + 1}`,
        metric: mapping.metric,
        unit: mapping.unit,
        value: entry.value,
        effective: entry.at.toISOString(),
        source: sourceOf(entry),
      });
    }
  }
  for (const { systolic, diastolic } of pressure.values()) {
    const [high] = systolic;
    const [low] = diastolic;
    if (systolic.length === 1 && diastolic.length === 1 && high && low)
      observations.push({
        id: `obs-${observations.length + 1}`,
        metric: "bloodPressure",
        unit: "mm[Hg]",
        value: { systolic: high.value, diastolic: low.value },
        effective: high.at.toISOString(),
        source: sourceOf(high),
      });
    else skipped.unpairedBloodPressure += systolic.length + diastolic.length;
  }
  const meds: MedicationInput[] = [];
  for (const record of medications) {
    if (!isRecordDate(record.date)) {
      skipped.undatedRecords += 1;
      continue;
    }
    meds.push({
      id: `med-${meds.length + 1}`,
      name: record.name,
      dosageText: [record.dose.trim(), schedule(record)].filter(Boolean).join(", "),
      start: record.date,
    });
  }
  const conds: ConditionInput[] = [];
  for (const record of conditions) {
    if (!isRecordDate(record.date)) {
      skipped.undatedRecords += 1;
      continue;
    }
    conds.push({ id: `cond-${conds.length + 1}`, name: record.name, onset: record.date });
  }
  return {
    records: { observations, medications: meds, conditions: conds },
    skipped,
    counts: {
      observations: observations.length,
      medications: meds.length,
      conditions: conds.length,
    },
  };
}

/** Inclusive civil dates (YYYY-MM-DD) to a half-open UTC range. */
export function exportRange(from: string, to: string): Range {
  if (!isRecordDate(from) || !isRecordDate(to) || to < from)
    throw new RangeError("Choose a start date on or before the end date");
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: new Date(`${from}T00:00:00Z`), end };
}

/** Reads readings in `range` plus all medications and conditions, and serialises a FHIR R4 Bundle. */
export async function exportHealth(
  store: HealthStore,
  range: Range,
  options: { clock: () => Date; uuid: () => string },
) {
  const [entries, medications, conditions] = await Promise.all([
    loadMeasurements(store, range),
    loadRecords(store, "medications"),
    loadRecords(store, "conditions"),
  ]);
  const { records, skipped, counts } = toFhirRecords(entries, medications, conditions);
  return { json: serialiseFhirBundle(records, options), skipped, counts };
}
