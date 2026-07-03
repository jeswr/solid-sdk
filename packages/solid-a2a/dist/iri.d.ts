/**
 * Percent-encode ONLY the Turtle IRIREF-forbidden characters in `value`, without
 * restricting the scheme. Use for SUBJECT / id positions that may be a legitimate
 * non-http absolute IRI (e.g. a `urn:` intent id): a valid id round-trips unchanged
 * while an injected `>`/space/etc. is neutralised so it can never break out of the
 * `<...>`. The forbidden set is exactly the Turtle IRIREF grammar's excluded chars:
 * control chars U+0000-U+0020 (incl. SPACE) and `< > " { } | ^ ` \`.
 */
export declare function escapeIri(value: string): string;
/**
 * Validate + normalise an http(s) IRI for an OBJECT position. Returns the normalised
 * absolute IRI, or `undefined` when `value` is not a string, is not a parseable
 * absolute URL, or is not `http:`/`https:`. The result is additionally run through
 * {@link escapeIri} so any IRIREF-forbidden char the URL parser leaves in place
 * (`| ^ ` in a query/fragment, ...) is neutralised before it reaches n3.Writer. A
 * caller DROPS the triple when this returns `undefined`.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
//# sourceMappingURL=iri.d.ts.map