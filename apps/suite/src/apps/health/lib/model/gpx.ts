// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol — ported from apps/pod-health/src/gpx.ts
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// GPX → RDF — parse a GPX 1.1 track document into a typed ph:Workout + its
// ordered ph:RoutePoint route, written through the @rdfjs/wrapper model (never
// hand-built triples).
//
// GPX is XML rather than RDF. Use the existing saxes dependency to resolve
// element namespaces and decode XML text before mapping through typed accessors.

import { DataFactory, Store } from "n3";
import { SaxesParser } from "saxes";
import type { ActivityType, RoutePoint, Workout } from "./model.js";
import { HealthDocument } from "./model.js";

/** Mean Earth radius in metres (haversine). */
const EARTH_RADIUS_M = 6_371_000;

/** A single parsed GPX track point, before it is written to RDF. */
export interface GpxTrackPoint {
  lat: number;
  long: number;
  /** Elevation in metres, if the point carried an `<ele>`. */
  elevation?: number;
  /** The point's instant, if it carried a `<time>`. */
  time?: Date;
}

/** Options controlling how a GPX document maps onto a workout subject. */
export interface GpxToWorkoutOptions {
  /** The workout subject IRI to mint. */
  workoutIri: string;
  /** The patient (a core:Person) the workout belongs to. */
  patient?: string;
  /** The activity kind; defaults to "Run". */
  activityType?: ActivityType;
  /**
   * A factory for each route-point's subject IRI given its 0-based index.
   * Defaults to `${workoutIri}/point/${index}`.
   */
  pointIri?: (index: number) => string;
}

/**
 * The result of parsing a GPX document: the in-memory dataset (an n3.Store
 * wrapped as a HealthDocument), the minted workout, and the ordered points.
 */
export interface ParsedGpxWorkout {
  document: HealthDocument;
  workout: Workout;
  points: RoutePoint[];
  /** The plain parsed track points (pre-RDF), in document order. */
  trackPoints: GpxTrackPoint[];
}

/** Coerce a string to a finite number, or undefined. */
function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce an ISO-8601 string to a Date, or undefined if absent/invalid. */
function toDate(value: string): Date | undefined {
  if (value.trim() === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

interface GpxFrame {
  name: string;
  text: string;
  point?: GpxTrackPoint;
  segment?: GpxTrackPoint[];
}

/**
 * Parse a GPX 1.1 document into its `<trkseg>` track segments, each a list of
 * track points in order. A GPX track can hold several segments separated by
 * recording gaps (a paused workout, a lost GPS fix), and a segment boundary is a
 * genuine route discontinuity — so distance is summed WITHIN a segment, never
 * across the gap between two segments (see `routeDistanceMetres`). Throws if
 * there is no `<gpx>` root element. A `<trkpt>` missing a valid lat/lon is
 * skipped. A GPX with track points but no explicit `<trkseg>` is returned as a
 * single segment.
 */
export function parseGpxSegments(gpx: string): GpxTrackPoint[][] {
  const parser = new SaxesParser({ xmlns: true });
  const stack: GpxFrame[] = [];
  const segments: GpxTrackPoint[][] = [];
  const loose: GpxTrackPoint[] = [];
  let namespace: string;
  parser.on("opentag", (tag) => {
    if (stack.length === 0) {
      if (
        tag.local !== "gpx" ||
        !["", "http://www.topografix.com/GPX/1/0", "http://www.topografix.com/GPX/1/1"].includes(
          tag.uri,
        )
      )
        throw new Error("Not a GPX document: missing root <gpx> element.");
      namespace = tag.uri;
    }
    const frame: GpxFrame = { name: tag.uri === namespace ? tag.local : "", text: "" };
    if (frame.name === "trkseg") {
      frame.segment = [];
      segments.push(frame.segment);
    }
    if (frame.name === "trkpt") {
      const lat = toNumber(tag.attributes.lat?.value);
      const long = toNumber(tag.attributes.lon?.value);
      if (lat !== undefined && long !== undefined) frame.point = { lat, long };
    }
    stack.push(frame);
  });
  const text = (value: string) => {
    const frame = stack.at(-1);
    if (frame !== undefined) frame.text += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    const frame = stack.pop() as GpxFrame;
    const parent = stack.at(-1);
    if (frame.point !== undefined) {
      const segment = stack.findLast((ancestor) => ancestor.segment !== undefined)?.segment;
      (segment ?? loose).push(frame.point);
    }
    if (parent?.point !== undefined) {
      if (frame.name === "ele") {
        const elevation = toNumber(frame.text.trim());
        if (elevation !== undefined) parent.point.elevation = elevation;
      }
      if (frame.name === "time") {
        const time = toDate(frame.text.trim());
        if (time !== undefined) parent.point.time = time;
      }
    }
  });
  parser.write(gpx).close();
  // Preserve support for tracks without explicit segment wrappers.
  if (segments.length === 0 && loose.length > 0) segments.push(loose);

  return segments;
}

/**
 * Parse a GPX 1.1 document into a flat list of every `<trkpt>`, in document
 * order across all segments. Use this for the route ORDER (the points written
 * to RDF); use {@link parseGpxSegments} + {@link routeDistanceMetres} for the
 * distance, which must respect segment boundaries.
 */
export function parseGpxTrackPoints(gpx: string): GpxTrackPoint[] {
  return parseGpxSegments(gpx).flat();
}

/** Great-circle distance in metres between two lat/long fixes (haversine). */
export function haversineMetres(aLat: number, aLong: number, bLat: number, bLong: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLong = toRad(bLong - aLong);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLong / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Total route distance in metres — the haversine sum over consecutive points
 * WITHIN each segment, with no distance accrued across a segment boundary (a
 * recording gap is not a travelled leg). Accepts either a flat point list (one
 * implicit segment) or the segmented form from {@link parseGpxSegments}.
 */
export function routeDistanceMetres(
  pointsOrSegments: readonly GpxTrackPoint[] | readonly (readonly GpxTrackPoint[])[],
): number {
  const segments: readonly (readonly GpxTrackPoint[])[] = Array.isArray(pointsOrSegments[0])
    ? (pointsOrSegments as readonly (readonly GpxTrackPoint[])[])
    : [pointsOrSegments as readonly GpxTrackPoint[]];

  let total = 0;
  for (const segment of segments) {
    let prev: GpxTrackPoint | undefined;
    for (const cur of segment) {
      if (prev !== undefined) {
        total += haversineMetres(prev.lat, prev.long, cur.lat, cur.long);
      }
      prev = cur;
    }
  }
  return total;
}

/**
 * Parse a GPX track document into a typed `ph:Workout` with its ordered route of
 * `ph:RoutePoint`s, written through the model into a fresh dataset.
 *
 * The workout's `startTime` / `endTime` are taken from the first / last timed
 * point; `distance` is the haversine sum over the route (only set when there are
 * at least two points). Points are written with an ascending `ph:sequence`
 * preserving GPX order.
 */
export function gpxToWorkout(gpx: string, options: GpxToWorkoutOptions): ParsedGpxWorkout {
  const segments = parseGpxSegments(gpx);
  const trackPoints = segments.flat();
  const document = new HealthDocument(new Store(), DataFactory);

  const workout = document.mintWorkout(options.workoutIri);
  workout.activityType = options.activityType ?? "Run";
  if (options.patient !== undefined) workout.patient = options.patient;

  const pointIri = options.pointIri ?? ((i: number): string => `${options.workoutIri}/point/${i}`);

  const points: RoutePoint[] = trackPoints.map((tp, index) => {
    const rp = document.mintRoutePoint(pointIri(index));
    rp.sequence = index;
    rp.lat = tp.lat;
    rp.long = tp.long;
    if (tp.elevation !== undefined) rp.elevation = tp.elevation;
    if (tp.time !== undefined) rp.time = tp.time;
    workout.points.add(rp.value);
    return rp;
  });

  // Derive start / end from the timed points (in document order).
  const times = trackPoints.map((tp) => tp.time).filter((t): t is Date => t !== undefined);
  const [first] = times;
  if (first !== undefined) {
    workout.startTime = first;
    // `times` is non-empty here, so the last element is always defined.
    workout.endTime = times[times.length - 1] as Date;
  }

  if (trackPoints.length > 1) {
    // Distance respects segment boundaries — no leg across a recording gap.
    workout.distance = routeDistanceMetres(segments);
  }

  return { document, workout, points, trackPoints };
}
