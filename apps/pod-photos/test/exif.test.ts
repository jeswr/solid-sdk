import { describe, expect, it } from 'vitest';
import {
  type ExifMetadata,
  dmsToDecimal,
  exifDateToIso,
  geoPointFromExif,
  isExifEmpty,
  normaliseExif,
} from '../src/photos/exif.js';

describe('exifDateToIso', () => {
  it('converts the EXIF colon date form to ISO-8601', () => {
    expect(exifDateToIso('2026:06:15 09:41:07')).toBe('2026-06-15T09:41:07.000Z');
  });

  it('accepts the EXIF form with a T separator', () => {
    expect(exifDateToIso('2026:06:15T09:41:07')).toBe('2026-06-15T09:41:07.000Z');
  });

  it('accepts an already-ISO UTC string', () => {
    expect(exifDateToIso('2026-06-15T09:41:07Z')).toBe('2026-06-15T09:41:07.000Z');
  });

  it('applies a positive timezone offset (not silently dropped)', () => {
    expect(exifDateToIso('2026-06-15T09:41:07+02:00')).toBe('2026-06-15T07:41:07.000Z');
  });

  it('applies a negative timezone offset', () => {
    expect(exifDateToIso('2026-06-15T09:41:07-05:00')).toBe('2026-06-15T14:41:07.000Z');
  });

  it('honours fractional seconds with a zone', () => {
    expect(exifDateToIso('2026-06-15T09:41:07.250Z')).toBe('2026-06-15T09:41:07.250Z');
  });

  it('reads an offset-less ISO string as UTC', () => {
    expect(exifDateToIso('2026-06-15T09:41:07')).toBe('2026-06-15T09:41:07.000Z');
  });

  it('rejects a zoned ISO string that is not a real instant', () => {
    expect(exifDateToIso('2026-13-15T09:41:07Z')).toBeUndefined();
  });

  it('rejects a zoned ISO string with a rolled-over calendar day (no silent roll)', () => {
    // 2026-06-31 is not a real date; the zoned path must reject it, not roll to
    // July 1 the way `new Date(...)` alone would.
    expect(exifDateToIso('2026-06-31T09:41:07Z')).toBeUndefined();
    expect(exifDateToIso('2026-06-15T25:00:00+02:00')).toBeUndefined();
  });

  it('rejects a zoned ISO string with an out-of-range offset', () => {
    // The wall clock is valid but the offset (+25:00) is not — Date yields NaN.
    expect(exifDateToIso('2026-06-15T09:41:07+25:00')).toBeUndefined();
  });

  it('returns undefined for undefined / empty / whitespace', () => {
    expect(exifDateToIso(undefined)).toBeUndefined();
    expect(exifDateToIso('')).toBeUndefined();
    expect(exifDateToIso('   ')).toBeUndefined();
  });

  it('returns undefined for a non-date string', () => {
    expect(exifDateToIso('not a date')).toBeUndefined();
  });

  it('rejects an out-of-range EXIF month (no silent roll-over)', () => {
    expect(exifDateToIso('2026:13:15 09:41:07')).toBeUndefined();
  });

  it('rejects an out-of-range EXIF day', () => {
    expect(exifDateToIso('2026:02:30 09:41:07')).toBeUndefined();
  });

  it('rejects a malformed ISO-prefixed string that Date cannot parse', () => {
    expect(exifDateToIso('2026-13-40T99:99:99')).toBeUndefined();
  });
});

describe('dmsToDecimal', () => {
  it('converts a northern/eastern coordinate to positive decimal', () => {
    expect(dmsToDecimal({ degrees: 51, minutes: 30, seconds: 0, ref: 'N' })).toBeCloseTo(51.5, 6);
    expect(dmsToDecimal({ degrees: 0, minutes: 7, seconds: 12, ref: 'E' })).toBeCloseTo(0.12, 6);
  });

  it('negates a southern coordinate', () => {
    expect(dmsToDecimal({ degrees: 33, minutes: 51, seconds: 0, ref: 'S' })).toBeCloseTo(-33.85, 6);
  });

  it('negates a western coordinate', () => {
    expect(dmsToDecimal({ degrees: 122, minutes: 0, seconds: 0, ref: 'W' })).toBe(-122);
  });

  it('returns undefined for a negative component', () => {
    expect(dmsToDecimal({ degrees: -1, minutes: 0, seconds: 0, ref: 'N' })).toBeUndefined();
    expect(dmsToDecimal({ degrees: 1, minutes: -1, seconds: 0, ref: 'N' })).toBeUndefined();
    expect(dmsToDecimal({ degrees: 1, minutes: 0, seconds: -1, ref: 'N' })).toBeUndefined();
  });

  it('returns undefined for a non-finite component', () => {
    expect(dmsToDecimal({ degrees: Number.NaN, minutes: 0, seconds: 0, ref: 'N' })).toBeUndefined();
  });

  it('rejects sexagesimal minutes / seconds at or above 60 (corrupt tag)', () => {
    expect(dmsToDecimal({ degrees: 1, minutes: 60, seconds: 0, ref: 'N' })).toBeUndefined();
    expect(dmsToDecimal({ degrees: 1, minutes: 0, seconds: 60, ref: 'N' })).toBeUndefined();
  });

  it('accepts minutes / seconds just below 60', () => {
    expect(dmsToDecimal({ degrees: 0, minutes: 59, seconds: 59, ref: 'E' })).toBeGreaterThan(0);
  });
});

describe('geoPointFromExif', () => {
  const lat = { degrees: 51, minutes: 30, seconds: 0, ref: 'N' } as const;
  const long = { degrees: 0, minutes: 7, seconds: 12, ref: 'W' } as const;

  it('builds a valid point from lat + long DMS', () => {
    const p = geoPointFromExif(lat, long);
    expect(p?.lat).toBeCloseTo(51.5, 6);
    expect(p?.long).toBeCloseTo(-0.12, 6);
  });

  it('returns undefined when either coordinate is missing', () => {
    expect(geoPointFromExif(undefined, long)).toBeUndefined();
    expect(geoPointFromExif(lat, undefined)).toBeUndefined();
  });

  it('returns undefined when a DMS component is invalid', () => {
    expect(geoPointFromExif({ ...lat, minutes: -1 }, long)).toBeUndefined();
  });

  it('rejects an out-of-range latitude', () => {
    expect(
      geoPointFromExif({ degrees: 200, minutes: 0, seconds: 0, ref: 'N' }, long),
    ).toBeUndefined();
  });

  it('rejects an out-of-range longitude', () => {
    expect(
      geoPointFromExif(lat, { degrees: 200, minutes: 0, seconds: 0, ref: 'E' }),
    ).toBeUndefined();
  });

  it('rejects a latitude carrying a longitude ref (wrong axis)', () => {
    expect(
      geoPointFromExif({ degrees: 51, minutes: 30, seconds: 0, ref: 'E' }, long),
    ).toBeUndefined();
  });

  it('rejects a longitude carrying a latitude ref (wrong axis)', () => {
    expect(
      geoPointFromExif(lat, { degrees: 0, minutes: 7, seconds: 12, ref: 'N' }),
    ).toBeUndefined();
  });
});

describe('normaliseExif', () => {
  it('keeps all valid fields', () => {
    const exif = normaliseExif({
      make: ' FUJIFILM ',
      model: 'X-T5',
      lensModel: 'XF 35mm',
      focalLengthMm: 35,
      fNumber: 2.8,
      exposureTimeSec: 0.004,
      iso: 400,
      pixelWidth: 6240,
      pixelHeight: 4160,
      orientation: 1,
      dateTimeOriginal: '2026:06:15 09:41:07',
      location: { lat: 51.5, long: -0.12 },
    });
    expect(exif).toEqual({
      make: 'FUJIFILM',
      model: 'X-T5',
      lensModel: 'XF 35mm',
      focalLengthMm: 35,
      fNumber: 2.8,
      exposureTimeSec: 0.004,
      iso: 400,
      pixelWidth: 6240,
      pixelHeight: 4160,
      orientation: 1,
      dateTimeOriginal: '2026-06-15T09:41:07.000Z',
      location: { lat: 51.5, long: -0.12 },
    });
  });

  it('drops a blank/whitespace string field', () => {
    expect(normaliseExif({ make: '   ', model: '' }).make).toBeUndefined();
    expect(normaliseExif({ model: '' }).model).toBeUndefined();
  });

  it('drops a non-string string field', () => {
    expect(normaliseExif({ make: 123 as unknown as string }).make).toBeUndefined();
  });

  it('drops non-positive / non-finite numeric fields', () => {
    const exif = normaliseExif({
      focalLengthMm: 0,
      fNumber: -1,
      exposureTimeSec: Number.NaN,
    });
    expect(exif.focalLengthMm).toBeUndefined();
    expect(exif.fNumber).toBeUndefined();
    expect(exif.exposureTimeSec).toBeUndefined();
  });

  it('keeps ISO 0 but drops a negative or fractional ISO', () => {
    expect(normaliseExif({ iso: 0 }).iso).toBe(0);
    expect(normaliseExif({ iso: -10 }).iso).toBeUndefined();
    expect(normaliseExif({ iso: 12.5 }).iso).toBeUndefined();
  });

  it('drops fractional pixel dimensions', () => {
    const exif = normaliseExif({ pixelWidth: 100.5, pixelHeight: 200.25 });
    expect(exif.pixelWidth).toBeUndefined();
    expect(exif.pixelHeight).toBeUndefined();
  });

  it('keeps an orientation in 1..8 and drops out-of-range / fractional', () => {
    expect(normaliseExif({ orientation: 8 }).orientation).toBe(8);
    expect(normaliseExif({ orientation: 0 }).orientation).toBeUndefined();
    expect(normaliseExif({ orientation: 9 }).orientation).toBeUndefined();
    expect(normaliseExif({ orientation: 1.5 }).orientation).toBeUndefined();
    expect(normaliseExif({ orientation: 'x' as unknown as number }).orientation).toBeUndefined();
  });

  it('drops an invalid EXIF date', () => {
    expect(normaliseExif({ dateTimeOriginal: 'nope' }).dateTimeOriginal).toBeUndefined();
  });

  it('drops an out-of-range location', () => {
    expect(normaliseExif({ location: { lat: 200, long: 0 } }).location).toBeUndefined();
    expect(normaliseExif({ location: { lat: 0, long: 200 } }).location).toBeUndefined();
  });

  it('drops a non-finite location', () => {
    expect(normaliseExif({ location: { lat: Number.NaN, long: 0 } }).location).toBeUndefined();
  });

  it('drops a location whose coords are the wrong type', () => {
    expect(
      normaliseExif({ location: { lat: '1' as unknown as number, long: 0 } }).location,
    ).toBeUndefined();
  });

  it('yields an empty object for empty input', () => {
    expect(normaliseExif({})).toEqual({});
  });
});

describe('isExifEmpty', () => {
  it('is true for an empty metadata object', () => {
    expect(isExifEmpty({})).toBe(true);
  });
  it('is false when any field is present', () => {
    const exif: ExifMetadata = { make: 'X' };
    expect(isExifEmpty(exif)).toBe(false);
  });
});
