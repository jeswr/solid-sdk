/** A chunk yielded by a streamed response body — bytes or a decoded string. */
export type BodyChunk = Uint8Array | string;
/**
 * The response shape `safeFetch` consumes. `body` is OPTIONAL: when present (the
 * real WHATWG `fetch` returns a `ReadableStream` here), `safeFetch` reads it via
 * the shared guarded-fetch body-cap logic. When absent, the guard falls back to an
 * empty body (matching standard `Response` semantics for a bodyless response).
 */
export interface SafeFetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
    body?: ReadableStream<Uint8Array> | null;
}
/** A minimal structural fetch type — `typeof globalThis.fetch`-compatible. */
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "manual" | "error";
    signal?: AbortSignal;
}) => Promise<SafeFetchResponse>;
export interface SafeFetchOptions {
    /** Injected fetch (auth-fetch seam / test stub). Defaults to the Node DNS-pinned guard. */
    fetch?: FetchLike;
    /** Request timeout in milliseconds. Default 15000. */
    timeoutMs?: number;
    /** Max response body size in bytes. Default 5 MiB. */
    maxBytes?: number;
}
export declare class SafeFetchError extends Error {
    readonly code: "scheme" | "credentials" | "blocked-host" | "redirect" | "timeout" | "too-large" | "http" | "network" | "guard";
    readonly status?: number;
    constructor(code: SafeFetchError["code"], message: string, status?: number, options?: {
        cause?: unknown;
    });
}
/**
 * Validate a target URL for SSRF safety. Throws {@link SafeFetchError} on any
 * violation. Exported for reuse by callers that want to vet a user-supplied base
 * URL up front (e.g. at config time). ASYNC — see the module doc for why.
 */
export declare function assertSafeUrl(rawUrl: string): Promise<URL>;
/**
 * Perform an SSRF-guarded GET (or other method) and return the response text.
 * Throws {@link SafeFetchError} on any guard violation, non-2xx, a redirect,
 * timeout, or an oversize body.
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