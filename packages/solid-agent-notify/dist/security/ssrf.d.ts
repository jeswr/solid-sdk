/**
 * ssrf.ts — THIN COMPATIBILITY SHIM over `@jeswr/guarded-fetch`.
 *
 * The SSRF mechanism (IP-literal classification, the public-address policy, the
 * cloud-internal hostname denylist, alternate-IPv4-encoding normalisation, the
 * DNS-resolve-all-records-then-validate rebinding check, and the connect-time
 * DNS-pinning that closes the lookup→connect TOCTOU) now lives in the shared,
 * single-reviewed `@jeswr/guarded-fetch` library — the consolidation of this
 * package's former inline guard plus the federation-client / community-feeds /
 * prod-solid-server copies. {@link guardedFetch} delegates straight to
 * `@jeswr/guarded-fetch/node`'s `createNodeGuardedFetch`.
 *
 * This module exists ONLY to keep `solid-agent-notify`'s PUBLIC API + signatures
 * unchanged after the rewire. The classifiers are RE-EXPORTED unchanged from
 * guarded-fetch; the agent-notify-specific helpers ({@link assertNotSsrf},
 * {@link isDeniedHostname} bound to this package's stricter denylist, the
 * {@link LookupAddress} alias) are thin policy shims that reuse the SAME
 * guarded-fetch primitives — they reimplement NO IP-classification logic. There
 * is exactly one reviewed copy of the SSRF mechanism, in guarded-fetch.
 *
 * `assertNotSsrf` mirrors guarded-fetch's own `assertAllowed` URL/host check but
 * RETURNS the first validated address (the pin), which the library's void
 * `assertSafeUrl` does not — so the agent-notify contract (a vetted, pinned
 * address) is preserved without re-deriving the classification.
 */
import { SsrfError, isLoopbackAddress, isPublicAddress, normalizeHostForClassification } from "@jeswr/guarded-fetch";
export { isLoopbackAddress, isPublicAddress, normalizeHostForClassification, SsrfError, };
/** The shape `node:dns/promises#lookup(host, { all: true })` returns (and what the pin uses). */
export interface LookupAddress {
    readonly address: string;
    readonly family: number;
}
/** The DNS lookup shape; tests inject a stub. Defaults to `node:dns/promises`. */
export type DnsLookup = (host: string) => Promise<LookupAddress[]>;
export interface SsrfGuardOptions {
    /** Re-permit loopback (and loopback-only http). Default false. NEVER true in production. */
    readonly allowLoopback: boolean;
    /** Inject a DNS lookup (tests). Defaults to `node:dns/promises` with `{ all: true }`. */
    readonly dnsLookup?: DnsLookup;
    /**
     * Enforce the HTTPS-only-plus-loopback-http nuance:
     *  - reject `http:` unless `allowLoopback` is on, AND
     *  - when `http:` is permitted under `allowLoopback`, require EVERY resolved address to be
     *    loopback (a dev box must not be tricked into HTTP-fetching a public host).
     */
    readonly enforceHttpsExceptLoopback?: boolean;
}
/**
 * Is `hostname` denied by `solid-agent-notify`'s cloud-internal name denylist
 * (`FETCH_HOSTNAME_DENYLIST` from config.ts — which is STRICTER than guarded-fetch's
 * `DEFAULT_HOSTNAME_DENYLIST`, additionally refusing `localhost` / `*.localhost` /
 * `*.local` unconditionally)? Delegates the matching algorithm to guarded-fetch's
 * `isDeniedHostname`, supplying this package's stricter list — so there is one
 * reviewed match implementation and one source-of-truth denylist (config.ts).
 */
export declare function isDeniedHostname(hostname: string): boolean;
/**
 * Assert that `rawUrl`'s host resolves only to public addresses (or loopback under `allowLoopback`),
 * returning the **pinned** address the fetch must connect to. Throws {@link SsrfError} on a
 * malformed URL, a non-http(s) scheme, userinfo, a denied hostname, an unresolvable host, or ANY
 * non-public record.
 *
 * DNS-rebinding mitigation: every record must pass; the first validated record is returned to pin.
 *
 * The host-shape + address policy is the SAME one guarded-fetch enforces (we call its
 * `classifyIpLiteral` / `normalizeHostForClassification` / `isDeniedHostname` /
 * `isPublicAddress` / `isLoopbackAddress`), so this stays in lock-step with the chokepoint and
 * adds NO independent classification logic — it only returns the pin the library's void
 * `assertSafeUrl` omits.
 */
export declare function assertNotSsrf(rawUrl: string, opts: SsrfGuardOptions): Promise<LookupAddress>;
//# sourceMappingURL=ssrf.d.ts.map