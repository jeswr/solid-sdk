// AUTHORED-BY Claude Fable 5
//
// IRI hardening for the n3.Writer write path.
//
// n3.Writer emits a NamedNode's IRI VERBATIM between `<` and `>`. It escapes
// newlines and tabs but NOT the other characters Turtle's IRIREF production
// forbids — `> < " { } | ^ \` \\` and SPACE / control chars — so an UNTRUSTED
// string flowing into a NamedNode (a member app's client_id, an assertedBy
// WebID/key, a storage root, a spec-version/sector IRI, or a record id) can
// break out of the `<…>` delimiters and inject arbitrary triples on serialise.
// These two helpers neutralise that at the write chokepoints (object-IRI
// triples + subject minting) in `wrappers.ts`.

/**
 * Validate + normalise an http(s) IRI destined for an OBJECT position. Returns
 * the canonical `href` (with the three IRIREF-forbidden characters the URL
 * parser leaves intact — `| ^ \`` — percent-encoded), or `undefined` when the
 * value is not a parseable http(s) URL. Callers DROP the triple on `undefined`,
 * so a hostile or malformed object IRI is silently omitted rather than emitted
 * verbatim. Object fields in this vocab (app client_id, assertedBy, storage
 * root, acceptsSpec / supportsSector, plus the trusted rdf:type / status vocab
 * constants) are all legitimately http(s), so the http(s) restriction is safe.
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
  return u.href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
}

/**
 * The non-control characters Turtle's `IRIREF` production forbids inside `<…>`.
 * The U+0000–U+0020 range (controls incl. SPACE) is handled numerically below.
 */
const IRIREF_FORBIDDEN_CHARS: ReadonlySet<number> = new Set(
  ["<", ">", '"', "{", "}", "|", "^", "`", "\\"].map((c) => c.charCodeAt(0)),
);

/**
 * Scheme-agnostic escape for an IRI destined for a SUBJECT / id position, which
 * may legitimately be a non-http absolute IRI (e.g. a `urn:` record id). Unlike
 * {@link safeHttpIri} it does NOT restrict the scheme or normalise the IRI — it
 * only percent-encodes the exact characters the Turtle IRIREF grammar forbids
 * (U+0000–U+0020 plus `< > " { } | ^ \` \\`), so a well-formed IRI round-trips
 * byte-for-byte unchanged while an injection payload (whose `>`, SPACE, `<`, `"`
 * break out of the delimiters) is rendered inert.
 */
export function escapeIri(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x20 || IRIREF_FORBIDDEN_CHARS.has(code)) {
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}
