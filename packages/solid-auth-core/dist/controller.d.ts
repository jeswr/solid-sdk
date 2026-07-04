import * as oauth from "oauth4webapi";
import type { SessionStore } from "./session-store.js";
import type { GetCodeCallback, SolidAuth } from "./types.js";
/**
 * The reactive-auth-style TokenProvider structural contract (the tiny, stable
 * shape @solid/reactive-authentication's manager matches structurally). Restated
 * here so this core has no dependency on that package.
 */
export interface TokenProvider {
    matches(request: Request): Promise<boolean>;
    upgrade(request: Request): Promise<Request>;
}
/** A WebID's profile advertises several OIDC issuers; the host must choose one. */
export declare class AmbiguousIssuerError extends Error {
    readonly webId: string;
    readonly issuers: string[];
    constructor(webId: string, issuers: string[]);
}
/** A WebID's profile has no `solid:oidcIssuer` — it cannot be used for Solid login. */
export declare class NoSolidIssuerError extends Error {
    readonly webId: string;
    constructor(webId: string);
}
/** The supplied input is not a usable WebID URL. */
export declare class InvalidWebIdError extends Error {
    constructor(input: string, reason: string);
}
/**
 * `login()` was called but no `authFlow` (the interactive popup driver) was supplied
 * at construction. `authFlow` is OPTIONAL — a restore-only consumer can omit it — but
 * the INTERACTIVE login flow needs it to drive the authorization-code popup. Construct
 * the controller with an `authFlow` to use `login()`.
 */
export declare class MissingAuthFlowError extends Error {
    constructor();
}
/** Pick one issuer from several advertised on a profile (the user chooses). */
export type ChooseIssuerCallback = (issuers: string[], webId: string) => Promise<string>;
/**
 * Options for {@link createSolidAuth}.
 *
 * DELIBERATELY ABSENT (the login-stall guarantee): there is NO `oauthFetch`
 * option. Every OIDC hop (discovery / registration / token grants / the silent-
 * restore grant) is pinned to the pristine {@link publicFetch} unconditionally —
 * a caller cannot route the engine's own token traffic through a patched global,
 * so the re-entrant single-flight deadlock (bead suite-tracker-8575) cannot be
 * configured back in.
 */
export interface SolidAuthConfig {
    /**
     * The interactive popup driver: anything exposing a compatible
     * `getCode(authUri, signal)` (e.g. @solid/reactive-authentication's
     * <authorization-code-flow> element, or a plain function wrapper).
     *
     * OPTIONAL: it is needed ONLY by interactive {@link SolidAuthController.login}. A
     * RESTORE-ONLY consumer (one that constructs the controller purely to silently
     * restore a persisted session on load, never calling `login()`) does not need a
     * popup driver and may omit it. Calling `login()` WITHOUT an `authFlow` throws a
     * targeted {@link MissingAuthFlowError} so the misconfiguration is clear.
     */
    authFlow?: {
        getCode: GetCodeCallback;
    };
    /**
     * The OAuth redirect/callback URI this client is registered with. Must be the
     * page that does `opener.postMessage(location.href)` (see the reactive-auth
     * skill) and must be listed in the Client Identifier Document when {@link clientId}
     * is set.
     */
    callbackUri: string;
    /**
     * A Solid-OIDC Client Identifier Document URL. When set, login + restore run as
     * a public client whose `client_id` IS this URL (stable consent-screen name).
     * When absent, dynamic client registration is used (dev fallback; throwaway).
     */
    clientId?: string;
    /**
     * Pick an issuer when a profile advertises several. Default: throw
     * {@link AmbiguousIssuerError} (never silently pick the first); a single issuer
     * is always used directly.
     */
    chooseIssuer?: ChooseIssuerCallback;
    /**
     * The IndexedDB database name for the persisted-session store. MUST be unique
     * per app on a shared origin. Defaults to a generic name; pass your app's.
     */
    dbName?: string;
    /**
     * The localStorage key for the SILENT-RESTORE pointer (the single last-active
     * WebID→issuer pointer that selects which issuer to restore on load). App-specific.
     * Cleared on logout. Distinct from the recent-accounts list below.
     */
    rememberedAccountsKey?: string;
    /**
     * The localStorage key for the RECENT-ACCOUNTS list — the credential-free history
     * of previously-used WebIDs (most-recent-first, deduplicated) powering the
     * returning-user affordance. This list SURVIVES logout (logout clears the session +
     * the restore pointer, NOT the account memory). App-specific; defaults to a generic
     * name derived from {@link rememberedAccountsKey} when omitted.
     */
    recentAccountsKey?: string;
    /**
     * Allow oauth4webapi insecure requests for `localhost`/`127.0.0.1` issuers only
     * (dev CSS over HTTP). Remote HTTPS issuers stay strict. Default false.
     */
    allowInsecureLoopback?: boolean;
    /**
     * Patch `globalThis.fetch` so EVERY plain `fetch` upgrades on 401 (reactive-auth's
     * default mode). Default FALSE here — we keep the global pristine so `publicFetch`
     * is unambiguously credential-free, and the authenticated path is the explicit
     * `authenticatedFetch` handle. Opt in only if a third-party lib that captured the
     * global must transparently authenticate.
     */
    patchGlobalFetch?: boolean;
    /**
     * The resource ORIGINS the session's DPoP-bound token may be attached to (the
     * credential boundary). `authenticatedFetch` upgrades a 401 ONLY for a request
     * whose origin is in the allowed set; every other origin is left UNAUTHENTICATED
     * (fail-closed), so the user's token is never sent to a foreign origin even if a
     * caller accidentally routes a cross-origin request through `.fetch`.
     *
     * The effective allowed set is the UNION of these explicit origins PLUS, by
     * default, the authenticated WebID's own origin and the issuer's origin (the
     * common case: a user's pod is served from their WebID's origin). Set
     * {@link includeWebIdOrigin}/{@link includeIssuerOrigin} to `false` to drop those
     * defaults and rely solely on this list. Each entry is compared by URL `origin`
     * (scheme + host + port); a non-URL entry is ignored. When the resulting set is
     * EMPTY the provider attaches the token to NOTHING (strictly fail-closed).
     *
     * Pods on a DIFFERENT host than the WebID (a valid Solid topology) MUST be listed
     * here — otherwise their 401s will not be authenticated.
     */
    allowedOrigins?: string[];
    /** Include the authenticated WebID's origin in the allowed set. Default true. */
    includeWebIdOrigin?: boolean;
    /** Include the issuer's origin in the allowed set. Default true. */
    includeIssuerOrigin?: boolean;
    /**
     * The session store implementation. Defaults to an {@link IndexedDbSessionStore}
     * (or an in-memory no-op when IndexedDB is unavailable). Test seam.
     */
    store?: SessionStore;
    /**
     * Override the fetch used to dereference the public WebID profile. Defaults to
     * the pristine `publicFetch` (captured before any patching) — the profile read
     * stays provably out of the reactive-auth loop. Test seam.
     */
    profileFetch?: typeof fetch;
    /**
     * Inject a KNOWN-PRISTINE native fetch to use as `publicFetch` (the credential-
     * free / foreign-origin boundary). By default the controller uses the snapshot
     * this module took at LOAD time (before any patching). Pass this ONLY if you are
     * constructing the controller after the global `fetch` was already patched and you
     * hold a reference to the original — otherwise the default is correct and safer.
     */
    publicFetch?: typeof fetch;
}
/** How {@link computeAllowedOrigins} derives the default WebID/issuer origins. */
export interface AllowedOriginsInputs {
    /** Explicit allowed resource origins (any URL; compared by `origin`). */
    allowedOrigins?: string[];
    /** The authenticated WebID (its origin is included unless disabled). */
    webId?: string;
    /** The issuer URL (its origin is included unless disabled). */
    issuer?: string;
    /** Include the WebID's origin. Default true. */
    includeWebIdOrigin?: boolean;
    /** Include the issuer's origin. Default true. */
    includeIssuerOrigin?: boolean;
    /**
     * Allow `http:` origins for LOOPBACK hosts only (dev). Default false: every
     * non-`https:` origin is dropped, so the token is never attached over cleartext.
     */
    allowInsecureLoopback?: boolean;
}
/**
 * The set of resource origins a session token may be attached to — the credential
 * boundary the token provider enforces. PURE + exported so the boundary is
 * unit-tested. CLEARTEXT GUARD: a non-`https:` origin is DROPPED (so a configured
 * `http:` allowedOrigin can't make the DPoP token ride over cleartext), EXCEPT a
 * loopback `http:` origin when `allowInsecureLoopback` is set (dev). Fail-closed: an
 * unparseable entry is skipped; an empty result means the token is attached to NOTHING.
 */
export declare function computeAllowedOrigins(inputs: AllowedOriginsInputs): ReadonlySet<string>;
/**
 * Whether a request URL targets an allowed origin (the per-request credential
 * gate). PURE + exported. Fail-closed: an unparseable URL is never allowed.
 */
export declare function isOriginAllowed(allowed: ReadonlySet<string>, requestUrl: string): boolean;
/**
 * The DPoP `htu` claim for a request URL — the request URI WITHOUT its query and
 * fragment (RFC 9449 §4.2). PURE + exported. If the URL is unparseable it is
 * returned unchanged (the proof generator then sees the raw string).
 */
export declare function htuOf(requestUrl: string): string;
/**
 * Whether a 401 response is a PURE DPoP-nonce challenge — i.e. its `WWW-Authenticate`
 * carries the DPoP scheme with `error="use_dpop_nonce"` (RFC 9449 §8). PURE + exported
 * for testing.
 *
 * This is deliberately CONSERVATIVE: it returns true ONLY when the server explicitly
 * says the token was fine and only the nonce was missing. Any OTHER error (e.g.
 * `invalid_token`, expired/revoked) — or no DPoP `error` token at all — returns false,
 * so the caller force-refreshes the access token instead of looping on a stale one even
 * when the server ALSO rotated the `DPoP-Nonce`. We match the `DPoP` auth-scheme
 * challenge specifically; a `Bearer …` challenge that happens to mention the string is
 * not treated as a DPoP nonce challenge.
 */
export declare function isUseDpopNonceChallenge(response: Response): boolean;
/**
 * Parse a `WWW-Authenticate` header into its individual challenges, each with its scheme
 * and a QUOTE-AWARE map of its top-level auth-params. PURE + exported for testing.
 *
 * The grammar (RFC 9110 §11.6.1) is comma-ambiguous: commas separate BOTH auth-params
 * within a challenge AND challenges from each other; auth-params allow optional whitespace
 * around `=` (BWS); and a quoted value may itself contain commas/`=`/scheme-like words. We
 * tokenise character-by-character into atoms (a bare word, a quoted string, or a standalone
 * `=`), then walk those atoms into challenges (see the internal `tokenizeChallengeHeader`
 * and `walkChallengeAtoms` helpers). Param VALUES are unquoted (quotes stripped, escapes
 * resolved). Odd input degrades safely (the caller is conservative — only an UNAMBIGUOUS
 * DPoP `error="use_dpop_nonce"` is acted on).
 *
 * The return type is written as the INLINE structural shape (not the internal `Challenge`
 * alias) so the published `.d.ts` — and the api-extractor report — stay byte-identical to
 * the pre-refactor signature: this decomposition changes structure, never the contract.
 */
export declare function parseWwwAuthenticate(header: string): {
    scheme: string;
    params: Map<string, string>;
}[];
/** Per-issuer in-memory live session (NOT persisted beyond the refresh token). */
export interface LiveSession {
    /**
     * The controller generation that CREATED this session (login / restore). A refresh
     * uses THIS — not the current generation — so a refresh of a SUPERSEDED session
     * writes under a stale generation (skipped by the guarded store) and never
     * overwrites a newer login's credential (the roborev race).
     */
    generation: number;
    issuer: URL;
    webId: string;
    /** The current access token — REPLACED in place when refreshed (see #refresh). */
    accessToken: string;
    dpopKey: CryptoKeyPair;
    dpopHandle: oauth.DPoPHandle;
    authorizationServer: oauth.AuthorizationServer;
    client: oauth.Client;
    /**
     * The resource ORIGINS this session's token may be attached to (the credential
     * boundary the provider enforces). Computed once at session creation from the
     * options + the WebID/issuer origins. Empty = attach to nothing (fail-closed).
     */
    allowedOrigins: ReadonlySet<string>;
    /**
     * Epoch ms the access token is treated as expired (server `expires_in` minus a
     * skew), or undefined when the OP reported no lifetime. Drives proactive refresh
     * in {@link WebIdDPoPTokenProvider.upgrade}.
     */
    expiresAt?: number;
    /**
     * The DPoP-bound refresh token, present only between {@link #authenticate} and
     * {@link #persist} (it is written to the durable store, never kept in memory for
     * the session lifetime, and never logged).
     */
    refreshToken?: string;
}
/**
 * THE keystone factory: build the shared Solid login/auth object every suite app
 * uses instead of hand-rolling a token provider + session glue.
 *
 * Construction order IS the security property: the pristine native fetch is
 * captured FIRST (the module-load snapshot from ./pristine.js, unwrapped through
 * this package's own wrapper brand), and the OIDC transport (`[oauth.customFetch]`
 * on every oauth4webapi call, the silent-restore grant's `fetch`) plus the
 * profile read and the engine-owned authenticated fetch are all pinned to it
 * before any global patching can happen (`patchGlobalFetch` installs OVER that
 * same pristine base). There is no configuration that routes an OIDC hop through
 * a live read of `globalThis.fetch` — the login-stall deadlock class
 * (suite-tracker-8575) is unrepresentable, not merely warned about.
 */
export declare function createSolidAuth(options: SolidAuthConfig): SolidAuth;
/**
 * THE WebID/DPoP token provider — the shared successor to the 21 hand-forked
 * app-local `webid-token-provider.ts` copies (shared-logic upstreaming review
 * cluster A). It attaches the engine's current live session's DPoP-bound token —
 * but ONLY for a request whose origin is in the session's allowed-origins set
 * (the credential boundary). It matches a request only when there IS a live
 * session AND the request targets an allowed origin, so a 401 from a FOREIGN
 * origin is left unauthenticated — the user's token never leaks cross-origin
 * even if a caller accidentally routes a foreign request through `.fetch`. The
 * session is read live via a getter so a relogin / restore is reflected without
 * re-registering the provider. The DPoP proof is generated by the audited `dpop`
 * package (RFC 9449, incl. the `ath` access-token hash) — never hand-rolled
 * crypto. Constructed and wired by {@link createSolidAuth} (which owns the
 * WebID→issuer resolution, the OIDC flow, and the proactive refresh it drives);
 * exported for typing and advanced/direct wiring.
 */
export declare class WebIdDPoPTokenProvider implements TokenProvider {
    #private;
    constructor(getSession: () => LiveSession | undefined, refresh: (session: LiveSession) => Promise<boolean>);
    /** True only for an allowed-origin request while a session is live. */
    matches(request: Request): Promise<boolean>;
    /**
     * Record a resource server's `DPoP-Nonce` for its origin (from a 401 challenge or a
     * rotated nonce on any response), so the NEXT proof to that origin embeds it. Only
     * stored for an ALLOWED origin with a live session — we never retain a nonce for an
     * origin the token is not attached to. Returns whether the stored nonce CHANGED (so
     * the caller can decide a 401 is worth retrying with the new nonce).
     */
    rememberNonce(response: Response, request: Request): boolean;
    /**
     * Attach the session's DPoP-bound token to `request` (allowed-origin only).
     * `forceRefresh` separates the two call sites:
     *  - PROACTIVE first attach (false): refresh ONLY when a KNOWN expiry has passed —
     *    a provider that omits `expires_in` must NOT trigger a refresh on EVERY fetch
     *    (token-rotation / rate-limit risk); the existing token is attached as-is.
     *  - 401 RETRY (true): the server REJECTED the token, so refresh even when the
     *    expiry is unknown (the 401 is the proof the token is stale).
     */
    upgrade(request: Request, forceRefresh?: boolean): Promise<Request>;
}
/**
 * Validate user input as a WebID: it must parse as a URL and be **`https:`** —
 * because the WebID's origin is added to the credential boundary (the session's
 * DPoP token may be attached to it), so a cleartext `http:` WebID would let the
 * token be sent over plaintext. `http:` is allowed ONLY for a loopback host
 * (`localhost`/`127.0.0.1`/`[::1]`) and ONLY when `allowInsecureLoopback` is set
 * (dev CSS over HTTP) — every other `http:` WebID is rejected.
 */
export declare function validateWebId(input: string, allowInsecureLoopback?: boolean): string;
//# sourceMappingURL=controller.d.ts.map