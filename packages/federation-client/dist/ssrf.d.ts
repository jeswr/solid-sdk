/** Raised when the SSRF guard refuses a URL / redirect / oversize body. */
export declare class SsrfError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** The shape of `node:dns/promises#lookup(host, { all: true })`. */
export interface ResolvedAddress {
    readonly address: string;
    readonly family: number;
}
/** A DNS lookup function — `host → all resolved addresses`. Injected for tests. */
export type DnsLookup = (host: string) => Promise<ResolvedAddress[]>;
/** Options for {@link guardedFetch} / {@link createGuardedFetch}. */
export interface GuardOptions {
    /**
     * The underlying `fetch` to issue the (guarded, `redirect: "manual"`) requests
     * with. Defaults to `globalThis.fetch`. Pass an authenticated fetch here — the guard
     * threads it through unchanged.
     *
     * NOTE: a plain auth/custom `fetch` does NOT, by itself, pin DNS — so supplying it
     * does NOT satisfy {@link GuardOptions.requireDnsPinning}. To assert a fetch pins
     * the connection to the resolved address (closing the rebinding window), pass it as
     * {@link GuardOptions.pinningFetch} instead, which is the ONLY thing that satisfies
     * the strict posture.
     */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * A fetch the caller **explicitly asserts pins DNS** to the resolved address (e.g.
     * an undici-`Agent` fetch with a pinned `lookup`), closing the lookup→connect
     * rebinding window. This is a DISTINCT, branded assertion: only setting `pinningFetch`
     * (not the generic {@link GuardOptions.fetch}) satisfies {@link
     * GuardOptions.requireDnsPinning} for a hostname target. When both are set,
     * `pinningFetch` is used as the underlying fetch. The guard does NOT verify the
     * pinning claim (it cannot) — the field is the caller's explicit attestation, so a
     * plain `globalThis.fetch` can never silently masquerade as pinning.
     */
    readonly pinningFetch?: typeof globalThis.fetch;
    /**
     * A DNS lookup for hostname classification. Defaults to Node's
     * `dns/promises.lookup(host, { all: true })` when available. Pass `null` to
     * explicitly declare NO DNS is available (a non-Node runtime); then a hostname
     * that is not an IP literal is REFUSED — fail closed — because the guard cannot
     * verify where it resolves, unless {@link GuardOptions.allowUnresolvedHosts} is set.
     * Injected in tests to drive the rebinding cases deterministically.
     */
    readonly dnsLookup?: DnsLookup | null;
    /**
     * Maximum response body size in bytes (default 1 MiB). A declared `Content-Length`
     * over the cap is rejected up front; the streamed body is rejected on overflow.
     */
    readonly maxBytes?: number;
    /** Total deadline for the whole operation (fetch + redirects + body), ms. Default 10s. */
    readonly timeoutMs?: number;
    /** Maximum redirect hops to follow (default 5). Each hop is re-guarded. */
    readonly maxRedirects?: number;
    /**
     * Dev/test ONLY: re-permit `http:` AND loopback addresses (a local registry on
     * `http://localhost:3000`). Off by default — production registries are https
     * public origins. Even when on, a non-loopback private address is still refused.
     */
    readonly allowLoopback?: boolean;
    /**
     * When no DNS lookup is available (non-Node runtime) AND the host is not an IP
     * literal, permit the request anyway instead of failing closed. Default `false`
     * (refuse). Set `true` only if you accept that hostname targets cannot be
     * classified in that environment and you trust the URL source.
     */
    readonly allowUnresolvedHosts?: boolean;
    /**
     * **DNS-rebinding posture (security-strict).** With plain `fetch` the guard
     * validates a hostname's resolved addresses but cannot pin the socket to them, so a
     * hostile DNS server could in principle return a public address during validation
     * and a private one microseconds later at connect time (a TOCTOU window). When set
     * `true`, the guard **refuses a hostname target unless a {@link
     * GuardOptions.pinningFetch} was supplied** — the explicit, branded pinning
     * attestation. A hostname through the default `globalThis.fetch` OR through a plain
     * (non-pinning) {@link GuardOptions.fetch} is rejected: a generic auth/custom fetch
     * can NOT silently satisfy the strict posture. IP-literal targets (which need no
     * resolution and have no rebinding window) are always allowed regardless. Default
     * `false` — the usable best-effort posture: DNS validation + redirect re-validation,
     * with the documented residual window. Set `true` (plus `pinningFetch`) for a
     * hardened deployment.
     */
    readonly requireDnsPinning?: boolean;
}
/**
 * Build a `fetch`-shaped guarded fetcher bound to the given options. The returned
 * function has the `typeof globalThis.fetch` signature so it can be passed straight
 * into `@jeswr/federation-registry`'s `parseRegistry({ fetch })` / `parseStorage`,
 * which call it (via `@jeswr/fetch-rdf`) with `(url, { headers, signal? })`. The
 * guard validates the URL + every redirect hop, caps the body, and bounds the time.
 */
export declare function createGuardedFetch(options?: GuardOptions): typeof globalThis.fetch;
/**
 * One-shot guarded fetch (constructs a guard per call). Prefer
 * {@link createGuardedFetch} when issuing many requests with the same policy.
 */
export declare function guardedFetch(input: RequestInfo | URL, init?: RequestInit & GuardOptions): Promise<Response>;
/**
 * Classify an IPv4/IPv6 literal as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback only.
 */
export declare function isPublicAddress(address: string, allowLoopback: boolean): boolean;
/** Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). */
export declare function isLoopbackAddress(address: string): boolean;
//# sourceMappingURL=ssrf.d.ts.map