/**
 * IRI safety guard for RDF serialisation.
 *
 * `n3.Writer` does NOT escape IRIs: a string handed to `namedNode()` is emitted
 * verbatim between `<…>`. It escapes newlines/tabs but NOT the delimiters that
 * matter for Turtle IRI-refs — `>` `<` `"` `{` `}` SPACE `|` `^` `` ` `` `\` — so
 * an UNTRUSTED IRI containing a `>` (or a space) closes the IRI-ref early and
 * injects arbitrary triples into the serialised document. `SceneData` fields — and
 * the scene's own SUBJECT (`resourceUrl`) — are plain, caller-supplied,
 * potentially-attacker-controlled strings; every one that becomes an IRI must pass
 * through one of these guards before reaching `namedNode()`.
 *
 * Two guards, one per RÔLE:
 *  - {@link safeHttpIri} for OBJECT links (`sceneDocument`, `thumbnail`, `about`,
 *    `wasGeneratedBy`): canonicalises via WHATWG `URL.href` (an object's exact
 *    lexeme does not carry document identity), returning `undefined` for a value
 *    that is not http(s) so the OPTIONAL triple can be DROPPED.
 *  - {@link safeSubjectBaseIri} for the REQUIRED scene SUBJECT: a subject's
 *    identity IS its exact lexeme, so it must NOT be canonicalised — it is escaped
 *    purely lexically ({@link escapeIri}) and a non-http(s)/unparseable value
 *    returns `undefined` so the caller can FAIL CLOSED (throw) rather than emit an
 *    injectable / empty subject.
 *
 * Mirrors the `safeHttpIri` pattern from `@jeswr/rdf-serialize` / `solid-dav-bridge`.
 */
/**
 * Canonicalise an untrusted string to a Turtle-safe http(s) IRI, or `undefined`
 * when the value is not a parseable http(s) IRI. A returned value is guaranteed to
 * contain none of the characters that could break out of a Turtle `<…>` IRI-ref.
 *
 * This is the guard for OBJECT links (`sceneDocument`, `thumbnail`, `about`,
 * `wasGeneratedBy`), where an object's exact lexeme does not carry document
 * identity, so WHATWG-`URL` canonicalisation (via `URL.href`) is acceptable. For
 * the REQUIRED scene SUBJECT — whose lexical value IS the resource identity — use
 * {@link safeSubjectBaseIri}, which preserves the exact lexeme.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/**
 * Percent-encode ONLY the Turtle-IRIREF-forbidden characters of a string (the
 * control range U+0000–U+0020, SPACE included, plus {@link IRIREF_FORBIDDEN_CHARS}),
 * preserving every other code point EXACTLY — a purely LEXICAL escape with no
 * WHATWG-`URL` canonicalisation (RDF identity is lexical, so a subject's lexeme must
 * survive untouched apart from the characters that would break Turtle). The result
 * is guaranteed to contain none of the characters that could break out of a Turtle
 * `<…>` IRI-ref. Iterates by code point (`for…of`) so astral characters are handled
 * whole, and avoids a control-character regex.
 */
export declare function escapeIri(value: string): string;
/**
 * Validate + LEXICALLY escape an untrusted string for use as a REQUIRED RDF SUBJECT
 * IRI base. Returns `undefined` when the value is not a parseable absolute http(s)
 * IRI — the caller then FAILS CLOSED by throwing, because a scene MUST have a valid
 * subject and there is no safe "drop" for the subject (unlike an optional object
 * link).
 *
 * Unlike {@link safeHttpIri} (used for OBJECT links) this does NOT canonicalise via
 * `URL.href`: a subject's identity is its EXACT lexical value, so the original string
 * is preserved and only the Turtle-forbidden characters are percent-encoded (via
 * {@link escapeIri}) so the serialised `<…>` cannot be broken out of. A clean http(s)
 * IRI is therefore returned byte-identical; a parseable http(s) IRI that carries
 * break-out characters is neutralised (escaped) into a single safe term rather than
 * allowed to inject a triple.
 */
export declare function safeSubjectBaseIri(value: string | undefined): string | undefined;
//# sourceMappingURL=iri.d.ts.map