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
//   - classifies the target host: an IP literal is checked directly; a hostname is
//     DNS-resolved (Node) and EVERY resolved A/AAAA record must be public — a
//     DNS-rebinding mitigation (one record to a public IP, one to 127.0.0.1 is
//     refused). Loopback / RFC-1918 / CGNAT / link-local / metadata / multicast /
//     reserved / IPv4-mapped-IPv6 / IPv6-ULA / 6to4- and NAT64-embedded-private-v4
//     are all refused;
//   - does NOT auto-follow redirects: it sets `redirect: "manual"`, then re-runs the
//     full guard against each `Location` (bounded hops + loop detection) and only
//     follows allowed hosts — so a 302 to `http://169.254.169.254/…` is refused;
//   - caps the response body (buffered up to `maxBytes`, over-cap rejected) and
//     bounds the whole operation (initial fetch + redirects + body) with a single
//     timeout via one AbortController.
//
// The IP-classification logic (`isPublicAddress` + helpers) is ported VERBATIM from
// the suite's vetted, exhaustively-tested `@pss/guarded-fetch` package
// (prod-solid-server `packages/guarded-fetch/src/addresses.ts`, itself ported from
// the RS WebID resolver). It is duplicated here (not depended on) only because
// `@pss/guarded-fetch` is an internal workspace package, not on npm; this client
// library ships standalone. Keep the two in lock-step.
//
// DNS-pinning note: the suite RS pins the validated IP into the connection via an
// undici `Agent({ connect: { lookup } })`, closing the lookup→connect rebinding
// TOCTOU exactly. This client library targets plain `fetch` (browser + Node) and
// deliberately does NOT depend on undici (it would bloat the browser bundle for a
// Node-only capability), so the DEFAULT plain-fetch path cannot pin the socket: the
// residual gap is a host that resolves to a public IP at guard time and a private IP
// microseconds later at connect time. Two things bound this: (1) the redirect
// re-validation + literal-IP blocking are absolute regardless of pinning; (2) a
// security-strict caller sets `requireDnsPinning: true`, which REFUSES a hostname
// unless the caller passes a DISTINCT, branded `pinningFetch` (an asserted
// pinning-capable fetch, e.g. an undici-`Agent`) — used unchanged so it pins the
// connection. A generic auth/custom `fetch` does NOT satisfy the strict posture; only
// `pinningFetch` does, so an ordinary fetch can never silently re-open the window.
// Full closure is therefore a deliberate, opt-in caller choice; the default
// best-effort posture documents the window rather than silently leaving it. (A bundled
// undici-pinning Node entry point is a tracked follow-up — see the package follow-ups.)

import { isIP } from "node:net";

/** Raised when the SSRF guard refuses a URL / redirect / oversize body. */
export class SsrfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsrfError";
  }
}

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
   * A DNS lookup for hostname classification. Defaults to Node's
   * `dns/promises.lookup(host, { all: true })` when available. Pass `null` to
   * explicitly declare NO DNS is available (a non-Node runtime); then a hostname
   * that is not an IP literal is REFUSED — fail closed — because the guard cannot
   * verify where it resolves, unless {@link GuardOptions.allowUnresolvedHosts} is set.
   * Injected in tests to drive the rebinding cases deterministically.
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
   * When no DNS lookup is available (non-Node runtime) AND the host is not an IP
   * literal, permit the request anyway instead of failing closed. Default `false`
   * (refuse). Set `true` only if you accept that hostname targets cannot be
   * classified in that environment and you trust the URL source.
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
 * Lazily resolve Node's `dns/promises.lookup` if running on Node; `undefined` in a
 * browser/edge runtime. Kept out of the module top-level `import` list so this file
 * imports cleanly where `node:dns` is unavailable (only `node:net#isIP` is needed
 * universally, and bundlers polyfill it).
 */
async function nodeDnsLookup(host: string): Promise<ResolvedAddress[]> {
  const { lookup } = await import("node:dns/promises");
  return lookup(host, { all: true });
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
  private readonly lookup: DnsLookup | undefined;
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

  constructor(options: GuardOptions) {
    this.havePinningFetch = options.pinningFetch !== undefined;
    // A branded pinningFetch (if given) is the underlying fetch; else the generic
    // fetch; else the global. pinningFetch takes precedence when both are present.
    this.fetcher = options.pinningFetch ?? options.fetch ?? globalThis.fetch;
    // Resolve the DNS lookup: an injected function (test) wins; `null` explicitly
    // disables DNS (simulate a non-Node runtime); `undefined` (the default) uses
    // Node DNS when available, else no DNS (fail-closed for hostnames).
    this.lookup =
      options.dnsLookup === null
        ? undefined
        : (options.dnsLookup ?? (hasNodeDns() ? nodeDnsLookup : undefined));
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
   * URL with no userinfo whose host classifies as public. A hostname is DNS-resolved
   * and EVERY record must pass (DNS-rebinding mitigation); under `requireDnsPinning` a
   * hostname through the default fetch is refused outright.
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
    const literalKind = isIP(hostname);
    // DNS-rebinding fail-closed posture: a HOSTNAME (which the guard validates but, on
    // plain `fetch`, cannot pin the socket to) is refused unless a DISTINCT, branded
    // `pinningFetch` was supplied. A generic auth/custom `fetch` does NOT satisfy this
    // — only the explicit pinning attestation does (roborev round-2 High). IP literals
    // need no resolution and have no rebinding window, so they bypass this check.
    if (this.requireDnsPinning && literalKind === 0 && !this.havePinningFetch) {
      throw new SsrfError(
        `Registry URL refused — requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`,
      );
    }
    let resolved: ResolvedAddress[];
    if (literalKind !== 0) {
      resolved = [{ address: hostname, family: literalKind }];
    } else if (this.lookup) {
      try {
        resolved = await this.lookup(hostname);
      } catch (cause) {
        throw new SsrfError(`Registry host did not resolve: ${hostname}: ${message(cause)}`, {
          cause,
        });
      }
      if (resolved.length === 0) {
        throw new SsrfError(`Registry host resolved to no addresses: ${hostname}.`);
      }
    } else {
      // No DNS available (non-Node) and not an IP literal: cannot verify the target.
      if (this.allowUnresolvedHosts) {
        return;
      }
      throw new SsrfError(
        `Cannot classify host ${hostname}: no DNS lookup is available in this runtime. ` +
          "Pass a dnsLookup, or set allowUnresolvedHosts to accept the risk.",
      );
    }

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

// --- IP classification ------------------------------------------------------
// Ported verbatim from @pss/guarded-fetch (prod-solid-server
// packages/guarded-fetch/src/addresses.ts). See the module header for why it is
// duplicated rather than imported. Keep in lock-step with the source.

/**
 * Classify an IPv4/IPv6 literal as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback only.
 */
export function isPublicAddress(address: string, allowLoopback: boolean): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPublicIpv4(address, allowLoopback);
  }
  if (family === 6) {
    return isPublicIpv6(address, allowLoopback);
  }
  return false;
}

/** Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). */
export function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return address.startsWith("127.");
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
      return true;
    }
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      return isIP(v4) === 4 && v4.startsWith("127.");
    }
  }
  return false;
}

function isPublicIpv4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) {
    return false; // 0.0.0.0/8
  }
  if (a === 127) {
    return allowLoopback;
  }
  if (a === 10) {
    return false; // RFC 1918
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false; // RFC 1918
  }
  if (a === 192 && b === 168) {
    return false; // RFC 1918
  }
  if (a === 169 && b === 254) {
    return false; // Link-local
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false; // CGNAT 100.64.0.0/10
  }
  if (a >= 224 && a <= 239) {
    return false; // Multicast 224.0.0.0/4
  }
  if (a >= 240) {
    return false; // Reserved / broadcast
  }
  if (a === 192 && b === 0 && c === 2) {
    return false; // TEST-NET-1
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false; // Benchmarking
  }
  if (a === 198 && b === 51 && c === 100) {
    return false; // TEST-NET-2
  }
  if (a === 203 && b === 0 && c === 113) {
    return false; // TEST-NET-3
  }
  return true;
}

/**
 * Pull the four IPv4 bytes from an IPv6 address starting at a given hextet pair index.
 * Used by the 6to4 + NAT64 checks to extract the embedded v4 and recurse through the
 * v4 classifier — preventing reaching an internal v4 via an IPv6-tunnelling prefix.
 */
function extractEmbeddedV4(hextets: string[], startHextet: number): string | undefined {
  const h1 = hextets[startHextet];
  const h2 = hextets[startHextet + 1];
  if (!h1 || !h2) {
    return undefined;
  }
  const w1 = Number.parseInt(h1, 16);
  const w2 = Number.parseInt(h2, 16);
  if (Number.isNaN(w1) || Number.isNaN(w2) || w1 < 0 || w1 > 0xffff || w2 < 0 || w2 > 0xffff) {
    return undefined;
  }
  return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`;
}

function isPublicIpv6(address: string, allowLoopback: boolean): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return allowLoopback;
  }
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") {
    return false; // Unspecified
  }
  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) — classify per the embedded v4. Detect via
  // FULL EXPANSION so both the compressed `::ffff:...` and the expanded
  // `0:0:0:0:0:ffff:HHHH:HHHH` forms are covered (a naive startsWith misses the latter,
  // letting `0:0:0:0:0:ffff:0a00:0001` = 10.0.0.1 pass as public).
  const mappedExpanded = expandIpv6(lower);
  if (
    mappedExpanded &&
    mappedExpanded[0] === "0" &&
    mappedExpanded[1] === "0" &&
    mappedExpanded[2] === "0" &&
    mappedExpanded[3] === "0" &&
    mappedExpanded[4] === "0" &&
    mappedExpanded[5] === "ffff"
  ) {
    const v4 = extractEmbeddedV4(mappedExpanded, 6);
    return v4 !== undefined && isPublicIpv4(v4, allowLoopback);
  }
  const head = lower.split(":")[0] ?? "";
  const high = Number.parseInt(head, 16);
  if (Number.isNaN(high)) {
    return false;
  }
  if ((high & 0xffc0) === 0xfe80) {
    return false; // fe80::/10 link-local
  }
  if ((high & 0xfe00) === 0xfc00) {
    return false; // fc00::/7 unique-local
  }
  if ((high & 0xff00) === 0xff00) {
    return false; // ff00::/8 multicast
  }
  if (high === 0x2002) {
    // 2002::/16 6to4 — encodes a v4 in hextets [1..2]. Block embedded non-public v4.
    const expanded = expandIpv6(lower);
    if (expanded) {
      const v4 = extractEmbeddedV4(expanded, 1);
      if (v4 && !isPublicIpv4(v4, allowLoopback)) {
        return false;
      }
    } else {
      return false; // fail closed
    }
  }
  if (high === 0x0064) {
    // 64:ff9b::/96 NAT64 well-known prefix (RFC 6052) — last 32 bits are a v4 address.
    const expanded = expandIpv6(lower);
    if (
      expanded &&
      expanded[0] === "64" &&
      expanded[1] === "ff9b" &&
      expanded[2] === "0" &&
      expanded[3] === "0" &&
      expanded[4] === "0" &&
      expanded[5] === "0"
    ) {
      const v4 = extractEmbeddedV4(expanded, 6);
      if (v4 && !isPublicIpv4(v4, allowLoopback)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Expand an IPv6 address to exactly 8 hextets so a classifier can index by position.
 * Returns lower-cased hextet strings (no leading zeros), or `undefined` if malformed.
 */
function expandIpv6(addr: string): string[] | undefined {
  let s = addr;
  const dot = s.lastIndexOf(".");
  if (dot !== -1) {
    const colon = s.lastIndexOf(":", dot);
    if (colon === -1) {
      return undefined;
    }
    const v4 = s.slice(colon + 1);
    if (isIP(v4) !== 4) {
      return undefined;
    }
    const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10));
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      return undefined;
    }
    s = `${s.slice(0, colon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const doubleColon = s.indexOf("::");
  let hextets: string[];
  if (doubleColon === -1) {
    hextets = s.split(":");
  } else {
    const head = s.slice(0, doubleColon) === "" ? [] : s.slice(0, doubleColon).split(":");
    const tail = s.slice(doubleColon + 2) === "" ? [] : s.slice(doubleColon + 2).split(":");
    const fill = 8 - head.length - tail.length;
    if (fill < 0) {
      return undefined;
    }
    hextets = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (hextets.length !== 8) {
    return undefined;
  }
  return hextets.map((h) => {
    const n = Number.parseInt(h, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) {
      return "BAD";
    }
    return n.toString(16);
  });
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

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
