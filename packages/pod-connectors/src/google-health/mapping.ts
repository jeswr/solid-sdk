// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { IntegrationSyncError } from "../core/errors.js";
import { Provenance } from "../core/provenance.js";
import type { NormalisedDoc } from "../core/types.js";
import { CLASSES, ExerciseAction } from "../core/vocab.js";
import {
  type HealthPoint,
  type HealthType,
  ID,
  MAX_OFFSET_MS,
  nativeSource,
  SOURCE_ORIGIN,
} from "./api.js";
import { HEALTH_VOCAB, HealthAction, HealthMetric } from "./vocab-map.js";

const ACTIVITIES = "health/activities.ttl";

interface Existing {
  key: string;
  identifier: string;
  sourceUrl?: string;
  google: boolean;
  start?: number;
  exerciseType?: string;
}

/**
 * Maps validated Google Health points to pod documents. Permanently unmappable points
 * (ambiguous or colliding legacy matches, overlapping daily intervals) are counted in
 * `skipped` and `warnings` instead of failing the run, so they never hold a checkpoint.
 */
export class HealthMapper {
  skipped = 0;
  warnings = 0;
  private readonly byTime = new Map<string, Existing | null>();
  private readonly byLegacyWall = new Map<string, Existing | null>();
  private readonly bySource = new Map<string, Existing | null>();
  private readonly byKey = new Map<string, Existing>();
  /** Activity subjects this run already wrote, across windows. */
  private readonly activityKeys = new Set<string>();
  constructor(private readonly resolve: (slug: string) => string) {}

  /** Index stored activities: Fitbit rows (local wall-clock with Z) and Google-derived rows. */
  indexActivities(existing: DatasetCore | undefined): void {
    if (!existing) return;
    if (existing.size > 1_000_000)
      throw new IntegrationSyncError(
        ID,
        "Legacy Fitbit activities exceeded the reconciliation cap.",
      );
    const prefix = `${this.resolve(ACTIVITIES)}#activity-`;
    const seen = new Set<string>();
    for (const q of existing) {
      if (q.subject.termType !== "NamedNode" || !q.subject.value.startsWith(prefix)) continue;
      const id = q.subject.value.slice(prefix.length);
      if (!/^[A-Za-z0-9_!.'()*%:~+-]{1,4096}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 100_000)
        throw new IntegrationSyncError(
          ID,
          "Legacy Fitbit activities exceeded the reconciliation cap.",
        );
      const ex = new ExerciseAction(q.subject, existing, DataFactory);
      const sourceUrl = nativeSource(ex.sourceUrl, "exercise-session");
      const identifier = ex.identifier;
      const google =
        !!sourceUrl ||
        new Provenance(q.subject, existing, DataFactory).derivedFrom.has(SOURCE_ORIGIN);
      const entry: Existing = {
        key: id,
        identifier: identifier && identifier.length <= 4096 ? identifier : id,
        sourceUrl,
        google,
      };
      this.byKey.set(id, entry);
      if (sourceUrl) this.bySource.set(sourceUrl, this.bySource.has(sourceUrl) ? null : entry);
      // A subject with several stored start times is never matched by time; its id stays
      // protected through byKey.
      if (existing.match(q.subject, DataFactory.namedNode(HEALTH_VOCAB.startTime), null).size > 1)
        continue;
      const start = ex.startTime;
      if (!start || !Number.isFinite(start.getTime()) || !ex.exerciseType) continue;
      if (ex.exerciseType.length > 256) continue;
      entry.start = start.getTime();
      entry.exerciseType = ex.exerciseType;
      const key = `${start.toISOString()}|${ex.exerciseType}`;
      this.byTime.set(key, this.byTime.has(key) ? null : entry);
      // Fitbit stored local wall-clock time with a Z suffix; only legacy rows match that way.
      if (!google) this.byLegacyWall.set(key, this.byLegacyWall.has(key) ? null : entry);
    }
  }

  private unmapped(): void {
    this.skipped++;
    this.warnings++;
  }

  /** Resolve the stored subject an exercise updates; null when it must be skipped. */
  private match(p: HealthPoint): Existing | undefined | null {
    const bySource = p.sourceUrl ? this.bySource.get(p.sourceUrl) : undefined;
    if (bySource !== undefined) return bySource;
    const same = this.byKey.get(p.key);
    // A numeric Google id equal to a legacy logId is the same activity when its type
    // matches and its start lies within any civil offset of the stored wall-clock start.
    if (
      same &&
      (same.google ||
        (same.exerciseType === p.activity &&
          same.start !== undefined &&
          Math.abs(same.start - Date.parse(p.start)) <= MAX_OFFSET_MS))
    )
      return same;
    const byTime = this.byTime.get(`${p.start}|${p.activity}`);
    if (byTime !== undefined) return byTime;
    const byWall = p.wallStart ? this.byLegacyWall.get(`${p.wallStart}|${p.activity}`) : undefined;
    if (byWall !== undefined) return byWall;
    // An unrelated legacy record already owns this id: never overwrite it.
    return same ? null : undefined;
  }

  /** Exercise sessions into the legacy activities document; sleep sessions one per document. */
  sessions(points: readonly HealthPoint[]): NormalisedDoc[] {
    const docs = new Map<string, NormalisedDoc>();
    const dataset = (slug: string, writeMode: "merge" | "replace"): Store => {
      let doc = docs.get(slug);
      if (!doc) {
        doc = {
          slug,
          forClass: CLASSES.ExerciseAction,
          category: "health",
          dataset: new Store(),
          writeMode,
        };
        docs.set(slug, doc);
      }
      return doc.dataset as Store;
    };
    for (const p of points) {
      if (p.type === "exercise-session") {
        const old = this.match(p);
        if (old === null) {
          this.unmapped();
          continue;
        }
        const key = old?.key ?? p.key;
        if (this.activityKeys.has(key)) {
          this.unmapped();
          continue;
        }
        this.activityKeys.add(key);
        const ex = new HealthAction(
          `${this.resolve(ACTIVITIES)}#activity-${key}`,
          dataset(ACTIVITIES, "merge"),
          DataFactory,
        ).mark();
        ex.name = p.activity;
        ex.exerciseType = p.activity;
        ex.identifier = old?.identifier ?? p.nativeId ?? p.key;
        ex.sourceUrl = p.sourceUrl ?? old?.sourceUrl;
        ex.startTime = new Date(p.start);
        ex.duration = duration(p.start, p.end);
        if (p.distanceKm !== undefined) ex.distance = `${p.distanceKm} km`;
      } else if (p.type === "sleep") {
        // One session per document makes removal of old linked stages idempotent.
        const slug = `health/sleep/${encodeURIComponent(p.key)}.ttl`;
        const ds = dataset(slug, "replace");
        const ex = new HealthAction(`${this.resolve(slug)}#sleep`, ds, DataFactory).mark();
        ex.name = "Sleep";
        ex.exerciseType = "Sleep";
        ex.startTime = new Date(p.start);
        ex.end = new Date(p.end);
        ex.duration = duration(p.start, p.end);
        ex.sourceUrl = p.sourceUrl;
        for (const [i, stage] of (p.stages ?? []).entries()) {
          const iri = `${this.resolve(slug)}#stage-${i}`;
          ex.parts.add(iri);
          const item = new HealthAction(iri, ds, DataFactory).mark();
          item.name = stage.label;
          item.startTime = new Date(stage.start);
          item.end = new Date(stage.end);
          item.duration = duration(stage.start, stage.end);
        }
      }
    }
    return [...docs.values()];
  }

  /**
   * One UTC day of samples. Heart rate is stored at one-minute resolution (mean, min, max and
   * sample count over every source), so a day document holds at most 1,440 entries; weight
   * keeps each sample, keyed by time and data source.
   */
  samples(type: HealthType, day: string, points: readonly HealthPoint[]): NormalisedDoc[] {
    if (points.length === 0) return [];
    const slug = `health/${type}/${day}.ttl`;
    const doc = this.resolve(slug);
    const ds = new Store();
    if (type === "heart-rate") {
      const minutes = new Map<string, number[]>();
      for (const p of points) {
        const minute = p.start.slice(0, 16);
        const values = minutes.get(minute) ?? [];
        values.push(p.value ?? 0);
        minutes.set(minute, values);
      }
      for (const [minute, values] of [...minutes].sort(([a], [b]) => a.localeCompare(b))) {
        const metric = new HealthMetric(
          `${doc}#minute-${minute.slice(11, 13)}-${minute.slice(14, 16)}`,
          ds,
          DataFactory,
        );
        metric.types.add(HEALTH_VOCAB.PropertyValue);
        metric.name = type;
        metric.identifier = `${type}-${minute}Z`;
        metric.time = new Date(`${minute}:00Z`);
        const sum = values.reduce((total, v) => total + v, 0);
        metric.measurement = Math.round((sum / values.length) * 100) / 100;
        // Never spread: one minute can hold many samples from many sources.
        metric.minValue = values.reduce((min, v) => (v < min ? v : min), Number.POSITIVE_INFINITY);
        metric.maxValue = values.reduce((max, v) => (v > max ? v : max), Number.NEGATIVE_INFINITY);
        metric.sampleCount = values.length;
        metric.unit = "bpm";
      }
    } else {
      for (const p of points) {
        const metric = new HealthMetric(`${doc}#${p.key}`, ds, DataFactory);
        metric.types.add(HEALTH_VOCAB.PropertyValue);
        metric.name = type;
        metric.identifier = p.key;
        metric.time = new Date(p.end);
        metric.measurement = p.value ?? 0;
        metric.unit = "kg";
      }
    }
    return [
      {
        slug,
        forClass: HEALTH_VOCAB.PropertyValue,
        category: "health",
        dataset: ds,
        writeMode: "merge",
      },
    ];
  }

  /** One civil date's reconciled total; overlapping intervals drop only that date. */
  daily(type: HealthType, date: string, points: readonly HealthPoint[]): NormalisedDoc[] {
    const group = [...points].sort((a, b) => a.start.localeCompare(b.start));
    const first = group[0];
    if (!first) return [];
    if (group.some((p, i) => i > 0 && p.start < (group[i - 1]?.end ?? ""))) {
      this.skipped += group.length;
      this.warnings++;
      return [];
    }
    const slug = `health/daily/${date}/${type}.ttl`;
    const ds = new Store();
    const iri = `${this.resolve(slug)}#daily-${date}`;
    const ex = new HealthAction(iri, ds, DataFactory).mark();
    ex.name = `Daily ${type}`;
    ex.exerciseType = "Daily activity";
    ex.startTime = new Date(first.civilStart ?? Date.parse(`${date}T00:00:00Z`));
    const metricIri = `${iri}/${type}`;
    ex.metrics.add(metricIri);
    const metric = new HealthMetric(metricIri, ds, DataFactory);
    metric.types.add(HEALTH_VOCAB.PropertyValue);
    metric.name = type;
    metric.measurement = group.reduce((sum, p) => sum + (p.value ?? 0), 0);
    metric.unit = type === "steps" ? "steps" : type === "distance" ? "m" : "kcal";
    return [
      {
        slug,
        forClass: CLASSES.ExerciseAction,
        category: "health",
        dataset: ds,
        writeMode: "merge",
      },
    ];
  }
}

/**
 * Map one batch of points (sessions, samples grouped by UTC day, summaries grouped by civil
 * date) in one go. The adapter drives the mapper window by window instead.
 */
export function healthDocuments(
  points: readonly HealthPoint[],
  resolve: (slug: string) => string,
  existingActivities?: DatasetCore,
  mapper = new HealthMapper(resolve),
): NormalisedDoc[] {
  mapper.indexActivities(existingActivities);
  const docs = mapper.sessions(points);
  const groups = new Map<string, HealthPoint[]>();
  for (const p of points) {
    if (p.type === "exercise-session" || p.type === "sleep") continue;
    const key = `${p.type}|${p.civilDate ?? p.start.slice(0, 10)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const [key, group] of groups) {
    const [type, date] = key.split("|") as [HealthType, string];
    docs.push(
      ...(group[0]?.civilDate
        ? mapper.daily(type, date, group)
        : mapper.samples(type, date, group)),
    );
  }
  return docs;
}

function duration(start: string, end: string): string {
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}
