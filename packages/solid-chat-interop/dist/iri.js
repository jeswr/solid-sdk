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