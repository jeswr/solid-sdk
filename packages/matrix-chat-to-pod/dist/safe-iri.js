// AUTHORED-BY Claude Fable 5
/**
 * Untrusted-IRI hardening for the n3.Writer / RDF write path.
 *
 * `n3.Writer` (and any RDF serializer that emits `<...>` IRIREFs) does NOT escape
 * the IRI it is given — it writes the string between the angle brackets verbatim.
 * So a value that reaches `namedNode()` carrying a `>` (or a newline, or any other
 * IRIREF-forbidden char) BREAKS OUT of the `<...>` and injects arbitrary triples
 * into the serialized document. In this package the injected document could be a
 * `.acl` — turning an owner-private container PUBLIC — so a bare "is it an http(s)
 * URL?" boolean check is NOT sufficient: `isHttpIri("https://x/a>...")` is `true`
 * yet the raw value still contains the breakout `>`.
 *
 * {@link safeHttpIri} closes this by returning the CANONICALISED form (never the
 * raw input):
 *  1. reject anything that is not an absolute `http:`/`https:` URL;
 *  2. canonicalise via the WHATWG URL parser (`new URL(v).href`), which
 *     percent-encodes `<`, `>`, `"`, spaces and C0 controls — the breakout chars;
 *  3. percent-encode the three IRIREF-forbidden chars the URL parser leaves alone
 *     (`|`, `^`, `` ` ``); and
 *  4. fail closed — if ANY IRIREF-forbidden char somehow survives, return
 *     `undefined` rather than emit an injectable IRI.
 *
 * The result is safe to hand to `namedNode()`: it is a well-formed absolute http(s)
 * IRI with no character that can escape a Turtle/N-Triples `<...>`.
 */
/**
 * IRIREF-forbidden characters per the Turtle grammar: the `#x00-#x20` control +
 * space range, plus `<` `>` `"` `{` `}` `|` `^` backtick and backslash. Used as a
 * fail-closed final guard after canonicalisation.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the IRIREF-forbidden C0 range is the point.
const IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|\\^`]/;
/**
 * Return an injection-safe, canonical absolute http(s) IRI for an UNTRUSTED value,
 * or `undefined` if the value is not a usable http(s) IRI. NEVER returns the raw
 * input — always the canonicalised, fully-escaped form (see module docs). Use this
 * (not a boolean `isHttpIri`) at every site where an untrusted string becomes a
 * `namedNode()` object/subject.
 */
export function safeHttpIri(value) {
    if (typeof value !== "string" || value.length === 0)
        return undefined;
    let href;
    try {
        const u = new URL(value);
        if (u.protocol !== "http:" && u.protocol !== "https:")
            return undefined;
        href = u.href;
    }
    catch {
        return undefined;
    }
    // The WHATWG URL parser percent-encodes the breakout chars (`<` `>` `"` space,
    // C0 controls) but leaves `|`, `^` and backtick un-encoded — all three are
    // IRIREF-forbidden, so encode them explicitly.
    const encoded = href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
    // Fail closed: any IRIREF-forbidden char that survived means we cannot emit a
    // safe `<...>` — drop the value rather than inject.
    if (IRIREF_FORBIDDEN.test(encoded))
        return undefined;
    return encoded;
}
/**
 * Canonicalise + validate a SOLID CONTAINER IRI, or `undefined` if it is not a
 * usable owner-lockable container. A container is the ACL anchor, so it must be
 * UNAMBIGUOUS: an injection-safe absolute http(s) IRI whose PATH ends in `/` and
 * that carries NO query (`?`) or fragment (`#`). Those are rejected because a
 * value like `https://pod.example/chat/?x=/` deceptively "ends in `/`" yet
 * `${container}.acl` would resolve to `https://pod.example/chat/?x=/.acl` — a
 * different resource than the real container ACL `https://pod.example/chat/.acl`,
 * so messages (resolving under `/chat/`) would land OUTSIDE the intended
 * owner-only ACL. The returned value is the ONE canonical container string every
 * caller must use for BOTH the ACL URL and every scope check — no downstream code
 * may re-derive from the raw input.
 */
export function canonicalContainer(container) {
    const safe = safeHttpIri(container);
    if (safe === undefined)
        return undefined;
    const u = new URL(safe);
    if (u.search !== "" || u.hash !== "")
        return undefined;
    if (!u.pathname.endsWith("/"))
        return undefined;
    // With no query/fragment, origin + pathname IS the canonical container.
    return `${u.origin}${u.pathname}`;
}
/**
 * True when `resourceUrl` is an http(s) IRI within the `base` container — SAME
 * origin AND a path strictly under the container's path. Both are canonicalised
 * through {@link safeHttpIri} first (so a `..`-escape or an injection char cannot
 * slip a write outside the base). Fail-closed: an unparseable/unsafe input is NOT
 * within base.
 */
export function isWithinBase(resourceUrl, base) {
    const safeResource = safeHttpIri(resourceUrl);
    const safeBase = safeHttpIri(base);
    if (safeResource === undefined || safeBase === undefined)
        return false;
    const r = new URL(safeResource);
    const b = new URL(safeBase);
    if (r.origin !== b.origin)
        return false;
    // `base` is a container; its canonical path ends with '/'. The resource path must
    // be a descendant (starts-with the container path, and is not the container itself).
    const basePath = b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`;
    return r.pathname.startsWith(basePath) && r.pathname.length > basePath.length;
}
/**
 * C0/C1 control characters that must NOT be persisted into a pod literal. TAB
 * (`\t` = 0x09), LF (`\n` = 0x0A) and CR (`\r` = 0x0D) are DELIBERATELY kept — they
 * are legitimate in a chat body (multi-line messages) and are safely escaped by the
 * Turtle writer. NUL and the rest (BEL, ESC, backspace, the C1 block, DEL, …) are
 * stripped so an imported message cannot smuggle a terminal-escape / display-
 * spoofing / log-injection control sequence into the stored resource.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point.
const STRIP_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Strip non-whitespace control characters from an untrusted text body. */
export function sanitizeText(value) {
    return value.replace(STRIP_CONTROL, "");
}
//# sourceMappingURL=safe-iri.js.map