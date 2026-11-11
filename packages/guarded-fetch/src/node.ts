// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/guarded-fetch/node` — the SSRF-safe NODE fetch path that FULLY CLOSES the
 * DNS-rebinding (TOCTOU) hole on the server side, by resolving once, validating every
 * record, and PINNING the validated IP onto the connecting socket (undici's
 * `Agent({ connect: { lookup } })` seam).
 *
 * The root guard pins its validation-time answers by default on Node. This entry adds
 * connect-time re-resolution and validation, a standalone dispatcher and private CA options.
 * Both entries share the internal pinned transport and body normalization implementation.
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
 * REDIRECTS. We do NOT let undici follow redirects (`redirect: "manual"`). Redirect
 * re-validation + re-pinning is owned by the shared guard in `./guard.ts`: it sets
 * `redirect:"manual"`, re-runs the FULL host classification on each `Location` hop, caps
 * hops, strips cross-origin credentials, and re-issues each hop through THIS pinning fetch.
 *
 * BROWSER ISOLATION. This module is a SEPARATE entry (`./node`) and is the ONLY place
 * `undici` / `node:*` builtins are imported. The default `.` entry (`./index.ts`) and its
 * `./guard.ts` have no static undici or top-level `node:` imports, so browser bundles
 * remain unaffected. The root guard lazily loads undici only for Node hostname pinning.
 */
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookupCb } from "node:dns";
import * as undici from "undici";
import { type Agent, buildConnector } from "undici";
// Import the guard + SsrfError + classifiers from the package ROOT entry (NOT directly from
// ./guard.js). The build keeps `./index.js` EXTERNAL for the node bundle, so `dist/node.js`
// references the SAME runtime `SsrfError` class + guard as `dist/index.js` — an error thrown
// by `@jeswr/guarded-fetch/node` therefore satisfies `instanceof SsrfError` imported from
// `@jeswr/guarded-fetch` in published builds (a single shared SsrfError class).
import {
  classifyIpLiteral,
  createGuardedFetch,
  type GuardOptions,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError,
} from "./index.js";
import { createPinnedTransport, validatingLookup } from "./pinned-transport.js";
import { normalizeRequest } from "./redirect.js";

// Re-export `GuardOptions` (+ its own transitive public members `DnsLookup` / `ResolvedAddress`)
// from THIS entry point. `NodePinningOptions extends Omit<GuardOptions, …>` below, so
// `GuardOptions` is part of the `./node` public type surface — a consumer resolving types purely
// off `@jeswr/guarded-fetch/node`'s own `.d.ts` must be able to reach it, and `GuardOptions`
// itself references `DnsLookup` (`dnsLookup?: DnsLookup | null`) which references
// `ResolvedAddress`, so the whole closure must be reachable or api-extractor's
// `ae-forgotten-export` fires (now promoted to `error`). Type-only, so it erases to zero runtime
// JS. The `type GuardOptions` import above is kept for local use (an `export type … from` gives
// no local binding).
export type { DnsLookup, GuardOptions, ResolvedAddress } from "./index.js";
// Re-export the redirect-refusal wrapper from THIS entry too, so a `./node`-only consumer can
// stack it on the pinning fetch (`refuseRedirects(nodeGuardedFetch)` — SSRF-pinned AND
// redirect-refusing): the guard honours the wrapper's captured redirect: "manual",
// so it returns the first redirect for the outer wrapper to refuse. `./index.js` is external
// in the node bundle, so `RedirectRefusedError` is
// the SAME runtime class as the one from `@jeswr/guarded-fetch` (a single shared class, like
// `SsrfError`), and `instanceof` works across both entries.
export {
  RedirectRefusedError,
  refuseRedirects,
  snapshotFetchInput,
  snapshotRequest,
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
 * Resolve a hostname to ALL of its A/AAAA records — `dns.lookup(host, { all: true })`. This
 * is the connect-time resolution whose result is validated AND pinned. Injectable (see
 * {@link NodePinningOptions.resolveAll}) so tests can drive the DNS-rebinding case (a
 * resolver that flips its answer) deterministically.
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

/** Options honoured by the bare connection-pinning dispatcher (no guard limits or deadline). */
export interface PinningDispatcherOptions {
  /** Permit loopback for development; plaintext HTTP remains loopback-only. */
  readonly allowLoopback?: boolean;
  /** Connect-time resolver; every returned address is validated before connecting. */
  readonly resolveAll?: ResolveAll;
  /** Additional trusted TLS certificates; certificate verification remains enabled. */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

/** Options for the Node pinning path. Extends the shared guard options (sans the fetch seams). */
export interface NodePinningOptions
  extends Omit<GuardOptions, "fetch" | "pinningFetch" | "dnsLookup"> {
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
export function createValidatingLookup(
  resolveAll: ResolveAll,
  allowLoopback: boolean,
  requireLoopbackOnly: boolean,
): ConnectLookup {
  return validatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);
}

/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated IP — the
 * rebinding-closing dispatcher. The returned dispatcher is suitable to pass as
 * `fetch(url, { dispatcher })` (undici), but prefer {@link createNodeGuardedFetch}, which
 * wires this together with the full SSRF guard. The Agent never re-resolves a hostname: our
 * `lookup` is the sole resolver and returns only pre-validated addresses.
 *
 * PROTOCOL-AWARE (the safe bare-dispatcher posture). undici calls our `connect(opts, cb)` with
 * the request's `protocol`, so the dispatcher applies the SAME per-scheme address rule the
 * guard's `assertResolvedAddressesAllowed` enforces, without needing the guard wired in:
 *   - `http:` when `allowLoopback` is FALSE → REFUSED outright, before any socket. `http:` is a
 *                plaintext scheme permitted only under the dev `allowLoopback` hatch; the bare
 *                dispatcher must not reach `http://localhost` / `http://127.0.0.1` (a connection
 *                undici's connector would otherwise dial DIRECTLY for an IP literal, skipping the
 *                validating lookup) in the default / production posture. The refusal lives in
 *                `connect()` (which fires for EVERY connection, literal or hostname) rather than
 *                the lookup (which undici skips for an IP literal), so it cannot be bypassed by an
 *                `http://127.0.0.1` literal target.
 *   - `http:` when `allowLoopback` is TRUE → a LOOPBACK-ONLY lookup. The `http:` dev connection
 *                must resolve to loopback addresses ONLY — a flip to a public address at connect
 *                time is refused, so a plaintext request can never leak to a public host. (A
 *                single non-loopback record fails the whole connection.)
 *   - `https:` → the standard public-address lookup (`isPublicAddress(addr, allowLoopback)`).
 *
 * IP-LITERAL targets (e.g. `https://10.0.0.5`, `https://127.0.0.1`). undici's connector dials an
 * IP literal DIRECTLY, never calling our validating `lookup` — so the per-record address rule
 * would be SKIPPED for a literal target. `connect()` therefore classifies an IP-literal
 * `opts.hostname` itself and applies the SAME per-scheme rule (https → `isPublicAddress`;
 * http-under-allowLoopback → loopback-only) BEFORE selecting a connector, refusing a private /
 * loopback / link-local / metadata literal the lookup never sees. A hostname target (literal
 * kind 0) is left to the connector's validating lookup as before.
 *
 * Previously a single non-loopback-only lookup served every protocol, the bare dispatcher had no
 * scheme gate (so it reached `http://localhost` / `http://127.0.0.1` at the default
 * `allowLoopback=false`), and an IP-literal target bypassed address validation entirely (so it
 * reached `https://127.0.0.1` / `https://10.0.0.5`) — strictly weaker. This makes the bare
 * dispatcher match the posture {@link createNodeGuardedFetch} (and the guard's URL-level scheme +
 * literal-IP checks) already apply.
 */
export function createPinningDispatcher(options?: PinningDispatcherOptions): Agent;
/** Compatibility overload: defined guard-only options throw TypeError rather than being ignored. */
export function createPinningDispatcher(options?: NodePinningOptions): Agent;
export function createPinningDispatcher(
  options: PinningDispatcherOptions | NodePinningOptions = {},
): Agent {
  // Include inherited/non-enumerable legacy guard fields as well as unknown own options.
  const keys = new Set([
    ...Object.getOwnPropertyNames(options),
    "maxBytes",
    "maxRedirects",
    "timeoutMs",
    "requireDnsPinning",
    "allowUnresolvedHosts",
    "hostnameDenylist",
    "allowedContentTypes",
    "enforcePortGate",
  ]);
  for (const key of keys) {
    if (
      key !== "allowLoopback" &&
      key !== "resolveAll" &&
      key !== "ca" &&
      (options as Record<string, unknown>)[key] !== undefined
    ) {
      throw new TypeError(
        `createPinningDispatcher does not support option "${key}"; use createNodeGuardedFetch for guard limits and deadlines.`,
      );
    }
  }
  const allowLoopback = options.allowLoopback ?? false;
  const resolveAll = options.resolveAll ?? defaultResolveAll;

  // Two connectors that differ ONLY in the protocol-aware validating lookup. Both keep TLS
  // certificate validation ON (we never pass `rejectUnauthorized:false`) and carry the optional
  // private CA. `https:` uses the public-address rule; `http:` (only reached under allowLoopback)
  // uses the loopback-only rule.
  const tlsBase: Record<string, unknown> = {};
  if (options.ca !== undefined) {
    tlsBase.ca = options.ca;
  }
  const httpsConnector = buildConnector({
    ...tlsBase,
    lookup: createValidatingLookup(resolveAll, allowLoopback, false) as never,
  });
  const httpLoopbackConnector = buildConnector({
    ...tlsBase,
    lookup: createValidatingLookup(resolveAll, allowLoopback, true) as never,
  });

  return new undici.Agent({
    // Custom connect (function form): undici hands us the full connect `Options`, INCLUDING
    // `protocol`, so we (a) REFUSE `http:` outright unless allowLoopback — the scheme gate that
    // fires for every connection incl. an IP-literal target undici would dial without a lookup —
    // (b) validate an IP-LITERAL host directly (the lookup is skipped for a literal), and
    // (c) pick the loopback-only connector for a permitted `http:` hop and the standard public
    // connector for `https:`. undici sets `opts.servername` to the request hostname, so TLS SNI +
    // cert validation stay against the original host while our lookup steers the (pinned) IP. The
    // dispatcher never follows redirects itself — the shared guard re-validates + re-pins each
    // `Location` hop as a fresh request through this same dispatcher.
    connect(opts: buildConnector.Options, cb: buildConnector.Callback) {
      if (opts.protocol === "http:" && !allowLoopback) {
        cb(
          new SsrfError(
            `Connection refused — http: is permitted only under allowLoopback (dev); ${opts.hostname} is plaintext and not reachable in the default posture.`,
          ),
          null,
        );
        return;
      }
      // IP-LITERAL host: undici dials it directly and SKIPS the validating lookup, so classify it
      // here against the same per-scheme rule. http: (reached only under allowLoopback) is
      // loopback-only; https: uses the public-address rule. A hostname (literal kind 0) is left to
      // the connector's validating lookup. `opts.hostname` is already bracket-free for IPv6.
      if (classifyIpLiteral(opts.hostname) !== 0) {
        const literalOk =
          opts.protocol === "http:"
            ? isLoopbackAddress(opts.hostname)
            : isPublicAddress(opts.hostname, allowLoopback);
        if (!literalOk) {
          const why =
            opts.protocol === "http:"
              ? "is not loopback (http: requires loopback-only)"
              : "is a non-public address";
          cb(
            new SsrfError(`Connection refused — ${opts.hostname} ${why} (IP-literal target).`),
            null,
          );
          return;
        }
      }
      const connector = opts.protocol === "http:" ? httpLoopbackConnector : httpsConnector;
      connector(opts, cb);
    },
  });
}

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
export function createNodeGuardedFetch(options: NodePinningOptions = {}): typeof globalThis.fetch {
  const allowLoopback = options.allowLoopback ?? false;
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const ca = options.ca;

  // A branded pinning fetch: it builds a per-request Agent whose connect.lookup validates +
  // pins, picking the http:-loopback-only rule by the request's own scheme so an http: hop
  // cannot flip loopback→public at connect.
  const pinningFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Node's built-in Request and the installed undici Request have distinct brands, so the
    // transport always receives the checked URL string plus a plain init.
    const { url: urlStr, init: effectiveInit } = normalizeRequest(input, init);
    const requireLoopbackOnly = safeIsHttp(urlStr) && allowLoopback;
    const lookup = createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);
    return createPinnedTransport(undici, {
      url: urlStr,
      entry: "node",
      hostname: new URL(urlStr).hostname.replace(/^\[|\]$/g, ""),
      lookup,
      ca,
    })(urlStr, effectiveInit);
  }) as typeof globalThis.fetch;

  // The guard's own URL-level DNS classification shares the SAME resolver, so a private
  // resolution is caught at the URL check too (before connect).
  const dnsLookup = (host: string) =>
    resolveAll(host) as Promise<Array<{ address: string; family: number }>>;

  return createGuardedFetch({
    ...stripNodeOnlyOptions(options),
    pinningFetch,
    requireDnsPinning: true,
    dnsLookup,
    allowLoopback,
  });
}

/** The default strict-posture node guarded fetch (no loopback, node:dns resolver). */
export const nodeGuardedFetch: typeof globalThis.fetch = createNodeGuardedFetch();

/** Drop the node-only option fields the shared guard does not accept. */
function stripNodeOnlyOptions(options: NodePinningOptions): GuardOptions {
  const { resolveAll: _r, ca: _ca, allowLoopback: _al, ...rest } = options;
  return rest as GuardOptions;
}

/** Whether a URL string is http: (best-effort; unparseable → false). */
function safeIsHttp(u: string): boolean {
  try {
    return new URL(u).protocol === "http:";
  } catch {
    return false;
  }
}
