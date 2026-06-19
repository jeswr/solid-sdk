/**
 * Pure IRI helpers — the ONE reviewed home for the small, total IRI predicates
 * the task / tracker / contacts modules all share.
 *
 * These were previously duplicated across `task.ts`, `tracker.ts` and
 * `contacts.ts` (an exported `isHttpIri` in `task.ts` plus a private copy in
 * `tracker.ts`; a private `docOf` in both `tracker.ts` and `contacts.ts`).
 * Consolidating them here gives the maintainer a single place to audit the
 * untrusted-input http(s)-only filter and the document-URL derivation, instead
 * of N transcribed copies that could silently diverge.
 *
 * **Pure core, no platform.** This module depends only on the WHATWG `URL`
 * global (available in both Node and the browser) — no `node:*`, no DOM, no
 * RDF/`n3` machinery — so it is client-safe and can be read as a small spec.
 */
/**
 * True for an absolute `http(s)` URL usable as a WebID / IRI object.
 *
 * Pod data is untrusted input: object-property values that are not absolute
 * http(s) IRIs (e.g. `javascript:`, `mailto:`, `urn:`, a bare string) are
 * rejected here so a caller never coerces one into a malformed `NamedNode` nor
 * surfaces it to a UI as a link. A narrowing type guard so callers can use it in
 * a `?:` without an extra cast.
 */
export declare function isHttpIri(value: string | undefined): value is string;
/**
 * Strip the fragment from an IRI to get its document URL (e.g. the tracker /
 * contact-book document that a `#this` / `#it` subject lives in). Throws on a
 * non-parseable IRI (the callers only ever pass an absolute subject IRI they
 * minted, so a throw here is a programmer error, not untrusted input).
 */
export declare function docOf(iri: string): string;
//# sourceMappingURL=iri.d.ts.map