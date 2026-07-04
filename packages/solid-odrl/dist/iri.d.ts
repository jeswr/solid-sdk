/**
 * Percent-encode ONLY the Turtle IRIREF-forbidden octets in `value`, leaving the
 * scheme and everything else untouched. Breakout-proof yet scheme-agnostic, so a
 * valid `urn:`/`uuid:` subject id round-trips byte-identical while a value carrying
 * a `>`/space/… cannot escape the serialiser's `<...>`.
 */
export declare function escapeIri(value: string): string;
/**
 * Return a safe http(s) IRI, or `undefined` if `value` is not a valid http/https
 * URL. Callers act on `undefined` (drop, or fail-closed).
 *
 * The critical discipline: **escape FIRST, then validate the ESCAPED form, then
 * emit that SAME escaped string** — validation and emission are the identical
 * string, so the WHATWG parser's normalisation can NEVER let a rewritten IRI
 * through, and there is NO `.href` canonicalisation:
 *  - `escapeIri` runs BEFORE `new URL`, so the FULL IRIREF-forbidden set (incl.
 *    backslash → `%5C`) is already percent-encoded; the parser can't reinterpret a
 *    `\` as `/`, strip an inner tab/newline, or otherwise rewrite the authority.
 *  - a leading/trailing C0-control/space (which the parser would silently trim) is
 *    rejected outright.
 *  - we return the escaped string, NOT `u.href`, so lexical identity is preserved
 *    (`:443`, host case, dot-segments all survive) — essential because `evaluate()`
 *    matches targets/agents by EXACT STRING, and a canonicalised target would stop
 *    matching the request.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/**
 * Return a safe, breakout-proof form of an ABSOLUTE IRI of ANY scheme
 * (`urn:`/`did:`/`http(s):`/…), or `undefined` if `value` is not an absolute IRI
 * (no `scheme:` prefix). Same escape-FIRST-then-validate-the-escaped-form
 * discipline as {@link safeHttpIri}: `escapeIri` runs first, the scheme test + the
 * returned value are BOTH the escaped string — so a `>`/space/backslash breakout is
 * neutralised while a legitimate `urn:`/`did:` value keeps its NamedNode semantics
 * (lexically identical). A schemeless value (a plain string) returns `undefined` so
 * the caller emits a literal instead.
 */
export declare function safeIri(value: string | undefined): string | undefined;
//# sourceMappingURL=iri.d.ts.map