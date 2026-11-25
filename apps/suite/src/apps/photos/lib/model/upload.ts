// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parse } from "exifr";
import { formatDuration } from "./duration.js";
import { type ExifMetadata, normaliseExif } from "./exif.js";
import { readVideoMetadata, stripVideoLocation } from "./mp4.js";
import type { Photo } from "./photograph.js";
import { httpIri, identifier, isoDate } from "./validation.js";

/** exifr is configured to retain numeric orientation and EXIF wall-clock dates. */
export function mapExif(tags: Record<string, unknown>): ExifMetadata {
  const raw: ExifMetadata = {};
  for (const [source, target] of [
    ["Make", "make"],
    ["Model", "model"],
    ["LensModel", "lensModel"],
  ] as const) {
    const value = tags[source];
    if (typeof value === "string") raw[target] = value;
  }
  for (const [source, target] of [
    ["FocalLength", "focalLengthMm"],
    ["FNumber", "fNumber"],
    ["ExposureTime", "exposureTimeSec"],
    ["ISO", "iso"],
    ["ExifImageWidth", "pixelWidth"],
    ["ExifImageHeight", "pixelHeight"],
    ["Orientation", "orientation"],
  ] as const) {
    const value = tags[source];
    if (typeof value === "number") raw[target] = value;
  }
  const date = tags.DateTimeOriginal;
  if (typeof date === "string") raw.dateTimeOriginal = date;
  if (date instanceof Date && Number.isFinite(date.getTime()))
    raw.dateTimeOriginal = date.toISOString();
  if (typeof tags.latitude === "number" && typeof tags.longitude === "number") {
    raw.location = { lat: tags.latitude, long: tags.longitude };
  }
  return normaliseExif(raw);
}

export async function readExif(bytes: ArrayBuffer): Promise<ExifMetadata> {
  // exifr 7 has no WebP reader. Let the encoder validate/decode these images;
  // omit their metadata rather than failing the upload on an unsupported container.
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  if (
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP"
  )
    return {};
  const tags: Record<string, unknown> | undefined = await parse(bytes, {
    translateValues: false,
    reviveValues: false,
  });
  return mapExif(tags ?? {});
}

export interface Dimensions {
  width: number;
  height: number;
  durationSeconds?: number | undefined;
}
export interface ThumbnailPlan extends Dimensions {
  /** Apply this raw EXIF orientation once, including reflection for 2/4/5/7. */
  orientation: number;
  contentType: "image/webp";
}
export interface ImageEncoder {
  /** Return raw pixel dimensions; do not apply automatic orientation. */
  dimensions(original: Blob): Promise<Dimensions>;
  /** Apply orientation once, resize, and emit WebP without EXIF/GPS metadata. */
  thumbnail(original: Blob, plan: ThumbnailPlan): Promise<Blob>;
  /** Remove all location metadata, preserving pixels, orientation and media type. */
  stripLocation(original: Blob): Promise<Blob>;
}

/** Long edge at most 320px; never upscale, preserve aspect ratio after rotation. */
export function thumbnailPlan(width: number, height: number, orientation = 1): ThumbnailPlan {
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value > 0) ||
    !Number.isInteger(orientation) ||
    orientation < 1 ||
    orientation > 8
  ) {
    throw new TypeError("Invalid image dimensions or orientation");
  }
  if (orientation >= 5) [width, height] = [height, width];
  const scale = Math.min(1, 320 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    orientation,
    contentType: "image/webp",
  };
}

export interface PreparedPhoto {
  itemUrl: string;
  photo: Photo;
  original: Blob;
  thumbnail: Blob;
  plan: ThumbnailPlan;
}
/** Details from outside the file (e.g. a Google Takeout sidecar), used only where EXIF has none. */
export interface CaptureMetadata {
  dateTimeOriginal?: string;
  location?: { lat: number; long: number };
  description?: string;
}
export interface UploadInput {
  id: string;
  name: string;
  original: Blob;
  stripLocation: boolean;
  metadata?: CaptureMetadata | undefined;
}

/** Pure orchestration with an injected encoder; no DOM, clock or random IDs. */
export async function preparePhoto(
  storage: string,
  input: UploadInput,
  encoder: ImageEncoder,
  now: string,
): Promise<PreparedPhoto> {
  const base = httpIri(storage);
  if (!base.endsWith("/") || new URL(base).hash || new URL(base).search)
    throw new TypeError("Expected a storage container URL");
  const root = new URL(base).href;
  const id = identifier(input.id);
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/tiff": "tif",
    "image/heic": "heic",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  const extension = extensions[input.original.type];
  if (!extension) throw new TypeError("Unsupported photo or video media type");
  const created = isoDate(now);
  const video = input.original.type.startsWith("video/");
  const movieBytes =
    video && input.original.type !== "video/webm" ? await input.original.arrayBuffer() : undefined;
  const movie = movieBytes ? readVideoMetadata(movieBytes) : {};
  const read: ExifMetadata = video ? {} : await readExif(await input.original.arrayBuffer());
  if (movie.created) read.dateTimeOriginal = movie.created;
  if (movie.location) read.location = movie.location;
  const extra = input.metadata;
  // The file's own EXIF wins; outside details only fill gaps, and are validated alike.
  const dateTimeOriginal = read.dateTimeOriginal ?? extra?.dateTimeOriginal;
  const location = read.location ?? extra?.location;
  const exif = normaliseExif({
    ...read,
    ...(dateTimeOriginal ? { dateTimeOriginal } : {}),
    ...(location ? { location } : {}),
  });
  const dimensions = await encoder.dimensions(input.original);
  const durationSeconds = video ? (movie.durationSeconds ?? dimensions.durationSeconds) : undefined;
  if (durationSeconds !== undefined) formatDuration(durationSeconds);
  const plan = thumbnailPlan(dimensions.width, dimensions.height, exif.orientation);
  exif.pixelWidth = dimensions.width;
  exif.pixelHeight = dimensions.height;
  const original = input.stripLocation
    ? movieBytes
      ? new Blob([stripVideoLocation(movieBytes)], { type: input.original.type })
      : await encoder.stripLocation(input.original)
    : input.original;
  if (input.stripLocation) delete exif.location;
  const thumbnail = await encoder.thumbnail(original, plan);
  if (thumbnail.type !== "image/webp" || original.type !== input.original.type)
    throw new TypeError("Encoder returned an unexpected media type");
  return {
    itemUrl: `${root}photos/items/${id}.ttl`,
    photo: {
      ...(video ? { kind: "video" as const } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      name: input.name,
      ...(extra?.description?.trim() ? { description: extra.description.trim() } : {}),
      contentUrl: `${root}photos/originals/${id}.${extension}`,
      thumbnailUrl: `${root}photos/thumbs/${id}.webp`,
      keywords: [],
      exif,
      created,
      modified: created,
    },
    original,
    thumbnail,
    plan,
  };
}
