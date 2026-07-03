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
//# sourceMappingURL=scope.d.ts.map