// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pure IRI helpers — the one reviewed home for the small, total IRI predicate the
 * bookmark model uses to filter untrusted object-property values.
 *
 * **Pure core, no platform.** This module depends only on the WHATWG `URL`
 * global (available in both Node and the browser) — no `node:*`, no DOM, no
 * RDF/`n3` machinery — so it is client-safe and can be read as a small spec.
 */
/**
 * The **canonical** absolute http(s) IRI for `value`, else `undefined` — the
 * recurring untrusted-input filter for an OPTIONAL object-property write (drop a
 * non-http(s) value rather than coerce it into a malformed `NamedNode`). This is
 * the single canonicalization primitive; {@link isHttpIri} is defined in terms of
 * it so the boolean guard and the value filter can never disagree.
 *
 * Returns the parsed `URL.href`, NOT the raw input. This matters because WHATWG
 * `new URL()` TOLERATES (and strips) leading/trailing C0-control + space
 * characters and some tab/newline noise — so `"  https://x.org/a  "` and
 * `"https://x.org/a\n"` parse "OK" but the RAW string contains whitespace
 * illegal inside an RDF IRI. Returning `u.href` writes only the normalized,
 * well-formed IRI, so a hostile / sloppy input can never land an invalid
 * `NamedNode` with embedded whitespace on the wire.
 */
export function httpIriOrUndefined(value) {
    if (!value)
        return undefined;
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * True for an absolute `http(s)` URL that is ALREADY in its canonical form —
 * i.e. {@link httpIriOrUndefined}`(value) === value`. A narrowing type guard so
 * callers can use it in a `?:` without a cast.
 *
 * **Canonical-consistent (not just "parseable").** A value that WHATWG `URL`
 * normalizes — e.g. one with leading/trailing whitespace or control characters,
 * or `http://x.org` (no trailing slash) which `URL` rewrites to `http://x.org/`
 * — returns `false` here, because the RAW string is NOT a well-formed RDF IRI
 * that should be written verbatim. This keeps the boolean guard and the
 * value-returning {@link httpIriOrUndefined} in lock-step: `isHttpIri(v)` is true
 * exactly when `v` may be written through unchanged. Pod data is untrusted input
 * (a `javascript:`/`data:` URL is a stored-XSS / open surface); when you need the
 * usable, normalized value, prefer {@link httpIriOrUndefined}.
 */
export function isHttpIri(value) {
    return value !== undefined && httpIriOrUndefined(value) === value;
}
//# sourceMappingURL=iri.js.map