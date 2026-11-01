// AUTHORED-BY Claude Opus 5.5

import { instantToWallClock, wallClockToInstant } from "../../../calendar/lib/tz";
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
  const zone = record.timeZone.trim();
  const at = zone ? `${record.time} (${zone})` : record.time;
  if (record.frequency === "daily") return `Daily at ${at}`;
  if (record.frequency === "weekly") return `Weekly at ${at}`;
  return "As needed";
}
const sourceOf = (entry: Measurement) => entry.source.trim() || "Entered in Health";

/** Manual saves mint `#<operation>-systolic` / `#<operation>-diastolic`, which links a pair. */
const PAIR_FRAGMENT = /^(.*#[^#]+)-(systolic|diastolic)$/;

/**
 * Maps app data onto the FHIR export library's inputs. Systolic and diastolic
 * readings become one blood-pressure Observation when they were saved together
 * (a shared operation fragment), or otherwise when exactly one of each shares a
 * timestamp and source; nothing is guessed or paired across times.
 */
export function toFhirRecords(
  entries: readonly Measurement[],
  medications: readonly ClinicalRecord[],
  conditions: readonly ClinicalRecord[],
): { records: HealthRecords; skipped: ExportSkips; counts: ExportCounts } {
  const skipped: ExportSkips = { sleep: 0, unpairedBloodPressure: 0, undatedRecords: 0 };
  const observations: ObservationInput[] = [];
  type Group = { systolic: Measurement[]; diastolic: Measurement[] };
  const add = (groups: Map<string, Group>, key: string, entry: Measurement) => {
    const group = groups.get(key) ?? { systolic: [], diastolic: [] };
    group[entry.kind as keyof Group].push(entry);
    groups.set(key, group);
  };
  const saved = new Map<string, Group>();
  const pressure = new Map<string, Group>();
  const ordered = [...entries].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.iri.localeCompare(b.iri),
  );
  for (const entry of ordered) {
    if (entry.kind === "sleep") skipped.sleep += 1;
    else if (entry.kind === "systolic" || entry.kind === "diastolic") {
      const match = PAIR_FRAGMENT.exec(entry.iri);
      if (match?.[2] === entry.kind) add(saved, match[1] as string, entry);
      else add(pressure, `${entry.at.toISOString()}\u0000${sourceOf(entry)}`, entry);
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
  const pairs: Group[] = [];
  for (const group of saved.values()) {
    if (group.systolic.length === 1 && group.diastolic.length === 1) pairs.push(group);
    // An incomplete operation falls back to matching by time and source.
    else
      for (const entry of [...group.systolic, ...group.diastolic])
        add(pressure, `${entry.at.toISOString()}\u0000${sourceOf(entry)}`, entry);
  }
  pairs.push(...pressure.values());
  pairs.sort(
    (a, b) =>
      ((a.systolic[0] ?? a.diastolic[0]) as Measurement).at.getTime() -
      ((b.systolic[0] ?? b.diastolic[0]) as Measurement).at.getTime(),
  );
  for (const { systolic, diastolic } of pairs) {
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

const nextDay = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};
/** The first instant of a civil day in `zone`, even where DST skips midnight. */
function startOfDay(date: string, zone: string) {
  for (const time of ["00:00:00", "01:00:00"]) {
    try {
      return new Date(wallClockToInstant(`${date}T${time}`, zone, "earlier"));
    } catch {
      // Midnight doesn't exist on some DST change days; the next hour does.
    }
  }
  throw new RangeError("Choose dates between 2000 and 2099");
}
/** Today's civil date (YYYY-MM-DD) in `zone`. */
export function civilToday(now: Date, zone: string) {
  return instantToWallClock(now.getTime(), zone).wallTime.slice(0, 10);
}
/** Inclusive civil dates (YYYY-MM-DD) in `zone` to a half-open instant range. */
export function exportRange(from: string, to: string, zone: string): Range {
  if (!isRecordDate(from) || !isRecordDate(to) || to < from)
    throw new RangeError("Choose a start date on or before the end date");
  return { start: startOfDay(from, zone), end: startOfDay(nextDay(to), zone) };
}

/**
 * Reads readings in `range` plus all medications and conditions, and serialises
 * a FHIR R4 Bundle. `unsaved` readings (still being written) are included too.
 */
export async function exportHealth(
  store: HealthStore,
  range: Range,
  options: { clock: () => Date; uuid: () => string; unsaved: readonly Measurement[] },
) {
  const [loaded, medications, conditions] = await Promise.all([
    loadMeasurements(store, range),
    loadRecords(store, "medications"),
    loadRecords(store, "conditions"),
  ]);
  const entries = new Map(loaded.map((entry) => [entry.iri, entry]));
  for (const entry of options.unsaved)
    if (entry.at >= range.start && entry.at < range.end) entries.set(entry.iri, entry);
  const { records, skipped, counts } = toFhirRecords(
    [...entries.values()],
    medications,
    conditions,
  );
  return {
    json: serialiseFhirBundle(records, { clock: options.clock, uuid: options.uuid }),
    skipped,
    counts,
  };
}
