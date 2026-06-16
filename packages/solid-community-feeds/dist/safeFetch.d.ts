/**
 * SSRF-safe fetch wrapper.
 *
 * The Matrix homeserver and Discourse forum base URLs are USER-CONFIGURED, so an
 * attacker (or a careless user) could point them at an internal target
 * (`http://169.254.169.254/`, `http://localhost:…`, an RFC1918 host). Every
 * outbound request this package makes goes through {@link safeFetch}, which:
 *
 *   1. requires `https:` (no `http:`, no `file:`/`data:`/other schemes);
 *   2. rejects credentials embedded in the URL (`https://user:pass@host`);
 *   3. blocks literal-IP hosts in private / loopback / link-local / reserved
 *      ranges (IPv4 + IPv6), incl. the cloud metadata IP, AND known local /
 *      internal HOSTNAMES (`localhost`, `*.local`, `*.internal`, …);
 *   4. caps the response body size (default 5 MiB): a `Content-Length` pre-check
 *      rejects a declared-oversize body up front, and the body is then read
 *      INCREMENTALLY from the response stream, aborting the instant the byte
 *      count passes the cap — so a lying/absent `Content-Length` cannot force an
 *      unbounded buffer (a `text()` fallback + post-read cap covers seams that
 *      expose no stream);
 *   5. applies a request timeout (default 15 s) via AbortController that stays
 *      ACTIVE THROUGH THE BODY READ — a server can send headers fast then dribble
 *      the body forever, so clearing the timer at headers (a classic bug) would
 *      let the read hang; the timer is cleared only after the body resolves;
 *   6. does NOT follow redirects automatically (`redirect: "manual"`) — a 30x to
 *      an internal host is a classic SSRF bypass; a redirect is surfaced as an
 *      error rather than silently chased.
 *
 * It does NOT resolve DNS itself (that needs a Node-only resolver and would break
 * the browser); literal-IP hosts + local hostnames are blocked synchronously, and
 * DNS-name targets are constrained by the https-only + no-redirect + timeout +
 * size-cap envelope. For a hard guarantee against DNS-rebinding to internal hosts,
 * a server-side deployment should additionally pin DNS (cf. prod-solid-server's
 * webidResolver).
 *
 * The `fetch` itself is INJECTED (`opts.fetch`) so the suite's auth-`fetch` seam
 * and tests can substitute it — the default is the global `fetch`.
 */
/** A chunk yielded by a streamed response body — bytes or a decoded string. */
export type BodyChunk = Uint8Array | string;
/**
 * The response shape `safeFetch` consumes. `body` is OPTIONAL: when present (the
 * real WHATWG `fetch` returns a `ReadableStream` here, which is async-iterable in
 * Node 18+), `safeFetch` reads it INCREMENTALLY and aborts the moment the byte
 * count exceeds `maxBytes` — so an untrusted oversized body is never fully
 * buffered (a memory-DoS guard). When `body` is absent, it falls back to
 * `text()` with a post-read byte cap.
 */
export interface SafeFetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
    body?: AsyncIterable<BodyChunk> | null;
}
/** A minimal structural fetch type so we don't depend on lib.dom's exact shape. */
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "manual" | "error";
    signal?: AbortSignal;
}) => Promise<SafeFetchResponse>;
export interface SafeFetchOptions {
    /** Injected fetch (auth-fetch seam / test stub). Defaults to global `fetch`. */
    fetch?: FetchLike;
    /** Request timeout in milliseconds. Default 15000. */
    timeoutMs?: number;
    /** Max response body size in bytes. Default 5 MiB. */
    maxBytes?: number;
}
export declare class SafeFetchError extends Error {
    readonly code: "scheme" | "credentials" | "blocked-host" | "redirect" | "timeout" | "too-large" | "http" | "network";
    readonly status?: number;
    constructor(code: SafeFetchError["code"], message: string, status?: number);
}
/**
 * Validate a target URL for SSRF safety and return the parsed URL. Throws
 * {@link SafeFetchError} on any violation. Exported for reuse by callers that
 * want to validate a user-supplied base URL up front (e.g. at config time).
 */
export declare function assertSafeUrl(rawUrl: string): URL;
/**
 * Perform an SSRF-guarded GET (or other method) and return the response text.
 * The body is read in a size-capped fashion; the call times out after
 * `timeoutMs`. Throws {@link SafeFetchError} on any guard violation, non-2xx, a
 * redirect, timeout, or an oversize body.
 */
export declare function safeFetch(rawUrl: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}, opts?: SafeFetchOptions): Promise<{
    status: number;
    body: string;
}>;
/** Parse a safe-fetched JSON body, throwing a typed error on malformed JSON. */
export declare function safeFetchJson<T>(rawUrl: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}, opts?: SafeFetchOptions): Promise<T>;
//# sourceMappingURL=safeFetch.d.ts.map