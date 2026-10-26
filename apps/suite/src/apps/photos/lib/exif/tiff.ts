// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExifOrientation } from "../library/orientation";
import { requireExif } from "./error";

export interface ExifMetadata {
  /** Validated EXIF civil time, YYYY:MM:DD HH:mm:ss. No timezone is inferred. */
  dateTimeOriginal?: string;
  /** Validated signed HH:mm offset, preserved separately from the civil time. */
  offsetTimeOriginal?: string;
  orientation?: ExifOrientation;
  make?: string;
  model?: string;
  /** Stored pixel dimensions, before applying orientation. ExifIFD takes precedence. */
  width?: number;
  height?: number;
  gps?: { latitude: number; longitude: number };
}

interface Entry {
  type: number;
  count: number;
  offset: number;
}
type Directory = Map<number, Entry>;
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

class TiffReader {
  private readonly view: DataView;
  private readonly little: boolean;
  private readonly visited = new Set<number>();
  private readonly pending: number[] = [];
  private readonly tables: [number, number][] = [[0, 8]];
  private readonly payloads: [number, number][] = [];

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.bounds(0, 8);
    const order = this.view.getUint16(0);
    requireExif(order === 0x4949 || order === 0x4d4d, "invalid-tiff");
    this.little = order === 0x4949;
    requireExif(this.u16(2) === 42, "invalid-tiff");
  }

  private bounds(offset: number, length: number): void {
    requireExif(offset <= this.view.byteLength - length, "out-of-bounds");
  }

  private u16(offset: number): number {
    this.bounds(offset, 2);
    return this.view.getUint16(offset, this.little);
  }

  private u32(offset: number): number {
    this.bounds(offset, 4);
    return this.view.getUint32(offset, this.little);
  }

  private external(offset: number, length: number): void {
    requireExif(offset >= 8 && offset % 2 === 0, "invalid-ifd");
    this.bounds(offset, length);
  }

  directory(offset = this.u32(4)): Directory {
    this.external(offset, 2);
    requireExif(!this.visited.has(offset), "invalid-ifd");
    this.visited.add(offset);
    const count = this.u16(offset);
    const end = offset + 2 + count * 12 + 4;
    this.bounds(offset, end - offset);
    this.tables.push([offset, end]);
    const entries: Directory = new Map();
    for (let i = 0; i < count; i++) {
      const position = offset + 2 + i * 12;
      const tag = this.u16(position);
      requireExif(!entries.has(tag), "invalid-ifd");
      const type = this.u16(position + 2);
      const size = TYPE_SIZES[type];
      requireExif(size, "unsupported-type");
      const length = this.u32(position + 4);
      requireExif(length > 0, "invalid-tag");
      const byteLength = length * size;
      const value = byteLength <= 4 ? position + 8 : this.u32(position + 8);
      if (byteLength > 4) {
        this.external(value, byteLength);
        this.payloads.push([value, value + byteLength]);
      }
      entries.set(tag, { type, count: length, offset: value });
    }
    const next = this.u32(end - 4);
    if (next !== 0) this.pending.push(next);
    return entries;
  }

  child(parent: Directory, tag: number): Directory {
    const entry = parent.get(tag);
    return entry ? this.directory(this.integer(entry, [4])) : new Map();
  }

  /** Iterative traversal also checks thumbnail chains without reading them as primary metadata. */
  finish(): void {
    for (let i = 0; i < this.pending.length; i++) {
      this.directory(this.pending[i]);
    }
    const tables = this.tables.sort((a, b) => a[0] - b[0]);
    let previousEnd = 0;
    for (const [start, end] of tables) {
      requireExif(start >= previousEnd, "invalid-ifd");
      previousEnd = end;
    }
    for (const [start, end] of this.payloads) {
      requireExif(
        tables.every(([tableStart, tableEnd]) => end <= tableStart || start >= tableEnd),
        "invalid-ifd",
      );
    }
  }

  integer(entry: Entry, types: readonly number[]): number {
    requireExif(types.includes(entry.type) && entry.count === 1, "invalid-tag");
    return entry.type === 3 ? this.u16(entry.offset) : this.u32(entry.offset);
  }

  ascii(entry: Entry): string {
    requireExif(entry.type === 2, "invalid-tag");
    requireExif(this.view.getUint8(entry.offset + entry.count - 1) === 0, "invalid-tag");
    let result = "";
    for (let i = 0; i < entry.count - 1; i++) {
      const byte = this.view.getUint8(entry.offset + i);
      requireExif(byte >= 0x20 && byte <= 0x7e, "invalid-tag");
      result += String.fromCharCode(byte);
    }
    return result;
  }

  coordinate(value: Entry, reference: Entry, positive: string, negative: string, max: number) {
    requireExif(value.type === 5 && value.count === 3, "invalid-tag");
    const ref = this.ascii(reference);
    requireExif(ref === positive || ref === negative, "invalid-tag");
    const components = [0, 1, 2].map((i) => {
      const denominator = this.u32(value.offset + i * 8 + 4);
      requireExif(denominator !== 0, "invalid-tag");
      return this.u32(value.offset + i * 8) / denominator;
    });
    const [degrees, minutes, seconds] = components as [number, number, number];
    requireExif(minutes < 60 && seconds < 60, "invalid-tag");
    const decimal = degrees + minutes / 60 + seconds / 3600;
    requireExif(decimal <= max, "invalid-tag");
    // Avoid returning -0 for a coordinate on the equator or prime meridian.
    return ref === positive || decimal === 0 ? decimal : -decimal;
  }
}

function dateTime(value: string): string {
  requireExif(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(value), "invalid-tag");
  const [year, month, day, hour, minute, second] = value.split(/[: ]/).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireExif(
    year > 0 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= Number(days[month - 1]) &&
      hour < 24 &&
      minute < 60 &&
      second < 60,
    "invalid-tag",
  );
  return value;
}

export function readTiff(bytes: Uint8Array): ExifMetadata {
  const reader = new TiffReader(bytes);
  const root = reader.directory();
  const exif = reader.child(root, 0x8769);
  const gps = reader.child(root, 0x8825);
  reader.finish();
  const result: ExifMetadata = {};
  for (const [tag, key] of [
    [0x010f, "make"],
    [0x0110, "model"],
  ] as const) {
    const entry = root.get(tag);
    if (entry) result[key] = reader.ascii(entry);
  }
  const orientation = root.get(0x0112);
  if (orientation) {
    const value = reader.integer(orientation, [3]);
    requireExif(value >= 1 && value <= 8, "invalid-tag");
    result.orientation = value as ExifOrientation;
  }
  for (const [tag, fallback, key] of [
    [0xa002, 0x0100, "width"],
    [0xa003, 0x0101, "height"],
  ] as const) {
    // Validate both sources even when ExifIFD supplies the preferred value.
    for (const entry of [root.get(fallback), exif.get(tag)]) {
      if (entry) {
        const value = reader.integer(entry, [3, 4]);
        requireExif(value > 0, "invalid-tag");
        result[key] = value;
      }
    }
  }
  const date = exif.get(0x9003);
  if (date) result.dateTimeOriginal = dateTime(reader.ascii(date));
  const offset = exif.get(0x9011);
  if (offset) {
    const value = reader.ascii(offset);
    requireExif(/^[+-](?:[01]\d|2[0-3]):[0-5]\d$/.test(value), "invalid-tag");
    result.offsetTimeOriginal = value;
  }
  const lat = gps.get(2);
  const latRef = gps.get(1);
  const lon = gps.get(4);
  const lonRef = gps.get(3);
  if (lat || latRef || lon || lonRef) {
    requireExif(lat && latRef && lon && lonRef, "invalid-tag");
    result.gps = {
      latitude: reader.coordinate(lat, latRef, "N", "S", 90),
      longitude: reader.coordinate(lon, lonRef, "E", "W", 180),
    };
  }
  return result;
}
