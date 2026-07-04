/**
 * Raised when {@link refuseRedirects} refuses a redirect response instead of following it.
 * Distinct from {@link ../guard.js SsrfError} (host safety) and {@link ../podScope.js
 * PodScopeError} (capability scope): this is the credential-safety refusal — the request itself
 * was allowed, but its response was a redirect the wrapper will not follow.
 */
export declare class RedirectRefusedError extends Error {
    /** The request URL that returned the refused redirect (userinfo redacted). */
    readonly url: string;
    /**
     * The redirect status. `0` for a browser opaque-redirect, whose real 3xx status is masked by
     * the Fetch spec's response filtering (the wrapper still refuses it).
     */
    readonly status: number;
    /**
     * The `Location` header (userinfo redacted), when readable — `undefined` for a browser
     * opaque-redirect (whose headers are stripped) or a redirect with no `Location`.
     */
    readonly location: string | undefined;
    constructor(message: string, detail: {
        url: string;
        status: number;
        location?: string;
        cause?: unknown;
    });
}
/**
 * Wrap `fetch` so it REFUSES (throws {@link RedirectRefusedError}) instead of following any
 * redirect. The returned function forces `redirect:"manual"` on every request (overriding a
 * caller-supplied `redirect` mode), and throws when the response is a redirect (a 3xx moved
 * status on Node, or a browser opaque-redirect). A non-redirect response is returned unchanged,
 * with its body untouched.
 *
 * Pass an AUTHENTICATED fetch as the argument to guard a credentialed call
 * (`refuseRedirects(authedFetch)`); use it for any trust-bearing request where a redirect is
 * not an expected part of the protocol. To ALSO SSRF-validate the target, compose with
 * {@link ../guard.js createGuardedFetch}: `createGuardedFetch({ fetch: refuseRedirects(authed) })`.
 *
 * @param fetch The underlying fetch to issue the (manual-redirect) request. Defaults to
 *   `globalThis.fetch`.
 */
export declare function refuseRedirects(fetch?: typeof globalThis.fetch): typeof globalThis.fetch;
//# sourceMappingURL=refuseRedirects.d.ts.map