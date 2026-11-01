// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  type createHealthStore,
  METRICS,
  type Measurement,
  type MetricKind,
  measurements,
  monthKeys,
  type Range,
} from "../model";
import { aggregateObservations } from "../stats";
import { convertUnit } from "../units";

export type HealthStore = ReturnType<typeof createHealthStore>;
export type MetricId = "steps" | "heartRate" | "sleep" | "weight" | "blood-pressure";
export const CATALOGUE = [
  { id: "steps", label: "Steps", unit: "steps", aggregation: "sum", kinds: ["steps"] },
  { id: "heartRate", label: "Heart rate", unit: "bpm", aggregation: "mean", kinds: ["heartRate"] },
  { id: "sleep", label: "Sleep", unit: "h", aggregation: "sum", kinds: ["sleep"] },
  { id: "weight", label: "Weight", unit: "kg", aggregation: "mean", kinds: ["weight"] },
  {
    id: "blood-pressure",
    label: "Blood pressure",
    unit: "mmHg",
    aggregation: "mean",
    kinds: ["systolic", "diastolic"],
  },
] as const;
export function displayValue(kind: MetricKind, value: number): number {
  return kind === "sleep" ? convertUnit(value, "s", "h", "duration") : value;
}
export function formatMetric(kind: MetricKind, value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: kind === "steps" ? 0 : 1 }).format(
    displayValue(kind, value),
  );
}
export function canonicalValue(kind: MetricKind, value: number, unit: string): number {
  if (kind === "weight") return convertUnit(value, unit, "kg", "mass");
  if (kind === "sleep") return convertUnit(value, unit, "s", "duration");
  if (kind === "systolic" || kind === "diastolic")
    return convertUnit(value, unit, "mm[Hg]", "blood-pressure");
  if (unit !== METRICS[kind].unitCode) throw new TypeError("Choose a supported unit");
  return value;
}
export function metricRange(range: "7d" | "30d" | "1y", now: Date): Range {
  const end = new Date(now);
  end.setUTCHours(24, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (range === "7d" ? 7 : range === "30d" ? 30 : 365));
  return { start, end };
}
export function summarizeMetric(entries: Measurement[], kind: MetricKind, period: "day" | "week") {
  const sorted = [...entries].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.iri.localeCompare(b.iri),
  );
  const buckets = aggregateObservations(
    sorted.map((entry) => ({
      timestamp: entry.at.getTime(),
      value: displayValue(kind, entry.value),
    })),
    { period, timeZone: "UTC" },
    METRICS[kind].sum ? "sum" : "mean",
  );
  const values = buckets.map((bucket) => bucket.value);
  return {
    entries: sorted.reverse(),
    buckets,
    latest: sorted[0],
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    average: values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null,
  };
}
export async function loadMetric(
  store: HealthStore,
  kind: MetricKind,
  range: Range,
  period: "day" | "week" = "day",
) {
  return summarizeMetric(await store.metric(kind, range), kind, period);
}
export async function readShard(store: HealthStore, path: string) {
  try {
    return await store.read(path);
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return null;
    throw error;
  }
}
/** Read each monthly document once, sharing it across all dashboard cards. */
export async function loadMeasurements(store: HealthStore, range: Range): Promise<Measurement[]> {
  const entries: Measurement[] = [];
  for (const key of monthKeys(range)) {
    const shard = await readShard(store, `observations/${key}.ttl`);
    if (shard)
      for (const kind of Object.keys(METRICS) as MetricKind[])
        entries.push(...measurements(shard.document, kind, range));
  }
  return entries;
}
export async function addMeasurement(
  store: HealthStore,
  id: string,
  kind: MetricKind,
  value: number,
  unit: string,
  at: Date,
  note?: string,
) {
  return store.addObservation(id, {
    kind,
    value: canonicalValue(kind, value, unit),
    at,
    source: "Manual entry",
    ...(note === undefined ? {} : { note }),
  });
}
