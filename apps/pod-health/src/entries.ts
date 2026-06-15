// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Health read facade for a flat, render-friendly health-records list.
//
// A `HealthDocument` exposes its clinical entities as separate typed iterables
// (observations, conditions, medications, immunizations, workouts, records).
// A list VIEW wants ONE chronologically-orderable sequence of typed rows, each
// carrying just the display fields — date, type, a value/summary. This module
// is the SINGLE place that walks the typed @rdfjs/wrapper accessors and lifts
// them into plain `HealthEntry` records, so the view layer (src/ui) never
// touches RDF, the wrapper, or an IRI directly.
//
// It is intentionally render-shaped, not RDF-shaped: every field is a primitive
// (string | number | Date | undefined) extracted via the data layer's typed
// getters — never a hand-parsed literal. The view formats; this only extracts.
//
// WAC-aware reading itself stays in `readHealth` (src/store.ts); this operates
// on an already-read document.

import type { ActivityType, HealthDocument, ObservationKind } from "./model.js";

/** The kind of health entry a row represents (drives grouping + the icon). */
export type HealthEntryKind =
  | "Record"
  | "Observation"
  | "Condition"
  | "Medication"
  | "Immunization"
  | "Workout";

/**
 * One row in a health-records list — a typed, RDF-free projection of a clinical
 * entity. Every field is already a primitive lifted off the typed model; the
 * view renders these and never re-enters the data layer.
 */
export interface HealthEntry {
  /** The entity's subject IRI — a stable React key + the resource it points at. */
  readonly iri: string;
  /** Which clinical kind this row is (groups the list + selects the icon). */
  readonly kind: HealthEntryKind;
  /**
   * The effective date/time of the entry, when the model carries one (an
   * observation's effective instant, a workout's start). `undefined` when the
   * entity has no time — the view renders a dash, never a fabricated date.
   */
  readonly date: Date | undefined;
  /**
   * A short, human-meaningful type label (e.g. "Heart Rate", "Step Count",
   * "Run", "Health Record"). Distinct from `kind`, which is the coarse group.
   */
  readonly typeLabel: string;
  /** The measured numeric value, when the entity is a measurement. */
  readonly value: number | undefined;
  /** The UCUM unit code string for `value` (e.g. "/min", "m"), when present. */
  readonly unitCode: string | undefined;
  /**
   * The coding-scheme / clinical-code reference IRI summarising WHAT the entry
   * is about (a condition's diagnosis code, a medication's product, an
   * observation's code). A reference, never free-text patient content.
   */
  readonly codeRef: string | undefined;
}

/** Map an observation subtype to a friendly type label. */
function observationLabel(kind: ObservationKind | undefined): string {
  switch (kind) {
    case "HeartRate":
      return "Heart Rate";
    case "StepCount":
      return "Step Count";
    case "Sleep":
      return "Sleep";
    default:
      // A bare `health:Observation`, or a node with no recognised subtype.
      return "Observation";
  }
}

/** Map a workout activity type to a friendly type label. */
function workoutLabel(activity: ActivityType | undefined): string {
  // The activity-type union is already display-friendly; fall back for an
  // entity that carries no `ph:activityType` at all.
  return activity ?? "Workout";
}

/**
 * The effective `Date` of an observation, resolved through the document's
 * linked `time:Instant`. The observation stores its effective time as a
 * separate instant subject (`health:effectiveTime`); we resolve that instant's
 * `time:inXSDDateTimeStamp`. Interval effective times have no single instant
 * stamp, so they surface as `undefined` (the row shows a dash) — never a
 * guessed date.
 */
function observationDate(
  document: HealthDocument,
  effectiveTimeIri: string | undefined,
): Date | undefined {
  if (effectiveTimeIri === undefined) {
    return undefined;
  }
  return document.instant(effectiveTimeIri).dateTime;
}

/**
 * Flatten a read `HealthDocument` into a list of render-ready {@link HealthEntry}
 * rows, newest first. Each clinical iterable on the document is projected
 * through its typed getters; nothing is hand-parsed. Entries with no date sort
 * last (after the dated ones), so a freshly-minted record without a time never
 * jumps to the top.
 *
 * @param document a document already read via `readHealth` (this never fetches).
 */
export function listHealthEntries(document: HealthDocument): HealthEntry[] {
  const entries: HealthEntry[] = [];

  for (const record of document.records) {
    entries.push({
      iri: record.value,
      kind: "Record",
      // The record document itself carries no single effective time in the
      // model; its entries do. So the record row is dateless by design.
      date: undefined,
      typeLabel: "Health Record",
      value: undefined,
      unitCode: undefined,
      codeRef: record.patientSubject,
    });
  }

  for (const obs of document.observations) {
    entries.push({
      iri: obs.value,
      kind: "Observation",
      date: observationDate(document, obs.effectiveTime),
      typeLabel: observationLabel(obs.kind),
      value: obs.measuredValue,
      unitCode: obs.unitCode,
      codeRef: obs.code,
    });
  }

  for (const condition of document.conditions) {
    entries.push({
      iri: condition.value,
      kind: "Condition",
      date: undefined,
      typeLabel: "Condition",
      value: undefined,
      unitCode: undefined,
      codeRef: condition.code,
    });
  }

  for (const medication of document.medicationStatements) {
    entries.push({
      iri: medication.value,
      kind: "Medication",
      date: undefined,
      typeLabel: "Medication",
      value: undefined,
      unitCode: undefined,
      codeRef: medication.medication,
    });
  }

  for (const immunization of document.immunizations) {
    entries.push({
      iri: immunization.value,
      kind: "Immunization",
      date: undefined,
      typeLabel: "Immunization",
      value: undefined,
      unitCode: undefined,
      codeRef: immunization.vaccine,
    });
  }

  for (const workout of document.workouts) {
    entries.push({
      iri: workout.value,
      kind: "Workout",
      date: workout.startTime,
      typeLabel: workoutLabel(workout.activityType),
      value: workout.distance,
      // Workout distance is metres in the model (ph:distance, QUDT metre).
      unitCode: workout.distance === undefined ? undefined : "m",
      codeRef: undefined,
    });
  }

  // Newest first; dateless rows sort last (treated as -Infinity for a
  // descending sort) and tie-break by IRI so the order is deterministic.
  return entries.sort((a, b) => {
    const ta = a.date ? a.date.getTime() : Number.NEGATIVE_INFINITY;
    const tb = b.date ? b.date.getTime() : Number.NEGATIVE_INFINITY;
    if (ta !== tb) {
      return tb - ta;
    }
    // IRIs are unique per subject, so this fully orders the tie with no equal case.
    return a.iri < b.iri ? -1 : 1;
  });
}
