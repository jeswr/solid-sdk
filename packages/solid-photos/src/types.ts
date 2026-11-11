// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { ExifMetadata } from "./exif.js";

/** A photo as the UI works with it (plain, serialisable). */
export interface Photo {
  /** Display title — `schema:name`. */
  name: string;
  /** Optional caption — `schema:description`. */
  description?: string;
  /** URL of the actual image binary — `schema:contentUrl` (an IRI). */
  contentUrl: string;
  thumbnailUrl?: string;
  created?: string;
  modified?: string;
  /** Free-text tags — `schema:keywords` (deduped, order-preserving). */
  keywords: string[];
  /** Validated/normalised technical EXIF metadata. */
  exif: ExifMetadata;
}
