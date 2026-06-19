/**
 * `@jeswr/guarded-fetch/node` — the SSRF-safe NODE fetch path that FULLY CLOSES the
 * DNS-rebinding (TOCTOU) hole on the server side, by resolving once, validating every
 * record, and PINNING the validated IP onto the connecting socket (undici's
 * `Agent({ connect: { lookup } })` seam).
 *
 * THE PROBLEM this entry exists to close. The browser-safe guard in `./guard.ts` validates
 * a hostname by DNS-resolving it and requiring every resolved record to be public — but it
 * issues the request through a plain `fetch`, which RE-RESOLVES the hostname at connect time.
 * Between the guard's `dns.lookup` (validate) and the socket's own resolution (connect) a
 * hostile/compromised DNS server can flip the answer from a public IP to a private one
 * (169.254.169.254, 10.x, 127.x, ::1, fc00::/7, …) — the classic DNS-rebinding bypass.
 * `./guard.ts` documents this residual and exposes a `pinningFetch` seam + `requireDnsPinning`
 * posture for closure but ships no actual pinning fetch — THIS module is that fetch.
 *
 * HOW it closes the window — resolve-once → validate-all → PIN the IP to connect:
 *   1. We build an `undici.Agent` whose `connect.lookup` is OUR function. undici calls it
 *      (the standard `net.connect` `(hostname, options, callback)` seam) with the ORIGINAL
 *      hostname for EVERY new connection.
 *   2. Our lookup resolves the hostname ONCE (`dns.lookup(host, { all:true })`) and validates
 *      EVERY returned A/AAAA record against the SAME `isPublicAddress` classifier the rest of
 *      the library uses. ONE private record fails the whole connection (a rebinding set is
 *      refused).
 *   3. We hand undici back ONLY the pre-validated address(es). `net.connect` then dials
 *      EXACTLY those IPs — it never re-resolves the name — so the socket is PINNED to the
 *      address the guard validated. A concurrent DNS change cannot redirect the connection.
 *   4. TLS SNI + certificate validation stay against the ORIGINAL hostname: undici sets
 *      `servername` to the request host and verifies the cert against that name, while our
 *      `lookup` only steers the IP. Pinning to an IP does NOT weaken cert checking (we never
 *      set `rejectUnauthorized:false` and never use the IP as the servername).
 *
 * REDIRECTS. We do NOT let undici follow redirects (`maxRedirections: 0`). Redirect
 * re-validation + re-pinning is owned by the shared guard in `./guard.ts`: it sets
 * `redirect:"manual"`, re-runs the FULL host classification on each `Location` hop, caps
 * hops, strips cross-origin credentials, and re-issues each hop through THIS pinning fetch.
 *
 * BROWSER ISOLATION. This module is a SEPARATE entry (`./node`) and is the ONLY place
 * `undici` / `node:*` builtins are imported. The default `.` entry (`./index.ts`) and its
 * `./guard.ts` remain free of `undici` and of any top-level `node:` import, so the browser
 * bundle is unaffected. Do NOT import undici elsewhere.
 */
import type { LookupAddress } from "node:dns";
import { Agent } from "undici";
import { type GuardOptions } from "./index.js";
/** The `net.connect`-style lookup callback undici's connector invokes. */
export type ConnectLookup = (hostname: string, options: {
    all?: boolean;
    family?: number;
    [k: string]: unknown;
}, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => void;
/**
 * Resolve a hostname to ALL of its A/AAAA records — `dns.lookup(host, { all: true })`. This
 * is the connect-time resolution whose result is validated AND pinned. Injectable (see
 * {@link NodePinningOptions.resolveAll}) so tests can drive the DNS-rebinding case (a
 * resolver that flips its answer) deterministically.
 */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;
/** Options for the Node pinning path. Extends the shared guard options (sans the fetch seams). */
export interface NodePinningOptions extends Omit<GuardOptions, "fetch" | "pinningFetch" | "dnsLookup"> {
    /**
     * Re-permit `http:` AND loopback addresses for a local/dev registry. Off by default. When
     * on, the pinning lookup permits a loopback IP (and only loopback for http:); a non-loopback
     * private address is still refused. Threaded into BOTH the connect-time address check and
     * the guard's URL/redirect classification so the two layers agree.
     */
    readonly allowLoopback?: boolean;
    /**
     * The connect-time hostname → all-records resolver. Defaults to `node:dns`'s
     * `lookup(host, { all: true })`. Injectable so tests can drive the rebinding case
     * deterministically — production never sets it.
     */
    readonly resolveAll?: ResolveAll;
    /**
     * Additional trusted CA certificate(s) for the TLS connection, forwarded to undici's
     * connector (`tls.connect` `ca`). For a registry behind a private/corporate CA. This NEVER
     * disables certificate validation — the cert is still verified against the ORIGINAL hostname
     * (the connector's `servername`), not the pinned IP. We deliberately expose ONLY `ca`: there
     * is no escape hatch to set `rejectUnauthorized: false`.
     */
    readonly ca?: string | Buffer | Array<string | Buffer>;
}
/**
 * Build a validating, PINNING `net.connect`-style lookup. Exported for unit testing (it is an
 * internal building block of {@link createPinningDispatcher}). `requireLoopbackOnly` mirrors
 * the guard's rule that an `http:` request (reachable only under `allowLoopback`) must resolve
 * to LOOPBACK addresses ONLY: without it, a flip from loopback at guard-validation time to a
 * PUBLIC address at connect time would be accepted for `http:`, leaking a plaintext request to
 * a public host. For `http:` every connect-time record must be loopback; for `https:` the
 * standard `isPublicAddress(addr, allowLoopback)` rule applies.
 *
 * It honours the `dns.lookup` callback contract exactly: the address ARRAY only when
 * `options.all === true`; otherwise (`all` false OR absent) the first validated
 * `(address, family)` single form. Every resolved record is validated — one disallowed record
 * fails the whole connection (a DNS-rebinding multi-record set is refused).
 */
export declare function createValidatingLookup(resolveAll: ResolveAll, allowLoopback: boolean, requireLoopbackOnly: boolean): ConnectLookup;
/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated IP — the
 * rebinding-closing dispatcher. The returned dispatcher is suitable to pass as
 * `fetch(url, { dispatcher })` (undici), but prefer {@link createNodeGuardedFetch}, which
 * wires this together with the full SSRF guard. The Agent never re-resolves a hostname: our
 * `lookup` is the sole resolver and returns only pre-validated addresses.
 */
export declare function createPinningDispatcher(options?: NodePinningOptions): Agent;
/**
 * Build a `fetch`-shaped function with the FULL SSRF guard wired to undici DNS-pinning — the
 * hardened, rebinding-closed server fetch. It composes the shared guard (scheme/userinfo/port/
 * denylist/literal checks, per-record rebinding re-check, redirect re-validation, body + time
 * caps) with a per-request undici Agent that pins the socket to the validated IP. Use this for
 * any attacker-influenceable URL on the server.
 *
 * `requireDnsPinning` is forced ON (a hostname always rides the pinning fetch); the guard's
 * `pinningFetch` seam is satisfied by the undici pinning fetch built here.
 */
export declare function createNodeGuardedFetch(options?: NodePinningOptions): typeof globalThis.fetch;
/** The default strict-posture node guarded fetch (no loopback, node:dns resolver). */
export declare const nodeGuardedFetch: typeof globalThis.fetch;
//# sourceMappingURL=node.d.ts.map