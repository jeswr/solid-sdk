/**
 * Scheme-agnostically neutralise an IRI for safe `<…>` emission: percent-encode
 * ONLY the Turtle-IRIREF forbidden characters, leaving everything else untouched.
 * A well-formed absolute IRI of ANY scheme (`http:`, `https:`, `urn:uuid:…`,
 * `did:…`) is returned byte-identical (round-trip preserving), while a hostile
 * value can no longer break out of the angle brackets. `%` is NOT forbidden, so an
 * already-percent-encoded IRI is not double-encoded.
 */
export declare function escapeIri(value: string): string;
/**
 * Canonicalise + harden a value that must be an http(s) IRI. Returns `undefined`
 * (⇒ the caller DROPS the triple) when the value is not a parseable http(s) URL.
 * `new URL().href` percent-encodes the breakout characters (`< > " { }` space) and
 * strips control chars; the residual `|`, `^`, backtick that `URL` can leave in a
 * path are percent-encoded here to fully close the IRIREF grammar.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/** Whether a string is an absolute IRI (an RFC-3986 scheme followed by `:`). */
export declare function isAbsoluteIri(value: string): boolean;
/**
 * The guard for an OBJECT-position IRI whose scheme is not fixed in advance:
 *  - an http(s) value is canonicalised + hardened via {@link safeHttpIri};
 *  - another ABSOLUTE-IRI scheme (`did:` / `urn:` — legitimate for a VC issuer or
 *    subject) is escaped IN PLACE via {@link escapeIri}, so it is preserved rather
 *    than wrongly dropped by the http-only filter;
 *  - a non-absolute / unparseable value returns `undefined`, so the caller DROPS
 *    the triple instead of writing a malformed IRI.
 */
export declare function safeObjectIri(value: string | undefined): string | undefined;
/**
 * The FAIL-CLOSED variant of {@link safeObjectIri} for a REQUIRED, identity-bearing
 * object IRI (a credential `issuer`, a presentation `holder`): returns the safe
 * absolute IRI, or THROWS when the value cannot be made one. An identity field must
 * NEVER be silently dropped from the graph the proof is computed over — omitting the
 * `issuer` triple would let a credential be signed/serialised with NO (or, on
 * verify, a mismatched) issuer, which is a fail-OPEN. Optional object IRIs (a claim
 * value, an extra type) keep using {@link safeObjectIri} (drop-on-invalid). Because
 * it delegates to {@link safeObjectIri}, a VALID issuer is canonicalised/escaped
 * exactly as before — only the previously-dropped (invalid) case now throws.
 */
export declare function requireObjectIri(value: string | undefined, field: string): string;
//# sourceMappingURL=iri.d.ts.map