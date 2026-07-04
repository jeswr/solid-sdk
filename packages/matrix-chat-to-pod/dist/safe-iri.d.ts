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
 * Return an injection-safe, canonical absolute http(s) IRI for an UNTRUSTED value,
 * or `undefined` if the value is not a usable http(s) IRI. NEVER returns the raw
 * input — always the canonicalised, fully-escaped form (see module docs). Use this
 * (not a boolean `isHttpIri`) at every site where an untrusted string becomes a
 * `namedNode()` object/subject.
 */
export declare function safeHttpIri(value: unknown): string | undefined;
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
export declare function canonicalContainer(container: unknown): string | undefined;
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
export declare function isWithinBase(resourceUrl: string, base: string): boolean;
/** Strip non-whitespace control characters from an untrusted text body. */
export declare function sanitizeText(value: string): string;
//# sourceMappingURL=safe-iri.d.ts.map