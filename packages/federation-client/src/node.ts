// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// `@jeswr/federation-client/node` — the SSRF-safe NODE fetch path that fully closes
// the DNS-rebinding (TOCTOU) hole on the server side (#86).
//
// THE PROBLEM this entry exists to close. The browser-safe guard in `./ssrf.ts`
// (task #92) validates a hostname by DNS-resolving it and requiring every resolved
// record to be public — but it issues the actual request through a plain `fetch`,
// which RE-RESOLVES the hostname at connect time. Between the guard's `dns.lookup`
// (validate) and the socket's own resolution (connect) a hostile/compromised DNS
// server can flip the answer from a public IP to a private one (169.254.169.254,
// 10.x, 127.x, ::1, fc00::/7, …) — the classic DNS-rebinding bypass. Validating the
// name up front does NOT bind the socket to the validated address, so the window is
// real. `./ssrf.ts` documents this residual and exposes a `pinningFetch` seam +
// `requireDnsPinning` posture for closure but ships no actual pinning fetch — THIS
// module is that fetch.
//
// HOW it closes the window — resolve-once → validate-all → PIN the IP to connect:
//   1. We build an `undici.Agent` whose `connect.lookup` is OUR function. undici
//      calls it (the standard `net.connect` `(hostname, options, callback)` seam)
//      with the ORIGINAL hostname for EVERY new connection.
//   2. Our lookup resolves the hostname ONCE (`dns.lookup(host, { all:true })`) and
//      validates EVERY returned A/AAAA record against the SAME blocklist the rest of
//      the library uses — `isPublicAddress` from `./ssrf.ts` (RFC1918, loopback,
//      link-local incl. 169.254.169.254, CGNAT, ULA fc00::/7, ::1, 0.0.0.0,
//      multicast, reserved, IPv4-mapped / 6to4 / NAT64-embedded private v4). ONE
//      private record fails the whole connection (a rebinding set is refused).
//   3. We hand undici back ONLY the pre-validated address(es). `net.connect` then
//      dials EXACTLY those IPs — it never re-resolves the name — so the socket is
//      PINNED to the address the guard validated. A concurrent DNS change cannot
//      redirect the connection: the rebinding window is gone.
//   4. TLS SNI + certificate validation stay against the ORIGINAL hostname: undici's
//      connector sets `servername` to the request host and `tls.connect` verifies the
//      cert against that name, while our `lookup` only steers the IP. So pinning to an
//      IP does NOT weaken cert checking (we never set `rejectUnauthorized:false` and
//      never use the IP as the servername).
//
// REDIRECTS. We do NOT let undici follow redirects (`maxRedirections: 0`). Redirect
// re-validation + re-pinning is owned by the shared guard in `./ssrf.ts`: it sets
// `redirect:"manual"`, re-runs the FULL host classification on each `Location` hop,
// caps hops, strips cross-origin credentials, and re-issues each hop through THIS
// pinning fetch — so every hop independently resolves-validates-pins. A 30x to a
// private IP (literal OR a rebinding hostname) is therefore blocked at the next hop's
// validation, before any socket to it is opened. (Were undici to follow the redirect
// itself, the hop would skip the guard — hence `maxRedirections: 0`.)
//
// BROWSER ISOLATION. This module is a SEPARATE entry (`./node`) and is the ONLY place
// `undici` / `node:*` builtins are imported. The default `.` entry (`./index.ts`) and
// its `./ssrf.ts` guard remain free of `undici` and of any top-level `node:` import,
// so the browser bundle (#92) is unaffected: a browser consumer never imports `./node`
// and the bundler never sees `undici`.

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookupCb } from "node:dns";
import { Agent, buildConnector, type Dispatcher, fetch as undiciFetch } from "undici";
// Import the guard + SsrfError + isPublicAddress from the package ROOT entry (NOT
// directly from ./ssrf.js). The build keeps `./index.js` EXTERNAL for the node bundle,
// so `dist/node.js` references the SAME runtime `SsrfError` class + guard as
// `dist/index.js` — an error thrown by `@jeswr/federation-client/node` therefore
// satisfies `instanceof SsrfError` imported from `@jeswr/federation-client` in published
// builds (roborev finding: avoid two separate inlined SsrfError classes). `isLoopbackAddress`
// is likewise the root's, kept identity-stable.
import {
  createGuardedFetch,
  type GuardOptions,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError,
} from "./index.js";

/** The `net.connect`-style lookup callback undici's connector invokes. */
export type ConnectLookup = (
  hostname: string,
  options: { all?: boolean; family?: number; [k: string]: unknown },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

/**
 * Resolve a hostname to ALL of its A/AAAA records — `dns.lookup(host, { all: true })`.
 * This is the connect-time resolution whose result is validated AND pinned. Injectable
 * (see {@link NodePinningOptions.resolveAll}) so tests can drive the DNS-rebinding case
 * (a resolver that flips its answer) deterministically — the production default uses
 * `node:dns`.
 */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

/** Promise form of `dns.lookup(host, { all: true })`, returning every A/AAAA record. */
const defaultResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookupCb(hostname, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses);
    });
  });

/** Options for the Node pinning path. Extends the shared guard options. */
export interface NodePinningOptions
  extends Omit<GuardOptions, "fetch" | "pinningFetch" | "dnsLookup"> {
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
export function createValidatingLookup(
  resolveAll: ResolveAll,
  allowLoopback: boolean,
  requireLoopbackOnly: boolean,
): ConnectLookup {
  return (hostname, lookupOptions, callback) => {
    resolveAll(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            new SsrfError(`Host resolved to no addresses: ${hostname}.`) as NodeJS.ErrnoException,
            [],
          );
          return;
        }
        for (const a of addresses) {
          const ok = requireLoopbackOnly
            ? isLoopbackAddress(a.address)
            : isPublicAddress(a.address, allowLoopback);
          if (!ok) {
            const why = requireLoopbackOnly
              ? "is not loopback (http: requires loopback-only)"
              : "is a non-public address";
            callback(
              new SsrfError(
                `Connection refused — ${hostname} resolves to an address that ${why} (${a.address}).`,
              ) as NodeJS.ErrnoException,
              [],
            );
            return;
          }
        }
        // Hand undici back ONLY the pre-validated addresses. `net.connect` dials these
        // exact IPs and never re-resolves the name — the pin. Return the ARRAY only when
        // `all === true`; otherwise (`all` false OR ABSENT) the single-address form is
        // expected. undici's connector passes `{ all: true }`, but following the contract
        // precisely keeps us correct for any caller / Node version where `all` is unset
        // and an array would be mishandled (roborev Medium).
        const first = addresses[0] as LookupAddress;
        if (lookupOptions?.all === true) {
          callback(null, addresses);
          return;
        }
        callback(null, first.address, first.family);
      },
      (err) => {
        callback(
          new SsrfError(`Host did not resolve: ${hostname}: ${message(err)}`, {
            cause: err,
          }) as NodeJS.ErrnoException,
          [],
        );
      },
    );
  };
}

export function createPinningDispatcher(options: NodePinningOptions = {}): Dispatcher {
  const allowLoopback = options.allowLoopback ?? false;
  const connectTimeout = options.timeoutMs ?? 10_000;
  const resolveAll = options.resolveAll ?? defaultResolveAll;

  const makeLookup = (requireLoopbackOnly: boolean): ConnectLookup =>
    createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);

  // Two base connectors, differing ONLY in the protocol-aware lookup. Both keep TLS cert
  // validation ON (we never pass rejectUnauthorized:false) and the optional private-CA.
  const tlsBase = {
    timeout: connectTimeout,
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
  };
  const httpsConnector = buildConnector({ ...tlsBase, lookup: makeLookup(false) as never });
  const loopbackOnlyConnector = buildConnector({
    ...tlsBase,
    lookup: makeLookup(true) as never,
  });

  return new Agent({
    // NOTE on redirects: the Agent dispatcher does NOT follow redirects on its own —
    // undici's `fetch` honours the request `redirect` mode, and the shared guard sets
    // `redirect: "manual"` on every request it issues through us, then re-validates +
    // re-pins each `Location` hop as a fresh request through this same dispatcher. So a
    // 30x to a private IP is blocked at the next hop's lookup, never auto-followed.
    //
    // Custom connect (function form): undici hands us the full connect `Options`,
    // INCLUDING `protocol`, so we pick the loopback-only connector for an `http:` hop and
    // the standard public connector for `https:`. undici sets `opts.servername` to the
    // request hostname, so TLS SNI + cert validation stay against the original host while
    // our lookup steers the (pinned) IP.
    connect(opts: buildConnector.Options, cb: buildConnector.Callback) {
      const connector = opts.protocol === "http:" ? loopbackOnlyConnector : httpsConnector;
      connector(opts, cb);
    },
  });
}

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
export function createNodeGuardedFetch(options: NodePinningOptions = {}): typeof globalThis.fetch {
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const dispatcher = createPinningDispatcher({ ...options, resolveAll });
  // The branded pinning fetch: undici's `fetch` bound to the pinning dispatcher. The
  // guard threads this through unchanged as `pinningFetch`, so it issues the actual
  // (already host-validated) request over the pinned socket. undici's `fetch` accepts a
  // `dispatcher` field on its init; we keep the call typed via undici's own param types
  // and surface it under the DOM `fetch` signature the guard expects.
  const pinningFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const undiciInit = {
      ...(init as Record<string, unknown> | undefined),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1];
    return undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      undiciInit,
    ) as unknown as Promise<Response>;
  }) as typeof globalThis.fetch;

  return createGuardedFetch({
    ...options,
    // Share ONE resolver across both layers: the guard's URL-level DNS classification AND
    // the connect-time pin use the same `resolveAll`, so the host the guard validated is
    // the host the socket pins to (no divergent resolver could disagree). Defaults to
    // `node:dns` — identical to the guard's own Node branch — and is injectable for tests.
    dnsLookup: resolveAll,
    // The guard re-resolves + re-classifies the host on the initial request AND each
    // redirect hop, then issues the validated request through `pinningFetch`, which
    // re-resolves + validates + PINS at connect time. Two independent resolutions, both
    // validated — the second one pins, closing the gap the first cannot.
    pinningFetch,
    // Strict posture: a hostname is allowed ONLY because we supplied a branded
    // pinningFetch. A plain fetch could never satisfy this — so the rebinding window can
    // never be silently re-opened by swapping the fetch.
    requireDnsPinning: true,
  });
}

/**
 * Convenience: a process-wide SSRF-safe Node guarded fetch with default options. Most
 * Node consumers can import this directly:
 * ```ts
 * import { nodeGuardedFetch } from "@jeswr/federation-client/node";
 * const result = await discoverFromRegistry(url, { fetch: nodeGuardedFetch });
 * ```
 */
export const nodeGuardedFetch: typeof globalThis.fetch = createNodeGuardedFetch();

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
