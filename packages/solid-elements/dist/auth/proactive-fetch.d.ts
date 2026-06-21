/**
 * The structural TokenProvider surface this wrapper drives. The consuming app supplies its
 * OWN provider implementing this — its login / silent-restore / logout / DPoP invariants
 * are untouched; only HOW the token is attached to fetches is moved from reactive
 * (`ReactiveFetchManager`) to proactive (this wrapper).
 *
 * `upgrade(request)` returns a NEW `Request` carrying the `Authorization: DPoP …` + `DPoP`
 * proof headers (rebuilding a fresh DPoP proof per call), or REJECTS — see
 * {@link ProactiveFetchConfig.isSuperseded} for which rejection is safe to absorb.
 */
export interface ProactiveTokenProvider {
    upgrade(request: Request): Promise<Request>;
}
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
export declare function isReactiveAuthResetError(e: unknown): boolean;
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
export declare function isProviderOAuthRequest(request: Request, issuerOrigins: ReadonlySet<string>): boolean;
/**
 * Inputs to {@link deriveProactiveAllowedOrigins}: the post-login resource origins the
 * token may ride to. The WebID + issuer origins are folded in by the seam's
 * `computeAllowedOrigins` default (toggle with {@link includeWebIdOrigin} /
 * {@link includeIssuerOrigin}).
 */
export interface ProactiveAllowedOriginsInputs {
    /** The pod / storage root URL known post-login (its origin is the primary target). */
    podRoot?: string;
    /**
     * Additional explicit allowed resource origins (e.g. a media host or a second pod on a
     * different host than the WebID — a valid Solid topology that MUST be listed). Compared
     * by URL `origin`; a non-URL entry is ignored.
     */
    extraOrigins?: string[];
    /** The authenticated WebID (its origin is included by default). */
    webId?: string;
    /** The resolved issuer href (its origin is included by default). */
    issuer?: string;
    /** Include the WebID's origin in the allowed set. Default true. */
    includeWebIdOrigin?: boolean;
    /** Include the issuer's origin in the allowed set. Default true. */
    includeIssuerOrigin?: boolean;
    /** Allow `http:` for loopback hosts only (dev against a local CSS / a test). */
    allowInsecureLoopback?: boolean;
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
export declare function deriveProactiveAllowedOrigins(inputs: ProactiveAllowedOriginsInputs): ReadonlySet<string>;
/**
 * The live state the patched fetch reads on EVERY request, so a login / restore / logout is
 * reflected without re-installing the patch.
 */
export interface ProactiveFetchState {
    /** The token provider, or null when no session/runtime is live (→ all requests public). */
    provider: ProactiveTokenProvider | null;
    /** The current credential boundary (empty when logged out → authenticate nothing). */
    allowedOrigins: ReadonlySet<string>;
    /**
     * OPTIONAL (#123 PM parity). The live set of issuer origins that host the OAuth
     * infrastructure (OIDC discovery / token / refresh). When supplied, a provider-internal
     * OAuth request to one of these origins is left UNAUTHENTICATED (the wrapper does NOT call
     * `provider.upgrade()` on it) — see {@link isProviderOAuthRequest}. This is needed when a
     * pod is served from its IdP's origin (the common CSS topology) AND the provider routes its
     * own oauth4webapi calls over the patched global fetch. Read FRESH every request (and on the
     * 401 retry) so a re-login that changes the issuer is reflected immediately.
     *
     * DEFAULT (omitted / undefined): behaviour is EXACTLY as before — no OAuth bypass; the
     * pristine-pinning path (pod-drive's approach — pin the provider's `customFetch` to
     * {@link ProactiveFetchInstall.pristineFetch}) remains the recommended re-entrancy guard. An
     * empty set is equivalent to omitting it (nothing is treated as provider-internal).
     */
    issuerOrigins?: ReadonlySet<string>;
    /**
     * OPTIONAL (#123 PM parity). A SESSION-LIVENESS gate read FRESH per request: it returns
     * `true` only when the provider can attach a token to this request WITHOUT any user
     * interaction (a live access token, or a refresh token that renews via a plain fetch). When
     * it returns `false`, an allowed-origin request is left UNAUTHENTICATED even though a session
     * exists — so a PASSIVE on-load read for an account whose refresh token is DEAD does NOT
     * trigger the interactive code flow (a popup) from a background fetch.
     *
     * WHY (the PM behaviour this covers): the reactive providers' `matches()` / unconditional
     * `upgrade()` is NOT a liveness check — it was the manager's "is this my provider" probe. If
     * the wrapper proactively upgrades whenever a session is armed, a passive read (e.g. the
     * on-load silent-restore profile fetch) for a dead-refresh-token account would start the
     * INTERACTIVE code flow from a background fetch — popping a window during restore, breaking
     * the fail-closed silent-restore invariant. Gating on non-interactive renewability keeps such
     * a passive read UNAUTHENTICATED when the only way to get a token would be a popup; an
     * EXPLICIT login flow (a fresh session) passes the gate and is proactively authenticated.
     *
     * Re-checked on the 401 retry too (the live state may have changed mid-flight). DEFAULT
     * (omitted / undefined): behaviour is EXACTLY as before — always attempt the upgrade on an
     * allowed origin (correct for a provider whose every armed session IS non-interactively
     * renewable, e.g. pod-drive's).
     */
    canAttachNonInteractively?: (request: Request) => boolean;
}
/**
 * Static (per-install) configuration for the proactive fetch — distinct from the live
 * {@link ProactiveFetchState}, which changes on login/logout.
 */
export interface ProactiveFetchConfig {
    /**
     * Predicate that decides whether an `upgrade()` rejection is a SUPERSESSION (reset-race)
     * — the only rejection safe to absorb into an unauthenticated fallback (every other
     * rejection is a real auth error that propagates). Defaults to
     * {@link isReactiveAuthResetError} (matches the suite providers' `ReactiveAuthResetError`
     * by name).
     */
    isSuperseded?: (e: unknown) => boolean;
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
export declare function proactiveAuthenticatedFetch(state: ProactiveFetchState, base: typeof fetch, input: RequestInfo | URL, init?: RequestInit, config?: ProactiveFetchConfig): Promise<Response>;
/**
 * Handle returned by {@link installProactiveAuthFetch} so the installer can update the live
 * state (on login / restore / logout) without re-patching the global, and run the patched
 * fetch directly.
 */
export interface ProactiveFetchInstall {
    /** Update the live provider + credential boundary read on every subsequent request. */
    setState(next: ProactiveFetchState): void;
    /**
     * The patched fetch itself — the proactive wrapper over the pristine fetch. When
     * `patchGlobal` was NOT set this is the ONLY way to reach the wrapper (the global stays
     * pristine); when `patchGlobal` WAS set this is identically `globalThis.fetch`.
     */
    readonly fetch: typeof fetch;
    /**
     * The pristine native fetch captured BEFORE the patch (the public / profile / credential-
     * free fetch). ⚠️ Pin your provider's OIDC/oauth4webapi `customFetch` (and any public
     * profile read) to THIS, never the patched global — see the re-entrancy note at the top of
     * this module.
     */
    readonly pristineFetch: typeof fetch;
    /** True when this install patched `globalThis.fetch` (vs. only exposing `.fetch`). */
    readonly patchedGlobal: boolean;
}
/** Options for {@link installProactiveAuthFetch}. */
export interface InstallProactiveAuthFetchOptions extends ProactiveFetchConfig {
    /** The initial live state. Default: provider-less + empty boundary (everything public). */
    initial?: ProactiveFetchState;
    /**
     * Patch `globalThis.fetch` so EVERY plain `fetch()` (including the ones inside
     * @jeswr/fetch-rdf and an app's data layer) PROACTIVELY carries the DPoP token for an
     * allowed origin — the seam-based replacement for `ReactiveFetchManager.registerGlobally()`.
     * Default TRUE (the pod-drive-proven behaviour). Set FALSE to keep the global pristine and
     * route only through the returned `.fetch` handle (e.g. the app wires it into a library's
     * `fetch?:` seam explicitly).
     *
     * ⚠️ When true, your provider's internal token requests MUST be pinned to `pristineFetch`
     * to avoid re-entering this patch — see the re-entrancy note at the top of this module.
     */
    patchGlobal?: boolean;
    /**
     * Inject the pristine fetch to wrap, instead of snapshotting `globalThis.fetch` at install
     * time. Pass this ONLY if you are installing AFTER the global was already patched and hold
     * a reference to the original; otherwise the default snapshot is correct and safer.
     */
    pristineFetch?: typeof fetch;
}
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
export declare function installProactiveAuthFetch(options?: InstallProactiveAuthFetchOptions): ProactiveFetchInstall;
/**
 * TEST-ONLY: reset the once-only GLOBAL install guard so each test patches a fresh global.
 * Never called in app code (the page-lifetime singleton is intentional).
 */
export declare function __resetProactiveFetchForTests(): void;
