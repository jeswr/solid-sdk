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
 * @throws if the target is empty, not http(s), or resolves outside the pod.
 */
export declare function resolveTarget(base: string, target: string): ResolvedTarget;
//# sourceMappingURL=scope.d.ts.map