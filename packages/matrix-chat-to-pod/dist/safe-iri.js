// AUTHORED-BY Claude Fable 5
/**
 * Repo-specific untrusted-input hardening for the n3.Writer / RDF write path — the
 * pieces that are SPECIFIC to importing Matrix chat into a Solid pod (an
 * owner-lockable container anchor, a strict-descendant write-scope check, and a
 * chat-body control-char sanitiser).
 *
 * The generic IRI-injection guard — "make an untrusted string safe to hand to
 * `namedNode()` so it cannot break out of a Turtle `<...>` and inject triples" —
 * is NO LONGER implemented here. It now lives in the ONE audited suite home,
 * `@jeswr/rdf-serialize` ({@link safeHttpIri}), consolidated from the ~6 hand-copied
 * variants across the suite (each hardened independently over ~40 cumulative
 * adversarial review rounds). This module RE-EXPORTS it so callers keep a single
 * import site, and composes it into the two repo-specific helpers below.
 *
 * IMPORTANT — LEXICAL, not `.href`-canonical. The canonical {@link safeHttpIri}
 * returns the injection-safe ESCAPED LEXICAL value (every IRIREF-forbidden byte
 * percent-encoded), NEVER `new URL(v).href`. This is the intended behaviour: RDF
 * identity is lexical, so a WebID / message IRI must be stored byte-for-byte as
 * given (minus the dangerous bytes) rather than silently canonicalised (host
 * lower-cased, `:443` dropped, a trailing `/` appended, dot-segments collapsed) —
 * canonicalisation would change the NamedNode's identity. The injection-safety
 * property (no raw `<` `>` `"` space / C0 control can survive) is unchanged. Where
 * this package genuinely NEEDS an unambiguous canonical form — the container ACL
 * anchor — {@link canonicalContainer} derives it EXPLICITLY (its own `new URL()`
 * origin+path re-derivation), not as a side effect of the IRI guard.
 */
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { safeHttpIri } from "@jeswr/rdf-serialize";
// Re-export the canonical suite IRI guard so this package's write path keeps ONE
// import site (`./safe-iri.js`) for it. It is the DEFINITIVE http(s)-only,
// injection-safe, lexical guard for an untrusted value that becomes a
// `namedNode()` — use it (never a boolean `isHttpIri`) at every such site.
export { safeHttpIri };
/**
 * Percent-encoded path-delimiter characters (`%2F` = `/`, `%5C` = `\`). Matches
 * `@jeswr/guarded-fetch`'s `normalizePodBase` `ENCODED_DELIMITER` check exactly
 * (case-insensitive) -- see {@link canonicalContainer} for why this must be
 * rejected here too, not just at the delegated scope check inside {@link isWithinBase}.
 */
const ENCODED_PATH_DELIMITER = /%2f|%5c/i;
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
 *
 * This is the ONE place in this package that deliberately CANONICALISES (as opposed
 * to the lexical {@link safeHttpIri}): after the injection guard runs it re-parses
 * with `new URL()` and returns `${origin}${pathname}`, so an origin-only input
 * (`https://x.example`) gains the container trailing slash and the host is
 * origin-normalised — the container identity MUST be unambiguous for the ACL to
 * bind, which is exactly the case where canonicalisation is correct.
 *
 * ALSO rejects a path carrying an encoded delimiter (`%2F`/`%5C`, case-insensitive
 * — {@link ENCODED_PATH_DELIMITER}). This mirrors `@jeswr/guarded-fetch`'s
 * `normalizePodBase`, which every write-target check now runs through via
 * {@link isWithinBase}. Without this check here, `importRoot()` could accept such
 * a container, write its ACL (a real side effect), and only THEN discover — at
 * every subsequent per-message `isWithinBase` scope check — that the delegated
 * guard rejects the base outright, silently dropping every message as
 * out-of-scope. Rejecting up front at the container gate avoids that write-then-
 * reject-everything trap and keeps `canonicalContainer` in lockstep with the
 * scope check its own output feeds.
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
    if (ENCODED_PATH_DELIMITER.test(u.pathname))
        return undefined;
    // With no query/fragment/encoded-delimiter, origin + pathname IS the canonical container.
    return `${u.origin}${u.pathname}`;
}
/**
 * True when `resourceUrl` is an http(s) IRI within the `base` container — SAME
 * origin AND a path STRICTLY under the container's path (the container itself is
 * NOT within base — a strict descendant is required, matching `allowRoot: false`).
 *
 * Both inputs are passed through {@link safeHttpIri} FIRST — this keeps the
 * RDF-injection-safety property explicit at this call site (a non-http(s) scheme
 * or any IRIREF-breakout char is escaped / rejected to `undefined` before the
 * scope check runs). The origin + segment-boundary path-prefix +
 * traversal/encoded-delimiter checks are then DELEGATED to `@jeswr/guarded-fetch`'s
 * consolidated pod-scope primitive ({@link isWithinPodScope}) — the suite's ONE
 * reviewed home for "is this URL within the configured pod (sub-)container?".
 *
 * NOTE the `safeHttpIri` here is LEXICAL (it does not collapse `.`/`..`), but the
 * traversal check is NOT weakened: `isWithinPodScope` re-parses each input with
 * `new URL()`, which collapses dot-segments FIRST and validates the COLLAPSED
 * result — so a `..`-escape still fails the scope check exactly as before.
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