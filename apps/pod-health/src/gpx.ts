// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// GPX → RDF — parse a GPX 1.1 track document into a typed ph:Workout + its
// ordered ph:RoutePoint route, written through the @rdfjs/wrapper model (never
// hand-built triples).
//
// GPX is an XML format (NOT RDF), so this module extracts the narrow GPX track
// structure with a small, self-contained, exhaustively-tested scanner and then
// maps it onto the typed accessors. We deliberately do NOT pull in a general XML
// library: the only GPX shape we need is <trk>/<trkseg>/<trkpt> with lat/lon
// attributes and optional <ele>/<time> children, and the published fast-xml-parser
// 5.x tree carries several low-reputation transitive deps (a supply-chain risk).
// This scanner is for the XML envelope only — all RDF still flows through the
// sanctioned @rdfjs/wrapper accessors, so the "never a bespoke RDF parser" rule
// holds.

import { DataFactory, Store } from "n3";
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

/** Decode the five standard XML entities that may appear in GPX text content. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Read a numeric attribute (`name="value"` or `name='value'`) from a tag's text. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`));
  if (!m) return undefined;
  return m[1] ?? m[2];
}

/** Read a child element's text content (`<name>text</name>`) within a fragment. */
function childText(fragment: string, name: string): string | undefined {
  const m = fragment.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m || m[1] === undefined) return undefined;
  return decodeXmlEntities(m[1].trim());
}

/** Coerce a string to a finite number, or undefined. */
function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce an ISO-8601 string to a Date, or undefined if absent/invalid. */
function toDate(value: string | undefined): Date | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse a GPX 1.1 document string into its track points (every `<trkpt>` in the
 * document, in order). Throws if there is no `<gpx>` root element. A `<trkpt>`
 * missing a valid lat/lon is skipped (one malformed fix does not lose the track).
 */
export function parseGpxTrackPoints(gpx: string): GpxTrackPoint[] {
  if (!/<gpx\b/i.test(gpx)) {
    throw new Error("Not a GPX document: missing root <gpx> element.");
  }

  const out: GpxTrackPoint[] = [];
  // Match both self-closing `<trkpt .../>` and `<trkpt ...>...</trkpt>` forms.
  const trkptRe = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
  let match: RegExpExecArray | null = trkptRe.exec(gpx);
  while (match !== null) {
    // Group 1 (attributes) is always present; group 2 (body) is absent for the
    // self-closing `<trkpt .../>` form, in which case there is no <ele>/<time>.
    const attrs = match[1] as string;
    const body = match[2] ?? "";
    const lat = toNumber(attr(attrs, "lat"));
    const long = toNumber(attr(attrs, "lon"));
    if (lat !== undefined && long !== undefined) {
      const point: GpxTrackPoint = { lat, long };
      const ele = toNumber(childText(body, "ele"));
      if (ele !== undefined) point.elevation = ele;
      const time = toDate(childText(body, "time"));
      if (time !== undefined) point.time = time;
      out.push(point);
    }
    match = trkptRe.exec(gpx);
  }

  return out;
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

/** Total route distance in metres (sum of haversine over consecutive points). */
export function routeDistanceMetres(points: readonly GpxTrackPoint[]): number {
  let total = 0;
  let prev: GpxTrackPoint | undefined;
  for (const cur of points) {
    if (prev !== undefined) {
      total += haversineMetres(prev.lat, prev.long, cur.lat, cur.long);
    }
    prev = cur;
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
  const trackPoints = parseGpxTrackPoints(gpx);
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
    workout.distance = routeDistanceMetres(trackPoints);
  }

  return { document, workout, points, trackPoints };
}
