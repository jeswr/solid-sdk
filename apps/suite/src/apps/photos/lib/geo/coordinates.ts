// AUTHORED-BY Codex GPT-6.1-Sol

import { isRecord, requireGeo } from "./error";

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeoCoordinate extends Coordinates {
  /** Cameras frequently use the origin to represent absent GPS metadata. */
  readonly suspicious: boolean;
}

/** Decoded unsigned EXIF rational, represented without dividing away its denominator. */
export type ExifRational = readonly [numerator: number, denominator: number];
export type ExifDms = readonly [ExifRational, ExifRational, ExifRational];

export interface ExifGps {
  readonly latitude: ExifDms;
  readonly latitudeRef: "N" | "S";
  readonly longitude: ExifDms;
  readonly longitudeRef: "E" | "W";
}

export const MEAN_EARTH_RADIUS_METRES = 6_371_008.8;

/** Validate signed decimal degrees without wrapping, clamping, or coercing input. */
export function createCoordinate(latitude: unknown, longitude: unknown): GeoCoordinate {
  requireGeo(
    typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      Math.abs(latitude) <= 90 &&
      typeof longitude === "number" &&
      Number.isFinite(longitude) &&
      Math.abs(longitude) <= 180,
    "INVALID_COORDINATE",
  );
  return {
    latitude: latitude === 0 ? 0 : latitude,
    longitude: longitude === 0 ? 0 : longitude,
    suspicious: latitude === 0 && longitude === 0,
  };
}

export function readCoordinate(value: unknown): GeoCoordinate {
  requireGeo(isRecord(value), "INVALID_COORDINATE");
  return createCoordinate(value.latitude, value.longitude);
}

function rational(value: unknown): readonly [bigint, bigint] {
  requireGeo(Array.isArray(value) && value.length === 2, "INVALID_COORDINATE");
  const [numerator, denominator] = value;
  requireGeo(
    Number.isSafeInteger(numerator) &&
      numerator >= 0 &&
      Number.isSafeInteger(denominator) &&
      denominator > 0,
    "INVALID_COORDINATE",
  );
  return [BigInt(numerator), BigInt(denominator)];
}

function dms(value: unknown, bound: number): number {
  requireGeo(Array.isArray(value) && value.length === 3, "INVALID_COORDINATE");
  const [degrees, degreesDenominator] = rational(value[0]);
  const [minutes, minutesDenominator] = rational(value[1]);
  const [seconds, secondsDenominator] = rational(value[2]);
  const sixty = BigInt(60);
  const hour = BigInt(3600);
  requireGeo(
    minutes < sixty * minutesDenominator && seconds < sixty * secondsDenominator,
    "INVALID_COORDINATE",
  );
  // Compare exact rationals: 90 degrees plus even a tiny positive second is out of bounds.
  const denominator = degreesDenominator * minutesDenominator * secondsDenominator * hour;
  const numerator =
    degrees * minutesDenominator * secondsDenominator * hour +
    minutes * degreesDenominator * secondsDenominator * sixty +
    seconds * degreesDenominator * minutesDenominator;
  requireGeo(numerator <= BigInt(bound) * denominator, "INVALID_COORDINATE");
  // Keep the integral part exact; rounding each large integer before division could cross a bound.
  return Number(numerator / denominator) + Number(numerator % denominator) / Number(denominator);
}

/** Hemisphere references must match their axes; malformed or missing tags fail closed. */
export function fromExifGps(value: unknown): GeoCoordinate {
  requireGeo(isRecord(value), "INVALID_COORDINATE");
  requireGeo(value.latitudeRef === "N" || value.latitudeRef === "S", "INVALID_COORDINATE");
  requireGeo(value.longitudeRef === "E" || value.longitudeRef === "W", "INVALID_COORDINATE");
  const latitude = dms(value.latitude, 90) * (value.latitudeRef === "S" ? -1 : 1);
  const longitude = dms(value.longitude, 180) * (value.longitudeRef === "W" ? -1 : 1);
  return createCoordinate(latitude, longitude);
}

function decimal(value: number): string {
  // Normalize a rounded negative zero for consistent human-readable output and links.
  const formatted = value.toFixed(6);
  return formatted === "-0.000000" ? "0.000000" : formatted;
}

/** Latitude first, longitude second, with six decimal places and no locale dependence. */
export function formatDecimal(value: unknown): string {
  const { latitude, longitude } = readCoordinate(value);
  return `${decimal(latitude)}, ${decimal(longitude)}`;
}

function formatAxisDms(value: number, positiveRef: string, negativeRef: string): string {
  // Round once in tenths of an arcsecond, carrying 60 seconds/minutes into the next unit.
  const tenths = Math.round(Math.abs(value) * 36_000);
  const degrees = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1);
  return `${degrees}°${minutes}′${seconds}″${value < 0 ? negativeRef : positiveRef}`;
}

/** DMS uses one decimal place for seconds, without padding degrees or minutes. */
export function formatDms(value: unknown): string {
  const { latitude, longitude } = readCoordinate(value);
  return `${formatAxisDms(latitude, "N", "S")}, ${formatAxisDms(longitude, "E", "W")}`;
}

/** RFC 5870 WGS-84 URI: no inferred altitude, uncertainty, or provider-specific parameters. */
export function toGeoUri(value: unknown): string {
  const { latitude, longitude } = readCoordinate(value);
  return `geo:${decimal(latitude)},${decimal(longitude)}`;
}

/** Build a link only; no map tiles or other third-party resources are requested. */
export function toOpenStreetMapUrl(value: unknown): string {
  const { latitude, longitude } = readCoordinate(value);
  const lat = decimal(latitude);
  const lon = decimal(longitude);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

/** Great-circle surface distance in metres on the specified mean-radius sphere. */
export function haversineDistance(from: unknown, to: unknown): number {
  const a = readCoordinate(from);
  const b = readCoordinate(to);
  const radians = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * radians) / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;
  // Floating-point rounding near antipodes can put h slightly outside [0, 1].
  const bounded = Math.max(0, Math.min(1, h));
  return 2 * MEAN_EARTH_RADIUS_METRES * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}
