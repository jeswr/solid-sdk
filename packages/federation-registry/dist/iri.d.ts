/**
 * Validate + normalise an http(s) IRI destined for an OBJECT position. Returns
 * the canonical `href` (with the three IRIREF-forbidden characters the URL
 * parser leaves intact — `| ^ \`` — percent-encoded), or `undefined` when the
 * value is not a parseable http(s) URL. Callers DROP the triple on `undefined`,
 * so a hostile or malformed object IRI is silently omitted rather than emitted
 * verbatim. Object fields in this vocab (app client_id, assertedBy, storage
 * root, acceptsSpec / supportsSector, plus the trusted rdf:type / status vocab
 * constants) are all legitimately http(s), so the http(s) restriction is safe.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/**
 * Scheme-agnostic escape for an IRI destined for a SUBJECT / id position, which
 * may legitimately be a non-http absolute IRI (e.g. a `urn:` record id). Unlike
 * {@link safeHttpIri} it does NOT restrict the scheme or normalise the IRI — it
 * only percent-encodes the exact characters the Turtle IRIREF grammar forbids
 * (U+0000–U+0020 plus `< > " { } | ^ \` \\`), so a well-formed IRI round-trips
 * byte-for-byte unchanged while an injection payload (whose `>`, SPACE, `<`, `"`
 * break out of the delimiters) is rendered inert.
 */
export declare function escapeIri(value: string): string;
//# sourceMappingURL=iri.d.ts.map