// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  buildObservation,
  code,
  HEALTH,
  HealthPatient,
  loincCode,
  type ObservationType,
  UNITS,
} from "@jeswr/solid-health";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, type Store } from "n3";
import { IntegrationSyncError } from "../core/errors.js";
import { SectorThing } from "../core/file-vocab-map.js";
import { copyDataset } from "../core/incremental.js";
import type { ImportContext } from "../core/types.js";
import { CLASSES, ExerciseAction, PodThing } from "../core/vocab.js";
import { RecordMarker } from "./vocab.js";

export const API = "https://api.prod.whoop.com/developer/v2";
export const MAX_RECORDS = 10_000;
export const MAX_STORED_QUADS = 500_000;
export type Kind = "cycle" | "recovery" | "sleep" | "workout";

/** WHOOP mapping policy only: display name, code, UCUM unit, optional QUDT unit and
 * Observation subtype. Subtyped metrics use the Health app's LOINC codes; all others are
 * source field codes without a scheme. QUDT IRIs are limited to the solid-health
 * profile's inventory (BEAT-PER-MIN, SEC); ms, Cel, %, kJ and /min carry UCUM only.
 */
type MetricPolicy = readonly [
  name: string,
  codeValue: string,
  unitCode: string,
  unit?: (typeof UNITS)[keyof typeof UNITS],
  type?: ObservationType,
];
export const METRICS = {
  restingHR: ["Resting heart rate", "40443-4", "/min", UNITS.pulse, HEALTH.HeartRate],
  hrv: ["Heart rate variability (RMSSD)", "hrv_rmssd_milli", "ms"],
  temperature: ["Skin temperature", "skin_temp_celsius", "Cel"],
  oxygen: ["Blood oxygen saturation", "spo2_percentage", "%"],
  energy: ["Energy burned", "kilojoule", "kJ"],
  sleep: ["Asleep duration", "93832-4", "s", UNITS.seconds, HEALTH.Sleep],
  light: ["Light sleep duration", "total_light_sleep_time_milli", "s", UNITS.seconds],
  deep: ["Deep sleep duration", "total_slow_wave_sleep_time_milli", "s", UNITS.seconds],
  rem: ["REM sleep duration", "total_rem_sleep_time_milli", "s", UNITS.seconds],
  respiratory: ["Respiratory rate", "respiratory_rate", "/min"],
  averageHR: ["Average heart rate", "average_heart_rate", "/min", UNITS.pulse],
  maxHR: ["Maximum heart rate", "max_heart_rate", "/min", UNITS.pulse],
} as const satisfies Record<string, MetricPolicy>;
export type Metric = keyof typeof METRICS;
export interface WhoopRecord {
  kind: Kind;
  start: Date;
  end?: Date;
  id?: string;
  updated?: Date;
  name?: string;
  values: Partial<Record<Metric, number>>;
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function sourceId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}
export function number(value: unknown, max = 1_000_000_000, min = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/** Require a real calendar date and explicit offset; never interpret a local time in host TZ. */
export function timestamp(value: unknown, offset?: string): Date | undefined {
  if (typeof value !== "string" || value.length > 80) return undefined;
  let raw = value
    .trim()
    .replace(" ", "T")
    .replace(/\s+([+-]\d{2}:?\d{2})$/, "$1");
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const supplied = offset?.trim().toUpperCase();
    const zone = supplied === "UTC" || supplied === "GMT" ? "Z" : supplied?.replace(/^UTC/, "");
    if (!zone || !/^(?:Z|[+-]\d{2}:?\d{2})$/.test(zone)) return undefined;
    raw += zone;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/.exec(raw);
  if (!match) return undefined;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    year < 1900 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59
  )
    return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

const route = (kind: Kind) => (kind === "sleep" || kind === "workout" ? `activity/${kind}` : kind);
export const sourceUrl = (kind: Kind) => `${API}/${route(kind)}`;

const aliasKey = (kind: Kind, start: Date) => `${kind}|${Math.floor(start.getTime() / 1000)}`;

interface Existing {
  csvRoots: Set<string>;
  hasApi: boolean;
}

/** Stage source input first. Read each destination once, reconcile aliases in linear work,
 * and conditionally replace it, retaining unrelated records and their provenance. */
export async function writeRecords(
  records: readonly WhoopRecord[],
  ctx: Pick<ImportContext, "resolve" | "read" | "write" | "signal">,
  source: "api" | "file" = "api",
): Promise<void> {
  const shards = new Map<string, WhoopRecord[]>();
  const unique = new Map(
    records.map((record) => [`${record.kind}|${record.id ?? record.start.toISOString()}`, record]),
  );
  for (const record of unique.values()) {
    const slug =
      record.kind === "workout"
        ? `health/workouts/${record.start.toISOString().slice(0, 7)}.ttl`
        : `health/observations/${record.start.toISOString().slice(0, 7)}.ttl`;
    const group = shards.get(slug) ?? [];
    group.push(record);
    shards.set(slug, group);
  }
  for (const [slug, incoming] of shards) {
    ctx.signal?.throwIfAborted();
    const loaded = new Map<string, Awaited<ReturnType<typeof loadShard>>>();
    const load = async (path: string) => {
      let shard = loaded.get(path);
      if (!shard) {
        shard = await loadShard(path, ctx);
        loaded.set(path, shard);
      }
      return shard;
    };
    const current = await load(slug);
    const { dataset, doc, aliases } = current;
    const dirty = new Set([current]);
    for (const record of incoming) {
      ctx.signal?.throwIfAborted();
      const alias = aliasKey(record.kind, record.start);
      // Compare whole seconds: API milliseconds and rounded export starts differ.
      const matches: Existing = { hasApi: false, csvRoots: new Set() };
      const second = Math.floor(record.start.getTime() / 1000);
      const neighbors = new Set([current]);
      for (const shift of [-60_000, 60_000]) {
        const month = new Date(record.start.getTime() + shift).toISOString().slice(0, 7);
        const adjacent = slug.replace(/\d{4}-\d{2}\.ttl$/, `${month}.ttl`);
        if (adjacent !== slug) neighbors.add(await load(adjacent));
      }
      for (const shard of neighbors) {
        for (let delta = -60; delta <= 60; delta++) {
          const entry = shard.aliases.get(`${record.kind}|${second + delta}`);
          if (!entry) continue;
          matches.hasApi ||= entry.hasApi;
          if (record.id || delta === 0)
            for (const root of entry.csvRoots) matches.csvRoots.add(root);
        }
      }
      // Remove a legacy duplicate CSV copy even when an API winner already exists.
      // CSV cannot distinguish multiple native events with matching starts.
      const root = `${doc}#${record.kind}-${record.id ?? `csv-${encodeURIComponent(record.start.toISOString())}`}`;
      const obsolete = new Set([root, ...matches.csvRoots]);
      for (const old of obsolete) {
        const shard = [...neighbors].find((item) => old.startsWith(`${item.doc}#`)) ?? current;
        for (const subject of ownedSubjects(old)) {
          if (shard.dataset.countQuads(subject, null, null, null)) dirty.add(shard);
          shard.dataset.removeQuads(shard.dataset.getQuads(subject, null, null, null));
          shard.carried.delete(subject);
        }
      }
      if (!record.id && matches.hasApi) continue;
      const marker = new RecordMarker(root, dataset, DataFactory);
      marker.types.add(CLASSES.Dataset);
      marker.description = record.kind;
      marker.source = "WHOOP";
      marker.startTime = record.start;
      marker.endTime = record.end;
      marker.identifier = record.id;
      marker.dateModified = record.updated;
      marker.sourceUrl = source === "api" ? sourceUrl(record.kind) : undefined;
      for (const [key, value] of Object.entries(record.values)) {
        const metric = key as Metric;
        addObservation(dataset, root, record, metric, value, source);
      }
      if (record.kind === "workout") {
        const workout = new ExerciseAction(`${root}/action`, dataset, DataFactory).mark();
        workout.name = record.name ?? "WHOOP workout";
        workout.exerciseType = record.name;
        workout.identifier = record.id;
        workout.startTime = record.start;
        if (record.end)
          workout.duration = `PT${(record.end.getTime() - record.start.getTime()) / 1000}S`;
        if (record.values.energy !== undefined)
          workout.calories = `${record.values.energy / 4.184} kcal`;
        workout.sourceUrl = source === "api" ? sourceUrl(record.kind) : undefined;
      }
      const entry = aliases.get(alias) ?? { hasApi: false, csvRoots: new Set<string>() };
      if (record.id) entry.hasApi = true;
      else entry.csvRoots.add(root);
      aliases.set(alias, entry);
      if (dataset.size > MAX_STORED_QUADS)
        throw new IntegrationSyncError("whoop", "WHOOP document exceeds the reconciliation limit.");
    }
    for (const shard of dirty) {
      const { dataset, doc, carried } = shard;
      const healthRecord = new SectorThing(doc, dataset, DataFactory);
      healthRecord.types.add(HEALTH.Record);
      healthRecord.dataSubject = `${doc}#subject`;
      new HealthPatient(`${doc}#subject`, dataset, DataFactory).mark();
      if (dataset.size > MAX_STORED_QUADS)
        throw new IntegrationSyncError("whoop", "WHOOP document exceeds the reconciliation limit.");
      await ctx.write({
        slug: shard.slug,
        category: "health",
        forClass: slug.startsWith("health/workouts/") ? CLASSES.ExerciseAction : HEALTH.Observation,
        dataset,
        writeMode: "replace",
        sourceUrl: source === "api" ? API : undefined,
        carriedForward: [...carried],
      });
    }
  }
}

async function loadShard(slug: string, ctx: Pick<ImportContext, "read" | "resolve">) {
  const previous = await ctx.read(slug);
  if ((previous?.size ?? 0) > MAX_STORED_QUADS)
    throw new IntegrationSyncError(
      "whoop",
      "Stored WHOOP document exceeds the reconciliation limit.",
    );
  const dataset = copyDataset(previous);
  const doc = ctx.resolve(slug);
  const aliases = new Map<string, Existing>();
  const carried = new Set<string>();
  for (const quad of dataset) {
    carried.add(quad.subject.value);
    if (quad.predicate.value !== `${NS.RDF}type` || quad.object.value !== CLASSES.Dataset) continue;
    const node = new RecordMarker(quad.subject, dataset, DataFactory);
    const start = node.startTime;
    if (node.source !== "WHOOP" || !start || !Number.isFinite(start.getTime())) continue;
    if (
      !node.value.startsWith(`${doc}#`) ||
      !["cycle", "recovery", "sleep", "workout"].includes(node.description ?? "")
    )
      continue;
    const key = aliasKey(node.description as Kind, start);
    const entries = aliases.get(key) ?? { hasApi: false, csvRoots: new Set<string>() };
    if (node.identifier) entries.hasApi = true;
    else entries.csvRoots.add(node.value);
    aliases.set(key, entries);
  }
  return { slug, doc, dataset, aliases, carried };
}

function* ownedSubjects(root: string): Generator<string> {
  yield root;
  yield `${root}/action`;
  for (const metric of Object.keys(METRICS)) {
    const observation = `${root}/metric/${metric}`;
    yield observation;
    // solid-health helper IDs, plus the pre-generated `/code` and `/time` helpers
    // so a reimport also removes legacy copies.
    yield `${observation}-code`;
    yield `${observation}-time`;
    yield `${observation}/code`;
    yield `${observation}/time`;
  }
}

function addObservation(
  dataset: Store,
  root: string,
  record: WhoopRecord,
  metric: Metric,
  value: number,
  source: "api" | "file",
): void {
  const [name, codeValue, unitCode, unit, type]: MetricPolicy = METRICS[metric];
  const iri = `${root}/metric/${metric}`;
  // The generated model writes and validates the observation, its code and instant
  // and the document-local patient. Stage totals stay independent reported values
  // at the record start; no stage interval is asserted.
  const built = buildObservation(iri, {
    type: type ?? HEALTH.Observation,
    ...(type ? loincCode(codeValue) : code(codeValue)),
    measuredValue: value,
    unit,
    unitCode,
    dateTime: record.start,
    name,
    source: "WHOOP",
  });
  for (const quad of built) dataset.add(quad);
  // Connector provenance: the import session derives each subject from its schema:url.
  if (source === "api") new PodThing(iri, dataset, DataFactory).sourceUrl = sourceUrl(record.kind);
}
