// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ExifMetadata } from "../exif";
import { isRecord, isText, requireAlbum } from "./error";

export interface PhotoMetadata extends Pick<ExifMetadata, "make" | "model" | "gps"> {
  readonly id: string;
  /** Resolved UTC epoch milliseconds. No timezone or missing-date fallback is inferred. */
  readonly takenAt?: number;
}

export type SmartAlbumPredicate =
  | { readonly kind: "date-range"; readonly start: number; readonly end: number }
  | { readonly kind: "camera"; readonly make?: string; readonly model?: string }
  | { readonly kind: "has-gps"; readonly value: boolean };

function isInstant(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 8.64e15;
}

function validatePredicate(predicate: SmartAlbumPredicate): void {
  requireAlbum(isRecord(predicate), "invalid-predicate");
  switch (predicate.kind) {
    case "date-range":
      requireAlbum(
        isInstant(predicate.start) && isInstant(predicate.end) && predicate.start <= predicate.end,
        "invalid-predicate",
      );
      return;
    case "camera":
      requireAlbum(
        predicate.make !== undefined || predicate.model !== undefined,
        "invalid-predicate",
      );
      requireAlbum(predicate.make === undefined || isText(predicate.make), "invalid-predicate");
      requireAlbum(predicate.model === undefined || isText(predicate.model), "invalid-predicate");
      return;
    case "has-gps":
      requireAlbum(typeof predicate.value === "boolean", "invalid-predicate");
      return;
    default:
      requireAlbum(false, "invalid-predicate");
  }
}

function validateMetadata(photo: PhotoMetadata): void {
  requireAlbum(isRecord(photo) && isText(photo.id), "invalid-metadata");
  requireAlbum(photo.takenAt === undefined || isInstant(photo.takenAt), "invalid-metadata");
  requireAlbum(photo.make === undefined || isText(photo.make), "invalid-metadata");
  requireAlbum(photo.model === undefined || isText(photo.model), "invalid-metadata");
  if (photo.gps !== undefined) {
    requireAlbum(isRecord(photo.gps), "invalid-metadata");
    requireAlbum(
      typeof photo.gps.latitude === "number" &&
        Number.isFinite(photo.gps.latitude) &&
        Math.abs(photo.gps.latitude) <= 90 &&
        typeof photo.gps.longitude === "number" &&
        Number.isFinite(photo.gps.longitude) &&
        Math.abs(photo.gps.longitude) <= 180,
      "invalid-metadata",
    );
  }
}

function matches(photo: PhotoMetadata, predicate: SmartAlbumPredicate): boolean {
  switch (predicate.kind) {
    case "date-range":
      return (
        photo.takenAt !== undefined &&
        photo.takenAt >= predicate.start &&
        photo.takenAt <= predicate.end
      );
    case "camera":
      return (
        (predicate.make === undefined || photo.make === predicate.make) &&
        (predicate.model === undefined || photo.model === predicate.model)
      );
    case "has-gps":
      return (photo.gps !== undefined) === predicate.value;
  }
}

/**
 * AND all predicates, preserving input order and records. Empty predicates match all.
 * Date bounds are inclusive; camera fields match exactly and missing fields never match.
 * Validate the entire input before matching, even records excluded by another predicate.
 */
export function smartAlbum<T extends PhotoMetadata>(
  photos: readonly T[],
  predicates: readonly SmartAlbumPredicate[],
): T[] {
  requireAlbum(Array.isArray(photos), "invalid-metadata");
  requireAlbum(Array.isArray(predicates), "invalid-predicate");
  for (const predicate of predicates) validatePredicate(predicate);
  const ids = new Set<string>();
  for (const photo of photos) {
    validateMetadata(photo);
    requireAlbum(!ids.has(photo.id), "duplicate-member");
    ids.add(photo.id);
  }
  return photos.filter((photo) => predicates.every((predicate) => matches(photo, predicate)));
}
