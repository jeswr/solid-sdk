// AUTHORED-BY Claude Fable 5
/**
 * refuse-redirects — the first-class, dependency-free REDIRECT-REFUSAL wrapper for a
 * CREDENTIALED / trust-bearing fetch. The suite's ONE reviewed home for the recurring roborev
 * finding "a credentialed/trust-bearing fetch must refuse redirects (redirect:manual)".
 *
 * THE PROBLEM it closes. A request that carries a credential (an `Authorization` / `DPoP`
 * header, a cookie) and AUTO-FOLLOWS a redirect can (a) leak that credential to a target the
 * SERVER chose in its `Location`, or (b) be silently re-pointed at a different resource than
 * the caller asked for. Native `fetch` follows 3xx by default. For a trust-bearing request the
 * safe posture is therefore to NOT follow ANY redirect: issue with `redirect:"manual"` and
 * REFUSE (throw) a redirect response, so the credential only ever reaches the ONE intended host
 * and a poisoned resource can never bounce the authenticated call elsewhere.
 *
 * HOW it differs from {@link ../guard.js createGuardedFetch} / {@link ../podScope.js
 * createPodScopedFetch}. Those FOLLOW redirects with re-validation (re-run the SSRF / pod-scope
 * check on each hop, strip cross-origin credentials, bound the hop count) — the right posture
 * for an UNCREDENTIALED public-data fetch (a `@jeswr/fetch-rdf` parse of a public profile that
 * legitimately 30x-redirects). `refuseRedirects` is the COMPLEMENT: the right posture for a
 * CREDENTIALED fetch, where any redirect is refused outright. The two COMPOSE — see below.
 *
 * OPT-OUT is STRUCTURAL, by construction (the "explicit opt-out spelled out in code" rule):
 * to allow redirects you use a follow-capable fetch INSTEAD of wrapping. There is no runtime
 * flag to disable refusal, and a stray `redirect:"follow"` in a request's `init` is OVERRIDDEN
 * to `"manual"` — so a credentialed call can never silently re-enable following through a
 * request option. The choice to follow is a visible, different function at the call site.
 *
 * CROSS-ENVIRONMENT redirect detection (both entries share this — browser + node):
 *   - Node/undici `fetch` with `redirect:"manual"` returns the REAL 3xx response (readable
 *     status + `Location`) → detected by {@link isRedirect}(status).
 *   - Browser `fetch` with `redirect:"manual"` returns an OPAQUE-REDIRECT filtered response
 *     (`type === "opaqueredirect"`, `status === 0`, empty headers, `Location` unreadable) →
 *     detected by `res.type`.
 * A `304 Not Modified` / `300 Multiple Choices` is NOT a "moved" redirect (not one of the
 * 301/302/303/307/308 set) and passes through untouched — a conditional / content-negotiation
 * response is never refused.
 *
 * COMPOSITION. `refuseRedirects` wraps ANY fetch:
 *   - `refuseRedirects(authedFetch)` — a DPoP/Bearer fetch that refuses any redirect (the common
 *     case; throws {@link RedirectRefusedError}).
 *   - To ALSO SSRF-validate a credentialed target host, either validate up front with
 *     {@link ../guard.js assertSafeUrl} then issue via `refuseRedirects(authedFetch)`, OR nest
 *     the refusing fetch UNDER the guard: `createGuardedFetch({ fetch: refuseRedirects(authed) })`
 *     — the guard host-validates and the refusing underlying fetch rejects any redirect before
 *     the guard would follow it. (Because the guard wraps a THROWING underlying fetch, that
 *     refusal surfaces as an `SsrfError` whose `cause` is the `RedirectRefusedError` — the
 *     redirect is still refused, only the outer error class differs.)
 *
 * **Pure core, no platform:** only the WHATWG `fetch` / `Response` globals — browser-safe, no
 * `node:*` import. Exported from the default `.` entry and re-exported from `./node`.
 */
import { isRedirect, redactUserinfo } from "./redirect.js";

/**
 * Raised when {@link refuseRedirects} refuses a redirect response instead of following it.
 * Distinct from {@link ../guard.js SsrfError} (host safety) and {@link ../podScope.js
 * PodScopeError} (capability scope): this is the credential-safety refusal — the request itself
 * was allowed, but its response was a redirect the wrapper will not follow.
 */
export class RedirectRefusedError extends Error {
  /** The request URL that returned the refused redirect (userinfo redacted). */
  readonly url: string;
  /**
   * The redirect status. `0` for a browser opaque-redirect, whose real 3xx status is masked by
   * the Fetch spec's response filtering (the wrapper still refuses it).
   */
  readonly status: number;
  /**
   * The `Location` header (userinfo redacted), when readable — `undefined` for a browser
   * opaque-redirect (whose headers are stripped) or a redirect with no `Location`.
   */
  readonly location: string | undefined;
  constructor(
    message: string,
    detail: { url: string; status: number; location?: string; cause?: unknown },
  ) {
    super(message, detail.cause !== undefined ? { cause: detail.cause } : undefined);
    this.name = "RedirectRefusedError";
    this.url = detail.url;
    this.status = detail.status;
    this.location = detail.location;
  }
}

/**
 * Wrap `fetch` so it REFUSES (throws {@link RedirectRefusedError}) instead of following any
 * redirect. The returned function forces `redirect:"manual"` on every request (overriding a
 * caller-supplied `redirect` mode), and throws when the response is a redirect (a 3xx moved
 * status on Node, or a browser opaque-redirect). A non-redirect response is returned unchanged,
 * with its body untouched.
 *
 * Pass an AUTHENTICATED fetch as the argument to guard a credentialed call
 * (`refuseRedirects(authedFetch)`); use it for any trust-bearing request where a redirect is
 * not an expected part of the protocol. To ALSO SSRF-validate the target, compose with
 * {@link ../guard.js createGuardedFetch}: `createGuardedFetch({ fetch: refuseRedirects(authed) })`.
 *
 * @param fetch The underlying fetch to issue the (manual-redirect) request. Defaults to
 *   `globalThis.fetch`.
 */
export function refuseRedirects(
  fetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Pass the ORIGINAL input THROUGH untouched so a `Request`'s FULL semantics (mode, cache,
    // integrity, referrer, referrerPolicy, keepalive, credentials, body, signal, …) are
    // preserved — the underlying fetch's Request constructor applies the `init` override OVER
    // the input's own fields, so we FORCE `redirect:"manual"` (the fetch cannot auto-follow,
    // even if the caller or the Request itself asked for "follow") WITHOUT dropping any other
    // caller-set fetch policy. We deliberately do NOT reconstruct the init from the Request:
    // that path drops policy-bearing fields (`mode:"same-origin"`, `integrity`, …), which for a
    // credential-safety wrapper would silently weaken the caller's request policy. Only the URL
    // for the refusal message is derived separately (see {@link requestUrlOf}).
    const res = await fetch(input, { ...(init ?? {}), redirect: "manual" });

    const opaqueRedirect = res.type === "opaqueredirect";
    if (opaqueRedirect || isRedirect(res.status)) {
      const location = opaqueRedirect ? undefined : (res.headers.get("location") ?? undefined);
      // Drain the refused redirect's body so a streamed body is not left dangling.
      try {
        await res.body?.cancel();
      } catch {
        // Body already consumed / closed — fine.
      }
      const safeUrl = redactUserinfo(requestUrlOf(input));
      const safeLocation = location !== undefined ? redactUserinfo(location) : undefined;
      const where = opaqueRedirect ? "opaque redirect" : `status ${res.status}`;
      const to = safeLocation !== undefined ? ` → ${safeLocation}` : "";
      throw new RedirectRefusedError(
        `Refusing to follow a redirect (${where}${to}) from ${safeUrl}: this fetch refuses redirects for credential safety. Use a follow-capable fetch if a redirect is an expected part of the protocol.`,
        { url: safeUrl, status: res.status, location: safeLocation },
      );
    }
    return res;
  };
  return wrapped as typeof globalThis.fetch;
}

/**
 * The request URL of a `fetch`-shaped input, for the refusal message only. Reads (never mutates
 * or reconstructs) the input: a string is itself, a `URL` stringifies, a `Request` yields its
 * `.url`. Deliberately does NOT touch any other Request field — the input is passed to the
 * underlying fetch intact.
 */
function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return (input as Request).url;
}
