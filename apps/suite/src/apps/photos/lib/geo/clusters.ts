// AUTHORED-BY Codex GPT-6.1-Sol

import {
  type Coordinates,
  createCoordinate,
  type GeoCoordinate,
  readCoordinate,
} from "./coordinates";
import { isRecord, requireGeo } from "./error";

export const MAX_CLUSTER_POINTS = 200_000;
export const MIN_CLUSTER_ZOOM = 0;
export const MAX_CLUSTER_ZOOM = 20;
export const MERCATOR_MAX_LATITUDE = 85.05112878;

export interface GeoPoint extends Coordinates {
  readonly id: string;
}

export interface GeoCluster {
  readonly count: number;
  /** Arithmetic mean of the original, unclamped coordinates. */
  readonly centroid: GeoCoordinate;
  readonly memberIds: readonly string[];
}

interface TileGroup {
  tileKey: string;
  latitudeSum: number;
  longitudeSum: number;
  memberIds: string[];
}

function tileKey(coordinate: Coordinates, zoom: number): string {
  const size = 2 ** zoom;
  const latitude = Math.max(
    -MERCATOR_MAX_LATITUDE,
    Math.min(MERCATOR_MAX_LATITUDE, coordinate.latitude),
  );
  const projectedY = Math.asinh(Math.tan((latitude * Math.PI) / 180));
  // Clamp indices at the closed geographic bounds (+180 and the rounded Mercator cutoff).
  const x = Math.max(
    0,
    Math.min(size - 1, Math.floor(((coordinate.longitude + 180) / 360) * size)),
  );
  const y = Math.max(0, Math.min(size - 1, Math.floor(((1 - projectedY / Math.PI) / 2) * size)));
  return `${zoom}/${x}/${y}`;
}

/**
 * One cluster per Web Mercator tile. Sort by descending count, then ascending ASCII zoom/x/y.
 * IDs must be unique non-blank strings; member order follows the input. Inputs are not mutated.
 */
export function clusterPoints(points: unknown, zoom: unknown): GeoCluster[] {
  requireGeo(Array.isArray(points), "INVALID_POINTS");
  // Check before validating zoom, scanning members, allocating groups, or copying input.
  requireGeo(points.length <= MAX_CLUSTER_POINTS, "TOO_MANY_POINTS");
  requireGeo(
    typeof zoom === "number" &&
      Number.isInteger(zoom) &&
      zoom >= MIN_CLUSTER_ZOOM &&
      zoom <= MAX_CLUSTER_ZOOM,
    "INVALID_ZOOM",
  );
  const groups = new Map<string, TileGroup>();
  const ids = new Set<string>();
  for (const point of points) {
    requireGeo(
      isRecord(point) && typeof point.id === "string" && point.id.trim().length > 0,
      "INVALID_POINTS",
    );
    requireGeo(!ids.has(point.id), "INVALID_POINTS");
    ids.add(point.id);
    const coordinate = readCoordinate(point);
    const key = tileKey(coordinate, zoom);
    let group = groups.get(key);
    if (!group) {
      group = { tileKey: key, latitudeSum: 0, longitudeSum: 0, memberIds: [] };
      groups.set(key, group);
    }
    group.latitudeSum += coordinate.latitude;
    group.longitudeSum += coordinate.longitude;
    group.memberIds.push(point.id);
  }
  return [...groups.values()]
    .sort((a, b) => b.memberIds.length - a.memberIds.length || (a.tileKey < b.tileKey ? -1 : 1))
    .map(({ latitudeSum, longitudeSum, memberIds }) => ({
      count: memberIds.length,
      centroid: createCoordinate(latitudeSum / memberIds.length, longitudeSum / memberIds.length),
      memberIds,
    }));
}
