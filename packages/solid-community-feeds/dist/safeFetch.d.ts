/**
 * SSRF-safe fetch wrapper.
 *
 * The Matrix homeserver and Discourse forum base URLs are USER-CONFIGURED, so an
 * attacker (or a careless user) could point them at an internal target
 * (`http://169.254.169.254/`, `http://localhost:…`, an RFC1918 host).
 *
 * This module is now a thin adapter over `@jeswr/guarded-fetch` — the suite-wide,
 * exhaustively-tested SSRF guard consolidated from this package's original bespoke
 * copy + `federation-client` + `solid-agent-notify` + the prod-solid-server
 * `@pss/guarded-fetch` reference (P1.6 / shared-logic-review Action 5). The URL/host
 * SSRF policy (https-only, no-userinfo, private/loopback/link-local/metadata/CGNAT/
 * reserved-range blocking incl. IPv4-mapped/6to4/NAT64 IPv6 + alternate IPv4 encodings,
 * a cloud-internal hostname denylist, per-hop redirect re-validation, DNS-rebinding
 * defence, a response-size cap, and a request timeout) all now live in that shared,
 * audited guard — see its README/tests for the full block-list.
 *
 * What THIS module still owns:
 *   1. **Redirect-refusal.** This package's prior posture was "never chase a 30x —
 *      surface it as an error", which is STRICTER than guarded-fetch's default (which
 *      re-validates + follows a *safe* redirect). We force that stricter posture with
 *      `maxRedirects: 0` so behaviour is preserved exactly: a redirect to any host,
 *      safe or not, surfaces as an error.
 *   2. **Two `safeFetch` strategies, selected by whether a `fetch` is injected:**
 *      - No `opts.fetch` (the production default): use the Node DNS-pinned entry
 *        (`@jeswr/guarded-fetch/node`) — real `dns.lookup`, every record validated,
 *        the validated IP PINNED to the connecting socket (closes the lookup→connect
 *        TOCTOU rebinding window).
 *      - `opts.fetch` supplied (a test stub, or a caller-supplied fetch we cannot
 *        assume pins DNS): layer the browser-safe guard (`createGuardedFetch`) over
 *        it, FORCED into the DNS-less syntactic branch (`dnsLookup: null`,
 *        `allowUnresolvedHosts: true`). This reproduces this package's original
 *        posture for an injected fetch — no live DNS resolution, only
 *        scheme / userinfo / literal-IP / hostname-denylist checks — so unit tests
 *        keep stubbing the network with no live DNS or network calls.
 *
 *      NOTE — this DNS-less branch is used ONLY for the injected-fetch `safeFetch`
 *      code path (a test/caller-supplied fetch that does its OWN resolution). The
 *      EXPORTED `assertSafeUrl` validator does REAL DNS-resolved validation (see
 *      below) — it must NEVER use the DNS-less branch, or a hostname that resolves
 *      to a private/internal IP would silently pass the validator (an SSRF hole).
 *   3. **An extended hostname denylist.** The original bespoke guard additionally
 *      blocked bare/suffix `intranet` / `lan` / `home.arpa` / `in-addr.arpa` /
 *      `ip6.arpa` / `localhost` / `local` (RFC 6761/8375 reserved special-use
 *      names beyond guarded-fetch's cloud-focused default list). We pass those as
 *      extra `hostnameDenylist` entries on TOP of `DEFAULT_HOSTNAME_DENYLIST` so no
 *      protection is dropped. Blocking `localhost`/`*.localhost`/`local`/`*.local`
 *      via `hostnameDenylist` (rather than relying solely on guarded-fetch's own
 *      DNS-less special-name checks) matters because `hostnameDenylist` is enforced
 *      UNCONDITIONALLY, before guarded-fetch branches into DNS-resolving vs
 *      DNS-less validation (see point 6) — so these special-use names are refused
 *      pre-resolution no matter which branch `assertSafeUrl` takes, even if a
 *      resolver were ever to return a public address for one of them.
 *   4. **HTTP-status mapping.** guarded-fetch has no opinion on non-2xx statuses
 *      (only redirects/SSRF/size/time are its job) — a non-2xx response is mapped to
 *      a typed `SafeFetchError("http", …)` here, same as before.
 *   5. **The public `SafeFetchError` taxonomy**, for source compatibility with
 *      `discourse.ts` / `matrix.ts` / this package's tests: guarded-fetch's
 *      `SsrfError` / `GuardError` are caught and re-mapped onto this package's
 *      existing `code` enum (scheme / credentials / blocked-host / redirect /
 *      timeout / too-large / http / network) via message-shape matching. Note
 *      `assertSafeUrl` is now ASYNC (guarded-fetch's own `assertSafeUrl` is async,
 *      since real SSRF validation can require a DNS lookup) — a deliberate,
 *      documented break from the previous synchronous signature.
 *   6. **The exported `assertSafeUrl` validator does REAL DNS-resolved validation.**
 *      It runs guarded-fetch's own `assertSafeUrl` on the DNS-RESOLVING Node branch
 *      (the default `node:dns/promises` resolver, or an injected one for tests) — so
 *      a hostname that resolves to a private/loopback/link-local/metadata IP is
 *      REJECTED, not just literal-IP / denylisted-name targets. This is the SSRF
 *      guarantee a config-time validator must give; the DNS-less branch above is
 *      strictly for the injected-fetch code path and is never reachable from here.
 *      Special-use hostnames (`localhost`, `*.localhost`, `local`, `*.local`) are
 *      refused by `hostnameDenylist` BEFORE guarded-fetch ever decides which branch
 *      to take — so they are rejected unconditionally, regardless of what any
 *      injected/default resolver would return for them (see point 3).
 *
 * `enforcePortGate` is left OFF (guarded-fetch defaults it on: only port 443 in
 * production) because the original guard never restricted ports and a self-hosted
 * Matrix homeserver / Discourse instance can legitimately run on a non-standard port.
 */
import { type DnsLookup } from "@jeswr/guarded-fetch";
/** A chunk yielded by a streamed response body — bytes or a decoded string. */
export type BodyChunk = Uint8Array | string;
/**
 * The response shape `safeFetch` consumes. `body` is OPTIONAL: when present (the
 * real WHATWG `fetch` returns a `ReadableStream` here), `safeFetch` reads it via
 * the shared guarded-fetch body-cap logic. When absent, the guard falls back to an
 * empty body (matching standard `Response` semantics for a bodyless response).
 */
export interface SafeFetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
    body?: ReadableStream<Uint8Array> | null;
}
/** A minimal structural fetch type — `typeof globalThis.fetch`-compatible. */
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "manual" | "error";
    signal?: AbortSignal;
}) => Promise<SafeFetchResponse>;
export interface SafeFetchOptions {
    /** Injected fetch (auth-fetch seam / test stub). Defaults to the Node DNS-pinned guard. */
    fetch?: FetchLike;
    /** Request timeout in milliseconds. Default 15000. */
    timeoutMs?: number;
    /** Max response body size in bytes. Default 5 MiB. */
    maxBytes?: number;
}
export declare class SafeFetchError extends Error {
    readonly code: "scheme" | "credentials" | "blocked-host" | "redirect" | "timeout" | "too-large" | "http" | "network" | "guard";
    readonly status?: number;
    constructor(code: SafeFetchError["code"], message: string, status?: number, options?: {
        cause?: unknown;
    });
}
/**
 * Validate a target URL for SSRF safety, doing REAL DNS resolution: a hostname
 * that resolves to a private/loopback/link-local/metadata IP is REJECTED, not
 * just literal-IP / denylisted-name targets. Throws {@link SafeFetchError} on any
 * violation. Exported for reuse by callers that want to vet a user-supplied base
 * URL up front (e.g. at config time). ASYNC — see the module doc for why.
 *
 * `opts.dnsLookup` injects a resolver (tests only) — production always uses the
 * default `node:dns/promises` resolver via guarded-fetch's Node branch.
 */
export declare function assertSafeUrl(rawUrl: string, opts?: {
    dnsLookup?: DnsLookup;
}): Promise<URL>;
/**
 * Perform an SSRF-guarded GET (or other method) and return the response text.
 * Throws {@link SafeFetchError} on any guard violation, non-2xx, a redirect,
 * timeout, or an oversize body.
 */
export declare function safeFetch(rawUrl: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}, opts?: SafeFetchOptions): Promise<{
    status: number;
    body: string;
}>;
/** Parse a safe-fetched JSON body, throwing a typed error on malformed JSON. */
export declare function safeFetchJson<T>(rawUrl: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}, opts?: SafeFetchOptions): Promise<T>;
//# sourceMappingURL=safeFetch.d.ts.map