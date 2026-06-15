/** The shape `node:dns/promises#lookup(host, { all: true })` returns (and what the pin uses). */
export interface LookupAddress {
    readonly address: string;
    readonly family: number;
}
/** The DNS lookup shape; tests inject a stub. Defaults to `node:dns/promises`. */
export type DnsLookup = (host: string) => Promise<LookupAddress[]>;
/** Raised when a URL/host fails the SSRF guard. Consumers map this to their own domain error. */
export declare class SsrfError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
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
 * Is `hostname` denied by the cloud-internal name denylist (exact match or dot-anchored suffix)?
 * Checked BEFORE DNS so a split-horizon resolver can never map an internal name to an endpoint we
 * connect to. `entry` starting with `.` is a suffix match (`.internal` matches `foo.internal`);
 * otherwise it is an exact match OR a `.entry` suffix match (`metadata.google.internal` also blocks
 * `x.metadata.google.internal`).
 */
export declare function isDeniedHostname(hostname: string): boolean;
/**
 * Normalise a URL hostname to a canonical IP literal for classification, covering alternate IPv4
 * encodings. WHATWG `new URL()` already does this for us — but we re-run it defensively so the
 * value the classifier sees is always a form `isIP` recognises. A bracketed IPv6 literal has its
 * brackets stripped. Returns the canonical form (or the input lowercased if it is not an IP).
 */
export declare function normalizeHostForClassification(hostname: string): string;
/**
 * Assert that `rawUrl`'s host resolves only to public addresses (or loopback under `allowLoopback`),
 * returning the **pinned** address the fetch must connect to. Throws {@link SsrfError} on a
 * malformed URL, a non-http(s) scheme, userinfo, a denied hostname, an unresolvable host, or ANY
 * non-public record.
 *
 * DNS-rebinding mitigation: every record must pass; the first validated record is returned to pin.
 */
export declare function assertNotSsrf(rawUrl: string, opts: SsrfGuardOptions): Promise<LookupAddress>;
/**
 * The Node `dns.lookup`-shaped callback that pins every connection to a single validated address —
 * fed into undici's `Agent({ connect: { lookup } })`. Returning the pre-validated IP (no second DNS
 * query) makes the SSRF guard and the fetch see the **same** address, closing the rebinding TOCTOU.
 *
 * Honours `options.all`: undici v7 invokes `lookup` with `{ all: true }` and expects the ARRAY form
 * `cb(null, [{ address, family }])`; the classic 3-arg form is `cb(null, address, family)`. Calling
 * the wrong form makes undici throw `ERR_INVALID_IP_ADDRESS`, surfacing as a generic "fetch failed".
 */
export declare function pinnedLookup(pinned: LookupAddress): (hostname: string, options: unknown, cb: PinnedLookupCallback) => void;
/** Either lookup-callback contract: classic `(err, address, family)` or undici v7's `(err, [..])`. */
type PinnedLookupCallback = ((err: NodeJS.ErrnoException | null, address: string, family: number) => void) | ((err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void);
export {};
//# sourceMappingURL=ssrf.d.ts.map