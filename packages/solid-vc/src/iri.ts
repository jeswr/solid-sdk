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
//                     datatype). This is the load-bearing security floor. It now
//                     lives in — and is RE-EXPORTED from — the canonical
//                     `@jeswr/rdf-serialize` (the single audited home for the
//                     injection-neutraliser); the implementation there is
//                     byte-equivalent to the former local one.
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
export function requireObjectIri(value: string | undefined, field: string): string {
  const iri = safeObjectIri(value);
  if (iri === undefined) {
    throw new Error(
      `@jeswr/solid-vc: ${field} must be an absolute http(s)/did:/urn: IRI, got ${JSON.stringify(
        value,
      )} — refusing to build a credential with an invalid ${field}`,
    );
  }
  return iri;
}
