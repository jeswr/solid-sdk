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
/**
 * The canonical http(s)-only IRI guard for UNTRUSTED input, re-exported from
 * `@jeswr/rdf-serialize` — the suite's SINGLE audited IRI-safety implementation
 * (consolidated from six+ hand-copied, subtly-divergent variants hardened across
 * ~40 cumulative adversarial review rounds). This bridge no longer keeps its own
 * copy; it consumes the shared one so a fix upstream reaches every writer.
 *
 * SECURITY (load-bearing): the value comes from untrusted DAV data (a VEVENT `URL`,
 * a vCard `UID`/`URL`). `n3.Writer` does NOT escape IRIs, so an IRI value that
 * itself contains a `>` (or SPACE, `<`, `"`, `{`, `}`, `|`, `^`, `` ` ``, `\`, or
 * a C0 control) would break OUT of the `<...>` IRIREF and INJECT arbitrary triples
 * into the owner's pod resource (e.g. a forged `solid:oidcIssuer` on the victim's
 * WebID). `safeHttpIri` returns the value to actually emit: it rejects a non-string
 * and a leading/trailing-C0-or-space value, percent-encodes every IRIREF-forbidden
 * character LEXICALLY (before any URL parse), requires an `http(s)` scheme with a
 * non-empty authority, and returns the ESCAPED LEXICAL string.
 *
 * NOTE — SEMANTIC DIFFERENCE vs the retired local copy (intentional): the shared
 * guard is LEXICAL. It returns the escaped input, NEVER `new URL().href`, so it
 * does NOT lower-case the host, strip a default port, or append a trailing slash
 * (RDF identity is lexical — canonicalisation would silently change the IRI's
 * identity). It also REJECTS a value with leading/trailing whitespace outright
 * rather than stripping it. Signature widens `string | undefined` → `unknown`
 * (a superset), so every existing call site remains type-safe. Use THIS (never the
 * raw string) wherever an untrusted value becomes an IRI object.
 *
 * @see https://github.com/jeswr/rdf-serialize `src/iri.ts` for the full 6-clause contract.
 */
export { safeHttpIri } from "@jeswr/rdf-serialize";
//# sourceMappingURL=vocab.d.ts.map