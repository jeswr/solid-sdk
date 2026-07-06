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
// THE VALIDATE/EMIT-MISMATCH BUG (suite-tracker-c77v, roborev Medium): a subtler
// variant of the same class on the SIGNING path. `new URL(value)` SILENTLY strips
// input before parsing — it removes any leading/trailing C0-control-or-space, and
// EVERY embedded ASCII tab (U+0009) / LF (U+000A) / CR (U+000D) — so a guard that
// validates `new URL(value)` but returns `escapeIri(value)` VALIDATES ONE STRING and
// EMITS ANOTHER: `"http://a.example/\tpath"` passes `new URL` (which drops the tab,
// seeing `http://a.example/path`) yet `escapeIri` emits `http://a.example/%09path`
// into the signed N-Quads pre-image. On a VC signing/verification path that is a real
// correctness+security hole (the issuer / verificationMethod actually signed is not
// the one the guard checked). The fix, below, makes the VALIDATED string byte-identical
// to the RETURNED string: reject any strip-divergent input FAIL-CLOSED, then validate
// the ESCAPED (returned) value — never `new URL(value)`.
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
//   • safeHttpIri   — http(s)-only, LEXICAL-PRESERVING, STRIP-DIVERGENCE-REJECTING.
//                     Returns `undefined` (⇒ the caller DROPS the triple) when the
//                     value is not a usable http(s) IRI — OR when it is not already
//                     in its exact lexical form (a byte `new URL` would trim/strip:
//                     leading/trailing control-or-space, or an embedded tab/LF/CR).
//                     For an accepted value it escapes the Turtle-IRIREF forbidden set
//                     via `escapeIri` and VALIDATES THE ESCAPED (returned) STRING, so a
//                     valid http(s) IRI is preserved BYTE-FOR-BYTE (its default port,
//                     host case, empty-path and percent-encoding are all kept) and the
//                     validated string is byte-identical to the returned one. Use for a
//                     field that is semantically an http(s) IRI.
//
//                     WHY LEXICAL, NOT `new URL().href` (suite-tracker-c77v):
//                     `new URL().href` CANONICALISES — it strips a default `:443`/
//                     `:80`, lower-cases the scheme+host, resolves dot-segments, and
//                     inserts a trailing `/` into an empty path (`https://a.example#me`
//                     → `https://a.example/#me`). That contradicts the single
//                     suite-wide LEXICAL-PRESERVING invariant `@jeswr/rdf-serialize`'s
//                     `escapeIri` establishes, and it made the SIGNED RDF lowering
//                     (`credentialToRdf`, which canonicalised the issuer) DISAGREE
//                     with the JSON-LD projection (`credentialToJsonLd`, which emits
//                     the issuer verbatim), with the subject-id / claim / proof
//                     `verificationMethod` writes (all already `escapeIri`-lexical),
//                     and with any external W3C VC verifier (standard JSON-LD→RDF does
//                     NOT URL-canonicalise absolute IRIs). Preserving lexically brings
//                     all four into lock-step. It does NOT change any existing
//                     signature outcome: `issue()` and `verifyCredential()` apply the
//                     SAME `credentialToRdf`, so the round-trip is invariant to this
//                     transform (a valid credential signed then verified matches
//                     either way); the change is only observable as different ABSOLUTE
//                     bytes for a NON-canonical input URL, which no captured golden
//                     uses. Injection stays fully closed — `escapeIri` percent-encodes
//                     the entire forbidden set (C0 controls + space + `<>"{}|^` +
//                     backtick + backslash), a strict SUPERSET of what `new URL()`
//                     handled.
//
//   • safeObjectIri — the object-position composite: an http(s) value is preserved
//                     via {@link safeHttpIri} (lexical); another absolute-IRI scheme
//                     (`did:` / `urn:`) is escaped in place (escapeIri, so a DID or
//                     URN issuer/subject is preserved, not dropped); a non-absolute /
//                     unparseable / STRIP-DIVERGENT value returns `undefined` so the
//                     caller drops the triple. This is what an object-IRI field
//                     (issuer, a type IRI) routes through. Both branches escape
//                     lexically — the only distinction is that the http(s) branch
//                     additionally requires a `new URL()`-parseable value. It applies
//                     the SAME strip-divergence rejection as {@link safeHttpIri} up
//                     front, so a strip-divergent http(s) value that `safeHttpIri`
//                     rejected can NOT be resurrected by the did:/urn: fallback.

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
 * Does `value` carry a byte that the WHATWG URL parser would SILENTLY STRIP before
 * parsing — i.e. is `value` NOT already in the exact lexical form `new URL` sees?
 *
 * The URL basic parser first removes (a) any leading/trailing C0 control or SPACE
 * (charCode ≤ 0x20 at either end) and (b) EVERY embedded ASCII tab (0x09), LF (0x0A)
 * or CR (0x0D). If any of those are present, the string `new URL` VALIDATES is not the
 * string we would EMIT — the validate/emit mismatch this guard closes on the VC
 * signing path. Such an input is rejected FAIL-CLOSED (the caller drops the triple, or
 * {@link requireObjectIri} throws) rather than silently signing a divergent IRI.
 *
 * Note this is deliberately about the STRIP-then-reparse divergence only: other
 * IRIREF-forbidden bytes (an embedded space, `<`, `>`, …) are NOT stripped by the URL
 * parser — they are percent-encoded identically by `escapeIri` and by URL's own
 * component encoding, so escaping-then-validating the escaped value keeps validated ===
 * returned for those without needing rejection.
 */
function hasUrlStripDivergence(value: string): boolean {
  if (value.length === 0) return false;
  // Leading / trailing C0 control or space — trimmed by the URL parser's edge-strip.
  if (value.charCodeAt(0) <= 0x20 || value.charCodeAt(value.length - 1) <= 0x20) {
    return true;
  }
  // Any embedded tab / LF / CR — removed from ANYWHERE in the input by the URL parser.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0d) return true;
  }
  return false;
}

/**
 * VALIDATE + harden a value that must be an http(s) IRI, LEXICAL-PRESERVING, with the
 * VALIDATED string byte-identical to the RETURNED string.
 *
 * Returns `undefined` (⇒ the caller DROPS the triple) when the value:
 *  - is not a string; or
 *  - is STRIP-DIVERGENT — it carries a byte `new URL` would silently trim/strip
 *    (leading/trailing control-or-space, or an embedded tab/LF/CR), so it is not in
 *    its exact lexical form; or
 *  - is not a parseable http(s) URL once escaped.
 *
 * For a valid value the ORIGINAL lexical form is preserved byte-for-byte (default
 * port, host case, empty path, percent-encoding all kept — NO `new URL().href`
 * canonicalisation); injection is neutralised by `escapeIri`, which percent-encodes
 * the full Turtle-IRIREF forbidden set (C0 controls + space + `<>"{}|^` + backtick +
 * backslash), a superset of the breakout characters.
 *
 * CRITICAL: the value validated by `new URL()` is the ESCAPED (returned) string, NOT
 * the raw input — so validated-string === returned-string. Validating `new URL(value)`
 * while returning `escapeIri(value)` was the fixed mismatch (suite-tracker-c77v): the
 * URL parser strips bytes that `escapeIri` percent-encodes, so the checked and the
 * signed IRIs diverged. `new URL` is used ONLY to VALIDATE (reject a non-http(s) scheme
 * / unparseable value) — its canonicalised `.href` is intentionally discarded. This
 * keeps the single suite-wide lexical-preserving IRI invariant (see the module header):
 * the signed RDF lowering, the JSON-LD projection, and any external W3C verifier all
 * agree on the issuer/type/relatedResource IRI bytes.
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  // FAIL CLOSED on any input `new URL` would TRIM or STRIP: if the parser silently
  // removes an edge control-or-space or an embedded tab/LF/CR, the string it VALIDATES
  // differs from the string we EMIT into the signed graph. Require the exact lexical
  // form (see hasUrlStripDivergence).
  if (hasUrlStripDivergence(value)) return undefined;
  // Neutralise injection LEXICALLY, then validate THE RETURNED STRING — `new URL(escaped)`,
  // never `new URL(value)` — so validated === returned. `.href` is discarded (lexical identity).
  const escaped = escapeIri(value);
  let u: URL;
  try {
    u = new URL(escaped);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  return escaped;
}

/** Whether a string is an absolute IRI (an RFC-3986 scheme followed by `:`). */
export function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

/**
 * The guard for an OBJECT-position IRI whose scheme is not fixed in advance:
 *  - a STRIP-DIVERGENT value (a byte `new URL` would trim/strip) returns `undefined`
 *    UP FRONT — so a strip-divergent http(s) value that {@link safeHttpIri} rejected
 *    can NOT be resurrected via the did:/urn: fallback, and a strip-divergent DID/URN
 *    is likewise dropped (an identity IRI must be exact, never silently re-formed);
 *  - an http(s) value is preserved (lexical) + hardened via {@link safeHttpIri};
 *  - another ABSOLUTE-IRI scheme (`did:` / `urn:` — legitimate for a VC issuer or
 *    subject) is escaped IN PLACE via {@link escapeIri}, so it is preserved rather
 *    than wrongly dropped by the http-only filter;
 *  - a non-absolute / unparseable value returns `undefined`, so the caller DROPS
 *    the triple instead of writing a malformed IRI.
 *
 * Both absolute-IRI branches preserve the value LEXICALLY (escapeIri) — the http(s)
 * branch differs only in additionally requiring a `new URL()`-parseable value. A valid
 * absolute IRI of ANY scheme survives byte-for-byte.
 */
export function safeObjectIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  // Same fail-closed rule as safeHttpIri, applied to BOTH branches: an http(s) value
  // rejected by safeHttpIri for strip-divergence must not sneak back through the
  // did:/urn: fallback (whose `isAbsoluteIri` sees `http:` as a valid scheme prefix).
  if (hasUrlStripDivergence(value)) return undefined;
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
 * it delegates to {@link safeObjectIri}, a VALID issuer is escaped (lexical) exactly
 * as {@link safeObjectIri} does — only the previously-dropped (invalid or
 * strip-divergent) case throws.
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
