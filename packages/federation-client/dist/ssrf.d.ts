/** Raised when the SSRF guard refuses a URL / redirect / oversize body. */
export declare class SsrfError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export { classifyIpLiteral, isLoopbackAddress, isPublicAddress } from "./ip.js";
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
     * A DNS lookup for hostname classification — selects the guard BRANCH. Defaults to
     * Node's `dns/promises.lookup(host, { all: true })` when running on Node (the NODE
     * branch: full DNS-resolve + every-record-public + rebinding mitigation). Pass `null`
     * to force the DNS-LESS branch (a syntactic guard: https-only, no userinfo,
     * private/loopback/metadata LITERALS blocked, `localhost`/`*.localhost`/`*.local` names
     * blocked, http: bound to loopback names, each redirect re-validated). On the DNS-less
     * branch a public-LOOKING hostname (no resolver to verify it) is allowed ONLY in a
     * positively-identified BROWSER (`window === globalThis`) — the documented residual; in
     * any other DNS-less runtime (edge / Workers / Deno / a DOM-shimmed SSR process) it
     * FAILS CLOSED unless {@link GuardOptions.allowUnresolvedHosts} is set. Injected in
     * tests to drive the rebinding cases (Node branch) and the DNS-less cases (`null`)
     * deterministically.
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
     * DNS-less branch only (no DNS resolver). Accepts the no-resolver residual for a
     * public-looking HOSTNAME target. It is needed in TWO DNS-less situations; in a
     * positively-identified BROWSER neither needs it (the browser residual is accepted by
     * default):
     *   - in a NON-browser DNS-less runtime (edge / Cloudflare Workers / Deno without node
     *     compat), a public-looking hostname FAILS CLOSED by default — reaching private
     *     infra via an unresolved hostname is a real SSRF escalation there; set this `true`
     *     to accept it (you trust the URL source);
     *   - with {@link GuardOptions.requireDnsPinning} set, a hostname fails closed in ANY
     *     DNS-less runtime (a socket cannot be pinned without a resolver) UNLESS this is
     *     `true`.
     * Regardless of this flag, `localhost` / `*.local` NAMES, private/loopback/metadata IP
     * LITERALS, and `http:` to a non-loopback name are ALWAYS refused. Default `false`. (On
     * the NODE branch DNS is always available, so this flag is inert there.)
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
//# sourceMappingURL=ssrf.d.ts.map