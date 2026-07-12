/**
 * A minimal structural mirror of the Web Storage `Storage` API surface this module
 * uses (`getItem`/`setItem`/`removeItem`). The transient redirect record lives in
 * **sessionStorage** by default (per-tab, same-origin, cleared on tab close), but
 * the store is INJECTABLE (a test in a `node` env passes an in-memory stub).
 */
export interface RedirectFlowStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/**
 * The serialised state a full-page-redirect login persists to sessionStorage
 * between {@link RedirectFlowStorage} write in `beginRedirectLogin` and the read in
 * `completeRedirectLogin`. It carries the PKCE verifier + the DPoP private+public
 * JWK + the OIDC `state`/`nonce` + the exact issuer/client/redirect_uri the
 * authorization request used.
 *
 * SECURITY — why persisting the DPoP private JWK (+ any client secret) here is
 * acceptable, and how it is bounded:
 *  - sessionStorage is SAME-ORIGIN and PER-TAB and is cleared when the tab closes,
 *    so the material is reachable only by this origin's own code for the brief
 *    duration of ONE redirect round-trip;
 *  - it is the STANDARD pattern for redirect-based PKCE+DPoP SPAs: a full-page
 *    redirect has no closure to keep the key in, so the only alternatives are a
 *    persisted extractable key (this) or abandoning DPoP for the redirect path;
 *  - the `state` is verified on return (`oauth.validateAuthResponse`), the `nonce`
 *    is the token exchange's `expectedNonce`, the PKCE verifier is single-use
 *    against the code, and the record is CLEARED the instant it is consumed
 *    (success OR failure — `completeRedirectLogin`'s `finally`, and the `abort`
 *    plan) so a refresh / back-button cannot replay it;
 *  - the re-imported DPoP key is re-imported NON-extractable for the live + durable
 *    session (see `completeRedirectLogin`), so the extractable copy exists only in
 *    this transient record for the round-trip.
 * The popup `login()` path keeps its DPoP key NON-extractable throughout (it never
 * leaves the closure); ONLY this redirect path exports the key, and only because
 * the redirect erases the closure.
 */
export interface PersistedRedirectFlow {
    /** The DPoP keypair, exported to JWK so it survives the full-page redirect. */
    dpopPrivateJwk: JsonWebKey;
    dpopPublicJwk: JsonWebKey;
    /** The PKCE code verifier — exchanged (single-use) for the code on return. */
    codeVerifier: string;
    /** The OIDC `state`, verified against the callback (CSRF / OP mix-up guard). */
    state: string;
    /** The OIDC `nonce`, the `expectedNonce` for the token exchange (replay guard). */
    nonce: string;
    /** The resolved issuer href (discovery + token endpoints are re-derived from it). */
    issuer: string;
    /**
     * The FULL OAuth client the authorization request used, persisted VERBATIM so
     * `completeRedirectLogin` reconstructs the EXACT SAME client — not a hand-picked
     * subset that could diverge on the auth method, a `client_secret`, or any other
     * registration metadata `oauth4webapi` consults during response validation.
     * `oauth.Client` is a plain JSON object (`client_id` + JSON-serialisable index
     * signature), so it round-trips through `JSON.stringify`/`parse`.
     */
    client: OAuthClientRecord;
    /**
     * The redirect_uri sent in BOTH the authorization request AND the token exchange
     * — they MUST be byte-identical or the token exchange is rejected.
     */
    redirectUri: string;
    /**
     * The WebID the user asked to log in as (the deep-link target), or null when the
     * login was started from a bare `oidcIssuer` (no WebID to bind to). When present,
     * `completeRedirectLogin` PROVES the OP authenticated as THIS WebID (fail-closed).
     */
    webId: string | null;
}
/**
 * A structural mirror of oauth4webapi's `Client` (a `client_id` plus a
 * JSON-serialisable index signature). Re-declared locally so this pure module has
 * no `oauth4webapi` import — keeping it free of the value module the engine mocks.
 */
export interface OAuthClientRecord {
    client_id: string;
    [key: string]: unknown;
}
/** WebCrypto params for an ES256 (P-256 ECDSA) key — to re-import the persisted DPoP JWK. */
export declare const ES256_JWK_IMPORT_ALG: {
    readonly name: "ECDSA";
    readonly namedCurve: "P-256";
};
/** The deep-link fragment prefix that triggers a fresh redirect autologin (CASE B). */
export declare const AUTOLOGIN_FRAGMENT_PREFIX = "#autologin/";
/**
 * Read + JSON-parse the persisted redirect-flow record, or null if absent / the
 * storage is unavailable / the record is corrupt (all fail-closed to "no pending
 * flow", so the caller falls back to a fresh login). Never throws.
 */
export declare function readPersistedRedirectFlow(storage: RedirectFlowStorage | undefined, key: string): PersistedRedirectFlow | null;
/**
 * Persist the redirect-flow record. Throws a clear error when the storage write
 * fails (the caller must NOT then navigate — a redirect whose in-between state was
 * not saved can never be completed). Never logs the record.
 */
export declare function writePersistedRedirectFlow(storage: RedirectFlowStorage | undefined, key: string, flow: PersistedRedirectFlow): void;
/** Remove the persisted redirect-flow record (idempotent; swallows storage errors). */
export declare function clearPersistedRedirectFlow(storage: RedirectFlowStorage | undefined, key: string): void;
/**
 * Parse the WebID out of a `#autologin/<encodeURIComponent(webid)>` fragment.
 * Returns the decoded WebID, or null when the hash is not an autologin deep-link or
 * decoding fails. PURE — the returned string is UNTRUSTED input (a deep-link the
 * launcher controls); the engine's `validateWebId` (https-only URL parse) is what
 * sanitises it before use, so no string here is ever concatenated into a URL.
 */
export declare function parseAutologinFragment(hash: string): string | null;
/** True when the URL query carries an OAuth `code` AND `state` (a successful redirect return). */
export declare function hasAuthCodeParams(search: string): boolean;
/**
 * True when the URL query carries an OAuth `error` AND `state` (a FAILED redirect
 * return — e.g. `error=login_required` / `error=access_denied`: the broker declined
 * silent SSO, or the user declined). `state` is required so a stray `error` query
 * unrelated to our flow is not mistaken for a redirect return.
 */
export declare function hasAuthErrorParams(search: string): boolean;
/** The OAuth `error` code on the URL query, or null. */
export declare function authErrorFrom(search: string): string | null;
/**
 * Strip BOTH the query (`?code&state…`) AND the fragment from a URL, leaving the
 * origin + path. Used to DERIVE the full-page-redirect RETURN URI from the current app
 * page (a bare, fragment-free URI that runs the app + matches a registered
 * `redirect_uri`; RFC 6749 §3.1.2 forbids a fragment on a redirect_uri). Returns the
 * input unchanged if it is unparseable. PURE. (For merely scrubbing the ADDRESS BAR
 * after a return — where the app's own query state must survive — use
 * {@link stripAuthCallbackParams} instead.)
 */
export declare function cleanedUrl(href: string): string;
/**
 * Scrub ONLY the OAuth callback params (`code`/`state`/`error`/…) + the
 * `#autologin/<webid>` fragment from a URL, PRESERVING any UNRELATED query params (the
 * app's own routing/state, e.g. `?workspace=123`) and any NON-autologin fragment. Used
 * to clean the address bar after a redirect return without discarding the app's state
 * (the roborev finding — {@link cleanedUrl} strips the whole query, which is right for
 * a redirect_uri but wrong for the address bar). Returns the input unchanged if it is
 * unparseable. PURE.
 */
export declare function stripAuthCallbackParams(href: string): string;
/**
 * The action the redirect handler should execute given the current URL + the
 * persisted/sentinel state + the login state. Pure data — the engine performs the
 * side effects (URL cleaning, the OIDC exchange, the navigation). Keeping the
 * decision pure makes the security-critical scenarios unit-testable with no DOM.
 *  - `"none"`           — nothing to do (already logged in / not a redirect URL /
 *                         a pending record with no code|error).
 *  - `"complete"`       — CASE A: a pending record + `?code&state` → complete the login.
 *  - `"abort"`          — a pending record + `?error&state` → drop the record + surface
 *                         the error (do NOT wait forever for a code that never comes).
 *  - `"begin"`          — CASE B: a fresh `#autologin/<webid>` deep-link (the URL has
 *                         no `?code`/`?error`) → begin the full-page redirect for
 *                         `webId`, OVERWRITING any stale pending record.
 *  - `"clear-sentinel"` — LOOP GUARD: a repeat deep-link for the SAME WebID with the
 *                         one-shot sentinel already set (we bounced back still
 *                         unauthenticated) → do not re-attempt.
 */
export type RedirectPlan = {
    kind: "none";
} | {
    kind: "complete";
} | {
    kind: "abort";
} | {
    kind: "begin";
    webId: string;
} | {
    kind: "clear-sentinel";
};
/** The inputs {@link planRedirect} decides over (all derived from the URL + storage). */
export interface RedirectPlanInputs {
    /** Already authenticated — a live session WINS; the redirect handler stands down. */
    loggedIn: boolean;
    /** A persisted full-page-redirect record exists in sessionStorage. */
    hasPendingRedirect: boolean;
    /** The URL carries `?code&state` (a successful redirect return). */
    hasCodeParams: boolean;
    /** The URL carries `?error&state` (a FAILED redirect return). */
    hasErrorParams: boolean;
    /** The WebID parsed from a `#autologin/<encoded>` fragment, or null. */
    fragmentWebId: string | null;
    /** The one-shot sentinel value (the WebID last attempted this tab), or null. */
    sentinel: string | null;
    /**
     * The WebID identity comparison the engine uses. Injected so this pure module
     * stays free of the engine import; the loop guard compares the sentinel to
     * `fragmentWebId` through it, so a stale sentinel for a DIFFERENT WebID does not
     * swallow a fresh deep-link.
     */
    webIdsEqual: (a: string | undefined, b: string | undefined) => boolean;
}
/**
 * Decide what the redirect handler should do. PURE — no I/O, no mutation.
 *
 * GUARD first: already logged in → `none` (a restored/active session wins). Then:
 *  - CASE A: a pending record + `?code&state` → `complete`.
 *  - ABORT:  a pending record + `?error&state` → `abort` (the broker declined silent
 *            SSO / the user declined — clean up, do not wait forever).
 *  - CASE B: NO pending record + an `#autologin/<webid>` fragment:
 *      - sentinel set for the SAME WebID (bounced back) → `clear-sentinel` (loop guard);
 *      - sentinel set for a DIFFERENT WebID / no sentinel → `begin` (a fresh deep-link).
 *  - anything else → `none`.
 */
export declare function planRedirect(inputs: RedirectPlanInputs): RedirectPlan;
//# sourceMappingURL=redirect.d.ts.map