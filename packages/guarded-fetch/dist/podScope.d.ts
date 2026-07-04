/** Raised when the pod-scope guard refuses a base, a candidate URL, or a redirect hop. */
export declare class PodScopeError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Options for the pod-scope checks. */
export interface PodScopeOptions {
    /**
     * Whether the base itself (the configured container, slash-terminated or not) counts as
     * within scope. Default `true` — reading/listing the configured container is in scope.
     * Set `false` for a WRITE-TARGET guard where documents are minted strictly UNDER the
     * base and touching the container document itself would clobber it (the rxdb-solid /
     * y-solid store semantics).
     */
    readonly allowRoot?: boolean;
}
/** Options for {@link createPodScopedFetch}. */
export interface PodScopedFetchOptions extends PodScopeOptions {
    /**
     * The underlying `fetch` to issue the (scope-checked, `redirect:"manual"`) requests
     * with. Defaults to `globalThis.fetch`. Pass an authenticated fetch here — the guard
     * threads it through unchanged; pass a {@link createGuardedFetch} result to stack the
     * SSRF policy under the scope check.
     */
    readonly fetch?: typeof globalThis.fetch;
    /** Maximum redirect hops to follow (default 5). Each hop is re-checked against the scope. */
    readonly maxRedirects?: number;
}
/**
 * Redact any embedded userinfo (`scheme://user:pass@host…` or a scheme-relative
 * `//user:pass@host…`) from a URL-ish string BEFORE it is interpolated into an error
 * message. Every validation error here echoes a user-controlled value, and consumers
 * surface those messages into logs / item output — so a target like `https://u:p@host/x`
 * must never leak its credentials through an error.
 *
 * This is a deliberately BROAD, best-effort textual scrub that also works on MALFORMED
 * input (where `new URL` threw, so the parser cannot be trusted — and a value like
 * `ht!tp://u:p@host/` has no RFC-valid scheme yet still carries a secret). It replaces
 * EVERY `//…@` authority-userinfo span (global, scheme-prefix-agnostic) with
 * `//<redacted>@`. The span is `[^/?#]*` (NOT excluding whitespace or `@`): a malformed
 * target like `https://alice:s3 cr3t@ho st/x` would otherwise slip the scrub and leak the
 * credential through the invalid-target error path. Over-redaction is safe here (these are
 * error strings, not requests); under-redaction would leak — so the rule errs toward
 * redacting.
 */
export declare function redactUserinfo(value: string): string;
/**
 * Normalise a pod base URL to a canonical container address: an absolute http(s) URL with
 * exactly one trailing `/`, no query/fragment, no embedded credentials, and no encoded
 * path delimiter. Throws {@link PodScopeError} otherwise. Every other function in this
 * module runs its `base` through this first, so callers may pass a non-normalised base —
 * but validating once at config time gives an earlier, clearer failure.
 */
export declare function normalizePodBase(base: string): string;
/**
 * Fail-closed assertion that `url` is within the pod scope rooted at `base`: same origin
 * AND path-prefixed under the base at a real segment boundary, http(s) only, with every
 * guard documented at the top of this module. `url` may be absolute (validated as-is
 * after WHATWG normalisation) or a relative reference (resolved against the base, then the
 * RESOLVED result is validated — so `.`/`..`/`%2e%2e` traversal is collapsed before the
 * check and cannot smuggle the target out).
 *
 * Returns the CANONICAL resolved URL string (use it as the request target, so the URL that
 * was checked is the URL that is fetched).
 *
 * @throws PodScopeError if the base is invalid or the candidate is out of scope.
 */
export declare function assertWithinPodScope(base: string, url: string, options?: PodScopeOptions): string;
/**
 * Boolean form of {@link assertWithinPodScope}: `true` iff `url` is within the pod scope
 * rooted at `base`. Fail-closed — ANY doubt (including an invalid base) returns `false`;
 * use {@link normalizePodBase} at config time if an invalid base should fail loudly.
 */
export declare function isWithinPodScope(base: string, url: string, options?: PodScopeOptions): boolean;
/**
 * Non-throwing FILTER form of {@link assertWithinPodScope}: the canonical in-scope URL
 * string, or `undefined` if `url` is out of scope (or the base is invalid). Use it to
 * DROP untrusted URLs — child entries from a container listing, type-index targets
 * discovered from a profile — rather than aborting the whole operation: a malicious
 * listing that points at an external origin is silently discarded (fail-closed).
 */
export declare function podScopedUrl(base: string, url: string, options?: PodScopeOptions): string | undefined;
/** True iff `url` is a container address (LDP convention: the path ends with `/`). */
export declare function isContainerUrl(url: string): boolean;
/**
 * Build a `fetch`-shaped POD-SCOPED fetch bound to `base`: every request URL AND every
 * redirect hop is checked with {@link assertWithinPodScope} before any bytes move, so a
 * poisoned in-scope resource cannot `302` the authenticated fetch out of the pod
 * (validating only the initial URL is NOT enough — default `fetch` auto-follows 3xx).
 *
 * Redirects are handled manually with standard Fetch semantics (bounded hops, loop
 * detection, method-changing redirects switch to GET and drop the body) via the same
 * shared machinery as {@link createGuardedFetch}. Because every hop must stay in scope,
 * every hop is same-origin by construction — credentials therefore survive an in-scope
 * redirect, and any out-of-scope hop throws {@link PodScopeError} instead of being
 * followed.
 *
 * This wrapper enforces SCOPE, not host safety — the base is trusted config. To also
 * apply the SSRF policy, pass a guarded fetch: `createPodScopedFetch(base, { fetch:
 * createGuardedFetch(opts) })`.
 *
 * @throws PodScopeError from the returned fetch when a request or redirect leaves the scope.
 */
export declare function createPodScopedFetch(base: string, options?: PodScopedFetchOptions): typeof globalThis.fetch;
//# sourceMappingURL=podScope.d.ts.map