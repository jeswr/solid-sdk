// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { IntegrationSyncError } from "../core/errors.js";
import { Provenance } from "../core/provenance.js";
import type { NormalisedDoc } from "../core/types.js";
import { CLASSES, ExerciseAction } from "../core/vocab.js";
import { type HealthPoint, ID, nativeSource, SOURCE_ORIGIN, summary } from "./api.js";
import { HEALTH_VOCAB, HealthAction, HealthMetric } from "./vocab-map.js";

/** Preserve Fitbit activity subjects using native ids or unambiguous stored start/type. */
export function healthDocuments(
  points: readonly HealthPoint[],
  resolve: (slug: string) => string,
  existingActivities?: DatasetCore,
): NormalisedDoc[] {
  // Google's name may be empty or use a new id. Match an unambiguous existing
  // Fitbit exercise by its known start and exercise type to retain its original id.
  interface Existing {
    key: string;
    identifier: string;
    sourceUrl?: string;
    google: boolean;
  }
  const byTime = new Map<string, Existing | null>();
  const bySource = new Map<string, Existing | null>();
  const byKey = new Map<string, Existing>();
  const seen = new Set<string>();
  const activityDoc = resolve("health/activities.ttl");
  let legacyRows = 0;
  if (existingActivities && existingActivities.size > 1_000_000)
    throw new IntegrationSyncError(ID, "Legacy Fitbit activities exceeded the reconciliation cap.");
  if (existingActivities)
    for (const q of existingActivities) {
      if (
        q.subject.termType !== "NamedNode" ||
        !q.subject.value.startsWith(`${activityDoc}#activity-`)
      )
        continue;
      const id = q.subject.value.slice(`${activityDoc}#activity-`.length);
      if (!/^[A-Za-z0-9_!.'()*%:~+-]{1,4096}$/.test(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      if (++legacyRows > 100_000)
        throw new IntegrationSyncError(
          ID,
          "Legacy Fitbit activities exceeded the reconciliation cap.",
        );
      if (
        existingActivities.match(q.subject, DataFactory.namedNode(HEALTH_VOCAB.startTime), null)
          .size > 1
      )
        throw new IntegrationSyncError(ID, "Ambiguous stored activity time; checkpoint unchanged.");
      const ex = new ExerciseAction(q.subject, existingActivities, DataFactory);
      const sourceUrl = nativeSource(ex.sourceUrl, "exercise-session");
      const identifier = ex.identifier;
      const entry: Existing = {
        key: id,
        identifier: identifier && identifier.length <= 4096 ? identifier : id,
        sourceUrl,
        google:
          !!sourceUrl ||
          new Provenance(q.subject, existingActivities, DataFactory).derivedFrom.has(SOURCE_ORIGIN),
      };
      byKey.set(id, entry);
      if (sourceUrl) bySource.set(sourceUrl, bySource.has(sourceUrl) ? null : entry);
      const start = ex.startTime;
      if (
        !start ||
        !Number.isFinite(start.getTime()) ||
        !ex.exerciseType ||
        ex.exerciseType.length > 256
      )
        continue;
      const key = `${start.toISOString()}|${ex.exerciseType}`;
      byTime.set(key, byTime.has(key) ? null : entry);
    }
  const docs = new Map<string, NormalisedDoc>();
  const dataset = (slug: string, forClass = CLASSES.ExerciseAction as string): Store => {
    let doc = docs.get(slug);
    if (!doc) {
      doc = { slug, forClass, category: "health", dataset: new Store(), writeMode: "merge" };
      docs.set(slug, doc);
    }
    return doc.dataset as Store;
  };
  const days = new Map<string, HealthPoint[]>();
  const activityKeys = new Set<string>();
  for (const p of points) {
    if (summary(p.type)) {
      const key = `${p.type}:${p.start.slice(0, 10)}`;
      const day = days.get(key) ?? [];
      day.push(p);
      days.set(key, day);
      continue;
    }
    if (p.type === "exercise-session") {
      const slug = "health/activities.ttl";
      let old = p.sourceUrl ? bySource.get(p.sourceUrl) : undefined;
      if (old === null)
        throw new IntegrationSyncError(
          ID,
          "Ambiguous Google Health native identity; checkpoint unchanged.",
        );
      old ??= byTime.get(`${p.start}|${p.activity}`);
      const sameKey = byKey.get(p.key);
      if (old === undefined && sameKey && !sameKey.google)
        throw new IntegrationSyncError(
          ID,
          "Google Health supplied an ambiguous legacy Fitbit id; checkpoint unchanged.",
        );
      if (old === null)
        throw new IntegrationSyncError(
          ID,
          "Ambiguous legacy Fitbit activity; checkpoint unchanged.",
        );
      old ??= sameKey;
      const key = old?.key ?? p.key;
      if (activityKeys.has(key))
        throw new IntegrationSyncError(
          ID,
          "Conflicting legacy Fitbit activity matches; checkpoint unchanged.",
        );
      activityKeys.add(key);
      const ex = new HealthAction(
        `${resolve(slug)}#activity-${key}`,
        dataset(slug),
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
      const ds = dataset(slug);
      const ex = new HealthAction(`${resolve(slug)}#sleep`, ds, DataFactory).mark();
      ex.name = "Sleep";
      ex.exerciseType = "Sleep";
      ex.startTime = new Date(p.start);
      ex.end = new Date(p.end);
      ex.duration = duration(p.start, p.end);
      for (const [i, stage] of (p.stages ?? []).entries()) {
        const iri = `${resolve(slug)}#stage-${i}`;
        ex.parts.add(iri);
        const item = new HealthAction(iri, ds, DataFactory).mark();
        item.name = stage.label;
        item.startTime = new Date(stage.start);
        item.end = new Date(stage.end);
        item.duration = duration(stage.start, stage.end);
      }
      const doc = docs.get(slug);
      if (doc) docs.set(slug, { ...doc, writeMode: "replace" });
    } else {
      const slug = `health/${p.type}.ttl`;
      const metric = new HealthMetric(
        `${resolve(slug)}#${p.key}`,
        dataset(slug, HEALTH_VOCAB.PropertyValue),
        DataFactory,
      );
      metric.types.add(HEALTH_VOCAB.PropertyValue);
      metric.name = p.type;
      metric.identifier = p.key;
      metric.time = new Date(p.end);
      metric.measurement = p.value ?? 0;
      metric.unit = p.type === "heart-rate" ? "bpm" : "kg";
    }
  }
  for (const group of days.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
    if (group.some((p, i) => i > 0 && p.start < (group[i - 1]?.end ?? "")))
      throw new IntegrationSyncError(ID, "Overlapping reconciled summaries; checkpoint unchanged.");
    const first = group[0];
    if (!first) continue;
    const day = first.start.slice(0, 10);
    const slug = `health/daily/${day}/${first.type}.ttl`;
    const ds = dataset(slug);
    const iri = `${resolve(slug)}#daily-${day}`;
    const ex = new HealthAction(iri, ds, DataFactory).mark();
    ex.name = `Daily ${first.type}`;
    ex.exerciseType = "Daily activity";
    ex.startTime = new Date(`${day}T00:00:00Z`);
    const metricIri = `${iri}/${first.type}`;
    ex.metrics.add(metricIri);
    const metric = new HealthMetric(metricIri, ds, DataFactory);
    metric.types.add(HEALTH_VOCAB.PropertyValue);
    metric.name = first.type;
    metric.measurement = group.reduce((sum, p) => sum + (p.value ?? 0), 0);
    metric.unit = first.type === "steps" ? "steps" : first.type === "distance" ? "m" : "kcal";
  }
  return [...docs.values()];
}

function duration(start: string, end: string): string {
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}
