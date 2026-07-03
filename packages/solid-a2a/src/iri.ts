// AUTHORED-BY Claude Fable 5
//
// IRI hardening for the n3.Writer serialisation path. n3.Writer does NOT escape the
// contents of an IRI: an untrusted string handed to `namedNode()` and then written
// is emitted VERBATIM between `<...>`, so a `>` or a space (or any other Turtle
// IRIREF-forbidden char) BREAKS OUT of the `<...>` and injects arbitrary triples into
// the serialised graph. n3.Writer escapes newlines/tabs but NOT the IRIREF-forbidden
// set below. A boolean "looks-like-an-IRI" filter is INSUFFICIENT because it forwards
// the raw string.
//
// Guards, chosen per site:
//   - `escapeIri` - for SUBJECT / id fields that may legitimately be a non-http
//     absolute IRI (`urn:...` intent ids, protocol-document ids, SHACL shape ids).
//     Percent-encodes ONLY the Turtle IRIREF-forbidden characters, without any scheme
//     restriction, so a valid `urn:` id survives untouched but a breakout is
//     impossible. A subject can NEVER inject (every breakout char is neutralised), so
//     subjects are escaped, never dropped/rejected.
//   - `safeIri` - for OBJECT fields that must be an ABSOLUTE IRI but may legitimately
//     be non-http (`urn:`/`did:` agent/recipient/target identifiers). Validates the
//     value is a parseable absolute IRI (any scheme) via the WHATWG URL parser, then
//     returns the LEXICALLY-PRESERVED original run through `escapeIri`; `undefined`
//     when the value is not a valid absolute IRI.
//   - `safeHttpIri` - the http(s)-only variant of `safeIri`, for object fields that
//     must be fetchable-over-http (`protocolSource`): additionally rejects any
//     non-http(s) scheme.
//   - `requireIri` / `requireHttpIri` - the FAIL-CLOSED wrappers of the two `safe*`
//     guards: a required object IRI that cannot be safely emitted THROWS rather than
//     being silently dropped, so a serialised graph never omits a field the public
//     object still claims (no object-desync / fail-open). Both are LEXICAL-preserving.
//
// A `safe*` guard rejects a value whose FIRST or LAST character is a C0 control or a
// space BEFORE parsing: the WHATWG URL parser silently trims those, so a leading/
// trailing-space value would otherwise validate yet round-trip to a percent-mangled
// IRI different from the one that was checked. Rejecting up front fails closed instead.

// The delimiter/breakout characters (all code point < 0x80) that n3.Writer would emit
// verbatim inside `<...>`. Control chars U+0000-U+0020 (incl. SPACE, 0x20) are handled
// numerically in `escapeIri`, so no control-char literal appears in this source.
const IRIREF_FORBIDDEN_DELIMITERS = new Set(["<", ">", '"', "{", "}", "|", "^", "`", "\\"]);

/**
 * Percent-encode ONLY the Turtle IRIREF-forbidden characters in `value`, without
 * restricting the scheme. Use for SUBJECT / id positions that may be a legitimate
 * non-http absolute IRI (e.g. a `urn:` intent id): a valid id round-trips unchanged
 * while an injected `>`/space/etc. is neutralised so it can never break out of the
 * `<...>`. The forbidden set is exactly the Turtle IRIREF grammar's excluded chars:
 * control chars U+0000-U+0020 (incl. SPACE) and `< > " { } | ^ ` \`.
 */
export function escapeIri(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    const code = value.charCodeAt(i);
    if (code <= 0x20 || IRIREF_FORBIDDEN_DELIMITERS.has(ch)) {
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * True when `value`'s FIRST or LAST character is a C0 control (U+0000-U+001F) or a
 * space (U+0020). The WHATWG URL parser silently strips these before parsing, so a
 * value with a leading/trailing control/space would validate yet not be the string
 * that was checked — we reject it up front and fail closed instead.
 */
function hasEdgeControlOrSpace(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  return value.charCodeAt(0) <= 0x20 || value.charCodeAt(value.length - 1) <= 0x20;
}

/**
 * Validate an ABSOLUTE IRI for an OBJECT position, SCHEME-AGNOSTICALLY — a legitimate
 * `urn:`/`did:` identifier (an agent/recipient/target may be one) is accepted, only a
 * value that is not a parseable absolute IRI is rejected. Returns the LEXICALLY
 * PRESERVED original run through {@link escapeIri} (so any IRIREF-forbidden char the
 * value carries is neutralised before n3.Writer, without the URL parser's
 * normalisation silently changing the IRI), or `undefined` when `value` is not a
 * string, has a leading/trailing control/space, or is not an absolute IRI.
 */
export function safeIri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || hasEdgeControlOrSpace(value)) {
    return undefined;
  }
  try {
    // Parse only to VALIDATE it is an absolute IRI (a relative string throws); the
    // parsed/normalised form is intentionally discarded in favour of the original.
    new URL(value);
  } catch {
    return undefined;
  }
  return escapeIri(value);
}

/**
 * Validate an http(s) IRI for an OBJECT position that must be fetchable-over-http
 * (e.g. a handshake `protocolSource`). As {@link safeIri} but additionally rejects any
 * non-`http:`/`https:` scheme. LEXICAL-preserving: returns {@link escapeIri} of the
 * ORIGINAL (not the URL parser's normalised `href`), so the emitted IRI matches the
 * value that was checked. Returns `undefined` when malformed / non-http(s).
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || hasEdgeControlOrSpace(value)) {
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
