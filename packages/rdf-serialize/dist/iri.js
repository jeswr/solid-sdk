// AUTHORED-BY Claude Fable 5
//
// The single canonical IRI-safety helper set for the @jeswr suite.
//
// n3.Writer does NOT escape IRIs: whatever string a `NamedNode` carries is
// emitted verbatim between angle brackets (`<…>`). So an IRI value that itself
// contains a `>` (or a space, `<`, `"`, `{`, `}`, `|`, `^`, backtick,
// backslash, or a C0 control) breaks out of the brackets and injects arbitrary
// triples into the serialised document — a classic injection whenever the value
// originates from foreign input (parsed RDF re-read as a string, an API/JSON
// field, a user-supplied URL, an HTTP header).
//
// A bare `startsWith("http")` / `new URL()` filter is NOT sufficient: the value
//   http://evil/> <https://evil/s> <https://evil/o> .
// passes `new URL()` validation yet still injects when serialised. The only
// safe path is to LEXICALLY percent-encode the IRIREF-forbidden characters
// before the value ever reaches `namedNode`.
//
// Six+ hand-copied, subtly-divergent variants of this pattern were found across
// the suite (each hardened independently over ~40 cumulative adversarial review
// rounds); this module is the ONE audited implementation every @jeswr
// RDF-writing package should consume instead. It lives beside the serialiser
// because the serialiser is exactly where an un-escaped IRI becomes dangerous.
//
// Design invariant — RDF identity is LEXICAL. These helpers return the ESCAPED
// LEXICAL value, never `new URL().href`. Canonicalisation (dropping `:443`,
// lower-casing the host, collapsing dot-segments, appending a trailing slash)
// changes the IRI's *identity* — a different NamedNode — so it must never be
// applied silently to data. We percent-encode the dangerous bytes and otherwise
// preserve the string byte-for-byte.
/**
 * The IRIREF-forbidden ASCII SYMBOLS (the non-control, non-space members of the
 * Turtle `IRIREF` exclusion set `[^#x00-#x20<>"{}|^` + "`" + `\]`): `< > " { }
 * | ^ ` (backtick) and `\` (backslash). The C0-control range U+0000–U+001F and
 * SPACE U+0020 are handled by a numeric `<= 0x20` range check rather than this
 * set.
 */
const FORBIDDEN_SYMBOL_CODES = new Set([
    0x3c, // <
    0x3e, // >
    0x22, // "
    0x7b, // {
    0x7d, // }
    0x7c, // |
    0x5e, // ^
    0x60, // ` (backtick)
    0x5c, // \ (backslash)
]);
/**
 * Is the given code point a Turtle `IRIREF`-forbidden character — i.e. a C0
 * control (U+0000–U+001F), SPACE (U+0020), or one of `< > " { } | ^ ` `\`?
 */
function isForbidden(codePoint) {
    return codePoint <= 0x20 || FORBIDDEN_SYMBOL_CODES.has(codePoint);
}
/**
 * Does the raw string contain ANY Turtle `IRIREF`-forbidden character? Used by
 * {@link isHttpIri} as a purely lexical injection-safety test (no encoding).
 */
function containsForbidden(value) {
    for (const ch of value) {
        if (isForbidden(ch.codePointAt(0))) {
            return true;
        }
    }
    return false;
}
/**
 * Does the string begin OR end with a C0 control (charCode ≤ 0x1F) or SPACE
 * (0x20)? The WHATWG URL parser silently STRIPS leading/trailing C0-or-space
 * before parsing, so a value wrapped in such bytes is a malformed/hostile
 * candidate that must be rejected up front rather than escaped — otherwise the
 * escaped `%XX` form would survive and be reinterpreted. (Embedded, non-edge
 * controls are legitimately escaped by {@link escapeIri}.)
 */
function hasEdgeControlOrSpace(value) {
    return (value.length > 0 && (value.charCodeAt(0) <= 0x20 || value.charCodeAt(value.length - 1) <= 0x20));
}
/**
 * Purely LEXICAL percent-encoder of the full Turtle `IRIREF`-forbidden set: the
 * entire C0 control range U+0000–U+001F, SPACE (U+0020), and `< > " { } | ^ `
 * (backtick) and `\` (backslash).
 *
 * This does NO URL parsing and NO canonicalisation: it iterates the string by
 * code point and replaces ONLY those forbidden characters with their uppercase
 * `%XX` percent-encoding (each forbidden character is single-byte ASCII, so one
 * `%XX` byte is exact). Every other code point — including `%` itself (so there
 * is no double-encoding), astral characters, and all IRI-legal punctuation —
 * passes through byte-for-byte. A `urn:` / `did:` / `http:` value therefore
 * round-trips unchanged except for any embedded forbidden bytes.
 *
 * Use this for subjects / ids you have ALREADY validated as the right scheme
 * and merely need to make injection-safe before handing to `namedNode`. For
 * untrusted values that must also be scheme-checked, use {@link safeHttpIri}
 * (http/https resource + WebID fields) or {@link safeIri} (scheme-agnostic
 * object IRIs), which call this internally.
 *
 * @param value - The string to escape.
 * @returns The value with every IRIREF-forbidden character percent-encoded.
 */
export function escapeIri(value) {
    let out = "";
    for (const ch of value) {
        const codePoint = ch.codePointAt(0);
        if (isForbidden(codePoint)) {
            out += `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
        }
        else {
            out += ch;
        }
    }
    return out;
}
/**
 * The DEFINITIVE http(s)-only IRI guard for UNTRUSTED input — the 6-clause
 * contract distilled from ~40 cumulative adversarial review rounds across the
 * suite's hand-copied variants.
 *
 * In this exact order:
 *  1. return `undefined` if `value` is not a string;
 *  2. return `undefined` if the RAW value has a leading OR trailing C0 control
 *     (charCode ≤ 0x1F) or SPACE (0x20) — a stripped-by-the-parser hostile form;
 *  3. escape FIRST (`escapeIri`), so an embedded tab / newline / carriage-return
 *     / backslash becomes `%XX` and the WHATWG URL parser can neither strip it
 *     nor reinterpret it (a backslash is NOT silently turned into `/`);
 *  4. `new URL(escaped)` inside try/catch → `undefined` on throw;
 *  5. require `protocol` to be `http:` or `https:`;
 *  6. require a NON-EMPTY LEXICAL authority
 *     (`/^https?:\/\/[^/?#]/i.test(escaped)`), which rejects authority-less
 *     `https:example.com` AND empty-authority `https:///foo` / `http:////foo` /
 *     `https://?x`; `u.host !== ""` is kept as belt-and-suspenders.
 *
 * On success it returns the ESCAPED LEXICAL value (never `u.href`), so `:443`,
 * host-case and dot-segments survive byte-identical — RDF identity is lexical.
 *
 * @param value - The untrusted candidate (any type).
 * @returns The injection-safe http(s) IRI string, or `undefined` when `value`
 *   is not a usable http(s) IRI.
 *
 * @example
 * ```ts
 * import { DataFactory } from "n3";
 * import { safeHttpIri } from "@jeswr/rdf-serialize";
 *
 * const safe = safeHttpIri(foreignInput.url);
 * if (safe !== undefined) {
 *   quads.push(DataFactory.quad(s, p, DataFactory.namedNode(safe)));
 * }
 * ```
 */
export function safeHttpIri(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    if (hasEdgeControlOrSpace(value)) {
        return undefined;
    }
    const escaped = escapeIri(value);
    let url;
    try {
        url = new URL(escaped);
    }
    catch {
        return undefined;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return undefined;
    }
    // Non-empty LEXICAL authority: rejects authority-less `https:example.com` and
    // empty-authority `https:///foo` / `http:////foo` / `https://?x`.
    if (!/^https?:\/\/[^/?#]/i.test(escaped) || url.host === "") {
        return undefined;
    }
    return escaped;
}
/**
 * The SCHEME-AGNOSTIC sibling of {@link safeHttpIri}: same escape-first +
 * leading/trailing-C0/space rejection, but it accepts ANY absolute `scheme:`
 * IRI — `urn:`, `did:`, `mailto:`, `http:`, … — rather than only http(s), and
 * does NOT require an authority (so authority-less schemes like `urn:` / `did:`
 * are accepted, not rejected).
 *
 * It validates that the escaped value parses as an ABSOLUTE URL (which implies
 * it carries a scheme) and returns the ESCAPED LEXICAL value; a schemeless /
 * relative reference (`/foo`, `foo/bar`, `#frag`) fails to parse and yields
 * `undefined`.
 *
 * Use this for object-position IRIs where the scheme is genuinely open (linking
 * to a `urn:`/`did:`/`mailto:` resource). For http(s) resource / WebID fields
 * use {@link safeHttpIri} instead — it additionally enforces the scheme and a
 * real authority.
 *
 * @param value - The untrusted candidate (any type).
 * @returns The injection-safe absolute IRI string, or `undefined` when `value`
 *   is not a usable absolute IRI.
 */
export function safeIri(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    if (hasEdgeControlOrSpace(value)) {
        return undefined;
    }
    const escaped = escapeIri(value);
    try {
        // `new URL(escaped)` with no base only parses ABSOLUTE references, so a
        // successful parse implies a scheme is present; relative refs throw.
        new URL(escaped);
    }
    catch {
        return undefined;
    }
    return escaped;
}
/**
 * A lexical SAFETY PREDICATE (NOT a canonical-equality check): `true` iff
 * `value` is a string, an absolute `http:`/`https:` URL, and contains NO raw
 * Turtle `IRIREF`-forbidden character (so it can be serialised inside `<…>`
 * without injecting).
 *
 * Unlike `value === safeHttpIri(value)`, this deliberately ACCEPTS benign
 * canonicalisation differences — a missing trailing slash, an upper-case host,
 * a present-or-absent default port — because such a value is already
 * injection-safe even though `safeHttpIri` would return a lexically-different
 * (equally-safe) string. Use it as a cheap guard/type-narrowing predicate; use
 * the `safeHttpIri(v) !== v` rule (below) only for EXACT-MATCH evaluation
 * fields where lexical identity matters.
 *
 * @param value - The candidate (any type).
 * @returns `true` (narrowing `value` to `string`) iff it is a raw-safe absolute
 *   http(s) IRI.
 */
export function isHttpIri(value) {
    if (typeof value !== "string") {
        return false;
    }
    if (containsForbidden(value)) {
        return false;
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
}
//# sourceMappingURL=iri.js.map