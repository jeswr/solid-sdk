// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { JourneyData, PlaceData, VisitData } from "./generated/model.js";

export const IMPORT_LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  records: 50_000,
  points: 200_000,
});
export const CATEGORIES = [
  "home",
  "work",
  "food",
  "shop",
  "travel",
  "outdoors",
  "culture",
  "health",
  "other",
] as const;
export const ACTIVITY_TYPES = [
  "walking",
  "cycling",
  "running",
  "driving",
  "train",
  "bus",
  "flight",
  "ferry",
  "other",
] as const;
export type ImportedPlace = { id: string; data: PlaceData };
export type ImportedVisit = { id: string; placeId: string; data: Omit<VisitData, "place"> };
export type ImportedJourney = { id: string; data: JourneyData };
export interface TimelineImport {
  places: ImportedPlace[];
  visits: ImportedVisit[];
  journeys: ImportedJourney[];
  skipped: number;
}
type Obj = Record<string, unknown>;
function obj(value: unknown): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}
function text(value: unknown, max = 256): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}
function numeric(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
export function coordinates(latitude: number, longitude: number): [number, number] {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new TypeError("Invalid coordinates");
  return [latitude, longitude];
}
function location(value: unknown): [number, number] | undefined {
  const point = obj(value);
  const raw = typeof value === "string" ? value : (point.latLng ?? point.point);
  let lat: number | undefined;
  let lon: number | undefined;
  if (typeof raw === "string" && raw.length <= 128) {
    const match = /^(?:geo:)?\s*([+-]?\d+(?:\.\d+)?)°?\s*,\s*([+-]?\d+(?:\.\d+)?)°?\s*$/.exec(raw);
    if (match) {
      lat = Number(match[1]);
      lon = Number(match[2]);
    }
  } else {
    lat = numeric(point.latitudeE7 ?? point.latE7);
    lon = numeric(point.longitudeE7 ?? point.lngE7);
    if (lat !== undefined) lat /= 1e7;
    if (lon !== undefined) lon /= 1e7;
  }
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return undefined;
  return [lat, lon];
}
function instant(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  // Require an explicit zone; reject Date's rollover of impossible calendar dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const last = new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate();
  const date = new Date(value);
  return year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= last &&
    Number.isFinite(date.getTime())
    ? date
    : undefined;
}
function timestamp(value: unknown): Date | undefined {
  const ms = numeric(value);
  if (ms === undefined) return undefined;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.getUTCFullYear() <= 9999
    ? date
    : undefined;
}
function times(value: Obj): { startTime: Date; endTime: Date } | undefined {
  const duration = obj(value.duration);
  const startTime =
    instant(value.startTime ?? duration.startTimestamp) ?? timestamp(duration.startTimestampMs);
  const endTime =
    instant(value.endTime ?? duration.endTimestamp) ?? timestamp(duration.endTimestampMs);
  return startTime && endTime && startTime <= endTime ? { startTime, endTime } : undefined;
}
/** Great-circle metres on a spherical Earth; clamps antipodal floating point rounding. */
export function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  coordinates(...a);
  coordinates(...b);
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function mode(value: unknown): JourneyData["activityType"] {
  const name = text(value)?.toLowerCase().replaceAll("_", "");
  const aliases: Record<string, JourneyData["activityType"]> = {
    walk: "walking",
    walking: "walking",
    onfoot: "walking",
    cycling: "cycling",
    bicycling: "cycling",
    running: "running",
  };
  // Google has used both MOVING and IN_* activity names across export generations.
  const known: Record<string, JourneyData["activityType"]> = {
    incar: "driving",
    driving: "driving",
    inpassengervehicle: "driving",
    intrain: "train",
    train: "train",
    insubway: "train",
    inbus: "bus",
    bus: "bus",
    flying: "flight",
    flight: "flight",
    inferry: "ferry",
    ferry: "ferry",
  };
  return (
    (name && Object.hasOwn(aliases, name)
      ? aliases[name]
      : name && Object.hasOwn(known, name)
        ? known[name]
        : undefined) ?? "other"
  );
}
function key(parts: unknown[]): string {
  return JSON.stringify(parts);
}
/**
 * Pure, bounded JSON importer. No fetching, geocoding or pod access. IDs are stable
 * canonical keys, hashed by the repository at persistence time. Unsupported rows
 * are counted; over-budget or unrecognised documents reject before returning data.
 */
export function parseGoogleTimeline(json: string): TimelineImport {
  if (
    typeof json !== "string" ||
    json.length > IMPORT_LIMITS.bytes ||
    new TextEncoder().encode(json).length > IMPORT_LIMITS.bytes
  )
    throw new RangeError("Timeline file is too large (maximum 32 MiB)");
  let root: Obj;
  try {
    root = obj(JSON.parse(json));
  } catch {
    throw new TypeError("This file is not valid JSON");
  }
  const raw = root.semanticSegments ?? root.timelineObjects;
  if (!Array.isArray(raw))
    throw new TypeError("Choose a Google Timeline or Semantic Location History JSON file");
  if (raw.length > IMPORT_LIMITS.records)
    throw new RangeError("Timeline has too many records (maximum 50,000)");
  const places = new Map<string, ImportedPlace>();
  const visits = new Map<string, ImportedVisit>();
  const journeys = new Map<string, ImportedJourney>();
  let skipped = 0;
  let pointBudget = 0;
  const addJourney = (record: Obj, activity: Obj, span: { startTime: Date; endTime: Date }) => {
    const path = Array.isArray(record.timelinePath) ? record.timelinePath : [];
    pointBudget += path.length;
    if (pointBudget > IMPORT_LIMITS.points)
      throw new RangeError("Timeline has too many path points");
    let first: [number, number] | undefined;
    let last: [number, number] | undefined;
    let pathDistance = 0;
    for (const item of path) {
      const next = location(item);
      if (!next) continue;
      first ??= next;
      if (last) pathDistance += haversine(last, next);
      last = next;
    }
    const start = location(activity.start ?? activity.startLocation) ?? first;
    const end = location(activity.end ?? activity.endLocation) ?? last;
    if (!start || !end) return false;
    const activityType = mode(
      obj(activity.topCandidate).type ?? activity.activityType ?? activity.type,
    );
    const metres = numeric(activity.distanceMeters ?? activity.distance);
    const distance =
      metres !== undefined && metres >= 0 && metres <= 100_000_000
        ? metres
        : pathDistance || haversine(start, end);
    const id = key([
      "journey",
      span.startTime.toISOString(),
      span.endTime.toISOString(),
      ...start,
      ...end,
      activityType,
    ]);
    journeys.set(id, {
      id,
      data: {
        ...span,
        startLatitude: start[0],
        startLongitude: start[1],
        endLatitude: end[0],
        endLongitude: end[1],
        activityType,
        distance,
        source: "google-timeline",
      },
    });
    return true;
  };
  for (const entry of raw) {
    const segment = obj(entry);
    const oldVisit = obj(segment.placeVisit);
    const visit = obj(segment.visit);
    const activity = obj(segment.activity ?? segment.activitySegment);
    const record = segment.placeVisit ? oldVisit : segment.activitySegment ? activity : segment;
    const span = times(record);
    if (!span) {
      skipped++;
      continue;
    }
    if (segment.visit || segment.placeVisit) {
      const candidate = obj(visit.topCandidate);
      const place = obj(oldVisit.location);
      const coords = location(candidate.placeLocation ?? place);
      if (!coords) {
        skipped++;
        continue;
      }
      // Never truncate identity fields: distinct long IDs/names must not collapse.
      if (
        [candidate.placeId ?? place.placeId, candidate.placeName ?? place.name].some(
          (value) => typeof value === "string" && value.length > 256,
        )
      ) {
        skipped++;
        continue;
      }
      const name = text(candidate.placeName ?? place.name) ?? "Unnamed place";
      const externalId = text(candidate.placeId ?? place.placeId);
      const id = externalId
        ? key(["google", externalId])
        : key(["coordinates", coords[0].toFixed(5), coords[1].toFixed(5), name.toLowerCase()]);
      if (!places.has(id))
        places.set(id, {
          id,
          data: {
            name,
            latitude: coords[0],
            longitude: coords[1],
            category: "other",
            saved: false,
            ...(externalId ? { externalId } : {}),
            ...(text(place.address, 1000) ? { address: text(place.address, 1000) } : {}),
            created: span.startTime,
            modified: span.startTime,
          },
        });
      const confidence = numeric(
        candidate.probability ?? visit.probability ?? oldVisit.visitConfidence,
      );
      const visitId = key(["visit", id, span.startTime.toISOString(), span.endTime.toISOString()]);
      visits.set(visitId, {
        id: visitId,
        placeId: id,
        data: {
          ...span,
          source: "google-timeline",
          ...(confidence !== undefined && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
        },
      });
    } else if (!addJourney(segment, activity, span)) skipped++;
  }
  return {
    places: [...places.values()],
    visits: [...visits.values()],
    journeys: [...journeys.values()],
    skipped,
  };
}
