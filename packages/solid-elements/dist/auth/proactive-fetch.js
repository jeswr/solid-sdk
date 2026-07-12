// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// proactive-fetch — a GENERIC, reusable proactive authenticated-`fetch` installer
// for the @jeswr Solid app suite. It wraps an EXTERNAL `TokenProvider` (the app keeps
// its own provider / login / restore / logout invariants) and ELIMINATES the
// per-resource "401-dance": it PROACTIVELY attaches the DPoP-bound token on the FIRST
// request to an ALLOWED origin (no wasted 401), enforces a fail-closed credential
// boundary, and does ONE bounded 401 re-upgrade.
//
// WHY THIS LIVES HERE (task #123): @jeswr/pod-drive proved this pattern in
// `web/src/auth/proactive-fetch.ts`, built on this package's PURE seam primitives
// (`computeAllowedOrigins` / `isOriginAllowed` / `isUseDpopNonceChallenge`) because the
// seam's `createReactiveAuthController` builds its OWN provider and won't accept an
// external one. The 7 sibling vite pod-apps (pod-mail/music/photos/money/health/docs/
// chat) + Pod Manager all need the SAME fix, so — per the suite rule "fix the pattern
// ONCE in a shared place, not copy-paste per app" — the proven extraction lives in
// @jeswr/solid-elements so every app IMPORTS it instead of copying it 8×.
//
// THE PROBLEM IT FIXES:
//   @solid/reactive-authentication's `ReactiveFetchManager([provider]).registerGlobally()`
//   sends EVERY request UNAUTHENTICATED first and only attaches the DPoP token REACTIVELY
//   on a 401 — per resource, with no origin/storage cache. So every distinct pod URL pays
//   a wasted 401 → upgrade → retry round-trip (a container listing of N children pays N
//   wasted 401s). Worse, an app provider's `matches()` is typically UNCONDITIONAL, so under
//   the raw manager the token is eligible for ANY origin's 401 — there is no credential
//   boundary.
//
// THE FIX — wrap an external provider over this package's seam primitives:
//   We do NOT re-implement the credential boundary or the DPoP-nonce logic; we reuse the
//   seam's pure, unit-tested `computeAllowedOrigins` / `isOriginAllowed` /
//   `isUseDpopNonceChallenge` (sibling `./index.ts`) and wrap the app's EXISTING token
//   provider. The wrapper:
//     1. PROACTIVELY attaches the token on the FIRST request to an ALLOWED origin with a
//        live session (no 401 needed) — a container listing of N children pays ZERO
//        wasted 401s instead of N.
//     2. Enforces the credential boundary: a request to a NON-allowed (foreign) origin is
//        left UNAUTHENTICATED. The token is NEVER sent cross-origin, even though a
//        provider's own `matches()` may be unconditional — `isOriginAllowed` is the gate.
//        Fail-closed: an empty allowed set authenticates NOTHING.
//     3. Does ONE bounded 401 re-upgrade (RFC 9449 `use_dpop_nonce`-vs-stale-token aware,
//        via the seam's `isUseDpopNonceChallenge`), matching the prior reactive retry — so
//        a genuinely-stale token / a server that first requires a re-proof still recovers,
//        but a per-resource 401 storm cannot recur.
//
// SECURITY (load-bearing — do not weaken):
//   • The token rides ONLY to origins in `computeAllowedOrigins` (https-only; http allowed
//     ONLY for a loopback host under the explicit dev/test `allowInsecureLoopback` opt-in).
//     A configured `http:` non-loopback origin is DROPPED by the seam — the DPoP token can
//     never ride over cleartext to a foreign host.
//   • `isOriginAllowed` is re-checked on EVERY request (live getter), so a logout / relogin
//     is reflected immediately: after logout the allowed set is empty and every request is
//     unauthenticated again.
//   • A TRANSPORT error from the authenticated `base()` PROPAGATES (it is NOT silently
//     downgraded to a second unauthenticated request — that would duplicate a non-idempotent
//     write + mask the real error). Only a SUPERSESSION (reset-race) `upgrade()` rejection
//     falls back to a public request; every other `upgrade()` failure (cancelled login,
//     OIDC discovery / token-endpoint error, refresh/session failure) is a REAL auth error
//     that propagates.
//
// PATCH-LIFECYCLE: when {@link installProactiveAuthFetch} patches the global, it does so
// EXACTLY ONCE per page (idempotent guard), capturing the pristine fetch FIRST. A
// StrictMode double-mount re-uses the same install; it never stacks a second patch.
//
// ⚠️ RE-ENTRANCY (the bit that bit pod-drive — lesson from #123): if you opt into patching
// the GLOBAL `fetch` (the `patchGlobal` install), your token provider's internal OIDC /
// oauth4webapi token requests (discovery, the refresh-token grant) MUST be pinned to the
// PRISTINE fetch captured here (`install.pristineFetch`) — NOT the patched global.
// Otherwise the provider's own token-endpoint `fetch` re-enters this patch, which calls
// `provider.upgrade()` again, which issues another token request… a self-deadlock /
// infinite re-entry. Wire your provider's `customFetch` / `profileFetch` /
// session-restore `fetch` option to `install.pristineFetch`. (The same applies to any
// PUBLIC profile read that must stay credential-free.)
import { computeAllowedOrigins, isOriginAllowed, isUseDpopNonceChallenge } from "./index.js";
/**
 * The DEFAULT supersession predicate. An `upgrade()` rejection is a SUPERSESSION/reset
 * race — a logout or relogin advanced the provider's generation mid-flight, so this
 * attempt's identity is stale — when its error `name` is `ReactiveAuthResetError` (thrown
 * by the suite providers on a generation-fence trip). ONLY this error is safe to absorb
 * into an unauthenticated fallback (the session is gone, so a public request is the correct
 * degraded behaviour). Matched STRUCTURALLY by error name so this module stays decoupled
 * from any concrete provider class. A consumer whose provider signals supersession
 * differently passes its own predicate as {@link ProactiveFetchConfig.isSuperseded}.
 */
export function isReactiveAuthResetError(e) {
    return e instanceof Error && e.name === "ReactiveAuthResetError";
}
/**
 * Whether a request is the token provider's OWN OAuth-infrastructure call (OIDC discovery /
 * token / refresh) that the proactive wrapper must NOT touch — SCOPED to the issuer origins.
 *
 * WHY (the PM topology this covers — #123 PM parity): when a pod is served from its IdP's
 * origin (the common CSS topology where the pod and the OP share a host), the issuer origin is
 * ALSO a resource origin, so it is in the allowed set. Without this guard a provider-internal
 * OAuth request (made via `oauth4webapi` over the patched global fetch) would be routed through
 * the wrapper, which would call `provider.upgrade()` on it — OVERWRITING oauth4webapi's own
 * client-auth `Authorization` / DPoP-proof `DPoP` headers, and potentially RECURSING (a
 * token-endpoint request triggering another upgrade → refresh-grant → another token request …).
 *
 * pod-drive avoids this DIFFERENTLY — by pinning oauth4webapi's `customFetch` to the pristine
 * fetch ({@link ProactiveFetchInstall.pristineFetch}), so the provider's own token requests
 * never reach the patched global at all (the re-entrancy note at the top of this module). That
 * pristine-pinning path stays the DEFAULT and is unchanged. This function is the OPTIONAL
 * SECOND line of defence for an app (like Pod Manager) whose provider routes its OAuth calls
 * over the global on a shared issuer/pod origin: supply {@link ProactiveFetchState.issuerOrigins}
 * and the wrapper additionally leaves these provider-internal calls unauthenticated.
 *
 * Scoping to the issuer origins is the first precision gate; a request elsewhere is never
 * provider-internal (so a resource write to the pod keeps the full auth path). On an issuer
 * origin, a request is treated as OAuth infrastructure ONLY when it ALSO looks like an OAuth
 * call — either (a) it carries a `DPoP` PROOF header (oauth4webapi stamps a DPoP proof on every
 * token/refresh request, and a Solid RESOURCE request routed through this wrapper never pre-sets
 * one — the wrapper is what ADDS it), or (b) its path is a well-known OIDC mount (`/.well-known/…`
 * or `/.oidc/…`, covering the header-less discovery GET).
 *
 * We deliberately do NOT key off `Authorization` alone: on a SHARED CSS origin (pod + IdP), a
 * caller that pre-authed a pod resource request with its own `Authorization` would then be
 * wrongly bypassed and lose the bounded 401 retry. The `DPoP`-proof signal is specific to the
 * provider's own OAuth calls. Fail-SAFE regardless: a false positive merely leaves a request
 * unauthenticated, which an OAuth endpoint never needs; an unparseable URL fails CLOSED (not
 * treated as provider-internal, so it still flows through the origin gate which itself
 * fail-closes an unparseable URL).
 *
 * @param request       the request being routed through the wrapper
 * @param issuerOrigins the live set of issuer origins that host OAuth infrastructure (empty
 *                      when logged out → nothing is treated as provider-internal)
 */
export function isProviderOAuthRequest(request, issuerOrigins) {
    let url;
    try {
        url = new URL(request.url);
    }
    catch {
        return false; // fail-closed: not treated as provider-internal (the origin gate fails closed too)
    }
    // Only the issuer's own origins host OAuth infrastructure — a request elsewhere is never
    // treated as provider-internal (so resource writes keep the full auth path).
    if (!issuerOrigins.has(url.origin))
        return false;
    if (request.headers.has("dpop"))
        return true; // oauth4webapi's token/refresh DPoP proof
    const path = url.pathname.toLowerCase();
    return path.startsWith("/.well-known/") || path.startsWith("/.oidc/");
}
/**
 * The credential boundary for the proactive fetch — the set of resource origins the
 * session token may be attached to. Delegates ENTIRELY to the seam's pure
 * {@link computeAllowedOrigins} (https-only + loopback-http-under-opt-in; fail-closed), so
 * the boundary logic is the one already exhaustively unit-tested in this package. The pod
 * root (+ any `extraOrigins`) is passed as an explicit allowed origin (a pod on a DIFFERENT
 * host than the WebID is a valid Solid topology and MUST be listed); the WebID + issuer
 * origins are added by the seam's defaults.
 */
export function deriveProactiveAllowedOrigins(inputs) {
    const allowedOrigins = [];
    if (inputs.podRoot)
        allowedOrigins.push(inputs.podRoot);
    if (inputs.extraOrigins)
        allowedOrigins.push(...inputs.extraOrigins);
    return computeAllowedOrigins({
        allowedOrigins,
        webId: inputs.webId,
        issuer: inputs.issuer,
        ...(inputs.includeWebIdOrigin !== undefined
            ? { includeWebIdOrigin: inputs.includeWebIdOrigin }
            : {}),
        ...(inputs.includeIssuerOrigin !== undefined
            ? { includeIssuerOrigin: inputs.includeIssuerOrigin }
            : {}),
        ...(inputs.allowInsecureLoopback !== undefined
            ? { allowInsecureLoopback: inputs.allowInsecureLoopback }
            : {}),
    });
}
/**
 * The COMPLETE per-request credential gate, evaluated LIVE off the current {@link
 * ProactiveFetchState}. The token is attached ONLY when ALL hold (fail-closed — any false
 * leaves the request unauthenticated):
 *   1. `isOriginAllowed` — the foreign-origin / cleartext boundary (token never leaves the
 *      allowed set; fail-closed for an empty set or an unparseable URL). ALWAYS applied.
 *   2. NOT a provider-internal OAuth request — only when {@link ProactiveFetchState.issuerOrigins}
 *      is supplied (#123 PM parity). Omitted ⇒ this clause is vacuously true (no bypass), so the
 *      gate reduces to the prior pod-drive behaviour.
 *   3. The session-liveness gate — only when {@link ProactiveFetchState.canAttachNonInteractively}
 *      is supplied (#123 PM parity). Omitted ⇒ vacuously true (always attempt the upgrade).
 *
 * Used at BOTH the first attempt and the bounded 401 retry so all three clauses are re-checked
 * live (a logout / re-login / now-dead refresh token between rounds is reflected). Note the
 * caller still checks `provider` separately; this gate is the origin+seam half.
 *
 * #123 P2 EXTENSION POINT (per-storage-prefix learning — DO NOT implement here): a future P2
 * can learn which storage PREFIXES require auth and refine this single predicate (e.g. an
 * optional `requiresAuth?: (request) => boolean | undefined` on the state, defaulting to the
 * current origin-level decision) WITHOUT an API churn — every gate decision already funnels
 * through this one function, so the learning hook plugs in here.
 */
function shouldAttachToken(state, request) {
    if (!isOriginAllowed(state.allowedOrigins, request.url))
        return false;
    // OPTIONAL OAuth bypass (#123 PM parity): when issuer origins are supplied, never wrap the
    // provider's OWN discovery/token/refresh calls (would clobber oauth4webapi's headers / recurse).
    if (state.issuerOrigins && isProviderOAuthRequest(request, state.issuerOrigins))
        return false;
    // OPTIONAL session-liveness gate (#123 PM parity): when supplied and false, leave the request
    // unauthenticated so a passive dead-session read never triggers the interactive popup.
    if (state.canAttachNonInteractively && !state.canAttachNonInteractively(request))
        return false;
    return true;
}
/**
 * The proactive authenticated-fetch implementation, run over an explicit `base` fetch (the
 * pristine global). Exported (not just the installer) so the credential boundary + the
 * bounded-retry behaviour are unit-testable WITHOUT patching the global.
 *
 * For an ALLOWED-origin request WITH a live provider:
 *   - PROACTIVELY upgrade (attach the DPoP-bound token) on the FIRST request — no 401 dance.
 *     The body is cloned BEFORE the first fetch so a retry can replay it (PUT / PATCH / POST
 *     request streams are single-use once fetched).
 *   - On a 401, retry ONCE: re-`upgrade` the pre-fetch clone (a fresh DPoP proof, the
 *     provider refreshing its session as needed) and re-issue. `isUseDpopNonceChallenge`
 *     distinguishes a pure RFC 9449 §8 nonce challenge (token was fine) from a genuine
 *     stale-token rejection — both are handled by the single re-`upgrade`, mirroring the
 *     prior reactive retry. We do NOT loop a second time (bounded).
 * For a NON-allowed origin OR no live provider: the request is left UNAUTHENTICATED — the
 * foreign-origin / public-read boundary (fail-closed).
 *
 * #123 PM-PARITY SEAMS (optional, default off — behaviour is identical to before when both are
 * omitted). When {@link ProactiveFetchState.issuerOrigins} is set, a provider-internal OAuth
 * request to an issuer origin is also left unauthenticated (see {@link isProviderOAuthRequest});
 * when {@link ProactiveFetchState.canAttachNonInteractively} is set and returns false, an
 * allowed-origin request is left unauthenticated so a passive dead-session read never starts the
 * interactive popup. Both are re-checked on the bounded 401 retry (the live state may have
 * changed). All gate decisions funnel through `shouldAttachToken`.
 *
 * @param state  the live provider + credential boundary + optional PM-parity seams (read fresh
 *               on every request AND the retry)
 * @param base   the pristine fetch the request is ultimately issued over
 * @param config optional per-install config (the supersession predicate)
 */
export async function proactiveAuthenticatedFetch(state, base, input, init, config) {
    const isSuperseded = config?.isSuperseded ?? isReactiveAuthResetError;
    const request = new Request(input, init);
    const { provider } = state;
    // The credential gate — re-evaluated live every request, fail-closed for an empty set or
    // an unparseable URL (delegated to the seam's `isOriginAllowed`), plus the two OPTIONAL
    // #123-PM seams (the provider-internal-OAuth bypass + the session-liveness gate). When
    // neither optional seam is supplied this is EXACTLY the prior pod-drive gate.
    if (!provider || !shouldAttachToken(state, request)) {
        return base(request);
    }
    // Clone BEFORE the first fetch consumes the body: a 401 retry must replay the body, but
    // request streams are single-use once fetched. clone() tees the stream while bodyUsed is
    // false (pre-fetch); a cheap no-op for bodyless GET/HEAD.
    const retrySource = request.clone();
    // Catch ONLY a supersession (reset-race) rejection: a logout / relogin advanced the
    // provider's generation mid-flight, so the session is gone and an UNAUTHENTICATED request
    // is the correct degraded behaviour (the pristine clone still has its body intact). Any
    // OTHER upgrade() error (cancelled login, OIDC discovery / token error, refresh/session
    // failure) is a REAL auth error → RETHROW, never silently downgrade to public. And
    // `base(upgraded)` runs OUTSIDE the catch so a TRANSPORT error (network / CORS / abort)
    // propagates rather than triggering a duplicate public request.
    let upgraded;
    try {
        upgraded = await provider.upgrade(request);
    }
    catch (e) {
        if (isSuperseded(e))
            return base(retrySource);
        throw e;
    }
    const response = await base(upgraded);
    if (response.status !== 401)
        return response;
    // ONE bounded retry. The single re-`upgrade()` re-mints a FRESH DPoP proof (new jti/iat)
    // for the same request — recovering the common case where the first proof was stale (clock
    // skew / a server that wants a fresh proof). `pureNonce` records whether the 401 was an
    // UNAMBIGUOUS RFC 9449 §8 `use_dpop_nonce` challenge (token fine, only the nonce missing)
    // vs a token-rejection. SCOPE: prod-solid-server + CSS (the suite's targets) do NOT issue
    // resource-server `DPoP-Nonce` challenges and the bound short-lived access token is
    // re-minted with a fresh proof here, so the re-`upgrade` is sufficient for them. Full RS
    // DPoP-Nonce caching + a forced refresh-grant on a non-nonce 401 would require the provider
    // to expose those (the stock providers do not today) — `pureNonce` is surfaced so that
    // wiring can branch on it without a churn here.
    const pureNonce = isUseDpopNonceChallenge(response);
    // Re-check the FULL gate (live): a logout during the first round may have emptied the
    // boundary, the issuer may have changed, or the session-liveness gate may now report the
    // refresh token dead. The same `shouldAttachToken` used on the first attempt — so the OAuth
    // bypass + the liveness gate are re-evaluated on the retry too (the live state may have
    // changed mid-flight). `retrySource` carries the same URL/headers as the original request.
    if (!state.provider || !shouldAttachToken(state, retrySource)) {
        return base(retrySource);
    }
    // Tee the body ONCE MORE before the retry upgrade: `upgrade` builds a new Request from its
    // argument, which can consume the source body stream — so if the retry upgrade itself
    // throws (a logout race during the retry), this pre-upgrade clone still has an intact body
    // for the unauthenticated fallback.
    const retryFallback = retrySource.clone();
    // Same precise scoping: absorb ONLY a supersession rejection (→ public fallback) and
    // rethrow any real auth error; a transport error from the retry `base()` propagates.
    let retried;
    try {
        retried = await state.provider.upgrade(retrySource);
    }
    catch (e) {
        if (isSuperseded(e))
            return base(retryFallback);
        throw e;
    }
    // (pureNonce is currently informational — see the NOTE above; referenced so a future
    // nonce-aware retry can branch on it without an unused-variable churn.)
    void pureNonce;
    return base(retried);
}
// Module-level once-only guard: the global is patched EXACTLY ONCE per page (mirroring the
// reactive-auth singleton). A second install call that ALSO requests the global patch returns
// the FIRST install's handle so a StrictMode double-mount re-uses it and never stacks a
// second patch. A non-global install (`patchGlobal: false`) always builds a FRESH, isolated
// handle (it touches no shared global, so there is nothing to collide).
let globalInstallSingleton = null;
/**
 * Install the proactive authenticated fetch. By DEFAULT (`patchGlobal !== false`) it patches
 * `globalThis.fetch` EXACTLY ONCE per page so every plain `fetch()` proactively carries the
 * DPoP token for an allowed origin — the seam-based replacement for
 * `ReactiveFetchManager.registerGlobally()`. Idempotent + once-only: a second global install
 * returns the first install's handle.
 *
 * The patched wrapper ALWAYS runs over the pristine fetch captured here at install time,
 * never the live (possibly re-patched) global — so it can never chain through another patch.
 * The initial state is provider-less (everything public) until {@link
 * ProactiveFetchInstall.setState} wires a live session.
 *
 * @example app wiring (mirrors pod-drive's SessionProvider)
 * ```ts
 * const install = installProactiveAuthFetch();
 * // …pin your provider's token-request fetch to the pristine one (re-entrancy guard):
 * const provider = new MyTokenProvider({ customFetch: install.pristineFetch });
 * // On login / restore: arm the boundary so the patched fetch attaches the token.
 * install.setState({
 *   provider,
 *   allowedOrigins: deriveProactiveAllowedOrigins({ podRoot, webId, issuer, allowInsecureLoopback }),
 * });
 * // On logout: drop the boundary so every request is public again.
 * install.setState({ provider: null, allowedOrigins: new Set() });
 * ```
 */
export function installProactiveAuthFetch(options = {}) {
    const patchGlobal = options.patchGlobal !== false;
    // A repeat GLOBAL install reuses the one-per-page handle (StrictMode double-mount safe).
    if (patchGlobal && globalInstallSingleton)
        return globalInstallSingleton;
    const pristineFetch = options.pristineFetch ?? globalThis.fetch.bind(globalThis);
    const config = options.isSuperseded
        ? { isSuperseded: options.isSuperseded }
        : {};
    // The single mutable cell the wrapper reads on every request.
    const state = {
        provider: options.initial?.provider ?? null,
        allowedOrigins: options.initial?.allowedOrigins ?? new Set(),
    };
    const wrapper = ((input, init) => proactiveAuthenticatedFetch(state, pristineFetch, input, init, config));
    if (patchGlobal)
        globalThis.fetch = wrapper;
    const install = {
        setState(next) {
            state.provider = next.provider;
            state.allowedOrigins = next.allowedOrigins;
        },
        fetch: wrapper,
        pristineFetch,
        patchedGlobal: patchGlobal,
    };
    if (patchGlobal)
        globalInstallSingleton = install;
    return install;
}
/**
 * TEST-ONLY: reset the once-only GLOBAL install guard so each test patches a fresh global.
 * Never called in app code (the page-lifetime singleton is intentional).
 */
export function __resetProactiveFetchForTests() {
    globalInstallSingleton = null;
}
