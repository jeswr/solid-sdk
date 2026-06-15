// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * EXIF metadata model — the technical capture metadata extracted out of an
 * image's binary EXIF block into a plain, serialisable shape that the RDF layer
 * (`photograph.ts`) renders into W3C `exif:` triples.
 *
 * This module is deliberately **decoder-agnostic**: it does NOT parse JPEG/TIFF
 * bytes itself (that belongs to the UI/upload layer, which will use a vetted
 * EXIF reader). It models the *result* of extraction and the normalisation +
 * validation that keeps junk EXIF out of the pod:
 *
 * - numbers are range-checked (a negative ISO, a 999mm "focal length" from a
 *   corrupt tag, or `NaN` are dropped, not written);
 * - the EXIF GPS sexagesimal form (deg/min/sec + N/S/E/W ref) is converted to
 *   the signed decimal degrees the `geo:` vocabulary uses;
 * - the EXIF date form (`YYYY:MM:DD HH:MM:SS`, colons in the date) is converted
 *   to an ISO-8601 `dateTime` for `schema:dateCreated`.
 *
 * Keeping this pure makes the tricky bits (GPS sign, EXIF date colons, bad
 * input) exhaustively unit-testable without any image bytes or a pod.
 */

/** A photo's capture location as signed decimal degrees (WGS84). */
export interface GeoPoint {
  /** Latitude, −90..90 (positive = North). */
  lat: number;
  /** Longitude, −180..180 (positive = East). */
  long: number;
}

/**
 * The technical EXIF metadata we model. Every field is optional — a photo may
 * carry any subset (or none). Values here are already normalised/validated.
 */
export interface ExifMetadata {
  /** `exif:make` — camera manufacturer (e.g. "FUJIFILM"). */
  make?: string;
  /** `exif:model` — camera model (e.g. "X-T5"). */
  model?: string;
  /** `exif:lensModel` — lens model. */
  lensModel?: string;
  /** `exif:focalLength` — focal length in millimetres (> 0). */
  focalLengthMm?: number;
  /** `exif:fNumber` — aperture f-number (> 0, e.g. 2.8). */
  fNumber?: number;
  /** `exif:exposureTime` — shutter speed in seconds (> 0, e.g. 0.004). */
  exposureTimeSec?: number;
  /** `exif:isoSpeedRatings` — ISO sensitivity (integer ≥ 0). */
  iso?: number;
  /** `exif:pixelXDimension` — pixel width (integer > 0). */
  pixelWidth?: number;
  /** `exif:pixelYDimension` — pixel height (integer > 0). */
  pixelHeight?: number;
  /** `exif:orientation` — EXIF orientation tag (1..8). */
  orientation?: number;
  /** Capture instant as an ISO-8601 string (from EXIF DateTimeOriginal). */
  dateTimeOriginal?: string;
  /** Capture location as signed decimal degrees. */
  location?: GeoPoint;
}

/** A finite number strictly greater than zero. */
function positive(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A finite, non-negative integer (fractional input is floored if exact). */
function nonNegativeInt(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return Number.isInteger(n) ? n : undefined;
}

/** A non-empty, trimmed string. */
function nonEmpty(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Convert an EXIF DateTime (`"YYYY:MM:DD HH:MM:SS"`, note the colons in the
 * date part) to an ISO-8601 string. Returns `undefined` for anything that
 * doesn't match the EXIF grammar or isn't a real calendar instant.
 *
 * The bare EXIF colon form carries NO timezone, so its wall-clock components
 * are interpreted as UTC (the only deterministic, machine-independent choice —
 * a local-time read would make the result depend on the runner's `TZ`).
 *
 * An ISO-8601 input that DOES carry a timezone (`…Z` or `±HH:MM`) is honoured:
 * its offset is applied (so `2026-06-15T09:41:07+02:00` → `…07:41:07.000Z`),
 * never silently dropped. An offset-less ISO input is, like EXIF, read as UTC.
 */
export function exifDateToIso(input: string | undefined): string | undefined {
  const s = nonEmpty(input);
  if (!s) return undefined;

  // An ISO date-time WITH an explicit zone designator: parse the whole string
  // so the offset is applied, then validate it is a real instant.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  // Otherwise pull the six wall-clock components from the EXIF colon form
  // ("2026:06:15 09:41:07") or an offset-less ISO date-time ("…T09:41:07").
  const exif = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const m = exif ?? iso;
  if (!m) return undefined;
  const [year, month, day, hour, min, sec] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // Build the instant in UTC, then verify every component survived round-trip
  // — this rejects an out-of-range value (month 13, day 30 in February) that
  // Date.UTC would otherwise silently roll over into a different real date.
  // The regex guarantees all six components are numeric, so Date.UTC never
  // yields NaN; the round-trip check below is the real out-of-range guard.
  const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== min ||
    d.getUTCSeconds() !== sec
  ) {
    return undefined;
  }
  return d.toISOString();
}

/** One component of an EXIF GPS coordinate (degrees / minutes / seconds). */
export interface ExifGpsDms {
  degrees: number;
  minutes: number;
  seconds: number;
  /** Hemisphere reference: 'N'/'S' for latitude, 'E'/'W' for longitude. */
  ref: 'N' | 'S' | 'E' | 'W';
}

/**
 * Convert an EXIF sexagesimal GPS coordinate (degrees/minutes/seconds + a
 * hemisphere ref) to signed decimal degrees. Returns `undefined` for a
 * malformed component: a non-finite or negative value, or a sexagesimal
 * minute/second outside `[0, 60)` (a corrupt EXIF tag). The ref↔axis match
 * (latitude must be N/S, longitude E/W) is enforced by {@link geoPointFromExif}
 * which knows the axis; this function trusts the supplied sign.
 */
export function dmsToDecimal(dms: ExifGpsDms): number | undefined {
  const { degrees, minutes, seconds, ref } = dms;
  for (const v of [degrees, minutes, seconds]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  }
  // Minutes and seconds are sexagesimal: a value ≥ 60 is a corrupt tag, never a
  // valid coordinate (it would over-count into the next degree).
  if (minutes >= 60 || seconds >= 60) return undefined;
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  const sign = ref === 'S' || ref === 'W' ? -1 : 1;
  return sign * magnitude;
}

/**
 * Build a {@link GeoPoint} from EXIF latitude/longitude DMS pairs. Rejects:
 * a missing/malformed component, a ref on the wrong axis (latitude must carry
 * `N`/`S`, longitude `E`/`W` — a mismatched ref is corrupt EXIF), or a decimal
 * result outside the legal range (|lat| ≤ 90, |long| ≤ 180).
 */
export function geoPointFromExif(
  lat: ExifGpsDms | undefined,
  long: ExifGpsDms | undefined,
): GeoPoint | undefined {
  if (!lat || !long) return undefined;
  // The hemisphere ref must belong to the coordinate's axis.
  if (lat.ref !== 'N' && lat.ref !== 'S') return undefined;
  if (long.ref !== 'E' && long.ref !== 'W') return undefined;
  const dLat = dmsToDecimal(lat);
  const dLong = dmsToDecimal(long);
  if (dLat === undefined || dLong === undefined) return undefined;
  if (Math.abs(dLat) > 90 || Math.abs(dLong) > 180) return undefined;
  return { lat: dLat, long: dLong };
}

/**
 * Normalise/validate a raw, possibly-untrusted EXIF bag into {@link
 * ExifMetadata}. Every field is independently cleaned — a single bad value
 * drops that field, never the whole record — so partial/corrupt EXIF still
 * yields the good parts.
 */
export function normaliseExif(raw: Partial<ExifMetadata>): ExifMetadata {
  const out: ExifMetadata = {};
  const make = nonEmpty(raw.make);
  if (make) out.make = make;
  const model = nonEmpty(raw.model);
  if (model) out.model = model;
  const lens = nonEmpty(raw.lensModel);
  if (lens) out.lensModel = lens;

  const focal = positive(raw.focalLengthMm);
  if (focal !== undefined) out.focalLengthMm = focal;
  const fnum = positive(raw.fNumber);
  if (fnum !== undefined) out.fNumber = fnum;
  const exposure = positive(raw.exposureTimeSec);
  if (exposure !== undefined) out.exposureTimeSec = exposure;

  const iso = nonNegativeInt(raw.iso);
  if (iso !== undefined) out.iso = iso;
  const w = positive(raw.pixelWidth);
  if (w !== undefined && Number.isInteger(w)) out.pixelWidth = w;
  const h = positive(raw.pixelHeight);
  if (h !== undefined && Number.isInteger(h)) out.pixelHeight = h;

  // EXIF orientation is a tag in the inclusive range 1..8.
  if (
    typeof raw.orientation === 'number' &&
    Number.isInteger(raw.orientation) &&
    raw.orientation >= 1 &&
    raw.orientation <= 8
  ) {
    out.orientation = raw.orientation;
  }

  const dto = exifDateToIso(raw.dateTimeOriginal);
  if (dto) out.dateTimeOriginal = dto;

  if (raw.location) {
    const { lat, long } = raw.location;
    if (
      typeof lat === 'number' &&
      typeof long === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(long) &&
      Math.abs(lat) <= 90 &&
      Math.abs(long) <= 180
    ) {
      out.location = { lat, long };
    }
  }

  return out;
}

/** True when an {@link ExifMetadata} carries no fields at all. */
export function isExifEmpty(exif: ExifMetadata): boolean {
  return Object.keys(exif).length === 0;
}
