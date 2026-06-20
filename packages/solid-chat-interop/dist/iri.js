// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pure IRI helpers — the ONE reviewed home for the small, total IRI predicates
 * the reconciler and the adapter share.
 *
 * Copied verbatim from `@jeswr/solid-task-model`'s `src/iri.ts` (the gold-standard
 * untrusted-IRI filter) so this package's read/write paths apply the EXACT same
 * http(s)-only guard a foreign chat document's object-property values must pass.
 *
 * **Pure core, no platform.** This module depends only on the WHATWG `URL` global
 * (available in both Node and the browser) — no `node:*`, no DOM, no RDF/`n3`
 * machinery — so it is client-safe and can be read as a small spec.
 */
/**
 * True for an absolute `http(s)` URL usable as a WebID / IRI object.
 *
 * Chat data is untrusted input: object-property values that are not absolute
 * http(s) IRIs (e.g. `javascript:`, `mailto:`, `urn:`, a bare string) are
 * rejected here so a caller never coerces one into a malformed `NamedNode` nor
 * surfaces it to a UI as a link. A narrowing type guard so callers can use it in
 * a `?:` without an extra cast.
 */
export function isHttpIri(value) {
    if (!value)
        return false;
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
/**
 * The value if it is an absolute http(s) IRI ({@link isHttpIri}), else
 * `undefined` — i.e. `isHttpIri(v) ? v : undefined`, the recurring untrusted-
 * input filter for an OPTIONAL object-property write (drop a non-http(s) value
 * rather than coerce it into a malformed `NamedNode`). Named once here instead of
 * repeating the ternary at every optional-IRI write site.
 */
export function httpIriOrUndefined(value) {
    return isHttpIri(value) ? value : undefined;
}
/**
 * Readable alias for {@link httpIriOrUndefined} — "give me a SAFE IRI or
 * nothing". Provided so call sites mapping an external/foreign value into an
 * IRI-valued field read as `safeIri(x)` (the intent: sanitise, don't coerce).
 */
export const safeIri = httpIriOrUndefined;
/**
 * Serialise an UNTRUSTED date to an ISO-8601 string, or `undefined` if it is
 * absent or invalid. A `Date` parsed from a malformed RDF literal (e.g.
 * `as:published "not-a-date"`) is an `Invalid Date`, and `Invalid Date.toISOString()`
 * THROWS (RangeError) — which would abort the whole parse instead of dropping the
 * bad field like we drop non-http IRIs. Funnel every read→canonical date through
 * this so a hostile/garbage date literal is filtered, never fatal. (Mirrors the
 * existing `Number.isNaN(d.getTime())` guard in the LibreChat adapter.)
 */
export function toIsoOrUndefined(d) {
    return d !== undefined && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
}
/**
 * Guard a single typed `@rdfjs/wrapper` read against a malformed-term THROW,
 * returning `undefined` on absence OR malformation. The `LiteralAs.*` /
 * `NamedNodeAs.*` mappings THROW on an untrusted RDF term of the wrong
 * datatype/kind — `LiteralAs.date`/`LiteralAs.string` raise `LiteralDatatypeError`
 * for a literal whose datatype is not the expected one, and `NamedNodeAs.string`
 * raises for a term that is a Literal where a NamedNode was expected. A foreign
 * chat document is UNTRUSTED input, so such a throw must never abort the whole
 * parse: pass each predicate read as a thunk (`() => OptionalFrom.subjectPredicate(
 * this, P, As)`) and a bad value is dropped like a non-http IRI. Guarding PER
 * PREDICATE also stops a malformed preferred predicate in an `a ?? b` fallback
 * chain (e.g. a garbage `dct:created`) from masking a valid fallback (`as:published`).
 */
export function tryRead(read) {
    try {
        return read();
    }
    catch {
        return undefined;
    }
}
/**
 * Read an UNTRUSTED date-valued property off a `@rdfjs/wrapper` doc and serialise
 * it to ISO-8601, or `undefined` if it is absent or malformed. TWO failure modes
 * from a hostile/garbage RDF literal are both caught here:
 *  1. `@rdfjs/wrapper`'s `LiteralAs.date` mapping **THROWS** (`LiteralDatatypeError`)
 *     when the literal's datatype is not `xsd:date`/`xsd:dateTime` — e.g. a plain
 *     `as:published "not-a-date"` string literal — caught by {@link tryRead}; and
 *  2. a well-typed but garbage value parses to an `Invalid Date`, whose
 *     `.toISOString()` throws (`RangeError`) — handled by {@link toIsoOrUndefined}.
 * Pass the getter as a thunk (`() => doc.published`) so the read happens inside the
 * guard. A bad date literal is then DROPPED like a non-http IRI, never fatal to the
 * whole parse.
 */
export function readIsoDate(read) {
    return toIsoOrUndefined(tryRead(read));
}
/**
 * Strip the fragment from an IRI to get its document URL (e.g. the chat resource
 * a `#this` / `#it` message subject lives in). Throws on a non-parseable IRI (the
 * callers only ever pass an absolute subject IRI they minted, so a throw here is a
 * programmer error, not untrusted input).
 */
export function docOf(iri) {
    const u = new URL(iri);
    u.hash = "";
    return u.toString();
}
//# sourceMappingURL=iri.js.map