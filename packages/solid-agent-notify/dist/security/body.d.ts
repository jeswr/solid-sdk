/**
 * Bounded body reader: stream a `Response` body up to a byte cap, refusing an over-cap declared
 * `Content-Length` up front and aborting mid-stream if the cap is exceeded.
 *
 * VENDORED from `solid-webid-index` `src/lib/security/body.ts` (itself from the prod-solid-server
 * `packages/guarded-fetch` copy). Each caller wraps {@link BodyTooLargeError} in its own domain
 * error where useful.
 */
/** Raised when a response body exceeds the byte cap (declared or streamed). */
export declare class BodyTooLargeError extends Error {
    constructor(message: string);
}
export interface ReadBoundedOptions {
    /** Maximum body size in bytes. */
    readonly maxBytes: number;
    /**
     * Optional AbortController to `.abort()` when the cap is exceeded — guardedFetch shares one
     * controller across the whole fetch (request + redirects + body) so an over-cap body also tears
     * down the in-flight request. When omitted the reader cancels its own stream reader.
     */
    readonly controller?: AbortController;
}
/** Stream `res.body` enforcing `maxBytes`, returning the raw bytes. Up-front rejects over-cap
 * `Content-Length`; aborts on overflow. An absent body returns an empty `Uint8Array`. */
export declare function readBoundedBytes(res: Response, opts: ReadBoundedOptions): Promise<Uint8Array>;
//# sourceMappingURL=body.d.ts.map