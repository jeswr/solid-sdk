// AUTHORED-BY Claude Fable 5
//
// IRI sanitisation for the RDF write path. `n3.Writer` emits a NamedNode's value
// VERBATIM between `<…>` — it escapes newlines/tabs but NOT `> < " { } SPACE | ^ `
// \` (the Turtle IRIREF-forbidden set). So an UNTRUSTED string reaching
// `factory.namedNode(value)` → serialise can inject arbitrary triples via a `>`
// (or space) break-out. Every untrusted value that becomes a subject/predicate/
// object IRI on the write path MUST pass through one of these two guards first
// (a boolean filter is insufficient — it forwards the raw string unchanged).
//
// Two guards, chosen per site:
//   - `safeHttpIri` — for http(s)-IRI OBJECT fields (url, owner, protocolSource,
//     issuer, agent): ESCAPES the value (full IRIREF-forbidden set), validates the
//     escaped form is an absolute http/https URL, and returns THAT escaped string
//     byte-for-byte (no `.href` canonicalisation — RDF identity is lexical), or
//     `undefined` to DROP the triple. (Mirrors @jeswr/rdf-serialize `safeHttpIri`.)
//   - `escapeIri` — for SUBJECT / id IRIs that may legitimately be non-http
//     absolute IRIs (a `did:`/`urn:` agent id, or a WebID): scheme-agnostic;
//     percent-encodes ONLY the IRIREF-forbidden chars, so a `did:`/`urn:`/`https:`
//     subject round-trips unchanged while a break-out attempt is neutralised.
//     Never drops a subject (that would silently emit no triple at all).

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
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  // (1) Reject leading/trailing C0-control or space — the parser would trim these,
  //     letting a non-IRI value validate. (escapeIri would turn them into %XX,
  //     which is not a dereferenceable IRI head/tail anyway.)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting leading/trailing C0/space is the point.
  if (/^[\u0000-\u0020]|[\u0000-\u0020]$/.test(value)) return undefined;
  // (2) Escape the FULL IRIREF-forbidden set (incl. `\` → %5C) BEFORE parsing.
  const escaped = escapeIri(value);
  let u: URL;
  try {
    u = new URL(escaped);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  // `new URL()` is FORGIVING for http(s): it REPAIRS authority-DEFICIENT forms into
  // a URL with a synthesised host — both authority-LESS (`https:example.com`,
  // `https:/foo`, `http:bar`) AND empty-authority triple-slash (`https:///foo`,
  // `http:////foo`, which it repairs to host `foo` by consuming a path segment).
  // Because we emit the escaped ORIGINAL (not `u.href`), those lexically-invalid
  // strings would slip through. Require a NON-EMPTY LEXICAL authority: the escaped
  // string must start with `http://`/`https://` AND the very next char must be a
  // real authority char — not `/`, `?`, `#`, or end-of-string. Keep the
  // `u.host === ""` reject too (a `https://:@/x`-style form is lexically
  // `//`-authority'd yet parses host-empty). A normal `https://host/path` passes
  // byte-identical.
  if (!/^https?:\/\/[^/?#]/i.test(escaped)) return undefined;
  if (u.host === "") return undefined;
  // Emit exactly the string that was validated.
  return escaped;
}

/**
 * The Turtle IRIREF-forbidden characters: control chars U+0000–U+0020 (incl.
 * SPACE) and `< > " { } | ^ \` \\`. Every member is a single-byte ASCII/control
 * code, so `charCodeAt(0)` is the byte to percent-encode.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the control chars is the point.
const IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;

/**
 * Scheme-agnostic IRI escape for a SUBJECT / id term. Percent-encodes ONLY the
 * IRIREF-forbidden chars (never restricting the scheme), so a legitimate
 * `did:…` / `urn:…` / `https://…` identifier passes through byte-for-byte while
 * any injection char (`>`, SPACE, `"`, …) is neutralised. Non-string input
 * yields the empty string (a caller upstream already rejects an empty id).
 */
export function escapeIri(value: string | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(
    IRIREF_FORBIDDEN,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}
