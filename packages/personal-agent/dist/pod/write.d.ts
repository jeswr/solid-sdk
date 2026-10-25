import type { PodFetch } from "../config.js";
/**
 * Fail CLOSED on any HTTP redirect on a trust-bearing request. Call BEFORE reading `res.ok`.
 * (The bridge enforces the same on its own writes but does not re-export its guard, so this
 * is the ONE local copy every pod request in this package shares.)
 */
export declare function refuseRedirect(res: Response, method: string, url: string): void;
/** Options for {@link putResource}. */
export interface PutOptions {
    /** The `Content-Type` of the body. */
    readonly contentType: string;
    /** `If-None-Match: *` — a create-only write (a `412` means "already exists"). */
    readonly ifNoneMatch?: "*";
    /** `If-Match: <etag>` — a compare-and-swap write (a `412` means "changed under us"). */
    readonly ifMatch?: string;
    /** When set, the target URL MUST resolve strictly within this base (fail-closed). */
    readonly base?: string;
}
/**
 * PUT `body` to `url` through the injected authed `fetch`, refusing redirects and
 * (optionally) enforcing the container scope. Returns the `Response` (inspect its
 * `.status` for a conditional-write `412`).
 */
export declare function putResource(fetchFn: PodFetch, url: string, body: string, options: PutOptions): Promise<Response>;
/** Throw unless the response is a 2xx — the "a write failure THROWS" contract. */
export declare function throwIfNotWritten(res: Response, url: string): Response;
//# sourceMappingURL=write.d.ts.map