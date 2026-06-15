import { BodyTooLargeError } from "./body.js";
import { type LookupAddress } from "./ssrf.js";
export { SsrfError } from "./ssrf.js";
export { BodyTooLargeError };
/** Raised by guardedFetch for non-SSRF failures (bad scheme/port, disallowed content-type, redirect
 * cap, redirect loop, scheme downgrade, a refused POST redirect, network error). SSRF failures
 * throw {@link SsrfError}. */
export declare class GuardedFetchError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export interface GuardedFetchOptions {
    /** HTTP method. Default `GET`. A `POST` sends `body` and refuses to follow ANY redirect. */
    readonly method?: "GET" | "POST";
    /** Request body (POST only). */
    readonly body?: string;
    /** Accept header to send. Default: the RDF accept set. */
    readonly accept?: string;
    /** Additional request headers (the guard always sets User-Agent + Accept; these merge over them). */
    readonly headers?: Record<string, string>;
    /** Max response body bytes. Default `MAX_BYTES_PROFILE` from config. */
    readonly maxBytes?: number;
    /** Total timeout (ms) spanning fetch + redirects + body. Default `FETCH_TIMEOUT_MS` from config. */
    readonly timeoutMs?: number;
    /** Max redirects followed (GET only; a POST never follows a redirect). Default `MAX_REDIRECTS`. */
    readonly maxRedirects?: number;
    /** Allowed final-response content-types (bare media type). Default: the RDF set. */
    readonly allowedContentTypes?: readonly string[];
    /**
     * Skip the content-type allowlist on the final response (used for an LDN POST whose receipt is
     * not RDF we parse). The body is still bounded; we just do not refuse a non-RDF content-type.
     */
    readonly skipContentTypeAllowlist?: boolean;
    /**
     * TEST/DEV ONLY: permit loopback (127.0.0.1, ::1) targets and `http:` to a loopback host. NEVER
     * set in production — this is the documented test hook so a fixture server on 127.0.0.1 is
     * reachable. Production code MUST leave this false (the default).
     */
    readonly allowLoopback?: boolean;
    /** Inject a DNS lookup (tests — e.g. the rebinding stub). Defaults to `node:dns/promises`. */
    readonly dnsLookup?: (host: string) => Promise<LookupAddress[]>;
    /** Conditional request validators (forwarded as If-None-Match / If-Modified-Since). */
    readonly conditional?: {
        readonly etag?: string;
        readonly lastModified?: string;
    };
}
export interface GuardedFetchResult {
    /** The final (post-redirect) response. Body has NOT been read off it; use `text`/`bytes`. */
    readonly response: Response;
    /** The final resolved URL (after redirects). */
    readonly finalUrl: string;
    /** The bare media type of the final response (lower-cased, no parameters). */
    readonly contentType: string;
    /** The bounded response body as UTF-8 text. */
    readonly text: string;
    /** The bounded response body as raw bytes. */
    readonly bytes: Uint8Array;
    /** HTTP status of the final response. */
    readonly status: number;
}
/** Per-hop scheme + port gate. 443 always; 80 only under loopback (dev/tests). `prevWasHttps`
 * rejects a downgrade redirect (https → http). Exported for exhaustive unit testing of the
 * scheme/port/downgrade branches. */
export declare function assertSchemeAndPort(url: URL, allowLoopback: boolean, prevWasHttps: boolean): void;
/**
 * Fetch an attacker-influenced URL with full SSRF defence-in-depth. Returns the final response, the
 * resolved URL, the content-type, and the bounded body. Throws {@link SsrfError} for an SSRF refusal
 * (private/loopback/denied target, rebinding), {@link GuardedFetchError} for any other guard failure
 * (bad scheme/port, redirect cap/loop/downgrade, refused POST redirect, disallowed content-type,
 * network/timeout), or {@link BodyTooLargeError} for an over-cap body.
 */
export declare function guardedFetch(rawUrl: string, opts?: GuardedFetchOptions): Promise<GuardedFetchResult>;
//# sourceMappingURL=guardedFetch.d.ts.map