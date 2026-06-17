// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// proactive-fetch.ts — the controller-owned global `fetch` patch that REPLACES the
// raw upstream @solid/reactive-authentication `ReactiveFetchManager`, eliminating the
// per-resource "401-dance".
//
// THE PROBLEM IT FIXES (task #123):
//   `ReactiveFetchManager([provider]).registerGlobally()` sends EVERY request
//   UNAUTHENTICATED first and only attaches the DPoP token REACTIVELY on a 401 — per
//   resource, with no origin/storage cache. So every distinct pod URL pays a wasted
//   401 → upgrade → retry round-trip (the listing GETs each child, each pays its own
//   401). Worse, the app's `WebIdDPoPTokenProvider.matches()` returns `true`
//   UNCONDITIONALLY, so under the raw manager the token would be eligible for ANY
//   origin's 401 — there is no credential boundary.
//
// THE FIX — adopt the @jeswr/solid-elements auth seam:
//   We do NOT re-implement the credential boundary or the DPoP-nonce logic. We reuse
//   the seam's PURE, exported, unit-tested primitives — `computeAllowedOrigins`,
//   `isOriginAllowed`, `isUseDpopNonceChallenge` — and wrap the app's EXISTING
//   `WebIdDPoPTokenProvider` (its login / silent-restore / logout / DPoP invariants are
//   untouched — including its own RFC 9449 §4.2 `htu` normalisation inside `upgrade()`).
//   The wrapper:
//     1. PROACTIVELY attaches the token on the FIRST request to an ALLOWED origin with
//        a live session (no 401 needed) — so a container listing of N children pays
//        ZERO wasted 401s instead of N.
//     2. Enforces the credential boundary: a request to a NON-allowed (foreign) origin
//        is left UNAUTHENTICATED. The token is NEVER sent cross-origin, even though the
//        provider's own `matches()` is unconditional — `isOriginAllowed` is the gate.
//        Fail-closed: an empty allowed set authenticates NOTHING.
//     3. Does ONE bounded 401 re-upgrade (RFC 9449 use_dpop_nonce vs stale-token aware,
//        via the seam's `isUseDpopNonceChallenge`), matching the prior reactive retry —
//        so a genuinely-stale token / a server that first requires a re-proof still
//        recovers, but a per-resource 401 storm cannot recur.
//
// SECURITY (load-bearing — do not weaken):
//   • The token rides ONLY to origins in `computeAllowedOrigins` (https-only; http
//     allowed ONLY for a loopback host under the explicit dev/test `allowInsecureLoopback`
//     opt-in). A configured `http:` non-loopback origin is DROPPED by the seam — the
//     DPoP token can never ride over cleartext to a foreign host.
//   • `isOriginAllowed` is re-checked on EVERY request (live getter), so a logout /
//     relogin is reflected immediately: after logout the allowed set is empty and every
//     request is unauthenticated again.
//
// PATCH-LIFECYCLE (mirrors the old singleton): the global is patched EXACTLY ONCE per
// page (idempotent guard), capturing the pristine fetch first. A StrictMode double-mount
// re-uses the same install; it never stacks a second patch (the bug the old
// `registerGlobally` model already guarded against).

import {
  computeAllowedOrigins,
  isOriginAllowed,
  isUseDpopNonceChallenge,
} from "@jeswr/solid-elements/auth";

/** The reactive-auth TokenProvider surface this wrapper drives (matches the app's
 * `WebIdDPoPTokenProvider`). `upgrade(request)` returns a NEW Request carrying the
 * `Authorization: DPoP …` + `DPoP` proof headers (or rejects when superseded). */
export interface ProactiveTokenProvider {
  upgrade(request: Request): Promise<Request>;
}

/**
 * Whether an `upgrade()` rejection is a SUPERSESSION/reset race — a logout or relogin
 * advanced the provider's generation mid-flight, so this attempt's identity is stale.
 * ONLY this error is safe to absorb into an unauthenticated fallback (the session is gone,
 * so a public request is the correct degraded behaviour). Every OTHER `upgrade()` failure
 * (cancelled login, OIDC discovery / token-endpoint error, refresh/session failure) is a
 * REAL auth error that MUST propagate — silently downgrading those to a public request
 * would let an authenticated operation continue unauthenticated (the roborev finding).
 *
 * Matched STRUCTURALLY by error name (`ReactiveAuthResetError`, thrown by
 * WebIdDPoPTokenProvider on a generation-fence trip) so this module stays decoupled from
 * the concrete provider — no import of the provider class.
 */
function isSupersededError(e: unknown): boolean {
  return e instanceof Error && e.name === "ReactiveAuthResetError";
}

/** Inputs to {@link deriveProactiveAllowedOrigins}: the post-login resource origins the
 * token may ride to. The WebID + issuer origins are folded in by the seam's
 * `computeAllowedOrigins` default. */
export interface ProactiveAllowedOriginsInputs {
  /** The pod / storage root URL known post-login (its origin is the primary target). */
  podRoot?: string;
  /** The authenticated WebID (its origin is included by default). */
  webId?: string;
  /** The resolved issuer href (its origin is included by default). */
  issuer?: string;
  /** Allow `http:` for loopback hosts only (dev against a local CSS / a test). */
  allowInsecureLoopback: boolean;
}

/**
 * The credential boundary for the proactive fetch — the set of resource origins the
 * session token may be attached to. Delegates ENTIRELY to the seam's pure
 * `computeAllowedOrigins` (https-only + loopback-http-under-opt-in; fail-closed), so the
 * boundary logic is the one already exhaustively unit-tested in @jeswr/solid-elements.
 * The pod root is passed as an explicit allowed origin (a pod on a DIFFERENT host than
 * the WebID is a valid Solid topology and MUST be listed); the WebID + issuer origins
 * are added by the seam's defaults.
 */
export function deriveProactiveAllowedOrigins(
  inputs: ProactiveAllowedOriginsInputs,
): ReadonlySet<string> {
  return computeAllowedOrigins({
    allowedOrigins: inputs.podRoot ? [inputs.podRoot] : [],
    webId: inputs.webId,
    issuer: inputs.issuer,
    allowInsecureLoopback: inputs.allowInsecureLoopback,
  });
}

/** The live state the patched fetch reads on EVERY request, so a login / restore /
 * logout is reflected without re-installing the patch. */
export interface ProactiveFetchState {
  /** The token provider, or null when no session/runtime is live (→ all requests public). */
  provider: ProactiveTokenProvider | null;
  /** The current credential boundary (empty when logged out → authenticate nothing). */
  allowedOrigins: ReadonlySet<string>;
}

/**
 * The proactive authenticated-fetch implementation, run over an explicit `base` fetch
 * (the pristine global). Exported (not just the installer) so the credential boundary +
 * the bounded-retry behaviour are unit-testable WITHOUT patching the global.
 *
 * For an ALLOWED-origin request WITH a live provider:
 *   - PROACTIVELY upgrade (attach the DPoP-bound token) on the FIRST request — no 401
 *     dance. The body is cloned BEFORE the first fetch so a retry can replay it (PUT /
 *     PATCH / POST request streams are single-use once fetched).
 *   - On a 401, retry ONCE: re-`upgrade` the pre-fetch clone (a fresh DPoP proof, the
 *     provider refreshing its session as needed) and re-issue. `isUseDpopNonceChallenge`
 *     distinguishes a pure RFC 9449 §8 nonce challenge (token was fine) from a genuine
 *     stale-token rejection — both are handled by the single re-`upgrade`, mirroring the
 *     prior reactive retry. We do NOT loop a second time (bounded).
 * For a NON-allowed origin OR no live provider: the request is left UNAUTHENTICATED — the
 * foreign-origin / public-read boundary (fail-closed).
 */
export async function proactiveAuthenticatedFetch(
  state: ProactiveFetchState,
  base: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input as RequestInfo, init);
  const { provider, allowedOrigins } = state;
  // The credential gate — re-evaluated live every request, fail-closed for an empty set
  // or an unparseable URL (delegated to the seam's `isOriginAllowed`).
  if (!provider || !isOriginAllowed(allowedOrigins, request.url)) {
    return base(request);
  }
  // Clone BEFORE the first fetch consumes the body: a 401 retry must replay the body,
  // but request streams are single-use once fetched. clone() tees the stream while
  // bodyUsed is false (pre-fetch); a cheap no-op for bodyless GET/HEAD.
  const retrySource = request.clone();
  // Catch ONLY a supersession (reset-race) rejection (roborev findings): a logout /
  // relogin advanced the provider's generation mid-flight, so the session is gone and an
  // UNAUTHENTICATED request is the correct degraded behaviour (the pristine clone still
  // has its body intact). Any OTHER upgrade() error (cancelled login, OIDC discovery /
  // token error, refresh/session failure) is a REAL auth error → RETHROW, never silently
  // downgrade to public. And `base(upgraded)` runs OUTSIDE the catch so a TRANSPORT error
  // (network / CORS / abort) propagates rather than triggering a duplicate public request.
  let upgraded: Request;
  try {
    upgraded = await provider.upgrade(request);
  } catch (e) {
    if (isSupersededError(e)) return base(retrySource);
    throw e;
  }
  const response = await base(upgraded);
  if (response.status !== 401) return response;
  // ONE bounded retry. The single re-`upgrade()` re-mints a FRESH DPoP proof (new jti/iat)
  // for the same request — recovering the common case where the first proof was stale
  // (clock skew / a server that wants a fresh proof). `pureNonce` records whether the 401
  // was an UNAMBIGUOUS RFC 9449 §8 `use_dpop_nonce` challenge (token fine, only the nonce
  // missing) vs a token-rejection. SCOPE: prod-solid-server + CSS (this app's targets) do
  // NOT issue resource-server `DPoP-Nonce` challenges and the bound short-lived access
  // token is re-minted with a fresh proof here, so the re-`upgrade` is sufficient for them.
  // Full RS DPoP-Nonce caching + a forced refresh-grant on a non-nonce 401 would require
  // WebIdDPoPTokenProvider to expose those (it does not today) — see the report's follow-up
  // note; `pureNonce` is surfaced so that wiring can branch on it without a churn here.
  const pureNonce = isUseDpopNonceChallenge(response);
  // Re-check the gate: a logout during the first round may have emptied the boundary.
  if (!isOriginAllowed(state.allowedOrigins, retrySource.url) || !state.provider) {
    return base(retrySource);
  }
  // Tee the body ONCE MORE before the retry upgrade: `upgrade` builds a new Request from
  // its argument, which can consume the source body stream — so if the retry upgrade
  // itself throws (a logout race during the retry), this pre-upgrade clone still has an
  // intact body for the unauthenticated fallback.
  const retryFallback = retrySource.clone();
  // Same precise scoping: absorb ONLY a supersession rejection (→ public fallback) and
  // rethrow any real auth error; a transport error from the retry `base()` propagates.
  let retried: Request;
  try {
    retried = await state.provider.upgrade(retrySource);
  } catch (e) {
    if (isSupersededError(e)) return base(retryFallback);
    throw e;
  }
  // (pureNonce is currently informational — see the NOTE above; referenced so a future
  // nonce-aware retry can branch on it without an unused-variable churn.)
  void pureNonce;
  return base(retried);
}

/** Handle returned by {@link installProactiveAuthFetch} so the installer can update the
 * live state (on login / restore / logout) without re-patching the global. */
export interface ProactiveFetchInstall {
  /** Update the live provider + credential boundary read on every subsequent request. */
  setState(next: ProactiveFetchState): void;
  /** The pristine native fetch captured BEFORE the patch (the public / profile fetch). */
  readonly pristineFetch: typeof fetch;
}

// Module-level once-only guard: the global is patched EXACTLY ONCE per page (mirroring
// the old auth-runtime singleton). A second install call returns the FIRST install's
// handle so a StrictMode double-mount re-uses it and never stacks a second patch.
let installSingleton: ProactiveFetchInstall | null = null;

/**
 * Patch `globalThis.fetch` so EVERY plain `fetch()` (including the ones inside
 * @jeswr/fetch-rdf and the @jeswr/pod-drive data layer) PROACTIVELY carries the DPoP
 * token for an allowed origin — the seam-based replacement for
 * `ReactiveFetchManager.registerGlobally()`. Idempotent + once-only.
 *
 * The patched wrapper ALWAYS runs over the pristine fetch captured here at install time,
 * never the live (possibly re-patched) global — so it can never chain through another
 * patch. The initial state is provider-less (everything public) until {@link
 * ProactiveFetchInstall.setState} wires a live session.
 */
export function installProactiveAuthFetch(
  initial: ProactiveFetchState = { provider: null, allowedOrigins: new Set() },
): ProactiveFetchInstall {
  if (installSingleton) return installSingleton;
  const pristineFetch = globalThis.fetch.bind(globalThis);
  // The single mutable cell the wrapper reads on every request.
  const state: ProactiveFetchState = { ...initial };
  const wrapper: typeof fetch = (input, init) =>
    proactiveAuthenticatedFetch(state, pristineFetch, input, init);
  globalThis.fetch = wrapper;
  installSingleton = {
    setState(next) {
      state.provider = next.provider;
      state.allowedOrigins = next.allowedOrigins;
    },
    pristineFetch,
  };
  return installSingleton;
}

/** TEST-ONLY: reset the once-only install guard so each test patches a fresh global.
 * Never called in app code (the page-lifetime singleton is intentional). */
export function __resetProactiveFetchForTests(): void {
  installSingleton = null;
}
