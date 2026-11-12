// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import type { FileImportContext } from "../core/file-import.js";
import { copyDataset } from "../core/incremental.js";
import { Provenance } from "../core/provenance.js";
import { CLASSES, PodThing } from "../core/vocab.js";
import { isTravelActivity } from "../garmin/file-adapter.js";
import { DEFAULT_MAX_BYTES } from "../google-drive/adapter.js";
import { FitMetric } from "../google-takeout/vocab.js";
import { ACTIVITY_LIMITS, type Activity, type ActivityBudget } from "./model.js";
import {
  ACTIVITY_CLASSES,
  ActivityIndexEntry,
  ActivityResource,
  MetricValue,
  TrackResource,
} from "./vocab.js";

export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
const keyHash = (value: string) => digest(new TextEncoder().encode(value));
const indexSlug = (second: number) => `indexes/${second}.ttl`;
/** xsd:duration with at most three fixed decimals; finish() bounds the value to [1 s, 7 days]. */
export const formatDuration = (value: number): string =>
  `PT${value.toFixed(3).replace(/\.?0+$/, "")}S`;
/** Display names are literals only, at most 256 code points. */
const displayName = (name: string) => Array.from(name).slice(0, 256).join("");
/** Hash-only origin IRI: sha-256 over the content hash and the file name. */
export async function originIri(filename: string, hash: string): Promise<string> {
  return `urn:sha256:${await keyHash(`${hash}:${filename}`)}`;
}
/** One file's shared source facts; the original is written once per file. */
export interface ActivitySource {
  readonly hash: string;
  readonly filename: string;
  readonly format: string;
  readonly origin: string;
  /** URL of the stored original bytes, absent when over the binary cap. */
  readonly original?: string;
}
/** Store a file's original bytes once (create-only), before its activities are saved. */
export async function writeOriginal(
  bytes: Uint8Array,
  hash: string,
  format: string,
  ctx: FileImportContext,
  budget: ActivityBudget,
): Promise<string | undefined> {
  if (bytes.length > DEFAULT_MAX_BYTES) {
    budget.warn("original-binary-cap-exceeded");
    return undefined;
  }
  const slug = `activities/${hash}.${format}`;
  await ctx.writeBinary({ slug, body: bytes, contentType: "application/octet-stream" });
  return ctx.resolve(slug);
}
const seconds = (duration: string | undefined): number | undefined => {
  const match = /^PT(\d+(?:\.\d+)?)S$/.exec(duration ?? "");
  const value = match ? Number(match[1]) : undefined;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
};

/** Five bounded second buckets find matches across bucket boundaries, without
 * a growing global manifest or a container listing. Each bucket caps at 32 entries.
 */
export async function saveActivity(
  a: Activity,
  source: ActivitySource,
  ctx: FileImportContext,
  budget: ActivityBudget,
): Promise<void> {
  const { hash, format, origin } = source;
  if (a.start === undefined) {
    budget.warn("activity-missing-start");
    ctx.skip();
    return;
  }
  const identity = await keyHash(`${a.start}|${a.sport}|${a.serial || hash}`);
  let slug = `activities/${identity}.ttl`;
  const second = Math.floor(a.start / 1000);
  let ownIndex = new Store();
  let matched = false;
  for (let bucket = second - 2; bucket <= second + 2; bucket++) {
    const found = await ctx.read(indexSlug(bucket));
    if (found && found.size > 4096) throw new Error("Oversized activity deduplication bucket.");
    const dataset = copyDataset(found);
    if (bucket === second) ownIndex = dataset;
    const subjects = new Set<string>();
    for (const quad of dataset) {
      if (
        quad.subject.termType !== "NamedNode" ||
        !quad.subject.value.startsWith(`${ctx.resolve(indexSlug(bucket))}#`)
      )
        continue;
      subjects.add(quad.subject.value);
      if (subjects.size > 32) throw new Error("Activity deduplication bucket exceeds its limit.");
    }
    for (const subject of subjects) {
      const entry = new ActivityIndexEntry(subject, dataset, DataFactory);
      const start = entry.startTime?.getTime();
      const duration = seconds(entry.duration);
      const target = entry.target;
      if (
        start === undefined ||
        !Number.isFinite(start) ||
        duration === undefined ||
        a.duration === undefined ||
        a.truncated ||
        Math.abs(start - a.start) > 2000 ||
        Math.abs(duration - a.duration) > 2 ||
        entry.exerciseType !== a.sport ||
        !target
      )
        continue;
      const relative = target.slice(ctx.resolve("activities/").length);
      if (
        !target.startsWith(ctx.resolve("activities/")) ||
        !/^[a-f0-9]{64}\.ttl#activity$/.test(relative)
      )
        throw new Error("Invalid activity deduplication target.");
      slug = `activities/${relative.split("#")[0]}`;
      matched = true;
      break;
    }
  }
  const url = ctx.resolve(slug);
  const previous = await ctx.read(slug);
  if (previous && previous.size > 4096) throw new Error("Oversized stored activity graph.");
  if (previous && a.truncated) {
    budget.warn("retained-previous-activity");
    return;
  }
  const dataset = copyDataset(previous);
  const resource = new ActivityResource(`${url}#activity`, dataset, DataFactory);
  const travel = isTravelActivity(a.sport);
  const forClass = travel ? CLASSES.TravelAction : CLASSES.ExerciseAction;
  resource.types.add(forClass);
  resource.name = a.name || resource.name || `${a.sport} activity`;
  resource.exerciseType = a.sport;
  resource.description = a.truncated ? "Activity track truncated by import limits." : undefined;
  resource.identifier ??= identity;
  resource.startTime ??= new Date(a.start);
  if (a.end !== undefined && (!matched || resource.end === undefined))
    resource.end = new Date(a.end);
  if (a.duration !== undefined && (!matched || resource.duration === undefined))
    resource.duration = formatDuration(a.duration);
  if (a.distance !== undefined && (a.summary || resource.distance === undefined))
    resource.distance = `${a.distance} m`;
  if (a.calories !== undefined) resource.calories = `${a.calories} kcal`;
  if (a.creator || a.serial) resource.creator = [a.creator, a.serial].filter(Boolean).join(" / ");
  const provenance = new Provenance(`${url}#activity`, dataset, DataFactory);
  // Keep per-activity history bounded too, even across many distinct exports.
  if (
    (resource.originals.size >= 32 &&
      !resource.originals.has(ctx.resolve(`activities/${hash}.${format}`))) ||
    (provenance.derivedFrom.size >= 32 && !provenance.derivedFrom.has(origin))
  ) {
    budget.warn("activity-source-cap-exceeded");
    return;
  }
  provenance.derivedFrom.add(origin);
  if (source.original) {
    resource.originals.add(source.original);
    const original = new PodThing(source.original, dataset, DataFactory);
    original.name = displayName(source.filename);
    original.identifier = hash;
  }
  const metrics: [string, number | undefined, string][] = [
    ["Elevation gain", a.elevation, "m"],
    ["Average heart rate", a.avgHr, "bpm"],
    ["Maximum heart rate", a.maxHr, "bpm"],
  ];
  for (const [i, [name, value, unit]] of metrics.entries()) {
    if (value === undefined) continue;
    const id = `${url}#metric-${i}`;
    resource.metrics.add(id);
    const metric = new FitMetric(id, dataset, DataFactory);
    metric.types.add(ACTIVITY_CLASSES.PropertyValue);
    metric.name = name;
    if (a.summary || new MetricValue(id, dataset, DataFactory).measurement === undefined)
      metric.measurement = value;
    metric.unit = unit;
  }
  const previousPointCount = new TrackResource(`${url}#track`, dataset, DataFactory).count ?? 0;
  if (
    !Number.isSafeInteger(previousPointCount) ||
    previousPointCount < 0 ||
    previousPointCount > ACTIVITY_LIMITS.trackPoints
  )
    throw new Error("Invalid stored activity track count.");
  if (a.track.length >= previousPointCount && a.track.length) {
    const track = new TrackResource(`${url}#track`, dataset, DataFactory).mark();
    track.types.add(ACTIVITY_CLASSES.GeoShape);
    resource.track = `${url}#track`;
    track.line = a.track.map((p) => `${p.lat} ${p.lon}`).join(" ");
    track.samples = JSON.stringify(
      a.track.map((p) => [
        p.lat,
        p.lon,
        p.time,
        p.altitude,
        p.hr,
        p.cadence,
        p.temperature,
        p.distance,
        p.speed,
        p.power,
        p.segment,
      ]),
    );
    track.encodingFormat = "application/json";
    track.count = a.track.length;
  }
  await ctx.write({
    slug,
    category: travel ? "mobility" : "health",
    forClass,
    dataset,
    sourceUrl: origin,
  });
  // A truncated prefix is never a fuzzy-dedup candidate for a complete workout.
  if (matched || a.truncated || a.duration === undefined) return;
  const entryId = `${ctx.resolve(indexSlug(second))}#${slug.slice(11, -4)}`;
  const entries = new Set(
    [...ownIndex]
      .filter((q) => q.subject.value.startsWith(`${ctx.resolve(indexSlug(second))}#`))
      .map((q) => q.subject.value),
  );
  if (entries.size >= 32 && !entries.has(entryId)) {
    budget.warn("deduplication-bucket-cap-exceeded");
    return;
  }
  const entry = new ActivityIndexEntry(entryId, ownIndex, DataFactory);
  entry.startTime = new Date(a.start);
  entry.duration = formatDuration(a.duration);
  entry.exerciseType = a.sport;
  entry.target = `${url}#activity`;
  await ctx.write({
    slug: indexSlug(second),
    category: travel ? "mobility" : "health",
    forClass,
    dataset: ownIndex,
    sourceUrl: origin,
    skipRegistration: true,
  });
}
