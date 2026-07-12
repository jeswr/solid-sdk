// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pure IRI helpers — the ONE reviewed home for the small, total IRI predicates
 * every entity module in this package shares.
 *
 * Ported verbatim from `@jeswr/solid-task-model`'s `iri.ts` (the suite template
 * this package mirrors): consolidating the untrusted-input http(s)-only filter
 * and the document-URL derivation here gives the maintainer a single place to
 * audit them, instead of N transcribed copies that could silently diverge.
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
export function httpIriOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
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
export function isHttpIri(value: string | undefined): value is string {
  return value !== undefined && httpIriOrUndefined(value) === value;
}

/**
 * Strip the fragment from an IRI to get its document URL (e.g. the meal /
 * protocol document that a `#it` subject lives in). Throws on a non-parseable
 * IRI (the callers only ever pass an absolute subject IRI they minted, so a
 * throw here is a programmer error, not untrusted input).
 */
export function docOf(iri: string): string {
  const u = new URL(iri);
  u.hash = "";
  return u.toString();
}
