// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Health records VIEW — one chronological list of a person's health
// entries from a single pod resource: observations / vitals, conditions,
// medications, immunizations, workouts and the record itself, each row showing
// its date, type and value/summary.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It renders ONLY — it never touches RDF or
// fetch directly; all data flows through `useHealthRecords`, which calls the
// data layer (`readHealth` → `listHealthEntries`). Styling is plain class names
// (`pod-health-*`) so the host app's CSS owns the look; the component ships no
// styles of its own.
//
// PRIVACY: health data is sensitive. The view renders only the already-shaped,
// primitive display fields the data layer lifts off the typed model — and NEVER
// logs an entry, a value, or the resource body.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useHealthRecords` → the data layer. See useHealthRecords.ts for the full note.

import type { HealthEntry } from "../entries.js";
import { entryIcon, formatDate, formatValue } from "./format.js";
import { useHealthRecords } from "./useHealthRecords.js";

/** Props for {@link HealthRecords}. */
export interface HealthRecordsProps {
  /** The health resource URL to read (e.g. `https://carol.example/health/record.ttl`). */
  resourceUrl: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the list. */
  title?: string;
}

/** A single entry row. Render-only — every field is already a display primitive. */
function EntryRow({ entry }: { entry: HealthEntry }) {
  return (
    <tr className={`pod-health-row pod-health-row-${entry.kind.toLowerCase()}`}>
      <td className="pod-health-cell-type">
        <span aria-hidden="true">{entryIcon(entry)}</span> {entry.typeLabel}
      </td>
      <td className="pod-health-cell-date">{formatDate(entry.date)}</td>
      <td className="pod-health-cell-value">{formatValue(entry.value, entry.unitCode)}</td>
    </tr>
  );
}

/**
 * Render a Solid health resource as a chronological records list (newest
 * first). Each row is a typed health entry showing its type, effective date and
 * value/summary. Loading, empty, error and access-denied (401/403) states are
 * all handled.
 */
export function HealthRecords({ resourceUrl, fetch, title }: HealthRecordsProps) {
  const { entries, loading, error, isAccessError, loaded, refresh } = useHealthRecords(
    resourceUrl,
    fetch ? { fetch } : {},
  );

  return (
    <section className="pod-health-records" aria-label={title ?? "Health records"}>
      {title ? <h2 className="pod-health-title">{title}</h2> : null}

      {loading ? (
        <p className="pod-health-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-health-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && loaded && entries.length === 0 ? (
        <p className="pod-health-empty">No health records found.</p>
      ) : null}

      {!error && entries.length > 0 ? (
        <table className="pod-health-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <EntryRow key={entry.iri} entry={entry} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
