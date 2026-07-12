// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the file-browser view. No React, no RDF — just
// the size/date/name formatting the view renders. Kept separate so they are
// trivially unit-testable and reusable by any future view (a list AND a grid).

import type { DriveResource } from "../model.js";

/**
 * Human-readable byte size (e.g. `1.5 KB`). Returns `"—"` when the server did
 * not expose a `posix:size` (containers, or resources whose size is absent) so
 * the column always renders a value rather than `undefined`.
 */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // One decimal place, dropping a trailing ".0" so "2 MB" reads cleanly.
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/**
 * ISO-date (`YYYY-MM-DD`) for a modified timestamp, or `"—"` when absent.
 * Deliberately locale-independent (no `toLocaleString`) so the rendered value
 * is stable across environments and trivially assertable in a test.
 */
export function formatModified(date: Date | undefined): string {
  if (date === undefined) {
    return "—";
  }
  return date.toISOString().slice(0, 10);
}

/**
 * The label for a resource's "kind" column: `Folder` for a container, else the
 * `dcterms:format` content type, falling back to `File` when the server exposes
 * neither. Drives the icon + accessible row description in the view.
 */
export function formatKind(resource: DriveResource): string {
  if (resource.isContainer) {
    return "Folder";
  }
  return resource.contentType ?? "File";
}

/**
 * A user-facing message for a thrown value. `listContainer` rejects only with an
 * `Error`, but a catch binds `unknown`; this normalises both (an Error's
 * `.message`, else the stringified value) into one display string — kept here as
 * a pure, directly-testable helper rather than an inline ternary in the hook.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The display name for a resource. The model's `name` (from @solid/object's
 * `Resource.name`) already decodes the last path segment and falls back to the
 * host for a path-less pod root, so this is a thin, named alias the view reads —
 * keeping all name logic in one place should that fallback need to grow.
 */
export function displayName(resource: DriveResource): string {
  return resource.name;
}
