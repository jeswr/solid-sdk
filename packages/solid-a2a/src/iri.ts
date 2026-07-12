// AUTHORED-BY Claude Fable 5
//
// IRI hardening for the n3.Writer serialisation path.
//
// THE BUG CLASS: n3.Writer does NOT escape the contents of an IRI. An untrusted
// string handed to `namedNode()` and then written is emitted VERBATIM between
// `<...>`, so a `>` or a space (or any other Turtle IRIREF-forbidden char) BREAKS
// OUT of the `<...>` and injects arbitrary triples into the serialised graph. A
// boolean "looks-like-an-IRI" filter is INSUFFICIENT because it forwards the raw
// string; the value must be LEXICALLY percent-encoded before it reaches namedNode.
//
// CONSOLIDATION (upstreaming bead 3juf, step 2): the three low-level guards —
// `escapeIri`, `safeIri`, `safeHttpIri` — now live in exactly ONE audited place,
// the canonical `@jeswr/rdf-serialize` package (the single home for the suite's
// injection-neutraliser, consolidated across five hand-copied variants). They are
// IMPORTED here and RE-EXPORTED, so this package's existing chokepoints
// (intent.ts, wrappers.ts, translate.ts, handshake.ts, shape.ts) and the IRI test
// suites resolve them from `./iri.js` unchanged — a pure import-source change with
// zero injection-logic change at every call site. The former local copies were:
//
//   - escapeIri:   BYTE-EQUIVALENT — the same Turtle-IRIREF forbidden set (the C0
//                  control range U+0000-U+0020 incl. SPACE, plus `< > " { } | ^ `
//                  (backtick) and `\`) percent-encoded to the same uppercase `%XX`;
//                  a valid absolute IRI of any scheme survives byte-for-byte and `%`
//                  is not double-encoded. (The canonical iterates by CODE POINT and
//                  the former local one by UTF-16 code unit — observationally
//                  identical, since every forbidden character is single-byte ASCII
//                  and every non-forbidden code point, astral or not, passes through
//                  unchanged either way.)
//   - safeIri:     BYTE-EQUIVALENT behaviour (same escape-first / validate-the-escaped
//                  / emit-the-escaped discipline, same leading/trailing-C0-or-space
//                  rejection), with the input type widened `string | undefined` ->
//                  `unknown` (a strict widening — a non-string still yields undefined).
//   - safeHttpIri: LEXICAL-preserving in BOTH — it returns the ESCAPED value, never
//                  `new URL().href`, so emitted IRI identity is unchanged for every
//                  value both accept (this package's local copy was NOT a
//                  canonicalising `.href` variant, so unlike @jeswr/solid-vc it is
//                  safe to swap). The canonical additionally REJECTS an authority-less
//                  `https:example.com` / empty-authority `https:///foo` form — a
//                  STRICT SUPERSET-OF-SAFETY (it only rejects more; it never accepts
//                  something the local copy rejected, and emits the identical string
//                  for the accepted set). No `protocolSource` / object field that was
//                  legitimately fetchable is affected; only never-fetchable
//                  authority-less inputs newly fail closed.
//
// `requireIri` / `requireHttpIri` — the FAIL-CLOSED wrappers that THROW (rather than
// silently drop) a REQUIRED object IRI so the serialised graph can never omit a field
// the public object still claims (the object-desync / fail-open class) — are NOT part
// of the canonical package and stay LOCAL, delegating to the imported `safeIri` /
// `safeHttpIri`.

import { escapeIri, safeHttpIri, safeIri } from "@jeswr/rdf-serialize";

// Re-export the canonical guards so `./iri.js`'s existing consumers and tests resolve
// them unchanged (`escapeIri` for SUBJECT/id positions; `safeIri` for scheme-agnostic
// absolute object IRIs; `safeHttpIri` for http(s)-only object fields).
export { escapeIri, safeHttpIri, safeIri };

/**
 * The FAIL-CLOSED wrapper of {@link safeIri}: return the safely-emittable absolute IRI,
 * or THROW a `TypeError` naming `field` when `value` cannot be safely emitted. Use for
 * a REQUIRED object IRI (an intent's `target`/`recipient`/`agent`, a SHACL response
 * class): never silently drop it, so the serialised graph cannot omit a field the
 * public object still claims (the object-desync / fail-open class).
 */
export function requireIri(value: string, field: string): string {
  const safe = safeIri(value);
  if (safe === undefined) {
    throw new TypeError(
      `@jeswr/solid-a2a: ${field} is not a valid absolute IRI: ${JSON.stringify(value)}`,
    );
  }
  return safe;
}

/** The FAIL-CLOSED wrapper of {@link safeHttpIri} (throws for a non-http(s) value). */
export function requireHttpIri(value: string, field: string): string {
  const safe = safeHttpIri(value);
  if (safe === undefined) {
    throw new TypeError(
      `@jeswr/solid-a2a: ${field} is not a valid http(s) IRI: ${JSON.stringify(value)}`,
    );
  }
  return safe;
}
