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
// Two guards, chosen per site:
//   - `safeHttpIri` - for OBJECT fields that must be an http(s) IRI (agent, target,
//     object, recipient, protocolSource, a SHACL response class). Parses with the
//     WHATWG URL parser, rejects any non-http(s) scheme, normalises the result;
//     returns `undefined` for anything malformed so the caller can DROP the triple.
//   - `escapeIri` - for SUBJECT / id fields that may legitimately be a non-http
//     absolute IRI (`urn:...` intent ids, protocol-document ids, SHACL shape ids).
//     Percent-encodes ONLY the Turtle IRIREF-forbidden characters, without any scheme
//     restriction, so a valid `urn:` id survives untouched but a breakout is
//     impossible.

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
 * Validate + normalise an http(s) IRI for an OBJECT position. Returns the normalised
 * absolute IRI, or `undefined` when `value` is not a string, is not a parseable
 * absolute URL, or is not `http:`/`https:`. The result is additionally run through
 * {@link escapeIri} so any IRIREF-forbidden char the URL parser leaves in place
 * (`| ^ ` in a query/fragment, ...) is neutralised before it reaches n3.Writer. A
 * caller DROPS the triple when this returns `undefined`.
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
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
  return escapeIri(u.href);
}
