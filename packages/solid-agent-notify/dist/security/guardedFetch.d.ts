import { BodyTooLargeError } from "./body.js";
import type { LookupAddress } from "./ssrf.js";
import { SsrfError } from "./ssrf.js";
export { SsrfError };
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
/**
 * Fetch an attacker-influenced URL with full SSRF defence-in-depth. Returns the final response, the
 * resolved URL, the content-type, and the bounded body. Throws {@link SsrfError} for an SSRF refusal
 * (private/loopback/denied target, rebinding), {@link GuardedFetchError} for any other guard failure
 * (bad scheme/port, redirect cap/loop/downgrade, refused POST redirect, disallowed content-type,
 * network/timeout), or {@link BodyTooLargeError} for an over-cap body.
 */
export declare function guardedFetch(rawUrl: string, opts?: GuardedFetchOptions): Promise<GuardedFetchResult>;
/**
 * Per-hop scheme + port + userinfo + downgrade gate, throwing {@link GuardedFetchError} (the policy
 * error, not the SSRF security boundary). Mirrors the historical agent-notify gate (same 3-arg
 * signature) so the public error TAXONOMY is unchanged: https-only (http: only under
 * `allowLoopback`); a scheme-downgrade redirect (https → http) rejected when `prevWasHttps`; no
 * userinfo; 443 always, any port under loopback (a fixture binds an ephemeral port).
 *
 * `guardedFetch` calls this ONLY on the FIRST URL (so `prevWasHttps` is false there); the per-hop
 * redirect re-validation — including the downgrade refusal — is owned end-to-end by
 * `@jeswr/guarded-fetch` (this is belt-and-braces, not the sole enforcement). The `prevWasHttps`
 * parameter + the downgrade branch are retained so the helper stays a faithful, exhaustively
 * unit-testable front gate (it is exported for that purpose; it is NOT part of the package's public
 * `.` entry — the only declared `exports` subpath).
 */
export declare function assertSchemeAndPort(url: URL, allowLoopback: boolean, prevWasHttps?: boolean): void;
/**
 * Map a thrown guarded-fetch error to agent-notify's public error taxonomy:
 *  - a BODY-CAP `SsrfError` → {@link BodyTooLargeError} (the public over-cap type, FIRST so it wins
 *    regardless of method/status);
 *  - a TIMEOUT or redirect-management `SsrfError` → {@link GuardedFetchError} (policy/non-SSRF);
 *  - for a POST, a redirect-management `SsrfError` → the confused-deputy {@link GuardedFetchError}
 *    (a POST refuses to follow ANY 3xx, so the `maxRedirects:0` cap firing IS the refusal);
 *  - any other `SsrfError` (private/loopback/denied/rebinding TARGET) → re-thrown UNCHANGED so
 *    `instanceof SsrfError` still holds at the call site;
 *  - anything else (a genuine network error) → {@link GuardedFetchError}.
 *
 * Exported for exhaustive unit testing of the error-taxonomy mapping (it is NOT part of the
 * package's public `.` entry — the only declared `exports` subpath).
 */
export declare function classifyGuardError(error: unknown, rawUrl: string, method: "GET" | "POST"): Error;
//# sourceMappingURL=guardedFetch.d.ts.map