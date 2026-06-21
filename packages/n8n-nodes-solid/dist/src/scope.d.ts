/** A target whose resolved URL must lie under the pod base. */
export interface ResolvedTarget {
    /** The absolute, validated URL to request. */
    readonly url: string;
    /** True iff the target is a container (LDP convention: a trailing slash). */
    readonly container: boolean;
}
/**
 * Redact any embedded userinfo (`scheme://user:pass@host…` or a scheme-relative
 * `//user:pass@host…`) from a URL-ish string BEFORE it is interpolated into an
 * error message. Every validation error here echoes a user-controlled value, and
 * the node surfaces those messages as item JSON under `continueOnFail` (and into
 * logs) — so a target like `https://u:p@host/x` must never leak its credentials
 * through an error.
 *
 * This is a deliberately BROAD, best-effort textual scrub that also works on
 * MALFORMED input (where `new URL` threw, so we cannot trust the parser — and a
 * value like `ht!tp://u:p@host/` has no RFC-valid scheme yet still carries a
 * secret). It replaces the `user[:pass]@` of EVERY `//…@host` authority in the
 * string (global, scheme-prefix-agnostic) with `<redacted>@`. Over-redaction is
 * safe here (these are error strings, not requests); under-redaction would leak —
 * so the rule errs toward redacting. The userinfo (RFC 3986) excludes `/?#@`, so
 * a `//` not followed by userinfo-then-`@` (e.g. a `//a/b` path) is left alone.
 */
export declare function redactUserinfo(value: string): string;
/**
 * Normalise a pod base URL to exactly one trailing slash. Throws if the base is
 * not an absolute http(s) URL.
 */
export declare function normalizePodBase(base: string): string;
/**
 * Fail-closed assertion that `url` is `base` itself or a strict descendant of it
 * (same origin, path prefixed by the base path, http(s) scheme). Guards against
 * any normalisation/encoding trick producing a URL outside the pod sub-tree.
 *
 * @throws if `url` is not http(s), not same-origin, or not path-prefixed by base.
 */
export declare function assertWithinPod(base: string, url: string): void;
/**
 * Resolve a workflow-supplied `target` (absolute URL OR base-relative path) to an
 * absolute URL confirmed to lie under the normalised pod `base`.
 *
 * The WHATWG `URL` constructor resolves a relative reference against the base and
 * collapses `.`/`..`; we then re-validate the COLLAPSED result with
 * {@link assertWithinPod}, so a `../../etc` style traversal cannot escape — the
 * thing we check is the already-collapsed URL.
 *
 * @param base - the normalised pod base (see {@link normalizePodBase}).
 * @param target - absolute http(s) URL, or a path relative to `base`.
 * @throws if the target is empty, not http(s), or resolves outside the pod.
 */
export declare function resolveTarget(base: string, target: string): ResolvedTarget;
/** True iff `url` is a container (LDP convention: the path ends with `/`). */
export declare function isContainerUrl(url: string): boolean;
//# sourceMappingURL=scope.d.ts.map