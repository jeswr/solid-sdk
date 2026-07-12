// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the health-records view. No React, no RDF —
// just the date/value/name formatting the view renders. Kept separate so they
// are trivially unit-testable and reusable by any future view (a list AND a
// timeline). Health data is sensitive: these helpers shape values for display
// and NEVER log them.

import type { HealthEntry } from "../entries.js";

/**
 * ISO-date (`YYYY-MM-DD`) for an effective timestamp, or `"—"` when absent.
 * Deliberately locale-independent (no `toLocaleString`) so the rendered value
 * is stable across environments and trivially assertable in a test. Guards
 * against an invalid `Date` (NaN time) by treating it as absent, so a bad
 * stamp renders a dash rather than the literal "Invalid Date".
 */
export function formatDate(date: Date | undefined): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toISOString().slice(0, 10);
}

/**
 * The value column for an entry: the numeric measurement plus its unit code
 * (e.g. `72 /min`, `5000 m`), the bare number when there is no unit, or `"—"`
 * when the entry carries no value at all (a record, condition, medication).
 * Numbers are rendered with `Intl.NumberFormat` (locale-independent "en-US")
 * so large counts read cleanly without leaking any user string.
 */
export function formatValue(value: number | undefined, unitCode: string | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const num = new Intl.NumberFormat("en-US").format(value);
  return unitCode ? `${num} ${unitCode}` : num;
}

/**
 * A user-facing message for a thrown value. `readHealth` rejects with an
 * `RdfFetchError` (an `Error`), but a catch binds `unknown`; this normalises
 * both (an Error's `.message`, else a generic string) into one display string.
 *
 * Deliberately does NOT stringify an arbitrary non-Error throw: a raw value
 * could carry health content, and this string is rendered. An unknown throw
 * gets a fixed generic message instead of `String(err)`.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not load health records.";
}

/** A small emoji icon per entry kind — decorative only (aria-hidden in the view). */
export function entryIcon(entry: HealthEntry): string {
  switch (entry.kind) {
    case "Record":
      return "🗂️";
    case "Observation":
      return "📈";
    case "Condition":
      return "🩺";
    case "Medication":
      return "💊";
    case "Immunization":
      return "💉";
    case "Workout":
      return "🏃";
    default:
      // Unreachable for the closed union, but keeps the switch total + gives a
      // safe fallback should the data layer add a kind before the view does.
      return "•";
  }
}
