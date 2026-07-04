// AUTHORED-BY Claude Fable 5
//
// IRI hardening for the write path. `n3.Writer` (and the shared
// `@jeswr/rdf-serialize` that wraps it) does NOT escape the Turtle IRIREF-forbidden
// characters — it emits a NamedNode's value VERBATIM between angle brackets, only
// escaping `\n`/`\t`/`\r`. So an untrusted string that reaches `namedNode()` /
// `NamedNodeFrom.string()` and contains `>` (or a space, `<`, `"`, `{`, `}`, `|`,
// `^`, a backtick, or a backslash) BREAKS OUT of the `<...>` and injects arbitrary
// triples on serialisation. A boolean `looksLikeIri` filter is INSUFFICIENT: it
// validates but forwards the RAW string. The two functions here are the fix:
//
//  - `escapeIri`  — scheme-agnostic. Percent-encodes ONLY the Turtle IRIREF
//    grammar's forbidden octets (U+0000–U+0020 incl. SPACE, and `< > " { } | ^ ` \`),
//    without restricting the scheme. A legitimate `urn:`/`uuid:` id survives
//    byte-identical (it contains none of those chars); a `>`-breakout cannot. This
//    is the breakout-proof escaper for SUBJECT / id fields that may legitimately be
//    non-http absolute IRIs. It is also applied at every GraphBuilder chokepoint as
//    defence-in-depth, so a forbidden octet can never reach the serialiser
//    regardless of the call site.
//
//  - `safeHttpIri` — for fields whose VALUE CONTRACT is an http(s) IRI (target,
//    assignee, assigner, profile). It ESCAPES FIRST (escapeIri), then validates the
//    ESCAPED string with the URL constructor, then EMITS that SAME escaped string —
//    never `u.href`. Validation and emission are thus the identical string, so the
//    WHATWG parser's normalisation (`\`→`/`, tab/newline stripping, C0 trimming,
//    `:443`/host-case canonicalisation) can neither smuggle a rewritten IRI through
//    NOR change what evaluate() later exact-string-matches. A non-http/unparseable
//    value (or one with leading/trailing C0/space) returns `undefined` so the caller
//    drops the triple / fails closed.
//  - `safeIri` — the scheme-agnostic sibling (urn:/did:/http(s):): same
//    escape-first-validate-the-escaped-form discipline, validating only that the
//    escaped value is an absolute `scheme:` IRI. Used for constraint right-operands
//    that legitimately carry a non-http concept IRI.
//
// Reference: `@jeswr/rdf-serialize` / `@jeswr/solid-dav-bridge` `safeHttpIri`.

/** Turtle IRIREF-forbidden octets: U+0000–U+0020 (controls + SPACE) and `<>"{}|^`\`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the IRIREF grammar forbids exactly these control octets.
const IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;

/**
 * Percent-encode ONLY the Turtle IRIREF-forbidden octets in `value`, leaving the
 * scheme and everything else untouched. Breakout-proof yet scheme-agnostic, so a
 * valid `urn:`/`uuid:` subject id round-trips byte-identical while a value carrying
 * a `>`/space/… cannot escape the serialiser's `<...>`.
 */
export function escapeIri(value: string): string {
  return value.replace(
    IRIREF_FORBIDDEN,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/** Leading/trailing C0-control or SPACE — the WHATWG URL parser silently trims these. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching the C0/space octets the URL parser would trim.
const LEADING_TRAILING_C0 = /^[\u0000-\u0020]|[\u0000-\u0020]$/;

/** An absolute-IRI scheme prefix (`scheme:` where scheme starts with a letter). */
const ABSOLUTE_IRI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Return a safe http(s) IRI, or `undefined` if `value` is not a valid http/https
 * URL. Callers act on `undefined` (drop, or fail-closed).
 *
 * The critical discipline: **escape FIRST, then validate the ESCAPED form, then
 * emit that SAME escaped string** — validation and emission are the identical
 * string, so the WHATWG parser's normalisation can NEVER let a rewritten IRI
 * through, and there is NO `.href` canonicalisation:
 *  - `escapeIri` runs BEFORE `new URL`, so the FULL IRIREF-forbidden set (incl.
 *    backslash → `%5C`) is already percent-encoded; the parser can't reinterpret a
 *    `\` as `/`, strip an inner tab/newline, or otherwise rewrite the authority.
 *  - a leading/trailing C0-control/space (which the parser would silently trim) is
 *    rejected outright.
 *  - we return the escaped string, NOT `u.href`, so lexical identity is preserved
 *    (`:443`, host case, dot-segments all survive) — essential because `evaluate()`
 *    matches targets/agents by EXACT STRING, and a canonicalised target would stop
 *    matching the request.
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (LEADING_TRAILING_C0.test(value)) return undefined;
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

/**
 * Return a safe, breakout-proof form of an ABSOLUTE IRI of ANY scheme
 * (`urn:`/`did:`/`http(s):`/…), or `undefined` if `value` is not an absolute IRI
 * (no `scheme:` prefix). Same escape-FIRST-then-validate-the-escaped-form
 * discipline as {@link safeHttpIri}: `escapeIri` runs first, the scheme test + the
 * returned value are BOTH the escaped string — so a `>`/space/backslash breakout is
 * neutralised while a legitimate `urn:`/`did:` value keeps its NamedNode semantics
 * (lexically identical). A schemeless value (a plain string) returns `undefined` so
 * the caller emits a literal instead.
 */
export function safeIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (LEADING_TRAILING_C0.test(value)) return undefined;
  const escaped = escapeIri(value);
  if (!ABSOLUTE_IRI_SCHEME.test(escaped)) return undefined;
  return escaped;
}
