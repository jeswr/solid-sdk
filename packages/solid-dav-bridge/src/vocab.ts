// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The vocabularies this bridge writes — schema.org for the event itself, and the
 * W3C RDF-iCal vocab for iCalendar fields schema.org lacks (esp. the raw
 * `RRULE`), plus the RDF/XSD terms the typed-quad construction needs.
 *
 * No new vocabulary is invented: schema:Event is the suite's established calendar
 * model and `http://www.w3.org/2002/12/cal/ical#` is the standard W3C iCalendar
 * RDF mapping (an event is typed BOTH `schema:Event` and `ical:Vevent` so a
 * reader that knows either vocabulary finds it).
 */

/** schema.org namespace (https, the canonical form). */
export const SCHEMA = "https://schema.org/" as const;
/** The W3C RDF-iCal namespace (RFC 2445/5545 mapped to RDF). */
export const ICAL = "http://www.w3.org/2002/12/cal/ical#" as const;
/** RDF namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;
/** XSD namespace. */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

// --- schema.org event terms ---
export const SCHEMA_EVENT = `${SCHEMA}Event` as const;
export const SCHEMA_PLACE = `${SCHEMA}Place` as const;
export const SCHEMA_NAME = `${SCHEMA}name` as const;
export const SCHEMA_DESCRIPTION = `${SCHEMA}description` as const;
export const SCHEMA_IDENTIFIER = `${SCHEMA}identifier` as const;
export const SCHEMA_START_DATE = `${SCHEMA}startDate` as const;
export const SCHEMA_END_DATE = `${SCHEMA}endDate` as const;
export const SCHEMA_LOCATION = `${SCHEMA}location` as const;
export const SCHEMA_URL = `${SCHEMA}url` as const;

// --- W3C RDF-iCal terms (fields schema.org lacks / typing) ---
export const ICAL_VEVENT = `${ICAL}Vevent` as const;
/** The raw RRULE recurrence string (carried verbatim; not expanded in phase 1). */
export const ICAL_RRULE = `${ICAL}rrule` as const;
/** The original TZID of a local DATE-TIME, when the source carried one. */
export const ICAL_TZID = `${ICAL}tzid` as const;
/** The iCalendar UID, kept under the iCal vocab in addition to schema:identifier. */
export const ICAL_UID = `${ICAL}uid` as const;

/** The Turtle prefixes used when serialising events. */
export const EVENT_PREFIXES: Record<string, string> = {
  schema: SCHEMA,
  ical: ICAL,
  rdf: RDF,
  xsd: XSD,
};

/**
 * True for an absolute `http(s)` URL usable as an IRI object. Untrusted input
 * (a `javascript:` / `mailto:` / `urn:` / bare string) is rejected so it is
 * never coerced into a malformed `NamedNode`. (Same predicate semantics as
 * `@jeswr/solid-task-model`'s `isHttpIri`, inlined here to keep this module a
 * small, dependency-light spec.)
 */
export function isHttpIri(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
