// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the document-browser view. No React, no RDF —
// just the name / date / format formatting the view renders. Kept separate so
// they are trivially unit-testable and reusable by any future view (a list AND
// a grid AND the open-document header).

import type { DocumentEntry } from "../store.js";

/**
 * The display name for a document listing row: its `dct:title` when the document
 * carries one, else the friendly `name` (the URL tail) the container listing
 * provides — so the row never renders an empty cell for an untitled document.
 */
export function displayTitle(entry: Pick<DocumentEntry, "title" | "name">): string {
  const title = entry.title.trim();
  return title.length > 0 ? title : entry.name;
}

/**
 * ISO-date (`YYYY-MM-DD`) for a modified timestamp, or `"—"` when absent or
 * unparseable. Deliberately locale-independent (no `toLocaleString`) so the
 * rendered value is stable across environments and trivially assertable in a
 * test. The stamp arrives as an ISO-8601 string from the data layer.
 */
export function formatModified(modified: string | undefined): string {
  if (modified === undefined) {
    return "—";
  }
  const ms = Date.parse(modified);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A user-facing message for a thrown value. The data layer rejects with typed
 * `Error`s, but a `catch` binds `unknown`; this normalises both (an `Error`'s
 * `.message`, else the stringified value) into one display string — kept here
 * as a pure, directly-testable helper rather than an inline ternary in the hook.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
