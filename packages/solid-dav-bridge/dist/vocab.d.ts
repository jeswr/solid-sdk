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
export declare const SCHEMA: "https://schema.org/";
/** The W3C RDF-iCal namespace (RFC 2445/5545 mapped to RDF). */
export declare const ICAL: "http://www.w3.org/2002/12/cal/ical#";
/** RDF namespace. */
export declare const RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD namespace. */
export declare const XSD: "http://www.w3.org/2001/XMLSchema#";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export declare const SCHEMA_EVENT: "https://schema.org/Event";
export declare const SCHEMA_PLACE: "https://schema.org/Place";
export declare const SCHEMA_NAME: "https://schema.org/name";
export declare const SCHEMA_DESCRIPTION: "https://schema.org/description";
export declare const SCHEMA_IDENTIFIER: "https://schema.org/identifier";
export declare const SCHEMA_START_DATE: "https://schema.org/startDate";
export declare const SCHEMA_END_DATE: "https://schema.org/endDate";
export declare const SCHEMA_LOCATION: "https://schema.org/location";
export declare const SCHEMA_URL: "https://schema.org/url";
export declare const ICAL_VEVENT: "http://www.w3.org/2002/12/cal/ical#Vevent";
/** The raw RRULE recurrence string (carried verbatim; not expanded in phase 1). */
export declare const ICAL_RRULE: "http://www.w3.org/2002/12/cal/ical#rrule";
/** The original TZID of a local DATE-TIME, when the source carried one. */
export declare const ICAL_TZID: "http://www.w3.org/2002/12/cal/ical#tzid";
/** The iCalendar UID, kept under the iCal vocab in addition to schema:identifier. */
export declare const ICAL_UID: "http://www.w3.org/2002/12/cal/ical#uid";
/** The Turtle prefixes used when serialising events. */
export declare const EVENT_PREFIXES: Record<string, string>;
/**
 * True for an absolute `http(s)` URL usable as an IRI object. Untrusted input
 * (a `javascript:` / `mailto:` / `urn:` / bare string) is rejected so it is
 * never coerced into a malformed `NamedNode`. (Same predicate semantics as
 * `@jeswr/solid-task-model`'s `isHttpIri`, inlined here to keep this module a
 * small, dependency-light spec.)
 */
export declare function isHttpIri(value: string | undefined): value is string;
//# sourceMappingURL=vocab.d.ts.map