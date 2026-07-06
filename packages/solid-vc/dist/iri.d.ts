import { escapeIri } from "@jeswr/rdf-serialize";
/**
 * `escapeIri` — the scheme-agnostic Turtle-IRIREF injection-neutraliser — now lives
 * in exactly one audited place: it is the single canonical export of
 * `@jeswr/rdf-serialize`, imported here and RE-EXPORTED. The former local
 * implementation was byte-equivalent for every input (same forbidden set — the C0
 * control range U+0000–U+0020 plus `<`, `>`, `"`, `{`, `}`, `|`, `^`, backtick and
 * backslash — and the same uppercase `%XX` percent-encoding; a well-formed absolute
 * IRI of any scheme survives byte-for-byte, and `%` is not double-encoded). It is
 * imported (not merely `export … from`) so the local {@link safeObjectIri} composite
 * can still reference it, and re-exported so `./iri.js`'s existing consumers (e.g.
 * `src/wrappers.ts`) resolve it unchanged.
 */
export { escapeIri };
/**
 * VALIDATE + harden a value that must be an http(s) IRI, LEXICAL-PRESERVING.
 * Returns `undefined` (⇒ the caller DROPS the triple) when the value is not a
 * parseable http(s) URL. For a valid value the ORIGINAL lexical form is preserved
 * byte-for-byte (default port, host case, empty path, percent-encoding all kept —
 * NO `new URL().href` canonicalisation); injection is neutralised by `escapeIri`,
 * which percent-encodes the full Turtle-IRIREF forbidden set (C0 controls + space +
 * `<>"{}|^` + backtick + backslash), a superset of the breakout characters.
 *
 * `new URL()` is used ONLY to VALIDATE (reject a non-http(s) scheme / unparseable
 * value) — its canonicalised `.href` is intentionally discarded. This keeps the
 * single suite-wide lexical-preserving IRI invariant (see the module header and
 * suite-tracker-c77v): the signed RDF lowering, the JSON-LD projection, and any
 * external W3C verifier all agree on the issuer/type/relatedResource IRI bytes.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/** Whether a string is an absolute IRI (an RFC-3986 scheme followed by `:`). */
export declare function isAbsoluteIri(value: string): boolean;
/**
 * The guard for an OBJECT-position IRI whose scheme is not fixed in advance:
 *  - an http(s) value is preserved (lexical) + hardened via {@link safeHttpIri};
 *  - another ABSOLUTE-IRI scheme (`did:` / `urn:` — legitimate for a VC issuer or
 *    subject) is escaped IN PLACE via {@link escapeIri}, so it is preserved rather
 *    than wrongly dropped by the http-only filter;
 *  - a non-absolute / unparseable value returns `undefined`, so the caller DROPS
 *    the triple instead of writing a malformed IRI.
 *
 * Both absolute-IRI branches now preserve the value LEXICALLY (escapeIri) — the
 * http(s) branch differs only in additionally requiring a `new URL()`-parseable
 * value. A valid absolute IRI of ANY scheme survives byte-for-byte.
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
 * it delegates to {@link safeObjectIri}, a VALID issuer is escaped (lexical) exactly
 * as {@link safeObjectIri} does — only the previously-dropped (invalid) case throws.
 */
export declare function requireObjectIri(value: string | undefined, field: string): string;
//# sourceMappingURL=iri.d.ts.map