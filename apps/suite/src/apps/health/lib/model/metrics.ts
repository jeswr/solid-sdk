// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { HealthTerm } from "./canonical-vocab.js";
import type { HealthDocument, ObservationKind } from "./model.js";

export const METRICS = {
  heartRate: {
    kind: "HeartRate",
    code: "8867-4",
    unit: "BEAT-PER-MIN",
    unitCode: "/min",
    sum: false,
  },
  steps: { kind: "StepCount", code: "55423-8", unit: "NUM", unitCode: "1", sum: true },
  sleep: { kind: "Sleep", code: "93832-4", unit: "SEC", unitCode: "s", sum: true },
  weight: { kind: "Observation", code: "29463-7", unit: "KiloGM", unitCode: "kg", sum: false },
  systolic: {
    kind: "Observation",
    code: "8480-6",
    unit: "MilliM_HG",
    unitCode: "mm[Hg]",
    sum: false,
  },
  diastolic: {
    kind: "Observation",
    code: "8462-4",
    unit: "MilliM_HG",
    unitCode: "mm[Hg]",
    sum: false,
  },
} as const satisfies Record<
  string,
  { kind: ObservationKind; code: string; unit: string; unitCode: string; sum: boolean }
>;
export type MetricKind = keyof typeof METRICS;
export interface Range {
  start: Date;
  end: Date;
}
export interface Measurement {
  iri: string;
  kind: MetricKind;
  at: Date;
  value: number;
  source: string;
  note?: string;
}

/** Text metadata shared by observations and clinical records. */
export class Details extends HealthTerm {
  get source(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.DCT}source`, LiteralAs.string);
  }
  set source(value: string | undefined) {
    OptionalAs.object(this, `${NS.DCT}source`, value, LiteralFrom.string);
  }
  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}description`, LiteralAs.string);
  }
  set note(value: string | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}description`, value, LiteralFrom.string);
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}name`, value, LiteralFrom.string);
  }
}

export function validDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid date");
}
export function validateRange(range: Range): void {
  validDate(range.start);
  validDate(range.end);
  if (range.end <= range.start) throw new TypeError("Range end must follow start");
}
export function monthKey(date: Date): string {
  validDate(date);
  return date.toISOString().slice(0, 7);
}
/** Enumerate every shard intersecting the half-open range, including empty months. */
export function monthKeys(range: Range): string[] {
  validateRange(range);
  const date = new Date(`${monthKey(range.start)}-01T00:00:00Z`);
  const result: string[] = [];
  while (date < range.end) {
    result.push(monthKey(date));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return result;
}
export function validateMeasurement(input: Measurement): void {
  validDate(input.at);
  if (safeHttpIri(input.iri) !== input.iri) throw new TypeError("Invalid measurement IRI");
  if (
    !Object.hasOwn(METRICS, input.kind) ||
    !Number.isFinite(input.value) ||
    input.value < 0 ||
    !input.source.trim()
  ) {
    throw new TypeError("Invalid measurement");
  }
  if (input.kind === "steps" && !Number.isInteger(input.value))
    throw new TypeError("Steps must be integral");
}
/** All values are canonical units from METRICS; callers normalize imports first. */
export function addMeasurement(document: HealthDocument, input: Measurement): void {
  validateMeasurement(input);
  const metric = METRICS[input.kind];
  const observation = document.mintObservation(input.iri, metric.kind);
  const code = document.mintCodeableConcept(`${input.iri}-code`);
  code.code = metric.code;
  code.scheme = "http://loinc.org";
  observation.code = code.value;
  observation.measuredValue = input.value;
  observation.unit = `${NS.UNIT}${metric.unit}`;
  observation.unitCode = metric.unitCode;
  observation.effectiveTime = `${input.iri}-time`;
  document.mintInstant(observation.effectiveTime).dateTime = input.at;
  const details = new Details(input.iri, document, documentFactory);
  details.source = input.source;
  details.note = input.note;
}

import { DataFactory as documentFactory } from "n3";

/** Reject missing/foreign units instead of silently combining incomparable readings. */
export function measurements(
  document: HealthDocument,
  kind: MetricKind,
  range: Range,
): Measurement[] {
  validateRange(range);
  const metric = METRICS[kind];
  const result: Measurement[] = [];
  for (const observation of document.observations) {
    const matches =
      (observation.code !== undefined &&
        (observation.code === `http://loinc.org/rdf/${metric.code}` ||
          (document.codeableConcept(observation.code).code === metric.code &&
            document.codeableConcept(observation.code).scheme === "http://loinc.org"))) ||
      (metric.kind !== "Observation" && observation.kind === metric.kind);
    if (!matches) continue;
    const at =
      observation.effectiveTime === undefined
        ? undefined
        : document.instant(observation.effectiveTime).dateTime;
    const value = observation.measuredValue;
    if (
      at === undefined ||
      value === undefined ||
      !Number.isFinite(value) ||
      at < range.start ||
      at >= range.end
    )
      continue;
    if (
      observation.unit !== `${NS.UNIT}${metric.unit}` ||
      observation.unitCode !== metric.unitCode
    ) {
      throw new TypeError("Measurement unit needs normalization");
    }
    const details = new Details(observation as Term, document, documentFactory);
    const entry: Measurement = {
      iri: observation.value,
      kind,
      at,
      value,
      source: details.source ?? "Unknown",
    };
    if (details.note !== undefined) entry.note = details.note;
    result.push(entry);
  }
  return result.sort((a, b) => a.at.getTime() - b.at.getTime() || a.iri.localeCompare(b.iri));
}
export interface MetricBucket {
  key: string;
  value: number;
  count: number;
}
/** UTC days / Monday weeks. Sum durations/counts; average sampled vitals. Never mutate inputs. */
export function aggregateMetric(
  entries: readonly Measurement[],
  period: "daily" | "weekly",
): MetricBucket[] {
  const groups = new Map<string, { total: number; count: number; kind: MetricKind }>();
  const kind = entries[0]?.kind;
  for (const entry of entries) {
    validateMeasurement(entry);
    const date = new Date(entry.at);
    if (period === "weekly") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = date.toISOString().slice(0, 10);
    const group = groups.get(key) ?? { total: 0, count: 0, kind: entry.kind };
    if (kind !== entry.kind) throw new TypeError("Cannot aggregate different metrics");
    group.total += entry.value;
    group.count++;
    groups.set(key, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      key,
      count: group.count,
      value: METRICS[group.kind].sum ? group.total : group.total / group.count,
    }));
}
