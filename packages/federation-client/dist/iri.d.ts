/**
 * Percent-encode ONLY the characters the Turtle `IRIREF` grammar forbids (the
 * U+0000–U+0020 control/space range plus `< > " { } | ^ \` \\`). Everything else
 * — including a `:443` default port, an uppercase host, `%`-escapes the caller
 * already wrote — is preserved BYTE-FOR-BYTE, so the emitted IRI is lexically
 * identical to the input (minus the injection-critical chars) and RDF IRI
 * identity is preserved. This is the shared neutraliser for both the subject and
 * the object guards, and (used alone) the SUBJECT guard: a client_id can never
 * break out of its `<…>` while any legitimate id still round-trips.
 */
export declare function escapeIri(value: string): string;
/**
 * Scheme-AGNOSTIC guard for an OBJECT IRI (sector / shape / consumes / produces /
 * declaresShape / access-mode / rdf:type). A federation object may be ANY
 * absolute RDF IRI — an http(s) Solid resource, but equally a `urn:` / `did:` /
 * other-scheme shape or sector IRI. So this does NOT restrict the scheme (that
 * would silently DROP a valid non-http IRI → data loss); it only requires the
 * value to be an ABSOLUTE IRI and then {@link escapeIri}s it, preserving the
 * caller's exact lexical form.
 *
 * Returns `undefined` for a non-string or a non-absolute (schemeless) value — the
 * caller DROPS the triple, because a schemeless value is not a valid absolute
 * NamedNode object and must never be emitted as a relative `<…>` reference.
 */
export declare function safeIri(value: string | undefined): string | undefined;
/**
 * http(s)-ONLY guard, for a field that must be a genuine Solid http(s) resource /
 * WebID. Validates (via `URL`) that the value parses as an `http:`/`https:` URL,
 * then returns the ORIGINAL LEXICAL value {@link escapeIri}'d — NOT `URL.href`,
 * which would canonicalise (strip default port, lower-case host, …) and thereby
 * change the IRI's identity. Returns `undefined` for a non-http(s) / malformed
 * value (the caller DROPS the triple).
 *
 * WHATWG `URL` TRIMS leading/trailing C0 controls (U+0000–U+001F) and spaces
 * before parsing, so `" https://x"` would PASS validation but be emitted as the
 * still-invalid `%20https://x`. To keep the VALIDATED form identical to the
 * EMITTED lexical form, reject up-front any value with a leading/trailing
 * control-or-space character (code ≤ U+0020).
 *
 * Not used by the current selfDescribe write path (whose objects are generic RDF
 * IRIs guarded by {@link safeIri}); provided for fields that are genuinely
 * constrained to http(s).
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
//# sourceMappingURL=iri.d.ts.map