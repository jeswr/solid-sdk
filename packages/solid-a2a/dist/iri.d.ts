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
 * Validate an ABSOLUTE IRI for an OBJECT position, SCHEME-AGNOSTICALLY — a legitimate
 * `urn:`/`did:` identifier (an agent/recipient/target may be one) is accepted, only a
 * value that is not a parseable absolute IRI is rejected.
 *
 * ESCAPE-FIRST / validate-the-escaped / emit-the-escaped. The WHATWG URL parser
 * silently STRIPS embedded tab/newline/CR (and other C0 controls) BEFORE parsing — so
 * validating the raw value and then emitting `escapeIri(raw)` would emit a string that
 * was NEVER validated (`ht\ntps://x` validates as http(s), then emits `ht%0Atps://x`).
 * We therefore run {@link escapeIri} FIRST (every C0 control U+0000-U+001F, space, and
 * the IRIREF delimiter set → `%XX`), then validate THAT escaped string with the URL
 * parser, then emit EXACTLY the validated string. The parser sees no strippable char,
 * so validated ≡ emitted; a value whose only defect was an embedded control becomes a
 * `%XX`-encoded IRI (never a silently-stripped one). Returns `undefined` when `value`
 * is not a string, has a leading/trailing control/space, or is not an absolute IRI.
 */
export declare function safeIri(value: string | undefined): string | undefined;
/**
 * Validate an http(s) IRI for an OBJECT position that must be fetchable-over-http
 * (e.g. a handshake `protocolSource`). As {@link safeIri} (same escape-first,
 * validate-the-escaped, emit-the-escaped discipline) but additionally rejects any
 * non-`http:`/`https:` scheme. Returns `undefined` when malformed / non-http(s).
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/**
 * The FAIL-CLOSED wrapper of {@link safeIri}: return the safely-emittable absolute IRI,
 * or THROW a `TypeError` naming `field` when `value` cannot be safely emitted. Use for
 * a REQUIRED object IRI (an intent's `target`/`recipient`/`agent`, a SHACL response
 * class): never silently drop it, so the serialised graph cannot omit a field the
 * public object still claims (the object-desync / fail-open class).
 */
export declare function requireIri(value: string, field: string): string;
/** The FAIL-CLOSED wrapper of {@link safeHttpIri} (throws for a non-http(s) value). */
export declare function requireHttpIri(value: string, field: string): string;
//# sourceMappingURL=iri.d.ts.map