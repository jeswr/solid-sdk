/**
 * Validate + normalise an http(s) IRI for use as an RDF object.
 *
 * @param value - the untrusted candidate IRI.
 * @returns the IRIREF-escaped value, byte-for-byte, if it is a well-formed
 *   absolute `http:`/`https:` IRI, else `undefined` (the caller DROPS the triple).
 *
 * ESCAPE-FIRST, then VALIDATE + EMIT THE SAME STRING. Two subtleties make the
 * naive "validate `value`, emit `escapeIri(value)`" order UNSAFE, because the
 * WHATWG `URL` parser NORMALISES before it validates:
 *   1. It TRIMS leading/trailing C0-control and space, so `"  https://evil"` (or a
 *      trailing NUL) parses as valid http — yet its escaped form `%20%20https://…`
 *      is not a dereferenceable IRI. We reject any leading/trailing C0/space up
 *      front, then escape.
 *   2. It rewrites `\` → `/` (special-scheme authority), so `https:\\evil.com\x`
 *      would validate as `https://evil.com/x` (a DIFFERENT host!). We percent-encode
 *      `\` → `%5C` (part of the IRIREF-forbidden set) BEFORE parsing, so the parser
 *      can never reinterpret it as a path/authority separator.
 * Validating AND emitting the SAME escaped string closes the gap: whatever the
 * parser accepts is exactly what we emit. No `.href` canonicalisation — RDF
 * identity is LEXICAL, so a valid IRI (uppercase host, explicit `:443`, dot
 * segments) round-trips byte-identical. `escapeIri` never touches `%`, so a
 * caller's existing `%XX` escapes survive un-doubled.
 */
export declare function safeHttpIri(value: string | undefined): string | undefined;
/**
 * Scheme-agnostic IRI escape for a SUBJECT / id term. Percent-encodes ONLY the
 * IRIREF-forbidden chars (never restricting the scheme), so a legitimate
 * `did:…` / `urn:…` / `https://…` identifier passes through byte-for-byte while
 * any injection char (`>`, SPACE, `"`, …) is neutralised. Non-string input
 * yields the empty string (a caller upstream already rejects an empty id).
 */
export declare function escapeIri(value: string | undefined): string;
//# sourceMappingURL=iri.d.ts.map