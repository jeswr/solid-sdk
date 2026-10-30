// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { parseCsv } from "../core/csv.js";
import type { FileImportContext } from "../core/file-import.js";
import type { NormalisedDoc } from "../core/types.js";
import { CLASSES, SCHEMA } from "../core/vocab.js";
import { FitDay, FitMetric, PlaceVisit } from "./vocab.js";

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function date(value: unknown): Date | undefined {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return undefined;
  const result = new Date(
    typeof value === "number" || (typeof value === "string" && /^\d{10,16}$/.test(value))
      ? Number(value)
      : String(value),
  );
  return Number.isFinite(result.getTime()) ? result : undefined;
}

export function locationDocument(
  raw: string,
  slug: string,
  ctx: Pick<FileImportContext, "resolve" | "maxRows">,
): { doc: NormalisedDoc; skipped: number } {
  const data = object(JSON.parse(raw));
  if (!Array.isArray(data.timelineObjects)) throw new Error("Invalid Takeout location snapshot.");
  const visits = data.timelineObjects;
  if (visits.length > ctx.maxRows) throw new Error("Takeout location row cap exceeded.");
  const dataset = new Store();
  let skipped = 0;
  for (const [i, rawVisit] of visits.entries()) {
    const row = object(rawVisit);
    if (!("placeVisit" in row)) {
      const segment = row.activitySegment;
      if (typeof segment !== "object" || segment === null || Array.isArray(segment)) skipped++;
      continue;
    }
    const visit = object(row.placeVisit);
    const location = object(visit.location);
    const duration = object(visit.duration);
    const start = date(duration.startTimestamp ?? duration.startTimestampMs);
    const end = date(duration.endTimestamp ?? duration.endTimestampMs);
    const latitude =
      typeof location.latitudeE7 === "number" ? location.latitudeE7 / 1e7 : Number.NaN;
    const longitude =
      typeof location.longitudeE7 === "number" ? location.longitudeE7 / 1e7 : Number.NaN;
    const validLatitude = Number.isFinite(latitude) && Math.abs(latitude) <= 90;
    const validLongitude = Number.isFinite(longitude) && Math.abs(longitude) <= 180;
    const hasLocation =
      [location.name, location.address, location.placeId].some(
        (value) => typeof value === "string" && value.trim(),
      ) ||
      (validLatitude && validLongitude);
    if (!hasLocation || !start || !end || end < start) {
      skipped++;
      continue;
    }
    const place = new PlaceVisit(`${ctx.resolve(slug)}#visit-${i}`, dataset, DataFactory);
    place.types.add(`${SCHEMA}Place`);
    place.name = text(location.name);
    place.address = text(location.address);
    if (validLatitude) place.latitude = latitude;
    if (validLongitude) place.longitude = longitude;
    place.start = start;
    place.end = end;
  }
  return { doc: { slug, category: "mobility", forClass: `${SCHEMA}Place`, dataset }, skipped };
}

const METRICS = [
  ["Step count", "steps", "steps"],
  ["Distance (m)", "distance", "m"],
  ["Calories (kcal)", "calories", "kcal"],
  ["Heart Points", "heart-points", "points"],
  ["Move Minutes count", "move-minutes", "min"],
] as const;

/** Same daily activity class as Apple Health/Fitbit, with typed aggregate measurements. */
export function fitDocument(
  raw: string,
  slug: string,
  ctx: Pick<FileImportContext, "resolve" | "maxRows">,
): { doc: NormalisedDoc; skipped: number } {
  const { rows, headers } = parseCsv(raw);
  if (!rows.length && !headers.includes("Date")) throw new Error("Invalid Takeout Fit snapshot.");
  if (rows.length > ctx.maxRows) throw new Error("Takeout Fit row cap exceeded.");
  const dataset = new Store();
  let skipped = 0;
  for (const row of rows) {
    const day = row.Date;
    const start = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? date(`${day}T00:00:00Z`) : undefined;
    if (!start || start.toISOString().slice(0, 10) !== day) {
      skipped++;
      continue;
    }
    const iri = `${ctx.resolve(slug)}#day-${day}`;
    const activity = new FitDay(iri, dataset, DataFactory).mark();
    activity.name = `Daily activity ${day}`;
    activity.startTime = start;
    for (const [column, key, unit] of METRICS) {
      const input = row[column] ?? (key === "move-minutes" ? row["Move Minutes"] : undefined);
      const value = Number(input);
      if (!input?.trim() || !Number.isFinite(value) || value < 0) continue;
      const metricIri = `${iri}/${key}`;
      activity.metrics.add(metricIri);
      const metric = new FitMetric(metricIri, dataset, DataFactory);
      metric.types.add(`${SCHEMA}PropertyValue`);
      metric.name = key;
      metric.measurement = value;
      metric.unit = unit;
      if (key === "distance") activity.distance = `${value} m`;
      if (key === "calories") activity.calories = `${value} kcal`;
    }
  }
  return { doc: { slug, category: "health", forClass: CLASSES.ExerciseAction, dataset }, skipped };
}
