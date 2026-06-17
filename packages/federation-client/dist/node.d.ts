import type { LookupAddress } from "node:dns";
import { type Dispatcher } from "undici";
import { type GuardOptions } from "./index.js";
/** The `net.connect`-style lookup callback undici's connector invokes. */
export type ConnectLookup = (hostname: string, options: {
    all?: boolean;
    family?: number;
    [k: string]: unknown;
}, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => void;
/**
 * Resolve a hostname to ALL of its A/AAAA records — `dns.lookup(host, { all: true })`.
 * This is the connect-time resolution whose result is validated AND pinned. Injectable
 * (see {@link NodePinningOptions.resolveAll}) so tests can drive the DNS-rebinding case
 * (a resolver that flips its answer) deterministically — the production default uses
 * `node:dns`.
 */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;
/** Options for the Node pinning path. Extends the shared guard options. */
export interface NodePinningOptions extends Omit<GuardOptions, "fetch" | "pinningFetch" | "dnsLookup"> {
    /**
     * Re-permit `http:` AND loopback addresses for a local/dev registry (e.g.
     * `http://127.0.0.1:3000`). Off by default. When on, the pinning lookup permits a
     * loopback IP (and only loopback for http:); a non-loopback private address is still
     * refused. Mirrors {@link GuardOptions.allowLoopback} and is threaded into BOTH the
     * connect-time address check and the guard's URL/redirect classification so the two
     * layers agree.
     */
    readonly allowLoopback?: boolean;
    /**
     * The connect-time hostname → all-records resolver. Defaults to `node:dns`'s
     * `lookup(host, { all: true })`. Injectable so tests can drive the DNS-rebinding case
     * (a resolver returning a public IP on the first call and a private one on the next)
     * deterministically — production never sets it.
     */
    readonly resolveAll?: ResolveAll;
    /**
     * Additional trusted CA certificate(s) for the TLS connection, forwarded to undici's
     * connector (`tls.connect` `ca`). For a registry behind a private/corporate CA. This
     * NEVER disables certificate validation — the certificate is still verified against the
     * ORIGINAL hostname (the connector's `servername`), not the pinned IP. We deliberately
     * expose ONLY `ca`: there is no escape hatch to set `rejectUnauthorized: false`, so a
     * caller cannot weaken cert validation through this path.
     */
    readonly ca?: string | Buffer | Array<string | Buffer>;
}
/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated
 * IP — the rebinding-closing dispatcher (step 1–4 in the module header).
 *
 * The returned dispatcher is suitable to pass as `fetch(url, { dispatcher })` (undici)
 * — but prefer {@link createNodeGuardedFetch}, which wires this together with the full
 * SSRF guard (scheme/userinfo/literal checks, redirect re-validation, body + time caps).
 * Use this directly only if you are composing your own request pipeline and already
 * apply those checks.
 *
 * The Agent never re-resolves a hostname for connection: our `lookup` is the sole
 * resolver and returns only pre-validated addresses, so the socket is pinned to the
 * validated IP. `connectTimeout` bounds the connect; the guard bounds the whole op.
 */
/**
 * Build a validating, PINNING `net.connect`-style lookup. Exported for unit tests (it is
 * an internal building block of {@link createPinningDispatcher}, not part of the intended
 * public API). `requireLoopbackOnly` mirrors the guard's `assertResolvedAddressesAllowed`
 * rule that an `http:` request (reachable only under `allowLoopback`) must resolve to
 * LOOPBACK addresses ONLY: without it, a flip from a loopback address at guard-validation
 * time to a PUBLIC address at connect time would be accepted for `http:`, leaking a
 * plaintext request to a public host. For `http:` every connect-time record must be
 * loopback; for `https:` the standard `isPublicAddress(addr, allowLoopback)` rule applies.
 *
 * It honours the `dns.lookup` callback contract exactly: it returns the address ARRAY only
 * when `options.all === true`; otherwise (`all` false OR absent) it returns the first
 * validated `(address, family)` single form. Every resolved record is validated — one
 * disallowed record fails the whole connection (a DNS-rebinding multi-record set is
 * refused).
 */
export declare function createValidatingLookup(resolveAll: ResolveAll, allowLoopback: boolean, requireLoopbackOnly: boolean): ConnectLookup;
export declare function createPinningDispatcher(options?: NodePinningOptions): Dispatcher;
/**
 * The SSRF-safe NODE `fetch` for federation-client — the DEFAULT recommended fetch for
 * Node consumers fetching a registry / storage / verify endpoint. It fully closes the
 * DNS-rebinding window: every request (and every guard-followed redirect hop) is
 * connected through {@link createPinningDispatcher} (resolve-once → validate-all → pin),
 * and the request is run through the shared `./ssrf.ts` guard for scheme/userinfo/IP-
 * literal checks, redirect re-validation (no auto-follow to a private host), and body +
 * time caps.
 *
 * Returns a `fetch`-shaped function — pass it as `RegistryOptions.fetch` /
 * `VerifyOptions.fetch` / `ListOptions.fetch`, or use it directly.
 *
 * `requireDnsPinning` is forced ON: the underlying pinning fetch is supplied as the
 * guard's branded `pinningFetch`, so the strict posture is satisfied and a hostname
 * target is connected only through the pinned socket — never a plain re-resolving fetch.
 */
export declare function createNodeGuardedFetch(options?: NodePinningOptions): typeof globalThis.fetch;
/**
 * Convenience: a process-wide SSRF-safe Node guarded fetch with default options. Most
 * Node consumers can import this directly:
 * ```ts
 * import { nodeGuardedFetch } from "@jeswr/federation-client/node";
 * const result = await discoverFromRegistry(url, { fetch: nodeGuardedFetch });
 * ```
 */
export declare const nodeGuardedFetch: typeof globalThis.fetch;
//# sourceMappingURL=node.d.ts.map