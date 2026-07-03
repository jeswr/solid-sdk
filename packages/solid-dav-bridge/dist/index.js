// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-dav-bridge` — import CalDAV calendars + CardDAV address books into
 * a Solid pod as the suite's established RDF models. READ / import-only (phase 1),
 * owner-private.
 *
 * A STANDARD-PROTOCOL bridge: it maps a well-specified format (iCalendar
 * [RFC 5545] over CalDAV [RFC 4791]; vCard [RFC 6350] over CardDAV [RFC 6352]) to
 * RDF the suite already speaks — it is NOT an app plugin.
 *
 *  - **iCalendar VEVENT → `schema:Event`** (schema.org), emitted via typed quads +
 *    `n3.Writer` (NEVER hand-concatenated Turtle). Fields schema.org lacks keep the
 *    W3C RDF-iCal vocab (`ical:`) — chiefly the raw `RRULE` as `ical:rrule` (carried
 *    verbatim; recurrence is NOT expanded in phase 1). The subject is typed BOTH
 *    `schema:Event` and `ical:Vevent`. No new vocabulary is invented.
 *  - **vCard → `vcard:AddressBook`** via `@jeswr/solid-task-model`'s `./contacts`
 *    `buildPerson` / `serializePerson` — the SolidOS-readable structured form, never
 *    hand-built vcard triples.
 *
 * The architecture mirrors the suite's granary-ingest bridge:
 *
 *  - **PURE MAPPERS** ({@link veventToEvent}, {@link vcardToContact}) — fixture-tested,
 *    NO network — are the testable core.
 *  - **A minimal in-house RFC 5545/6350 content-line parser** (`ical.ts`) does line
 *    unfolding + property/param parsing; it is small + exhaustively tested, and keeps
 *    the committed `dist/` self-contained under `ignore-scripts=true` with no inlined
 *    third-party parser. (See `ical.ts` for the rationale.)
 *  - **INGEST writers** ({@link importCalendar}, {@link importAddressBook}) accept
 *    EITHER already-fetched text (`icsText`/`vcfText` — the unit-testable path) OR a
 *    `davUrl` routed through the SSRF guard, and PUT each item as an owner-private
 *    pod resource via an injectable authed `writeFetch`.
 *  - **THE SSRF REMOTE** ({@link fetchDav}) is the ONLY place a user URL is
 *    dereferenced — always through `@jeswr/guarded-fetch` (https-only, block
 *    private/loopback/metadata, DNS-pin, cap + timeout, NO redirect-follow). DAV auth
 *    is a separate injectable credential turned into an `Authorization` header —
 *    never logged, never in a URL, never re-sent cross-origin (the guard does not
 *    follow redirects).
 *
 * **Owner-privacy contract:** imported third-party data MUST default to owner-only.
 * This package never writes a broadening ACL and never auto-shares — written
 * resources inherit the (required owner-private) target container's access. See the
 * README SECURITY section.
 *
 * **Untrusted-input hardened throughout:** an unparseable date drops THAT field
 * (never aborts the event); a non-http(s) URL/UID is dropped from IRI fields; a
 * malformed/hostile entry drops the bad field rather than aborting the import.
 *
 * @packageDocumentation
 */
// --- the iCal DATE / DATE-TIME → xsd literal helper ---
export { parseICalDate } from "./datetime.js";
// --- the iCalendar / vCard content-line parser (RFC 5545 §3.1 / RFC 6350 §3.2) ---
export { findComponents, getProperties, getProperty, parseComponents, parseContentLine, unescapeText, unfoldLines, } from "./ical.js";
// --- the ingest API (write to a pod) ---
export { defaultContactSlug, defaultEventSlug, importAddressBook, importCalendar, } from "./ingest.js";
// --- the pure mappers (the fixture-tested core) ---
export { vcardToContact, veventToEvent, } from "./map.js";
// --- the optional SSRF-guarded fetch-from-DAV helper + DAV auth ---
export { DavFetchError, fetchDav } from "./remote.js";
// --- the vocabularies + the http(s)-only IRI guard ---
export { EVENT_PREFIXES, ICAL, ICAL_RRULE, ICAL_VEVENT, isHttpIri, SCHEMA, SCHEMA_EVENT, safeHttpIri, } from "./vocab.js";
//# sourceMappingURL=index.js.map