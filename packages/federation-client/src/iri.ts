// AUTHORED-BY Claude Fable 5
//
// IRI-injection guards for the selfDescribe write path.
//
// `n3.Writer` does NOT escape the IRIs it emits between `<…>`: it escapes
// newlines/tabs but NOT `>` `<` `"` `{` `}` SPACE `|` `^` `` ` `` `\`. So an
// UNTRUSTED string reaching `NamedNodeFrom.string(...)` → serialise is emitted
// verbatim, and a `>` (or space) breaks out of the `<…>` and injects arbitrary
// triples. These helpers neutralise that at the write chokepoints (see
// wrappers.ts `addIriTriple` and `FederationBuilder.app`).
//
// LEXICAL-PRESERVING by design: RDF IRI identity is LEXICAL, so a guard must
// NOT canonicalise (no `URL.href` — that would strip a default `:443`/`:80`,
// lower-case the host, collapse `/./`, etc., emitting a DIFFERENT IRI than the
// caller supplied and breaking registry/verifier matching). We validate with
// `URL` where an http(s) scheme is REQUIRED, but always emit the caller's
// ORIGINAL lexical value with only the Turtle-IRIREF-forbidden characters
// percent-encoded.

/**
 * The non-control characters the Turtle `IRIREF` grammar forbids inside `<…>`.
 * The U+0000–U+0020 control/space range is handled numerically in
 * {@link escapeIri} so no raw control byte need appear in this source.
 */
const IRIREF_FORBIDDEN_CHARS = new Set(["<", ">", '"', "{", "}", "|", "^", "`", "\\"]);

/** Percent-encode a single (ASCII) forbidden character, e.g. `>` → `%3E`. */
function percentEncode(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * An absolute IRI has a leading `scheme:` per RFC 3987 (`ALPHA *( ALPHA / DIGIT
 * / "+" / "-" / "." )` then `:`). We only ever emit ABSOLUTE IRIs as `<…>` — a
 * schemeless value would serialise as a relative reference resolved against the
 * document base, which is not what any federation link means.
 */
function hasScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

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
export function escapeIri(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= 0x20 || IRIREF_FORBIDDEN_CHARS.has(ch) ? percentEncode(ch) : ch;
  }
  return out;
}

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
export function safeIri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (!hasScheme(value)) {
    return undefined;
  }
  return escapeIri(value);
}

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
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  // Reject leading/trailing C0-control-or-space (which `new URL` would silently
  // trim), so the parsed value matches the emitted lexical value exactly.
  if ((value.codePointAt(0) ?? 0) <= 0x20 || (value.charCodeAt(value.length - 1) ?? 0) <= 0x20) {
    return undefined;
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return undefined;
  }
  return escapeIri(value);
}
