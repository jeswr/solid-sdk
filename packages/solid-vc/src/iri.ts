// AUTHORED-BY Claude Fable 5
//
// IRI hardening for the n3.Writer / RDFC serialisation path.
//
// THE BUG CLASS: `n3.Writer` does NOT escape IRIs. A term built from an UNTRUSTED
// string via `namedNode()` / `NamedNodeFrom.string()` is emitted VERBATIM between
// angle brackets (`<…>`); an IRI containing a Turtle-IRIREF-forbidden character —
// `>` (or a space, `<`, `"`, `{`, `}`, `|`, `^`, a backtick, or a backslash) —
// breaks out of the `<…>` and injects arbitrary triples into the serialised graph.
// A boolean `isHttpIri` / `looksLikeIri` filter is INSUFFICIENT: it VALIDATES the
// string (e.g. via `new URL()`) but then FORWARDS the RAW string to the writer, so
// the breakout characters survive. The fix must forward a value that can no longer
// break out of `<…>`.
//
// Two guards, chosen per the SEMANTICS of the field being written:
//
//   • escapeIri     — scheme-agnostic. Percent-encodes ONLY the Turtle-IRIREF
//                     forbidden characters, in place, WITHOUT restricting the
//                     scheme. Non-mutating for any already-valid IRI (`http:`,
//                     `urn:uuid:…`, `did:…` all survive byte-for-byte), so it is
//                     safe for SUBJECT ids and any value that may legitimately be a
//                     non-http absolute IRI, and for closing the breakout at the
//                     low-level write chokepoint (subject / predicate / object /
//                     datatype). This is the load-bearing security floor.
//
//   • safeHttpIri   — http(s)-only. Canonicalises via `new URL().href` (which
//                     percent-encodes the breakout characters and strips control
//                     chars) then percent-encodes the residual `|`, `^`, backtick
//                     that `URL` leaves in a path. Returns `undefined` for a value
//                     that is not a parseable http(s) URL — the caller DROPS the
//                     triple rather than write a malformed IRI. Use for a field that
//                     is semantically an http(s) IRI.
//
//   • safeObjectIri — the object-position composite: an http(s) value is
//                     canonicalised (safeHttpIri); another absolute-IRI scheme
//                     (`did:` / `urn:`) is escaped in place (escapeIri, so a DID or
//                     URN issuer/subject is preserved, not dropped); a non-absolute /
//                     unparseable value returns `undefined` so the caller drops the
//                     triple. This is what an object-IRI field (issuer, a type IRI)
//                     routes through.

/**
 * The characters a Turtle / N-Triples `IRIREF` may not contain literally, per the
 * grammar (`[^#x00-#x20<>"{}|^` + "`" + `\] | UCHAR`): the C0 control range
 * U+0000–U+0020 (control chars + space), plus `<`, `>`, `"`, `{`, `}`, `|`, `^`,
 * backtick, and backslash. `n3.Writer` escapes none of these inside `<…>`, so any
 * of them in an emitted IRI is an injection vector. Built from a string (not a
 * regex literal) so the C0 range carries no literal control byte in source.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 control range IS the IRIREF-forbidden set we must percent-encode; matching it is the whole point.
const IRI_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;

/** Percent-encode a single forbidden character to its `%XX` form (upper-hex). */
function percentEncode(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * Scheme-agnostically neutralise an IRI for safe `<…>` emission: percent-encode
 * ONLY the Turtle-IRIREF forbidden characters, leaving everything else untouched.
 * A well-formed absolute IRI of ANY scheme (`http:`, `https:`, `urn:uuid:…`,
 * `did:…`) is returned byte-identical (round-trip preserving), while a hostile
 * value can no longer break out of the angle brackets. `%` is NOT forbidden, so an
 * already-percent-encoded IRI is not double-encoded.
 */
export function escapeIri(value: string): string {
  return value.replace(IRI_FORBIDDEN, percentEncode);
}

/**
 * Canonicalise + harden a value that must be an http(s) IRI. Returns `undefined`
 * (⇒ the caller DROPS the triple) when the value is not a parseable http(s) URL.
 * `new URL().href` percent-encodes the breakout characters (`< > " { }` space) and
 * strips control chars; the residual `|`, `^`, backtick that `URL` can leave in a
 * path are percent-encoded here to fully close the IRIREF grammar.
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  return u.href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
}

/** Whether a string is an absolute IRI (an RFC-3986 scheme followed by `:`). */
export function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

/**
 * The guard for an OBJECT-position IRI whose scheme is not fixed in advance:
 *  - an http(s) value is canonicalised + hardened via {@link safeHttpIri};
 *  - another ABSOLUTE-IRI scheme (`did:` / `urn:` — legitimate for a VC issuer or
 *    subject) is escaped IN PLACE via {@link escapeIri}, so it is preserved rather
 *    than wrongly dropped by the http-only filter;
 *  - a non-absolute / unparseable value returns `undefined`, so the caller DROPS
 *    the triple instead of writing a malformed IRI.
 */
export function safeObjectIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const http = safeHttpIri(value);
  if (http !== undefined) return http;
  return isAbsoluteIri(value) ? escapeIri(value) : undefined;
}
