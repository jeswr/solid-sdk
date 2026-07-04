// AUTHORED-BY Claude Sonnet — see prod-solid-server docs/MODEL-PROVENANCE.md
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
 *   2. **Two fetch strategies, selected by whether a `fetch` is injected:**
 *      - No `opts.fetch` (the production default): use the Node DNS-pinned entry
 *        (`@jeswr/guarded-fetch/node`) — real `dns.lookup`, every record validated,
 *        the validated IP PINNED to the connecting socket (closes the lookup→connect
 *        TOCTOU rebinding window).
 *      - `opts.fetch` supplied (a test stub, or a caller-supplied fetch we cannot
 *        assume pins DNS): layer the browser-safe guard (`createGuardedFetch`) over
 *        it, FORCED into the DNS-less syntactic branch (`dnsLookup: null`,
 *        `allowUnresolvedHosts: true`). This exactly reproduces this package's
 *        original posture for an injected fetch — no live DNS resolution, only
 *        scheme / userinfo / literal-IP / hostname-denylist checks — so unit tests
 *        keep stubbing the network with no live DNS or network calls.
 *   3. **An extended hostname denylist.** The original bespoke guard additionally
 *      blocked bare/suffix `intranet` / `lan` / `home.arpa` / `in-addr.arpa` /
 *      `ip6.arpa` (RFC 6761/8375 reserved special-use names beyond guarded-fetch's
 *      cloud-focused default list). We pass those as extra `hostnameDenylist`
 *      entries on TOP of `DEFAULT_HOSTNAME_DENYLIST` so no protection is dropped.
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
 *
 * `enforcePortGate` is left OFF (guarded-fetch defaults it on: only port 443 in
 * production) because the original guard never restricted ports and a self-hosted
 * Matrix homeserver / Discourse instance can legitimately run on a non-standard port.
 */
import { createGuardedFetch, DEFAULT_HOSTNAME_DENYLIST, GuardError, assertSafeUrl as guardedAssertSafeUrl, SsrfError, } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
export class SafeFetchError extends Error {
    code;
    status;
    constructor(code, message, status, options) {
        super(message, options);
        this.name = "SafeFetchError";
        this.code = code;
        if (status !== undefined) {
            this.status = status;
        }
    }
}
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Reserved special-use names (RFC 6761/8375) this package's original bespoke guard
 * blocked that are NOT in guarded-fetch's cloud-focused `DEFAULT_HOSTNAME_DENYLIST` —
 * added on top so no protection regresses. Dot-prefixed (suffix form) so each also
 * matches the bare label (`isDeniedHostname` treats a leading-dot entry as matching
 * both `host === entry.slice(1)` and a `.entry` suffix).
 */
const EXTRA_HOSTNAME_DENYLIST = [".intranet", ".lan", ".home.arpa", ".in-addr.arpa", ".ip6.arpa"];
const HOSTNAME_DENYLIST = Object.freeze([
    ...DEFAULT_HOSTNAME_DENYLIST,
    ...EXTRA_HOSTNAME_DENYLIST,
]);
/** Shared policy knobs for BOTH the Node-pinned and the injected-fetch guard paths. */
const SHARED_GUARD_OPTIONS = {
    hostnameDenylist: HOSTNAME_DENYLIST,
    enforcePortGate: false,
    maxRedirects: 0,
};
/**
 * The forced DNS-less posture for an INJECTED fetch (tests / a caller-supplied
 * fetch we cannot assume pins DNS): no live DNS resolution, matching this
 * package's original never-resolves posture exactly.
 */
const INJECTED_FETCH_GUARD_OPTIONS = {
    ...SHARED_GUARD_OPTIONS,
    dnsLookup: null,
    allowUnresolvedHosts: true,
};
/** Map a guarded-fetch `SsrfError` / `GuardError` onto this package's `SafeFetchError` taxonomy. */
function mapGuardError(err) {
    if (err instanceof SafeFetchError) {
        return err;
    }
    if (err instanceof GuardError) {
        return new SafeFetchError("guard", err.message, undefined, { cause: err });
    }
    if (err instanceof SsrfError) {
        const msg = err.message;
        if (/must be https/i.test(msg)) {
            return new SafeFetchError("scheme", msg, undefined, { cause: err });
        }
        if (/userinfo|credentials/i.test(msg)) {
            return new SafeFetchError("credentials", msg, undefined, { cause: err });
        }
        if (/timed out/i.test(msg)) {
            return new SafeFetchError("timeout", msg, undefined, { cause: err });
        }
        if (/exceeds cap/i.test(msg)) {
            return new SafeFetchError("too-large", msg, undefined, { cause: err });
        }
        if (/redirect/i.test(msg)) {
            return new SafeFetchError("redirect", msg, undefined, { cause: err });
        }
        if (/fetch failed for/i.test(msg)) {
            return new SafeFetchError("network", msg, undefined, { cause: err });
        }
        // Every remaining SsrfError is a host/URL-shape policy refusal (private/
        // reserved literal IP, denylisted/local/internal hostname, rebinding,
        // malformed URL, DNS-less fail-closed, …).
        return new SafeFetchError("blocked-host", msg, undefined, { cause: err });
    }
    // A body-read-time abort (the guard's own AbortController fires mid-stream,
    // e.g. a slow body dribbling past `timeoutMs`) surfaces as a raw AbortError —
    // guarded-fetch's body-cap loop does not itself wrap a read-time abort into an
    // SsrfError. Map it to "timeout" (same as the pre-request timeout case above).
    if (err instanceof Error && err.name === "AbortError") {
        return new SafeFetchError("timeout", err.message, undefined, { cause: err });
    }
    return new SafeFetchError("network", `network error: ${err instanceof Error ? err.message : String(err)}`, undefined, { cause: err });
}
/**
 * Validate a target URL for SSRF safety. Throws {@link SafeFetchError} on any
 * violation. Exported for reuse by callers that want to vet a user-supplied base
 * URL up front (e.g. at config time). ASYNC — see the module doc for why.
 */
export async function assertSafeUrl(rawUrl) {
    try {
        await guardedAssertSafeUrl(rawUrl, INJECTED_FETCH_GUARD_OPTIONS);
    }
    catch (err) {
        throw mapGuardError(err);
    }
    try {
        return new URL(rawUrl);
    }
    catch {
        throw new SafeFetchError("blocked-host", `invalid URL: ${rawUrl}`);
    }
}
/** Build the guarded fetch for one `safeFetch` call, per the strategy in the module doc. */
function buildGuardedFetch(opts) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    if (opts.fetch) {
        return createGuardedFetch({
            ...INJECTED_FETCH_GUARD_OPTIONS,
            fetch: opts.fetch,
            timeoutMs,
            maxBytes,
        });
    }
    return createNodeGuardedFetch({
        ...SHARED_GUARD_OPTIONS,
        timeoutMs,
        maxBytes,
    });
}
/**
 * Perform an SSRF-guarded GET (or other method) and return the response text.
 * Throws {@link SafeFetchError} on any guard violation, non-2xx, a redirect,
 * timeout, or an oversize body.
 */
export async function safeFetch(rawUrl, init, opts = {}) {
    const guarded = buildGuardedFetch(opts);
    let res;
    try {
        res = await guarded(rawUrl, {
            method: init.method ?? "GET",
            headers: init.headers,
            body: init.body,
        });
    }
    catch (err) {
        throw mapGuardError(err);
    }
    if (!res.ok) {
        throw new SafeFetchError("http", `HTTP ${res.status} ${res.statusText}`, res.status);
    }
    let text;
    try {
        text = await res.text();
    }
    catch (err) {
        throw new SafeFetchError("network", `error reading body: ${err instanceof Error ? err.message : String(err)}`, undefined, { cause: err });
    }
    return { status: res.status, body: text };
}
/** Parse a safe-fetched JSON body, throwing a typed error on malformed JSON. */
export async function safeFetchJson(rawUrl, init, opts = {}) {
    const { body } = await safeFetch(rawUrl, init, opts);
    try {
        return JSON.parse(body);
    }
    catch {
        throw new SafeFetchError("network", "response was not valid JSON");
    }
}
//# sourceMappingURL=safeFetch.js.map