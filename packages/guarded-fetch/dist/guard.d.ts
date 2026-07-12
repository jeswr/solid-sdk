/** Raised when the guard refuses a URL / redirect / oversize body on SSRF grounds. */
export declare class SsrfError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Raised for a NON-SSRF guard refusal: a disallowed port, or a content-type allowlist miss
 * when {@link GuardOptions.allowedContentTypes} is configured. SSRF refusals throw
 * {@link SsrfError}; this is the policy (not the security-boundary) error.
 */
export declare class GuardError extends Error {
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
/**
 * The default cloud-internal hostname denylist, refused BEFORE any DNS resolution. An entry
 * starting with `.` is a SUFFIX match (`.internal` matches `foo.internal`); otherwise it is
 * an exact match OR a dot-anchored suffix match (`metadata.google.internal` also blocks
 * `x.metadata.google.internal`). Defence in depth: the IP classifier already blocks the
 * addresses these names resolve to, but a denied name is cheaper and closes split-horizon
 * DNS gaps. Override / extend via {@link GuardOptions.hostnameDenylist}.
 *
 * Deliberately does NOT include `localhost` / `*.localhost` / `*.local`: those are handled by
 * the host-classification BRANCHES (refused in production; `localhost` reachable under the dev
 * `allowLoopback` hatch; `.local` always refused as an mDNS LAN name) so the legitimate
 * `allowLoopback` dev path is not broken by an unconditional denylist hit. The denylist is for
 * cloud-internal METADATA / CLUSTER names that must never be reached in ANY mode.
 */
export declare const DEFAULT_HOSTNAME_DENYLIST: readonly string[];
/** Options for {@link createGuardedFetch} / {@link guardedFetch}. */
export interface GuardOptions {
    /**
     * The underlying `fetch` to issue the (guarded, `redirect:"manual"`) requests with.
     * Defaults to `globalThis.fetch`. Pass an authenticated fetch here — the guard threads it
     * through unchanged. A plain auth/custom `fetch` does NOT, by itself, pin DNS, so supplying
     * it does NOT satisfy {@link GuardOptions.requireDnsPinning}; pass {@link
     * GuardOptions.pinningFetch} for that.
     */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * A fetch the caller **explicitly asserts pins DNS** to the resolved address (e.g. an
     * undici-`Agent` fetch with a pinned `lookup` — see the `./node` entry), closing the
     * lookup→connect rebinding window. This is a DISTINCT, branded assertion: only setting
     * `pinningFetch` (not the generic {@link GuardOptions.fetch}) satisfies {@link
     * GuardOptions.requireDnsPinning} for a hostname target. When both are set, `pinningFetch`
     * is the underlying fetch. The guard does NOT verify the pinning claim (it cannot) — the
     * field is the caller's explicit attestation, so a plain `globalThis.fetch` can never
     * silently masquerade as pinning.
     */
    readonly pinningFetch?: typeof globalThis.fetch;
    /**
     * A DNS lookup for hostname classification — selects the guard BRANCH. Defaults to Node's
     * `dns/promises.lookup(host, { all: true })` when running on Node (the NODE branch: full
     * DNS-resolve + every-record-public + rebinding mitigation). Pass `null` to FORCE the
     * DNS-less branch (a syntactic guard). Injected in tests to drive the rebinding cases
     * (Node branch) and the DNS-less cases (`null`) deterministically.
     */
    readonly dnsLookup?: DnsLookup | null;
    /** Maximum response body size in bytes (default 1 MiB). Declared over-cap rejected up front. */
    readonly maxBytes?: number;
    /** Total deadline for the whole operation (fetch + redirects + body), ms. Default 10s. */
    readonly timeoutMs?: number;
    /** Maximum redirect hops to follow (default 5). Each hop is re-guarded. */
    readonly maxRedirects?: number;
    /**
     * Dev/test ONLY: re-permit `http:` AND loopback addresses (a local registry on
     * `http://localhost:3000`). Off by default. Even when on, a non-loopback private address
     * is still refused, an `http:` host must resolve loopback-only, and any port is permitted
     * (a fixture server binds an ephemeral loopback port).
     */
    readonly allowLoopback?: boolean;
    /**
     * DNS-less branch only. Accepts the no-resolver residual for a public-looking HOSTNAME
     * target in a NON-browser DNS-less runtime (edge / Workers / Deno) — where a public-looking
     * hostname otherwise FAILS CLOSED. Also required (in ANY DNS-less runtime) when {@link
     * GuardOptions.requireDnsPinning} is set, since a socket cannot be pinned without a
     * resolver. Regardless of this flag, `localhost` / `*.local` NAMES, private/loopback/
     * metadata IP LITERALS, and `http:` to a non-loopback name are ALWAYS refused. Default
     * `false`. Inert on the Node branch (DNS is always available there).
     */
    readonly allowUnresolvedHosts?: boolean;
    /**
     * **DNS-rebinding posture (security-strict).** When `true`, the guard **refuses a hostname
     * target unless a {@link GuardOptions.pinningFetch} was supplied** — the explicit, branded
     * pinning attestation. A hostname through the default `globalThis.fetch` OR a plain
     * (non-pinning) {@link GuardOptions.fetch} is rejected. IP-literal targets (no rebinding
     * window) are always allowed. Default `false` — the usable best-effort posture (DNS
     * validation + redirect re-validation, documented residual window). Set `true` (plus
     * `pinningFetch`, e.g. the `./node` entry) for a hardened deployment.
     */
    readonly requireDnsPinning?: boolean;
    /**
     * The cloud-internal hostname denylist (exact / suffix), refused BEFORE DNS. Defaults to
     * {@link DEFAULT_HOSTNAME_DENYLIST}. Pass an explicit list to override (e.g. add your own
     * cluster names); pass `[]` to disable the name denylist (the IP classifier still applies).
     */
    readonly hostnameDenylist?: readonly string[];
    /**
     * Restrict the FINAL response's bare content-type to this allowlist (lower-cased media
     * type, no parameters). When set, a final 2xx response with a content-type NOT in the list
     * throws {@link GuardError}. Body-irrelevant statuses (204/205/304/≥400) bypass it. Default
     * unset (any content-type accepted).
     */
    readonly allowedContentTypes?: readonly string[];
    /**
     * Enforce the production PORT gate: an explicit port must be 443 (https) in production
     * (`allowLoopback=false`). Under `allowLoopback` any port is permitted (a fixture binds an
     * ephemeral loopback port). Default `true`. Set `false` to allow arbitrary public ports
     * (e.g. a registry on `:8443`) — weaker, opt-in.
     */
    readonly enforcePortGate?: boolean;
}
/**
 * Build a `fetch`-shaped guarded fetcher bound to the given options. The returned function
 * has the `typeof globalThis.fetch` signature so it threads straight into any consumer that
 * takes an injectable fetch (a `@jeswr/fetch-rdf` parse, an LDN POST, …). The guard validates
 * the URL + every redirect hop, caps the body, and bounds the time.
 */
export declare function createGuardedFetch(options?: GuardOptions): typeof globalThis.fetch;
/**
 * One-shot guarded fetch (constructs a guard per call). Prefer {@link createGuardedFetch}
 * when issuing many requests with the same policy.
 */
export declare function guardedFetch(input: RequestInfo | URL, init?: RequestInit & GuardOptions): Promise<Response>;
/**
 * Validate a target URL's host shape (scheme / userinfo / port / denylist / literal-IP) and
 * its resolved addresses against the SSRF policy, WITHOUT issuing any request. Throws
 * {@link SsrfError} / {@link GuardError} on a violation; returns normally if the URL would be
 * allowed. Exported for callers that want to vet a user-supplied base URL up front (e.g. at
 * config time) before wiring it into a guarded fetch.
 */
export declare function assertSafeUrl(rawUrl: string, options?: GuardOptions): Promise<void>;
/**
 * Is `hostname` denied by the cloud-internal denylist (exact match or dot-anchored suffix)?
 * `entry` starting with `.` is a suffix match (`.internal` matches `foo.internal`); otherwise
 * it is an exact match OR a `.entry` suffix match. Exported so a consumer can reuse the same
 * name-denial logic at config time.
 */
export declare function isDeniedHostname(hostname: string, denylist: readonly string[]): boolean;
/**
 * Normalise a URL hostname to a canonical IP literal for classification, covering alternate
 * IPv4 encodings. `new URL()` already canonicalises decimal (`2130706433`), hex
 * (`0x7f000001`), octal (`0177.0.0.1`), and short-form (`127.1`) IPv4 to dotted-decimal — we
 * re-run it defensively so the value the classifier sees is always a form `classifyIpLiteral`
 * recognises. A bracketed IPv6 literal has its brackets stripped. Returns the canonical form
 * (or the input lowercased if it is not an IP). Exported for reuse + testing.
 */
export declare function normalizeHostForClassification(hostname: string): string;
//# sourceMappingURL=guard.d.ts.map