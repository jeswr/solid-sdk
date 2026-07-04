import { isContainerUrl, normalizePodBase, redactUserinfo } from "@jeswr/guarded-fetch";
export { isContainerUrl, normalizePodBase, redactUserinfo };
/** A target whose resolved URL must lie under the pod base. */
export interface ResolvedTarget {
    /** The absolute, validated, CANONICAL URL to request. */
    readonly url: string;
    /** True iff the target is a container (LDP convention: a trailing slash). */
    readonly container: boolean;
}
/**
 * Backwards-compatible VOID assertion (public-API stability): throws unless `url`
 * is `base` itself or a descendant of it. Delegates to {@link assertWithinPodScope}
 * with `allowRoot: true` — the base counts as in-scope, matching this node's
 * original semantics (it never rejected the pod root). Prefer the RETURNING
 * `assertWithinPodScope` (re-derivable from `@jeswr/guarded-fetch`) for new code,
 * so the checked URL is the URL that is used.
 *
 * `url` MUST be an absolute http(s) URL (the pre-consolidation contract — roborev
 * Medium finding, 13311df): unlike {@link resolveTarget}, this assertion never
 * resolved a relative reference against `base`, so a caller passing a relative
 * string here while using the ORIGINAL (unresolved) string elsewhere would have
 * validated a different URL than the one it went on to use. Parsing `url` with
 * `new URL(url)` first (throwing on anything non-absolute) preserves that and
 * hands `assertWithinPodScope` the already-canonical absolute string.
 *
 * @throws Error if `url` is not an absolute URL.
 * @throws PodScopeError if `url` is not http(s), not same-origin, or escapes the base.
 */
export declare function assertWithinPod(base: string, url: string): void;
/**
 * Resolve a workflow-supplied `target` (absolute URL OR base-relative path) to an
 * absolute URL confirmed to lie under the pod `base`, returning the CANONICAL
 * (WHATWG-normalised) URL callers must use for the request.
 *
 * This is the n8n-specific wrapper over {@link assertWithinPodScope}. The ONE
 * convenience the shared primitive intentionally does not provide is that a
 * LEADING-SLASH target (`/notes/x.ttl`) re-roots RELATIVE TO THE BASE PATH rather
 * than to the origin root — so `resolveTarget(base, "/notes/x.ttl")` equals
 * `${base}notes/x.ttl`, NOT an escape to the origin root. The step order below is
 * load-bearing:
 *   1. reject an empty target;
 *   2. reject a scheme-relative (`//host`) target FIRST — before the leading-slash
 *      strip, else `//evil.example/x` would get its leading slashes stripped into a
 *      harmless-looking relative path and silently miss the scheme-relative refusal;
 *   3. only THEN, for a non-absolute target, strip leading `/`+ so it resolves
 *      relative to the base path;
 *   4. delegate credentials/origin/path/encoded-delimiter/traversal validation +
 *      canonicalisation to `assertWithinPodScope`, using its RETURNED canonical URL.
 *
 * @param base - the pod base (normalised via {@link normalizePodBase}; passing a
 *   non-normalised base is fine — the primitive normalises it, idempotently).
 * @param target - absolute http(s) URL, or a path relative to `base`.
 * @param options.allowRoot - whether the pod base itself (in EITHER its
 *   slash-terminated or slashless spelling — `assertWithinPodScope` treats them
 *   as the same root) counts as in-scope. Default `true` (matches the node's
 *   original read/list semantics — it never rejected the pod root). **Callers
 *   resolving a WRITE target (create/update/delete) MUST pass `false`**: with
 *   the default, a workflow-supplied target equal to the pod base MINUS its
 *   trailing slash (e.g. `https://pod.example/alice` against a base of
 *   `https://pod.example/alice/`) is accepted as an ordinary in-scope resource
 *   path — the pre-consolidation guard rejected that exact form outright (its
 *   strict `pathname.startsWith(basePath)` check does not treat a shorter,
 *   slash-less path as a prefix match), so accepting it widens the write
 *   boundary vs `main` (roborev finding, 13311df). `allowRoot: false` closes
 *   that gap by refusing BOTH root spellings for a write target.
 * @throws if the target is empty, not http(s), or resolves outside the pod.
 */
export declare function resolveTarget(base: string, target: string, options?: {
    readonly allowRoot?: boolean;
}): ResolvedTarget;
//# sourceMappingURL=scope.d.ts.map