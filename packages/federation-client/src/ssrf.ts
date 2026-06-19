// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SSRF-guarding fetch wrapper for consuming a registry URL (a user/config-supplied
// remote origin). `discoverFromRegistry`/`resolveStorageSpecVersion` fetch a remote
// document the caller named; without a guard a hostile/typo'd URL could coax an
// outbound request to an internal service (cloud metadata 169.254.169.254, the
// docker bridge, localhost admin ports, RFC-1918 hosts). This module produces a
// `fetch`-shaped function that, on every request AND every redirect hop:
//   - allows only `https:` (no http:, file:, data:, gopher:, …) by default;
//   - rejects userinfo (`https://user:pass@…`) so credentials never leak to the host;
//   - classifies the target host. There are TWO branches, selected automatically by
//     CAPABILITY DETECTION (is `node:dns/promises` importable), NOT a caller flag, so
//     a Node consumer is unaffected and a browser/static-export consumer needs no shim:
//       * NODE branch (DNS available): an IP literal is checked directly; a hostname is
//         DNS-resolved and EVERY resolved A/AAAA record must be public — a DNS-rebinding
//         mitigation (one record to a public IP, one to 127.0.0.1 is refused).
//       * BROWSER branch (no `node:dns`): a DNS-LESS guard — there is no resolver, so a
//         hostname is inspected SYNTACTICALLY (reject `localhost`, `*.local`,
//         `*.localhost`, and any private/loopback/link-local/metadata IP LITERAL in the
//         URL host) and otherwise allowed. See the residual note below — this is the
//         inherent limit of browser `fetch`, surfaced honestly.
//     In both branches Loopback / RFC-1918 / CGNAT / link-local / metadata / multicast /
//     reserved / IPv4-mapped-IPv6 / IPv6-ULA / 6to4- and NAT64-embedded-private-v4
//     LITERALS are all refused;
//   - does NOT auto-follow redirects: it sets `redirect: "manual"`, then re-runs the
//     full guard (the SAME branch) against each `Location` (bounded hops + loop
//     detection) and only follows allowed hosts — so a 302 to `http://169.254.169.254/…`
//     is refused in both branches;
//   - caps the response body (buffered up to `maxBytes`, over-cap rejected) and
//     bounds the whole operation (initial fetch + redirects + body) with a single
//     timeout via one AbortController.
//
// BROWSER-SAFE node: imports (the load-bearing mechanism for task #92). This module
// has NO top-level `import` of a `node:` builtin. The IP-literal classifier is a
// pure-JS `classifyIpLiteral` (matching `node:net#isIP` semantics; fuzzed against it in
// the tests) — now in `./ip.ts` and imported here — so `node:net` is never imported,
// and the only `node:dns/promises` use is a LAZY `await import(...)` reached ONLY on the
// Node branch (gated by `hasNodeDns()`). So a browser bundler with no Node polyfills
// resolves + tree-shakes this module with no `NormalModuleReplacementPlugin` /
// `resolve.fallback` shim. (Before #92 a top-level `import { isIP } from "node:net"`
// forced the PM /federations build to add a webpack shim — that is now unnecessary.)
//
// The IP-classification primitive (`classifyIpLiteral` / `isPublicAddress` /
// `isLoopbackAddress` + the IPv4/IPv6 range helpers) lives in `./ip.ts` — pure,
// browser-safe, no `node:` import — and is imported + re-exported here. Its ranges are
// ported from the suite's vetted, exhaustively-tested `@pss/guarded-fetch` package
// (prod-solid-server `packages/guarded-fetch/src/addresses.ts`, itself ported from the
// RS WebID resolver); see `./ip.ts`'s header for why they are duplicated rather than
// depended on, and keep them in lock-step with that source.
//
// DNS-pinning note (NODE branch): the suite RS pins the validated IP into the
// connection via an undici `Agent({ connect: { lookup } })`, closing the lookup→connect
// rebinding TOCTOU exactly. This client library targets plain `fetch` (browser + Node)
// and deliberately does NOT depend on undici (it would bloat the browser bundle for a
// Node-only capability), so the DEFAULT plain-fetch path cannot pin the socket: the
// residual gap is a host that resolves to a public IP at guard time and a private IP
// microseconds later at connect time. Two things bound this: (1) the redirect
// re-validation + literal-IP blocking are absolute regardless of pinning; (2) a
// security-strict caller sets `requireDnsPinning: true`, which REFUSES a hostname
// unless the caller passes a DISTINCT, branded `pinningFetch` (an asserted
// pinning-capable fetch, e.g. an undici-`Agent`) — used unchanged so it pins the
// connection. A generic auth/custom `fetch` does NOT satisfy the strict posture; only
// `pinningFetch` does, so an ordinary fetch can never silently re-open the window.
// Full closure is therefore a deliberate, opt-in caller choice for the default `.` entry;
// the default best-effort posture documents the window rather than silently leaving it.
// (#86 — FULL rebinding closure — is now IMPLEMENTED in the SEPARATE `./node` entry
// (`src/node.ts`): a real undici-`Agent` pinningFetch that resolves-once → validates-all
// → PINS the validated IP to the socket connect, wired in here as `pinningFetch` with
// `requireDnsPinning: true`. It lives in its OWN Node-only module so `undici` / `node:`
// builtins are NEVER imported into THIS module or the default `.` entry — the browser
// path (#92) stays shim-free. Do NOT import undici here.)
//
// DNS-LESS-branch RESIDUAL + the edge/worker distinction (documented honestly, not
// hidden). On the DNS-less branch there is NO DNS resolver and `fetch` exposes no socket,
// so the guard CANNOT verify where a hostname actually resolves at connect time. A
// hostname that looks public in the URL (`https://innocent.example/…`) but resolves to a
// private IP (`10.x`, `169.254.169.254`, …) at connect time is NOT caught by hostname
// inspection alone. How that residual is handled depends on the RUNTIME (roborev #92
// round-2 High):
//   - A POSITIVELY-IDENTIFIED BROWSER (a DOM `window`): a public-looking https hostname
//     is ALLOWED — this is the SAME residual every browser app already has (the page can
//     `fetch` any origin regardless), and accepting it is the cost of needing no Node
//     builtins / no shim.
//   - ANY OTHER DNS-less runtime (edge / Cloudflare Workers / Deno without node compat):
//     a public-looking hostname FAILS CLOSED unless the caller sets `allowUnresolvedHosts`
//     — in a server runtime an unresolved hostname reaching private infra is a real SSRF
//     escalation, not the benign browser residual.
// In BOTH cases the DNS-less branch still blocks the obvious vectors (non-https,
// userinfo, `localhost`/`*.local` NAMES, private/loopback/metadata IP LITERALS in the
// host, http: to a non-loopback name) and re-validates each redirect hop the same way.
// For a target you do not control on the NODE branch you get the full DNS-resolve +
// every-record-public check on top.

/** Raised when the SSRF guard refuses a URL / redirect / oversize body. */
export class SsrfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsrfError";
  }
}

// IP-LITERAL CLASSIFICATION lives in `./ip.ts` — the pure, browser-safe SSRF primitive
// (`classifyIpLiteral` / `isPublicAddress` / `isLoopbackAddress` + the IPv4/IPv6 range
// helpers), extracted so its dense, RFC-spec'able logic is reviewable in isolation from
// the guard's fetch/redirect POLICY below. It is the ONLY place `node:net#isIP` is
// replaced (the #92 browser-safe mechanism) and the only IP-range source of truth. We
// import the three public entries here and RE-EXPORT them so the package's public API
// (via `./index.ts`) and the existing `../src/ssrf.js` internal-import contract are
// byte-identical. Keep `./ip.ts`'s ranges in lock-step with `@pss/guarded-fetch`.
import { classifyIpLiteral, isLoopbackAddress, isPublicAddress } from "./ip.js";

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

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * The `node:dns/promises` module specifier, assembled at runtime so a browser bundler
 * (esbuild / webpack / turbopack) CANNOT statically see the literal `"node:dns/promises"`
 * and therefore never tries to resolve it at build time. This is the load-bearing part
 * of the #92 browser-safe mechanism: a *literal* `await import("node:dns/promises")` is
 * still statically analysed by esbuild (it errors `Could not resolve "node:dns/promises"`
 * under `platform:"browser"`), which is exactly the resolution failure that forced the
 * PM build to add a `NormalModuleReplacementPlugin` shim. An OPAQUE specifier sidesteps
 * the static analyser — the import is performed only at runtime, only on Node (gated by
 * `hasNodeDns()` so it never even runs in a browser). `classifyIpLiteral` (pure JS)
 * replaces `node:net`, so `node:net` is not imported at all.
 */
const NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");

/**
 * Marker error thrown by {@link loadNodeDnsLookup} when the `node:dns/promises` MODULE itself
 * cannot be imported (as opposed to a genuine DNS resolution failure). The guard uses
 * this to distinguish "this isn't really a Node runtime — fall back to the DNS-less
 * policy" from "the host did not resolve — fail" (roborev #92 round-3 Medium). This
 * matters when `process.versions.node` is present (e.g. a browser bundle with a `process`
 * shim) but `node:dns` is not actually importable.
 */
class NodeDnsUnavailableError extends Error {}

/**
 * PROBE + load Node's `dns/promises.lookup` if running on Node, returning a bound
 * {@link DnsLookup}. Uses the opaque {@link NODE_DNS_SPECIFIER} so the import is invisible
 * to a browser bundler's static analysis (see that constant's note) — no `node:`
 * resolution at build time, no shim. If the module cannot be imported (a non-Node runtime
 * that merely *looks* like Node via a `process` shim), throws {@link
 * NodeDnsUnavailableError} so the caller can fall back to the DNS-less policy.
 *
 * The IMPORT (capability probe) is separated from a host RESOLUTION (roborev #92 round-6
 * Medium): the guard probes importability ONCE up front, so the strict `requireDnsPinning`
 * rejection can fire BEFORE any `lookup(host)` network query — no DNS leaks for a request
 * the strict posture was always going to refuse.
 */
async function loadNodeDnsLookup(): Promise<DnsLookup> {
  let mod: { lookup: (host: string, opts: { all: true }) => Promise<ResolvedAddress[]> };
  try {
    mod = (await import(/* @vite-ignore */ NODE_DNS_SPECIFIER)) as typeof mod;
  } catch (cause) {
    throw new NodeDnsUnavailableError(`node:dns/promises is not importable: ${message(cause)}`, {
      cause,
    });
  }
  return (host: string) => mod.lookup(host, { all: true });
}

/**
 * Build a `fetch`-shaped guarded fetcher bound to the given options. The returned
 * function has the `typeof globalThis.fetch` signature so it can be passed straight
 * into `@jeswr/federation-registry`'s `parseRegistry({ fetch })` / `parseStorage`,
 * which call it (via `@jeswr/fetch-rdf`) with `(url, { headers, signal? })`. The
 * guard validates the URL + every redirect hop, caps the body, and bounds the time.
 */
export function createGuardedFetch(options: GuardOptions = {}): typeof globalThis.fetch {
  const guard = new SsrfGuard(options);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    guard.fetch(input, init)) as typeof globalThis.fetch;
}

/**
 * One-shot guarded fetch (constructs a guard per call). Prefer
 * {@link createGuardedFetch} when issuing many requests with the same policy.
 */
export function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit & GuardOptions,
): Promise<Response> {
  return new SsrfGuard(init ?? {}).fetch(input, init);
}

/** The guard implementation: URL validation, redirect re-validation, body cap, timeout. */
class SsrfGuard {
  private readonly fetcher: typeof globalThis.fetch;
  /**
   * A caller-INJECTED DNS lookup (a custom resolver / test stub), or `undefined`. When
   * present it is the resolver and there is no import-failure fallback (an injected lookup
   * throwing is always a genuine resolution failure). Distinct from the DEFAULT node
   * lookup (see {@link usingDefaultNodeLookup}), which is probed lazily.
   */
  private readonly injectedLookup: DnsLookup | undefined;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowLoopback: boolean;
  private readonly allowUnresolvedHosts: boolean;
  private readonly requireDnsPinning: boolean;
  /**
   * Whether the caller supplied a DISTINCT, branded {@link GuardOptions.pinningFetch}
   * (the explicit "this fetch pins DNS" attestation). A plain {@link GuardOptions.fetch}
   * does NOT set this — so a generic auth/custom fetch can never silently satisfy
   * `requireDnsPinning` (roborev round-2 High).
   */
  private readonly havePinningFetch: boolean;
  /**
   * Whether we are in a positively-identified BROWSER context (a DOM window). On the
   * DNS-less branch this gates whether a public-looking hostname is allowed by default:
   * a real browser accepts the documented residual; any other DNS-less runtime
   * (edge / workers) fails closed unless `allowUnresolvedHosts` (roborev #92 round-2
   * High). Captured once at construction.
   */
  private readonly isBrowser: boolean;
  /**
   * Whether the DEFAULT Node `node:dns` lookup is in play (no injected lookup AND the
   * process LOOKS like Node). The actual `node:dns` import is probed lazily by
   * {@link resolveDefaultLookup}; if it cannot be imported (a non-Node runtime with only a
   * `process` shim) the guard FALLS BACK to the DNS-less policy (roborev #92 round-3).
   */
  private readonly usingDefaultNodeLookup: boolean;
  /** Cached default-node-lookup probe (see {@link resolveDefaultLookup}). */
  private defaultLookup: Promise<DnsLookup> | undefined;

  constructor(options: GuardOptions) {
    this.havePinningFetch = options.pinningFetch !== undefined;
    this.isBrowser = isBrowserContext();
    // A branded pinningFetch (if given) is the underlying fetch; else the generic
    // fetch; else the global. pinningFetch takes precedence when both are present.
    this.fetcher = options.pinningFetch ?? options.fetch ?? globalThis.fetch;
    // DNS lookup selection: an INJECTED function (test/custom) wins and resolves directly;
    // `null` explicitly disables DNS (the DNS-less branch); `undefined` (the default) uses
    // the Node `node:dns` lookup WHEN the process LOOKS like Node — but its IMPORT is only
    // probed lazily (resolveDefaultLookup), separating capability from a host query so the
    // strict requireDnsPinning rejection can fire before any network lookup (roborev #92
    // round-6). `hasNodeDns()` is a cheap heuristic; the import probe is authoritative.
    this.injectedLookup = options.dnsLookup === null ? undefined : (options.dnsLookup ?? undefined);
    this.usingDefaultNodeLookup = options.dnsLookup === undefined && hasNodeDns();
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.allowLoopback = options.allowLoopback ?? false;
    this.allowUnresolvedHosts = options.allowUnresolvedHosts ?? false;
    this.requireDnsPinning = options.requireDnsPinning ?? false;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Normalise a `Request` input so its method/headers/body/signal are NOT dropped
    // (roborev round-2 Low): when `input` is a Request, fold its fields into the init
    // (any explicit `init` arg wins per the WHATWG `fetch(input, init)` contract).
    const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
    // ONE controller + timer spanning the whole operation (initial fetch + every
    // redirect hop + the bounded body read) so a slow chain cannot exceed the budget.
    // We always chain to any caller-supplied signal so an external abort still works.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = effectiveInit?.signal ?? undefined;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    try {
      return await this.fetchGuarded(startUrl, effectiveInit, controller);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  private async fetchGuarded(
    startUrl: string,
    init: RequestInit | undefined,
    controller: AbortController,
  ): Promise<Response> {
    let currentUrl = startUrl;
    // Per-hop init — copied so we can strip credential-bearing headers on a
    // cross-origin redirect without mutating the caller's object.
    let currentInit: RequestInit = { ...(init ?? {}) };
    const seen = new Set<string>();
    // hop 0 = the initial request; up to maxRedirects further hops.
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new SsrfError(`Redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      await this.assertAllowed(currentUrl);

      let res: Response;
      try {
        res = await this.fetcher(currentUrl, {
          ...currentInit,
          // We re-validate every hop ourselves, so the underlying fetch must NOT
          // auto-follow — a browser-style follow would let a hostile redirect bounce
          // to an internal address before the guard ever saw the Location.
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (cause) {
        throw new SsrfError(`Fetch failed for ${currentUrl}: ${message(cause)}`, { cause });
      }

      if (!isRedirect(res.status)) {
        // Terminal response — enforce the body cap and hand it back.
        return await this.capBody(res, currentUrl, controller);
      }

      const location = res.headers.get("location");
      if (!location) {
        // A 3xx with no Location is not followable — return it as-is (capped).
        return await this.capBody(res, currentUrl, controller);
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new SsrfError(`Redirect to a malformed Location (${location}) from ${currentUrl}.`);
      }
      // Rewrite the next-hop init per the standard Fetch redirect rules:
      //   - method/body: a 303 (always), and a 301/302 on a non-GET/HEAD method,
      //     switch the method to GET and drop the body + body-shaping `Content-*`
      //     headers (so a POST is not replayed across a redirect);
      //   - cross-origin: additionally strip credential-bearing headers
      //     (`Authorization`/`Cookie`/`DPoP`/…) so they never leak to a different
      //     (even allowed-public) origin a hostile redirect points at.
      currentInit = rewriteInitForRedirect(
        currentInit,
        res.status,
        !sameOrigin(currentUrl, nextUrl),
      );
      // Drain/cancel the redirect response body so the connection is released before
      // we issue the next hop (the guard never needs a redirect's body).
      try {
        await res.body?.cancel();
      } catch {
        // Body already consumed/closed — fine.
      }
      currentUrl = nextUrl;
    }
    throw new SsrfError(`Too many redirects (> ${this.maxRedirects}) starting from ${startUrl}.`);
  }

  /**
   * Buffer the response body up to `maxBytes` (rejecting an over-cap declared
   * `Content-Length` up front and an over-cap stream mid-read) and return a fresh
   * `Response` carrying the capped bytes + the original status/headers/url. Buffering
   * (rather than handing back a streaming body) makes the cap authoritative regardless
   * of how the downstream consumer reads it.
   */
  private async capBody(
    res: Response,
    url: string,
    controller: AbortController,
  ): Promise<Response> {
    const declared = Number(res.headers.get("content-length") ?? Number.NaN);
    if (!Number.isNaN(declared) && declared > this.maxBytes) {
      controller.abort();
      throw new SsrfError(
        `Response body for ${url} exceeds cap (Content-Length ${declared} > ${this.maxBytes}).`,
      );
    }
    const bytes = await this.readCapped(res, url, controller);
    // Reconstruct a Response so the original headers/status survive but the body is
    // the validated, size-bounded buffer.
    // A null-body status (204/205/304) MUST be constructed with a `null` body — passing
    // even an empty `ArrayBuffer` throws (roborev round-3 Low); pass the backing
    // `ArrayBuffer` (a `BodyInit`/`BufferSource`) only for body-bearing statuses.
    const body = isNullBodyStatus(res.status) ? null : bytes.buffer;
    const out = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    // Preserve the FINAL (post-redirect) URL on the capped response. `Response.url` is
    // read-only and not settable via the constructor, so define it explicitly — the
    // registry's `fetchRdf` uses `response.url || requestUrl` as the parse base IRI, so
    // without this a relative IRI in a REDIRECTED registry/storage document would
    // resolve against the original (pre-redirect) URL (roborev round-4 Medium). Prefer
    // the underlying response's own `.url` when present (most accurate), else the final
    // hop URL the guard followed to.
    const finalUrl = res.url || url;
    try {
      Object.defineProperty(out, "url", { value: finalUrl, configurable: true });
    } catch {
      // A runtime that forbids redefining `url` — harmless; base IRI falls back to the
      // request URL exactly as before.
    }
    return out;
  }

  private async readCapped(
    res: Response,
    url: string,
    controller: AbortController,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const body = res.body;
    if (!body) {
      return new Uint8Array(new ArrayBuffer(0));
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          total += value.byteLength;
          if (total > this.maxBytes) {
            controller.abort();
            throw new SsrfError(
              `Response body for ${url} exceeds cap (${total} bytes > ${this.maxBytes}).`,
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released / errored — fine.
      }
    }
    const out = new Uint8Array(new ArrayBuffer(total));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /**
   * Refuse `rawUrl` unless it is an https (or, under `allowLoopback`, http-to-loopback)
   * URL with no userinfo whose host is allowed by the active branch:
   *   - NODE branch (DNS available): an IP literal is checked directly; a hostname is
   *     DNS-resolved and EVERY record must be public (DNS-rebinding mitigation); under
   *     `requireDnsPinning` a hostname through the default fetch is refused outright.
   *   - BROWSER branch (no DNS): an IP literal is checked directly; a hostname is
   *     inspected SYNTACTICALLY (reject `localhost` / `*.local` / `*.localhost`) and
   *     otherwise allowed — see the module-header residual note (a hostname that
   *     resolves to a private IP at connect time is NOT caught: inherent to browser
   *     `fetch`).
   * The host-shape checks (scheme, userinfo, IP literal) are identical in both branches;
   * only the hostname (non-literal) path differs.
   */
  private async assertAllowed(rawUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SsrfError(`Registry URL is malformed: ${rawUrl}.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SsrfError(
        `Registry URL must be https: (got ${url.protocol} for ${rawUrl}). Only http(s) is fetched.`,
      );
    }
    if (url.protocol === "http:" && !this.allowLoopback) {
      throw new SsrfError(
        `Registry URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev).`,
      );
    }
    if (url.username || url.password) {
      throw new SsrfError(`Registry URL must not carry userinfo (credentials): ${url.host}.`);
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const literalKind = classifyIpLiteral(hostname);

    // IP-LITERAL targets: classified directly in BOTH branches (no resolution, no
    // rebinding window). This is the absolute literal-IP block that holds regardless of
    // whether DNS is available — so a `https://10.0.0.1/`, `https://169.254.169.254/`,
    // `https://[::1]/`, `https://[::ffff:10.0.0.1]/` etc. is refused everywhere.
    if (literalKind !== 0) {
      const r = { address: hostname, family: literalKind };
      this.assertResolvedAddressesAllowed(url, hostname, [r]);
      return;
    }

    // HOSTNAME targets (non-literal). Determine the active resolver, separating DNS
    // CAPABILITY (is a resolver available) from a host QUERY:
    //   - an INJECTED lookup is a known-available resolver (resolve directly);
    //   - the DEFAULT node lookup is probed (import only — no host query); on import
    //     failure (a runtime that only LOOKS like Node via a `process` shim) we route to
    //     the DNS-less policy;
    //   - neither ⇒ the DNS-less branch.
    let lookup: DnsLookup;
    if (this.injectedLookup) {
      lookup = this.injectedLookup;
    } else if (this.usingDefaultNodeLookup) {
      try {
        lookup = await this.resolveDefaultLookup();
      } catch (cause) {
        // The default `node:dns` import is NOT possible here — not really Node. This is a
        // CAPABILITY result, not a resolution failure, and it leaked no DNS query: route to
        // the DNS-less policy (roborev #92 round-3 + round-6 Medium).
        if (cause instanceof NodeDnsUnavailableError) {
          this.assertDnslessHostnameAllowed(url.protocol, hostname);
          return;
        }
        throw new SsrfError(`node:dns probe failed for ${hostname}: ${message(cause)}`, { cause });
      }
    } else {
      // --- DNS-LESS branch (no resolver available at all).
      this.assertDnslessHostnameAllowed(url.protocol, hostname);
      return;
    }

    // --- NODE branch: a resolver IS available. The DNS-rebinding fail-closed posture now
    // applies and fires BEFORE any host query (roborev #92 round-6 Medium — no DNS leak for
    // a request the strict posture was always going to refuse): a HOSTNAME (validated but,
    // on plain `fetch`, not socket-pinned) is refused under `requireDnsPinning` unless a
    // DISTINCT, branded `pinningFetch` was supplied. A generic auth/custom `fetch` does NOT
    // satisfy this — only the explicit pinning attestation does (roborev round-2 High).
    if (this.requireDnsPinning && !this.havePinningFetch) {
      throw new SsrfError(
        `Registry URL refused — requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`,
      );
    }
    let resolved: ResolvedAddress[];
    try {
      resolved = await lookup(hostname);
    } catch (cause) {
      throw new SsrfError(`Registry host did not resolve: ${hostname}: ${message(cause)}`, {
        cause,
      });
    }
    if (resolved.length === 0) {
      throw new SsrfError(`Registry host resolved to no addresses: ${hostname}.`);
    }
    this.assertResolvedAddressesAllowed(url, hostname, resolved);
  }

  /**
   * Probe + cache the DEFAULT Node `node:dns` lookup. The import (capability) is attempted
   * ONCE and memoised; a successful probe yields the bound lookup, a failed import throws
   * {@link NodeDnsUnavailableError} (cached so we do not retry the import per request). The
   * caller (the hostname path) probes this BEFORE the requireDnsPinning rejection so the
   * strict posture fails before any network query (roborev #92 round-6 Medium).
   */
  private resolveDefaultLookup(): Promise<DnsLookup> {
    if (this.defaultLookup === undefined) {
      this.defaultLookup = loadNodeDnsLookup();
    }
    return this.defaultLookup;
  }

  /**
   * DNS-LESS branch hostname guard (no resolver). The IP-literal cases are already
   * handled by the caller; here `hostname` is a non-literal name. We:
   *   1. REFUSE the obvious local/loopback names — `localhost`, `*.localhost`, `local`,
   *      `*.local` — which denote a private host on essentially every system (only
   *      permitted under the dev `allowLoopback` escape hatch);
   *   2. enforce the scheme policy WITH protocol context (roborev #92 round-2 Medium): an
   *      `http:` URL (reachable here only under `allowLoopback`) is allowed ONLY for the
   *      loopback NAMES above — never a public-looking hostname over `http:`, matching the
   *      Node branch's "http is loopback-only" intent;
   *   3. for a public-looking https hostname, ALLOW it ONLY in a positively-identified
   *      browser (the documented inherent residual — the page can `fetch` any origin
   *      anyway) OR when the caller set `allowUnresolvedHosts`. In a DNS-less *server*
   *      runtime (edge / workers) WITHOUT that opt-in we FAIL CLOSED (roborev #92 round-2
   *      High) — an unresolved public-looking hostname reaching private infra is a real
   *      SSRF escalation there, not the benign browser residual.
   * `requireDnsPinning` cannot be honoured without a resolver, so it fails closed for ANY
   * hostname (incl. a loopback name) unless `allowUnresolvedHosts` is set — and that check
   * runs FIRST, ahead of every allow path, so the `allowLoopback` dev hatch cannot let a
   * `localhost` target bypass the strict posture (roborev #92 round-3 Medium). The
   * browser-vs-server decision uses `this.isBrowser`, which is `process`-independent
   * (`window === globalThis`), so it is correct on the import-failure fallback path too.
   */
  private assertDnslessHostnameAllowed(protocol: string, hostname: string): void {
    const lower = hostname.toLowerCase().replace(/\.$/, ""); // strip a trailing FQDN dot

    // STRICT-PINNING GATE FIRST (roborev #92 round-3 Medium): `requireDnsPinning` asks for
    // a socket pinned to a validated address, which is impossible without a resolver. It
    // therefore fails closed for EVERY DNS-less hostname target — INCLUDING a loopback
    // name — unless the caller explicitly accepted the no-resolver residual via
    // `allowUnresolvedHosts`. This must run BEFORE any allow path below, so the
    // `allowLoopback` dev hatch cannot let a `localhost` target slip past the strict
    // posture (the pre-#92 behaviour rejected any hostname under requireDnsPinning).
    if (this.requireDnsPinning && !this.allowUnresolvedHosts) {
      throw new SsrfError(
        `Registry URL refused — requireDnsPinning is set but no DNS resolver is available in this runtime to pin "${hostname}". A browser cannot pin a socket; set allowUnresolvedHosts to accept the residual, or run on Node with a pinningFetch.`,
      );
    }

    // `.local` / `local` is the mDNS LAN namespace (RFC 6762) — a LINK-LOCAL/private
    // network target (e.g. `printer.local`), NOT loopback. It must be REFUSED outright
    // and is NOT re-permitted by `allowLoopback` (which is a localhost dev escape hatch)
    // — on the Node branch such a name resolving to a private LAN address would be
    // rejected, so the DNS-less branch must not silently allow it (roborev #92 round-3
    // Medium).
    if (lower === "local" || lower.endsWith(".local")) {
      throw new SsrfError(
        `Registry URL refused — "${hostname}" is an mDNS/link-local (.local) name denoting a private LAN target. Use a public https host.`,
      );
    }

    // `localhost` / `*.localhost` is the loopback namespace (RFC 6761). Permit ONLY under
    // the dev `allowLoopback` escape hatch (matching the Node branch's intent that
    // http/loopback is dev-only); refused otherwise.
    if (lower === "localhost" || lower.endsWith(".localhost")) {
      if (this.allowLoopback) {
        return;
      }
      throw new SsrfError(
        `Registry URL refused — "${hostname}" is a loopback name (localhost/*.localhost), which denotes a private target. Use a public https host.`,
      );
    }

    // An http: URL only reaches here under allowLoopback (the scheme check refuses http:
    // otherwise). http: is dev-loopback-only — a public-looking hostname over http: is
    // NEVER allowed (it was already rejected above if it were a loopback name).
    if (protocol === "http:") {
      throw new SsrfError(
        `Registry URL refused — http: is allowed only for a loopback name (localhost/*.localhost) in this runtime; "${hostname}" is not loopback. Use https:.`,
      );
    }

    // A public-looking https hostname with no resolver. Allow it ONLY when EITHER we are
    // in a positively-identified browser (the documented inherent residual — a page can
    // `fetch` any origin anyway) OR the caller explicitly accepted the no-resolver risk
    // via `allowUnresolvedHosts`. In any OTHER DNS-less runtime (edge / Cloudflare
    // Workers / Deno / a DOM-shimmed SSR process) we FAIL CLOSED: there, reaching private
    // infra via an unresolved hostname is a real SSRF escalation, not the benign browser
    // residual (roborev #92 round-2 High).
    if (this.isBrowser || this.allowUnresolvedHosts) {
      return;
    }
    throw new SsrfError(
      `Registry URL refused — no DNS resolver is available in this runtime to classify "${hostname}", and this is not a positively-identified browser context. ` +
        "Set allowUnresolvedHosts to accept that hostname targets cannot be classified here (you trust the URL source), or run on Node where the full DNS-resolve guard applies.",
    );
  }

  /**
   * Enforce the address-level policy on a set of resolved (or literal) addresses, shared
   * by the IP-literal and Node-branch paths: under `allowLoopback` an http: URL must
   * resolve to loopback ONLY, and EVERY address must be public (or loopback when
   * allowLoopback) — one private record fails the whole request (rebinding mitigation).
   */
  private assertResolvedAddressesAllowed(
    url: URL,
    hostname: string,
    resolved: ResolvedAddress[],
  ): void {
    // Under `allowLoopback`, an http: URL must resolve to loopback ONLY — a dev box
    // must not HTTP-fetch a public host. (https: under allowLoopback may still target
    // loopback or public.)
    if (url.protocol === "http:" && this.allowLoopback) {
      for (const r of resolved) {
        if (!isLoopbackAddress(r.address)) {
          throw new SsrfError(
            `Registry URL refused — http: is allowed only when every resolved address is loopback (got ${r.address} for ${hostname}). Use https:.`,
          );
        }
      }
    }
    // DNS-rebinding mitigation: EVERY resolved address must be public (or loopback
    // when allowLoopback). One private record in the set fails the whole request.
    for (const r of resolved) {
      if (!isPublicAddress(r.address, this.allowLoopback)) {
        throw new SsrfError(
          `Registry URL refused — ${hostname} resolves to a non-public address (${r.address}).`,
        );
      }
    }
  }
}

// --- small helpers ----------------------------------------------------------

/** Whether a status code is a redirect we re-validate + follow manually. */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Whether a status code is a "null body status" per the Fetch spec — `new Response`
 * MUST be given a `null` body for these (even an empty buffer throws a `TypeError`).
 */
function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

/** Whether two URLs share the same WHATWG origin (scheme + host + port). */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false; // an unparseable URL is never same-origin (fail safe → strip headers)
  }
}

/**
 * Credential-bearing request headers that must NOT be forwarded across a CROSS-ORIGIN
 * redirect (the standard browser rule — a hostile redirect to a different, even
 * allowed-public, origin must not receive the caller's `Authorization` / `Cookie` /
 * `DPoP` etc.). Lower-cased for case-insensitive match.
 */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "www-authenticate",
  "dpop",
]);

/**
 * Body-shaping `Content-*` headers that must be dropped whenever a redirect strips the
 * request body (a method-changing redirect — see {@link rewriteInitForRedirect}).
 */
const CONTENT_HEADERS: ReadonlySet<string> = new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "content-language",
  "content-location",
]);

/**
 * Rewrite the per-hop `init` for the NEXT redirect hop, applying standard Fetch
 * redirect semantics:
 *   - **Method/body rewrite** — a `303` (always), and a `301`/`302` when the current
 *     method is NOT `GET`/`HEAD`, switch the method to `GET` and DROP the request body
 *     (+ `duplex`) and the body-shaping `Content-*` headers. This is what stops a
 *     `POST` body being replayed across a redirect (roborev round-3 Medium). `307`/
 *     `308` preserve method + body, per spec.
 *   - **Cross-origin credential strip** — when `crossOrigin`, also remove the
 *     credential-bearing headers so they never leak to a different origin (roborev
 *     round-2 Medium).
 * Returns a fresh init (the caller's object is never mutated). Headers are normalised
 * from whatever `HeadersInit` shape the caller passed into a plain record.
 */
function rewriteInitForRedirect(
  init: RequestInit,
  status: number,
  crossOrigin: boolean,
): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const methodChanges =
    status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");

  // The body is dropped when EITHER (a) the method changes to GET (303 / non-GET
  // 301-302 — the standard rewrite), OR (b) the redirect is CROSS-ORIGIN: a
  // credentialed POST body must never be replayed to a different (even allowed-public)
  // origin a hostile redirect points at, regardless of status — so a cross-origin
  // 307/308 also drops the body + its `Content-*` headers (roborev round-4 Medium).
  const dropBody = methodChanges || crossOrigin;

  const headers = new Headers(init.headers ?? {});
  if (crossOrigin) {
    for (const name of CREDENTIAL_HEADERS) {
      headers.delete(name);
    }
  }
  if (dropBody) {
    for (const name of CONTENT_HEADERS) {
      headers.delete(name);
    }
  }
  const kept: Record<string, string> = {};
  headers.forEach((value, key) => {
    kept[key] = value;
  });

  // Strip fields we are about to override / drop, then rebuild.
  const {
    body: _body,
    duplex: _duplex,
    method: _method,
    ...rest
  } = init as RequestInit & {
    duplex?: string;
  };
  const next: RequestInit = { ...rest, headers: kept };
  if (methodChanges) {
    next.method = "GET"; // 303 / non-GET 301-302 → GET, no body
  } else if (init.method !== undefined) {
    next.method = init.method; // 307 / 308 / GET-301-302 keep the method...
    // ...and keep the body ONLY for a SAME-origin redirect (a cross-origin redirect
    // drops it above). A one-shot stream cannot be replayed, but that is a fetch
    // limitation, not introduced here; the guard issues few hops in practice.
    if (!dropBody && init.body !== undefined) {
      next.body = init.body;
      const duplex = (init as { duplex?: string }).duplex;
      if (duplex !== undefined) {
        (next as { duplex?: string }).duplex = duplex;
      }
    }
  }
  return next;
}

/**
 * Normalise the `(input, init)` a `fetch`-shaped call receives into a `{ url, init }`
 * pair. For a string / `URL` input, the url is taken directly and `init` is passed
 * through. For a **`Request`** input, its url is taken AND its request fields
 * (method / headers / body / credentials / redirect / signal …) are folded into the
 * init so they are NOT dropped — with any explicit `init` argument taking precedence
 * (the WHATWG `fetch(input, init)` override rule). This closes the case where a caller
 * builds a `new Request(url, { method, headers, body })` and passes it as the sole
 * argument (roborev round-2 Low). The guard then re-imposes its own `redirect:"manual"`
 * + `signal` downstream, so those two are not load-bearing here.
 */
function normalizeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { url: string; init: RequestInit | undefined } {
  if (typeof input === "string") {
    return { url: input, init };
  }
  if (input instanceof URL) {
    return { url: input.toString(), init };
  }
  // A `Request` object: carry its fields, letting an explicit `init` override.
  const req = input as Request;
  const fromRequest: RequestInit = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    redirect: req.redirect,
    ...(req.signal ? { signal: req.signal } : {}),
    // `req.body` is a one-shot ReadableStream; only attach it when present (a GET/HEAD
    // Request has none). The guard issues at most a few hops; a non-replayable stream
    // body is a known fetch limitation, not introduced here.
    ...(req.body ? { body: req.body, duplex: "half" } : {}),
  } as RequestInit;
  return { url: req.url, init: { ...fromRequest, ...(init ?? {}) } };
}

/** Is Node's `dns/promises` plausibly available (Node runtime)? */
function hasNodeDns(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions !== undefined &&
    process.versions.node !== undefined
  );
}

/**
 * Positively identify a REAL BROWSER context. This is consulted only on the DNS-LESS path
 * (no resolver available) to decide whether a public-looking hostname is allowed by
 * default — the documented browser residual is acceptable in an actual browser (a page can
 * `fetch` any origin anyway), but a DNS-less SERVER runtime (edge / Workers / Deno / an
 * SSR process with a DOM shim) must FAIL CLOSED for it (an unresolved public host reaching
 * private infra is a real SSRF escalation there).
 *
 * The load-bearing signal is `window === globalThis`: in an actual browser the global
 * object IS the `window`, so this identity holds. A SERVER DOM shim — jsdom / happy-dom on
 * Node, or an SSR polyfill — sets `globalThis.window` to a SEPARATE object, so
 * `window !== globalThis` there; an edge/worker runtime has no `window` at all. So this one
 * check distinguishes a real browser from BOTH a Node-with-jsdom runtime AND a DOM-shimmed
 * SSR/server runtime (roborev #92 round-3 + round-5 Medium). It needs NO `process`
 * heuristic, so it is correct on the import-failure fallback path too (roborev #92 round-4
 * Medium), where the Node signal would be moot. `document` is additionally required as
 * belt-and-braces.
 *
 * Conservative by design: a false negative (a real browser misdetected) only costs the
 * caller an explicit `allowUnresolvedHosts`; a false positive would re-open the SSRF
 * window — so we err toward fail-closed.
 */
function isBrowserContext(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return (
    typeof g.window !== "undefined" &&
    (g.window as unknown) === (globalThis as unknown) &&
    typeof g.document !== "undefined" &&
    g.document !== null
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
