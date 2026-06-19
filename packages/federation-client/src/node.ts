// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// `@jeswr/federation-client/node` — the SSRF-safe NODE fetch path that fully closes the
// DNS-rebinding (TOCTOU) hole on the server side. The undici DNS-pinning machinery is the
// consolidated suite implementation `@jeswr/guarded-fetch/node`: this module re-exports the
// recommended fetches + building blocks from it, and keeps ONE fed-client-OWNED wrapper —
// `createPinningDispatcher` — to PRESERVE this package's prior, stricter http-loopback-only
// behaviour on that low-level escape hatch (see the dedicated note below).
//
// WHAT it gives a Node consumer: `createNodeGuardedFetch` / `nodeGuardedFetch` — a
// `fetch`-shaped function that resolves a hostname ONCE, validates EVERY A/AAAA record
// against the suite block-list, and PINS the validated IP onto the connecting socket
// (undici's `Agent({ connect: { lookup } })` seam), so a hostile DNS server cannot flip a
// public answer at validation time to a private one at connect time. TLS SNI + cert
// validation stay against the ORIGINAL hostname (the connector's `servername`), so pinning
// to an IP never weakens cert checking, and `rejectUnauthorized` is never disabled.
// `requireDnsPinning` is forced ON, so a hostname rides the pinned socket or is refused.
//
// BROWSER ISOLATION (#92) PRESERVED. `@jeswr/guarded-fetch/node` is the ONLY artifact that
// imports `undici` / `node:*` builtins; the package's default `.` entry (`./index.ts` →
// `./ssrf.ts` → `@jeswr/guarded-fetch`) imports the browser-safe ROOT entry only, so the
// browser bundle never sees `undici`. The committed `dist/node.js` keeps `undici` external
// (a consumer-resolved npm dep) and references the SAME runtime `SsrfError` class as
// `dist/index.js` (both resolve to the inlined guarded-fetch root), so an error thrown by
// `@jeswr/federation-client/node` still satisfies `instanceof SsrfError` imported from
// `@jeswr/federation-client`.
//
// SsrfError IDENTITY. `SsrfError` is re-exported from THIS package's root (`./index.ts`),
// not separately from `@jeswr/guarded-fetch/node`, so the class a consumer catches from the
// `.` entry and the `./node` entry is one and the same (the inlined guarded-fetch root is
// shared between dist/index.js and dist/node.js by the build keeping `./index.js` external
// in the node bundle).
//
// WHY a fed-client-OWNED `createPinningDispatcher` (parity guard — roborev Medium). The
// RECOMMENDED path (`createNodeGuardedFetch` / `nodeGuardedFetch`) is wrapped by the shared
// SSRF guard, which refuses `http:` to a non-loopback host AND applies the http-loopback-only
// pin per request — so it is fully safe regardless of the dispatcher below. But the LOW-LEVEL
// `createPinningDispatcher` is an escape hatch a consumer may pass straight to `undici.fetch`
// WITHOUT the shared guard. This package's PRIOR `createPinningDispatcher` was protocol-aware:
// an `http:` connect used a LOOPBACK-ONLY validating lookup, so even under `allowLoopback: true`
// it could never send plaintext `http:` to a PUBLIC host. `@jeswr/guarded-fetch`'s current
// `createPinningDispatcher` builds a single non-loopback-only lookup for ALL protocols (its
// loopback-only nuance lives only in `createNodeGuardedFetch`'s per-request fetch), so
// re-exporting it verbatim would REGRESS this surface: `createPinningDispatcher({ allowLoopback:
// true })` + `undici.fetch('http://public-host')` would be permitted. To stay AT LEAST AS STRICT
// as before (and avoid weakening fed-client), we keep our own protocol-aware dispatcher built on
// guarded-fetch's audited `createValidatingLookup` primitive — restoring the exact prior posture
// without forking the guard. (Filed upstream: guarded-fetch's bare `createPinningDispatcher`
// should itself be protocol-aware — see the task report.)

import {
  type ConnectLookup,
  createValidatingLookup,
  type NodePinningOptions,
  type ResolveAll,
} from "@jeswr/guarded-fetch/node";
import { Agent, buildConnector, type Dispatcher } from "undici";

export {
  type ConnectLookup,
  createNodeGuardedFetch,
  createValidatingLookup,
  type NodePinningOptions,
  nodeGuardedFetch,
  type ResolveAll,
} from "@jeswr/guarded-fetch/node";

/** Promise form of `dns.lookup(host, { all: true })`, returning every A/AAAA record. */
const defaultResolveAll: ResolveAll = (hostname) =>
  // Lazy-require node:dns so this stays a node-only concern (the module is the `./node`
  // entry, already node-only). We mirror guarded-fetch's own default resolver.
  import("node:dns").then(
    (dns) =>
      new Promise((resolve, reject) => {
        dns.lookup(hostname, { all: true }, (err, addresses) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(addresses);
        });
      }),
  );

/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated IP — the
 * rebinding-closing dispatcher. PROTOCOL-AWARE, restoring this package's prior posture
 * (roborev Medium): an `http:` connect uses a LOOPBACK-ONLY validating lookup so that, even
 * under `allowLoopback: true`, a plaintext `http:` request can only ever reach a loopback IP at
 * connect time — never a public host; an `https:` connect uses the standard
 * `isPublicAddress`-based lookup. Both keep TLS cert validation ON (we never pass
 * `rejectUnauthorized: false`) and forward the optional private-`ca`.
 *
 * The returned dispatcher is suitable to pass as `fetch(url, { dispatcher })` (undici), but
 * prefer {@link createNodeGuardedFetch}, which wires this together with the full SSRF guard
 * (scheme/userinfo/literal checks, redirect re-validation, body + time caps). Use this directly
 * only if you are composing your own request pipeline and already apply those checks. The Agent
 * never re-resolves a hostname for connection: our `lookup` is the sole resolver and returns
 * only pre-validated addresses, so the socket is pinned to the validated IP.
 */
export function createPinningDispatcher(options: NodePinningOptions = {}): Dispatcher {
  const allowLoopback = options.allowLoopback ?? false;
  const connectTimeout = options.timeoutMs ?? 10_000;
  const resolveAll = options.resolveAll ?? defaultResolveAll;

  const makeLookup = (requireLoopbackOnly: boolean): ConnectLookup =>
    createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);

  // Two base connectors, differing ONLY in the protocol-aware lookup. Both keep TLS cert
  // validation ON and the optional private-CA.
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
    // Custom connect (function form): undici hands us the full connect `Options`, INCLUDING
    // `protocol`, so we pick the loopback-only connector for an `http:` hop and the standard
    // public connector for `https:`. undici sets `opts.servername` to the request hostname, so
    // TLS SNI + cert validation stay against the original host while our lookup steers the
    // (pinned) IP. The Agent does NOT follow redirects on its own — the shared guard re-pins
    // each hop through a fresh request — so a 30x to a private IP is blocked at the next hop.
    connect(opts: buildConnector.Options, cb: buildConnector.Callback) {
      const connector = opts.protocol === "http:" ? loopbackOnlyConnector : httpsConnector;
      connector(opts, cb);
    },
  });
}
