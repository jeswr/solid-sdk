/**
 * A redirect response the driver refused to follow (credential-leak / SSRF guard).
 * A Solid pod addressed by exact URLs should not redirect a data request; when one
 * does, the driver fails closed rather than forwarding credentials to the redirect
 * target.
 */
export declare class SolidRedirectError extends Error {
    readonly url: string;
    readonly status: number;
    constructor(url: string, status: number);
}
/**
 * Wrap `fetchImpl` into the driver's data-path fetch: it asserts the target is
 * within `base`, forces manual redirect handling, and throws
 * {@link SolidRedirectError} on any redirect (leaving `304 Not Modified`, which is
 * not a redirect, untouched). `base` must already be normalised
 * (see `normalizeBase`).
 */
export declare function createScopedFetch(base: string, fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch;
/**
 * Wrap `fetchImpl` into the WATCH-path fetch: it asserts the target stays on
 * `origin` and refuses redirects, but — unlike {@link createScopedFetch} — does
 * NOT apply the base-PATH containment check.
 *
 * WHY a separate variant: notification discovery legitimately addresses
 * same-origin URLs OUTSIDE the driver `base` sub-tree (the pod's storage-description
 * document, the notification subscription endpoint), so the path-prefix check of
 * `createScopedFetch` would wrongly reject them. But those requests still carry the
 * caller's (possibly credentialed) headers, so they need the SAME redirect-refusal
 * guard: without it a pod-controlled same-origin description doc could `302` off
 * to a foreign origin and the underlying `fetch` would forward the headers there.
 * We force `redirect: "manual"` and throw {@link SolidRedirectError} on any
 * redirect (the watch layer catches it and degrades to a no-op). A cross-origin
 * TARGET is refused outright (fail-closed) so a credentialed request never leaves
 * `origin`.
 */
export declare function createSameOriginRedirectRefusingFetch(origin: string, fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch;
//# sourceMappingURL=scope.d.ts.map