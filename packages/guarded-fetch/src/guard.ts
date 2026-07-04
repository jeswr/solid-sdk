// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The SSRF / DNS-rebinding guard POLICY CORE — the small, reviewed custom code over the
 * mechanical IP primitive in `./addresses.ts`. Browser-safe by default: this module has NO
 * top-level `import` of any `node:` builtin (the IP-literal classifier is the pure-JS
 * `classifyIpLiteral`, and the only `node:dns/promises` use is a LAZY `await import(...)`
 * reached ONLY on the Node branch). A browser bundler resolves + tree-shakes it with no
 * polyfill shim. The full DNS-pinning closure of the rebinding window lives in the SEPARATE
 * Node-only `./node` entry, which is the ONLY place `undici` / `node:*` are imported.
 *
 * Consolidated from the four suite copies; the consolidated guard is a strict SUPERSET of
 * every defence any one of them had. On every request AND every redirect hop it:
 *   - allows only `https:` (no http:, file:, data:, gopher:, …) by default — `http:` only
 *     under the dev `allowLoopback` escape hatch, and even then loopback-only;
 *   - rejects userinfo (`https://user:pass@…`) so credentials never leak to the host;
 *   - rejects a non-default PORT in production (443 for https; +80 for http under loopback)
 *     — fetching an internal service on a non-standard port is exactly the SSRF we block;
 *   - refuses a cloud-internal HOSTNAME denylist (`metadata.google.internal`,
 *     `*.svc.cluster.local`, `*.internal`, …) BEFORE any DNS so a split-horizon resolver
 *     cannot map an internal name to a reachable endpoint;
 *   - normalises alternate IPv4 encodings (decimal/octal/hex/short-form) to dotted-decimal
 *     before classifying (belt-and-braces over `new URL()`'s own canonicalisation);
 *   - classifies the host via the active BRANCH, selected by CAPABILITY DETECTION (is
 *     `node:dns/promises` importable), NOT a caller flag:
 *       * NODE branch (DNS available): an IP literal is checked directly; a hostname is
 *         DNS-resolved and EVERY resolved A/AAAA record must be public — a DNS-rebinding
 *         mitigation (one record public, one 127.0.0.1 is refused);
 *       * DNS-LESS branch (no `node:dns`): a syntactic guard — reject `localhost`,
 *         `*.localhost`, `*.local`, and any private/loopback/link-local/metadata IP LITERAL,
 *         and otherwise ALLOW a public-looking https hostname ONLY in a positively-identified
 *         BROWSER (the inherent browser residual); any OTHER DNS-less runtime (edge / Workers
 *         / Deno) FAILS CLOSED unless the caller sets `allowUnresolvedHosts`;
 *   - does NOT auto-follow redirects: it sets `redirect:"manual"`, re-runs the full guard
 *     against each `Location` (bounded hops + loop detection), strips credential headers +
 *     the body on a cross-origin or method-changing redirect, and only follows allowed hosts;
 *   - caps the response body (declared `Content-Length` rejected up front, streamed body
 *     rejected on overflow) and bounds the whole operation with a single timeout.
 *
 * Two error types: {@link SsrfError} for an SSRF refusal (scheme/userinfo/private-target/
 * rebinding/oversize/timeout/malformed), {@link GuardError} for a non-SSRF guard refusal
 * (a disallowed port, a content-type allowlist miss when one is configured). SSRF refusals
 * are the security boundary; `GuardError` is the policy boundary. Both are caught the same
 * way (a guarded fetch never silently succeeds on a refused target).
 */
import { classifyIpLiteral, isLoopbackAddress, isPublicAddress } from "./addresses.js";
import {
  isRedirect,
  normalizeRequest,
  rewriteInitForRedirect,
  safeProtocol,
  sameOrigin,
} from "./redirect.js";

/** Raised when the guard refuses a URL / redirect / oversize body on SSRF grounds. */
export class SsrfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsrfError";
  }
}

/**
 * Raised for a NON-SSRF guard refusal: a disallowed port, or a content-type allowlist miss
 * when {@link GuardOptions.allowedContentTypes} is configured. SSRF refusals throw
 * {@link SsrfError}; this is the policy (not the security-boundary) error.
 */
export class GuardError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GuardError";
  }
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
export const DEFAULT_HOSTNAME_DENYLIST: readonly string[] = Object.freeze([
  "metadata.google.internal",
  "metadata.goog",
  ".internal",
  ".svc.cluster.local",
  ".cluster.local",
  ".vercel-internal.com",
]);

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

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * The `node:dns/promises` specifier, assembled at runtime so a browser bundler CANNOT
 * statically see the literal `"node:dns/promises"` and try to resolve it at build time
 * (which errors under `platform:"browser"` and is what forces a polyfill shim). An OPAQUE
 * specifier sidesteps the static analyser — the import runs only at runtime, only on Node
 * (gated by `hasNodeDns()`).
 */
const NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");

/**
 * Marker error thrown by {@link loadNodeDnsLookup} when the `node:dns/promises` MODULE itself
 * cannot be imported (vs a genuine DNS resolution failure). Distinguishes "this isn't really
 * a Node runtime — fall back to the DNS-less policy" from "the host did not resolve — fail".
 */
class NodeDnsUnavailableError extends Error {}

/** PROBE + load Node's `dns/promises.lookup` if running on Node, as a bound {@link DnsLookup}. */
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
 * Build a `fetch`-shaped guarded fetcher bound to the given options. The returned function
 * has the `typeof globalThis.fetch` signature so it threads straight into any consumer that
 * takes an injectable fetch (a `@jeswr/fetch-rdf` parse, an LDN POST, …). The guard validates
 * the URL + every redirect hop, caps the body, and bounds the time.
 */
export function createGuardedFetch(options: GuardOptions = {}): typeof globalThis.fetch {
  const guard = new SsrfGuard(options);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    guard.fetch(input, init)) as typeof globalThis.fetch;
}

/**
 * One-shot guarded fetch (constructs a guard per call). Prefer {@link createGuardedFetch}
 * when issuing many requests with the same policy.
 */
export function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit & GuardOptions,
): Promise<Response> {
  return new SsrfGuard(init ?? {}).fetch(input, init);
}

/**
 * Validate a target URL's host shape (scheme / userinfo / port / denylist / literal-IP) and
 * its resolved addresses against the SSRF policy, WITHOUT issuing any request. Throws
 * {@link SsrfError} / {@link GuardError} on a violation; returns normally if the URL would be
 * allowed. Exported for callers that want to vet a user-supplied base URL up front (e.g. at
 * config time) before wiring it into a guarded fetch.
 */
export async function assertSafeUrl(rawUrl: string, options: GuardOptions = {}): Promise<void> {
  await new SsrfGuard(options).assertAllowed(rawUrl);
}

/**
 * Is `hostname` denied by the cloud-internal denylist (exact match or dot-anchored suffix)?
 * `entry` starting with `.` is a suffix match (`.internal` matches `foo.internal`); otherwise
 * it is an exact match OR a `.entry` suffix match. Exported so a consumer can reuse the same
 * name-denial logic at config time.
 */
export function isDeniedHostname(hostname: string, denylist: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const raw of denylist) {
    const entry = raw.toLowerCase();
    if (entry.startsWith(".")) {
      if (host === entry.slice(1) || host.endsWith(entry)) {
        return true;
      }
    } else if (host === entry || host.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalise a URL hostname to a canonical IP literal for classification, covering alternate
 * IPv4 encodings. `new URL()` already canonicalises decimal (`2130706433`), hex
 * (`0x7f000001`), octal (`0177.0.0.1`), and short-form (`127.1`) IPv4 to dotted-decimal — we
 * re-run it defensively so the value the classifier sees is always a form `classifyIpLiteral`
 * recognises. A bracketed IPv6 literal has its brackets stripped. Returns the canonical form
 * (or the input lowercased if it is not an IP). Exported for reuse + testing.
 */
export function normalizeHostForClassification(hostname: string): string {
  const stripped = hostname.replace(/^\[|\]$/g, "");
  if (classifyIpLiteral(stripped) !== 0) {
    return stripped;
  }
  try {
    const reparsed = new URL(`http://${stripped}/`).hostname.replace(/^\[|\]$/g, "");
    return reparsed.toLowerCase();
  } catch {
    return stripped.toLowerCase();
  }
}

/** The guard implementation: URL validation, redirect re-validation, body cap, timeout. */
class SsrfGuard {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly injectedLookup: DnsLookup | undefined;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowLoopback: boolean;
  private readonly allowUnresolvedHosts: boolean;
  private readonly requireDnsPinning: boolean;
  private readonly havePinningFetch: boolean;
  private readonly isBrowser: boolean;
  private readonly usingDefaultNodeLookup: boolean;
  private readonly hostnameDenylist: readonly string[];
  private readonly allowedContentTypes: readonly string[] | undefined;
  private readonly enforcePortGate: boolean;
  private defaultLookup: Promise<DnsLookup> | undefined;

  constructor(options: GuardOptions) {
    this.havePinningFetch = options.pinningFetch !== undefined;
    this.isBrowser = isBrowserContext();
    this.fetcher = options.pinningFetch ?? options.fetch ?? globalThis.fetch;
    this.injectedLookup = options.dnsLookup === null ? undefined : (options.dnsLookup ?? undefined);
    this.usingDefaultNodeLookup = options.dnsLookup === undefined && hasNodeDns();
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.allowLoopback = options.allowLoopback ?? false;
    this.allowUnresolvedHosts = options.allowUnresolvedHosts ?? false;
    this.requireDnsPinning = options.requireDnsPinning ?? false;
    this.hostnameDenylist = options.hostnameDenylist ?? DEFAULT_HOSTNAME_DENYLIST;
    this.allowedContentTypes = options.allowedContentTypes
      ? options.allowedContentTypes.map((t) => t.toLowerCase())
      : undefined;
    this.enforcePortGate = options.enforcePortGate ?? true;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
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
    let currentInit: RequestInit = { ...(init ?? {}) };
    let prevWasHttps = false;
    const seen = new Set<string>();
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new SsrfError(`Redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      await this.assertAllowed(currentUrl, prevWasHttps);

      let res: Response;
      try {
        res = await this.fetcher(currentUrl, {
          ...currentInit,
          // We re-validate every hop ourselves, so the underlying fetch must NOT auto-follow.
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new SsrfError(`Fetch timed out for ${currentUrl} (${this.timeoutMs}ms).`, {
            cause,
          });
        }
        throw new SsrfError(`Fetch failed for ${currentUrl}: ${message(cause)}`, { cause });
      }

      if (!isRedirect(res.status)) {
        return await this.finalize(res, currentUrl, controller);
      }

      const location = res.headers.get("location");
      if (!location) {
        // A 3xx with no Location is not followable — return it as-is (finalised).
        return await this.finalize(res, currentUrl, controller);
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new SsrfError(`Redirect to a malformed Location (${location}) from ${currentUrl}.`);
      }
      currentInit = rewriteInitForRedirect(
        currentInit,
        res.status,
        !sameOrigin(currentUrl, nextUrl),
      );
      try {
        await res.body?.cancel();
      } catch {
        // Body already consumed/closed — fine.
      }
      prevWasHttps = safeProtocol(currentUrl) === "https:";
      currentUrl = nextUrl;
    }
    throw new SsrfError(`Too many redirects (> ${this.maxRedirects}) starting from ${startUrl}.`);
  }

  /** Enforce the content-type allowlist (when configured) then cap the body. */
  private async finalize(
    res: Response,
    url: string,
    controller: AbortController,
  ): Promise<Response> {
    if (this.allowedContentTypes && isBodyBearingStatus(res.status)) {
      const contentType = (res.headers.get("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !this.allowedContentTypes.includes(contentType)) {
        try {
          await res.body?.cancel();
        } catch {
          // already consumed — fine
        }
        throw new GuardError(
          `Disallowed content-type "${contentType || "(none)"}" for ${url}; expected one of ${this.allowedContentTypes.join(", ")}.`,
        );
      }
    }
    return await this.capBody(res, url, controller);
  }

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
    const body = isNullBodyStatus(res.status) ? null : bytes.buffer;
    const out = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    const finalUrl = res.url || url;
    try {
      Object.defineProperty(out, "url", { value: finalUrl, configurable: true });
    } catch {
      // A runtime that forbids redefining `url` — harmless; base IRI falls back to the request URL.
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
   * Refuse `rawUrl` unless it is an https (or, under `allowLoopback`, http-to-loopback) URL
   * with no userinfo, an allowed port, a non-denied host, and a host allowed by the active
   * branch. `prevWasHttps` rejects a scheme-downgrade redirect (https → http).
   */
  async assertAllowed(rawUrl: string, prevWasHttps = false): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SsrfError(`URL is malformed: ${rawUrl}.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SsrfError(
        `URL must be https: (got ${url.protocol} for ${rawUrl}). Only http(s) is fetched.`,
      );
    }
    if (url.protocol === "http:" && !this.allowLoopback) {
      throw new SsrfError(
        `URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev).`,
      );
    }
    if (prevWasHttps && url.protocol === "http:") {
      throw new SsrfError(`Refusing redirect scheme downgrade (https → http): ${url.host}.`);
    }
    if (url.username || url.password) {
      throw new SsrfError(`URL must not carry userinfo (credentials): ${url.host}.`);
    }
    this.assertPortAllowed(url);

    // Denylist check on the RAW hostname BEFORE DNS (split-horizon defence).
    const rawHostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isDeniedHostname(rawHostname, this.hostnameDenylist)) {
      throw new SsrfError(`Host is on the cloud-internal denylist: ${rawHostname}.`);
    }

    const hostname = normalizeHostForClassification(url.hostname);
    // After alternate-encoding normalisation a denied name could appear (defence in depth).
    if (isDeniedHostname(hostname, this.hostnameDenylist)) {
      throw new SsrfError(`Host is on the cloud-internal denylist: ${hostname}.`);
    }

    const literalKind = classifyIpLiteral(hostname);

    // IP-LITERAL targets: classified directly in BOTH branches (no resolution, no rebinding
    // window). This absolute literal-IP block holds regardless of DNS availability.
    if (literalKind !== 0) {
      this.assertResolvedAddressesAllowed(url, hostname, [
        { address: hostname, family: literalKind },
      ]);
      return;
    }

    // HOSTNAME targets (non-literal). Determine the active resolver, separating DNS
    // CAPABILITY (is a resolver available) from a host QUERY.
    let lookup: DnsLookup;
    if (this.injectedLookup) {
      lookup = this.injectedLookup;
    } else if (this.usingDefaultNodeLookup) {
      try {
        lookup = await this.resolveDefaultLookup();
      } catch (cause) {
        if (cause instanceof NodeDnsUnavailableError) {
          // Not really Node (a process shim with no node:dns): route to the DNS-less policy.
          this.assertDnslessHostnameAllowed(url.protocol, hostname);
          return;
        }
        throw new SsrfError(`node:dns probe failed for ${hostname}: ${message(cause)}`, { cause });
      }
    } else {
      this.assertDnslessHostnameAllowed(url.protocol, hostname);
      return;
    }

    // --- NODE branch: a resolver IS available. The DNS-rebinding fail-closed posture fires
    // BEFORE any host query (no DNS leak for a request the strict posture will refuse): a
    // HOSTNAME (validated but, on plain fetch, not socket-pinned) is refused under
    // `requireDnsPinning` unless a branded `pinningFetch` was supplied.
    if (this.requireDnsPinning && !this.havePinningFetch) {
      throw new SsrfError(
        `URL refused — requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`,
      );
    }
    let resolved: ResolvedAddress[];
    try {
      resolved = await lookup(hostname);
    } catch (cause) {
      throw new SsrfError(`Host did not resolve: ${hostname}: ${message(cause)}`, { cause });
    }
    if (resolved.length === 0) {
      throw new SsrfError(`Host resolved to no addresses: ${hostname}.`);
    }
    this.assertResolvedAddressesAllowed(url, hostname, resolved);
  }

  /** Port gate: in production an explicit port must be 443 (https). Inert under allowLoopback. */
  private assertPortAllowed(url: URL): void {
    if (!this.enforcePortGate || this.allowLoopback) {
      return;
    }
    if (url.port === "") {
      return; // scheme default
    }
    const port = Number(url.port);
    if (!(url.protocol === "https:" && port === 443)) {
      throw new GuardError(
        `URL port not allowed (${url.port}) for ${url.host}; only 443 (https) is permitted in production.`,
      );
    }
  }

  private resolveDefaultLookup(): Promise<DnsLookup> {
    if (this.defaultLookup === undefined) {
      this.defaultLookup = loadNodeDnsLookup();
    }
    return this.defaultLookup;
  }

  /** DNS-LESS branch hostname guard (no resolver). The IP-literal cases are handled by the caller. */
  private assertDnslessHostnameAllowed(protocol: string, hostname: string): void {
    const lower = hostname.toLowerCase().replace(/\.$/, "");

    // STRICT-PINNING GATE FIRST: requireDnsPinning asks for a socket pinned to a validated
    // address, impossible without a resolver. Fails closed for EVERY DNS-less hostname target
    // — incl. a loopback name — unless the caller accepted the residual via allowUnresolvedHosts.
    // Runs BEFORE any allow path so the allowLoopback dev hatch cannot bypass the strict posture.
    if (this.requireDnsPinning && !this.allowUnresolvedHosts) {
      throw new SsrfError(
        `URL refused — requireDnsPinning is set but no DNS resolver is available in this runtime to pin "${hostname}". A browser cannot pin a socket; set allowUnresolvedHosts to accept the residual, or run on Node with a pinningFetch.`,
      );
    }

    // `.local` / `local` is the mDNS LAN namespace (RFC 6762) — a LINK-LOCAL/private target,
    // NOT loopback. Refused outright and NOT re-permitted by allowLoopback.
    if (lower === "local" || lower.endsWith(".local")) {
      throw new SsrfError(
        `URL refused — "${hostname}" is an mDNS/link-local (.local) name denoting a private LAN target. Use a public https host.`,
      );
    }

    // `localhost` / `*.localhost` is the loopback namespace (RFC 6761). Permit ONLY under
    // the dev allowLoopback escape hatch; refused otherwise.
    if (lower === "localhost" || lower.endsWith(".localhost")) {
      if (this.allowLoopback) {
        return;
      }
      throw new SsrfError(
        `URL refused — "${hostname}" is a loopback name (localhost/*.localhost), which denotes a private target. Use a public https host.`,
      );
    }

    // http: reaches here only under allowLoopback. It is dev-loopback-only — a public-looking
    // hostname over http: is NEVER allowed (a loopback name was already handled above).
    if (protocol === "http:") {
      throw new SsrfError(
        `URL refused — http: is allowed only for a loopback name (localhost/*.localhost) in this runtime; "${hostname}" is not loopback. Use https:.`,
      );
    }

    // A public-looking https hostname with no resolver. Allow ONLY in a positively-identified
    // browser (the inherent residual — a page can fetch any origin anyway) OR when the caller
    // set allowUnresolvedHosts. In any OTHER DNS-less runtime we FAIL CLOSED.
    if (this.isBrowser || this.allowUnresolvedHosts) {
      return;
    }
    throw new SsrfError(
      `URL refused — no DNS resolver is available in this runtime to classify "${hostname}", and this is not a positively-identified browser context. ` +
        "Set allowUnresolvedHosts to accept that hostname targets cannot be classified here (you trust the URL source), or run on Node where the full DNS-resolve guard applies.",
    );
  }

  /**
   * Enforce the address-level policy on a set of resolved (or literal) addresses: under
   * `allowLoopback` an http: URL must resolve to loopback ONLY, and EVERY address must be
   * public (or loopback when allowLoopback) — one private record fails the whole request
   * (rebinding mitigation).
   */
  private assertResolvedAddressesAllowed(
    url: URL,
    hostname: string,
    resolved: ResolvedAddress[],
  ): void {
    if (url.protocol === "http:" && this.allowLoopback) {
      for (const r of resolved) {
        if (!isLoopbackAddress(r.address)) {
          throw new SsrfError(
            `URL refused — http: is allowed only when every resolved address is loopback (got ${r.address} for ${hostname}). Use https:.`,
          );
        }
      }
    }
    for (const r of resolved) {
      if (!isPublicAddress(r.address, this.allowLoopback)) {
        throw new SsrfError(
          `URL refused — ${hostname} resolves to a non-public address (${r.address}).`,
        );
      }
    }
  }
}

// --- small helpers ----------------------------------------------------------

/**
 * Whether a status code is a "null body status" per the Fetch spec — `new Response` MUST be
 * given a `null` body for these (even an empty buffer throws a `TypeError`).
 */
function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

/** Whether a status carries a body subject to the content-type allowlist (a 2xx, not 204/205). */
function isBodyBearingStatus(status: number): boolean {
  return status >= 200 && status < 300 && status !== 204 && status !== 205;
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
 * Positively identify a REAL BROWSER context. Consulted only on the DNS-less path to decide
 * whether a public-looking hostname is allowed by default. The load-bearing signal is
 * `window === globalThis` (in a real browser the global object IS the window; a server DOM
 * shim sets a SEPARATE `window`, so `window !== globalThis` there; edge/workers have no
 * `window`). `document` is additionally required as belt-and-braces. Conservative by design:
 * a false negative only costs an explicit `allowUnresolvedHosts`; a false positive would
 * re-open the SSRF window — so we err toward fail-closed.
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
