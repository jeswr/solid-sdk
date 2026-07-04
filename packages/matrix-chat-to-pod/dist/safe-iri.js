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
import { isWithinPodScope } from "@jeswr/guarded-fetch";
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
 * origin AND a path STRICTLY under the container's path (the container itself is
 * NOT within base — a strict descendant is required, matching `allowRoot: false`).
 *
 * Both inputs are canonicalised through {@link safeHttpIri} FIRST — this keeps the
 * RDF-injection-safety property explicit at this call site (a `..`-escape is
 * collapsed and any IRIREF-breakout char / non-http(s) scheme is rejected to
 * `undefined` before the scope check runs). The origin + segment-boundary
 * path-prefix + traversal/encoded-delimiter checks are then DELEGATED to
 * `@jeswr/guarded-fetch`'s consolidated pod-scope primitive
 * ({@link isWithinPodScope}) — the suite's ONE reviewed home for "is this URL
 * within the configured pod (sub-)container?".
 *
 * NOTE the argument order: this function's external signature is
 * `(resourceUrl, base)` (its callers depend on it), whereas `isWithinPodScope`
 * takes `(base, url)` — so the arguments are SWAPPED at the delegation call.
 *
 * Fail-closed: an unparseable/unsafe input (or any doubt inside the scope check)
 * is NOT within base.
 */
export function isWithinBase(resourceUrl, base) {
    const safeResource = safeHttpIri(resourceUrl);
    const safeBase = safeHttpIri(base);
    if (safeResource === undefined || safeBase === undefined)
        return false;
    // Delegate the origin/segment-boundary/traversal/encoded-delimiter checks to the
    // consolidated guard. `allowRoot: false` preserves this function's strict-
    // descendant contract (the container document itself is out of base). Argument
    // order is (base, url) here — swapped from this function's own (resourceUrl, base).
    return isWithinPodScope(safeBase, safeResource, { allowRoot: false });
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