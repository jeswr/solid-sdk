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
export declare function escapeIri(value: string): string;
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
export declare function safeHttpIri(value: unknown): string | undefined;
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
export declare function safeIri(value: unknown): string | undefined;
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
export declare function isHttpIri(value: unknown): value is string;
//# sourceMappingURL=iri.d.ts.map