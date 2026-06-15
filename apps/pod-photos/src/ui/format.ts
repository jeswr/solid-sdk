// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the photo-gallery view. No React, no RDF — just
// the name / dimensions / alt-text formatting the view renders. Kept separate so
// they are trivially unit-testable and reusable by any future view.

import type { Photo } from '../photos/photograph.js';
import { nameFromUrl } from '../pod/rdf.js';

/**
 * The display title for a photo: its `schema:name`, falling back to the photo
 * document's URL tail when the name is blank — so a tile always shows something
 * readable rather than an empty label.
 */
export function photoTitle(url: string, photo: Photo): string {
  const name = photo.name.trim();
  return name.length > 0 ? name : nameFromUrl(url);
}

/**
 * Accessible alt text for a photo's thumbnail: its title plus the keyword list
 * when present (e.g. `Sunset over the bay — sunset, bay`). Screen-reader-facing,
 * so it leans on the human-meaningful fields, never the raw URL alone.
 */
export function photoAltText(url: string, photo: Photo): string {
  const title = photoTitle(url, photo);
  if (photo.keywords.length === 0) {
    return title;
  }
  return `${title} — ${photo.keywords.join(', ')}`;
}

/**
 * `"W × H"` pixel dimensions for the caption, or `undefined` when the photo
 * carries no EXIF dimensions (the view then renders no dimension line rather
 * than a half-empty one).
 */
export function photoDimensions(photo: Photo): string | undefined {
  const { pixelWidth, pixelHeight } = photo.exif;
  if (pixelWidth === undefined || pixelHeight === undefined) {
    return undefined;
  }
  return `${pixelWidth} × ${pixelHeight}`;
}

/**
 * A user-facing message for a thrown value. The data layer rejects with an
 * `Error`, but a `catch` binds `unknown`; this normalises both (an Error's
 * `.message`, else the stringified value) into one display string — a pure,
 * directly-testable helper rather than an inline ternary in the hook.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
