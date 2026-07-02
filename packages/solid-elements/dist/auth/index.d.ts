import { type SessionStore } from "@jeswr/solid-session-restore";
import type { AuthorizationCodeFlow, GetCodeCallback } from "@solid/reactive-authentication";
import type { LoginController } from "../login-controller.js";
import { AmbiguousIssuerError, InvalidWebIdError, MissingAuthFlowError, NoSolidIssuerError } from "./errors.js";
import { isUseDpopNonceChallenge, parseWwwAuthenticate } from "./www-authenticate.js";
export { AmbiguousIssuerError, InvalidWebIdError, MissingAuthFlowError, NoSolidIssuerError };
/** Pick one issuer from several advertised on a profile (the user chooses). */
export type ChooseIssuerCallback = (issuers: string[], webId: string) => Promise<string>;
/** Options for {@link createReactiveAuthController}. */
export interface ReactiveAuthControllerOptions {
    /**
     * The <authorization-code-flow> element (or anything exposing a compatible
     * `getCode(authUri, signal)`), which drives the interactive popup.
     *
     * OPTIONAL: it is needed ONLY by interactive {@link LoginController.login}. A
     * RESTORE-ONLY consumer (one that constructs the controller purely to silently
     * restore a persisted session on load, never calling `login()`) does not need a
     * popup driver and may omit it. Calling `login()` WITHOUT an `authFlow` throws a
     * targeted {@link MissingAuthFlowError} so the misconfiguration is clear.
     */
    authFlow?: Pick<AuthorizationCodeFlow, "getCode"> | {
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
export { isUseDpopNonceChallenge, parseWwwAuthenticate };
/**
 * Build a {@link LoginController} that wires @solid/reactive-authentication +
 * @jeswr/solid-session-restore for <jeswr-login-panel>. Constructing this captures
 * the pristine native fetch BEFORE the ReactiveFetchManager exists, so `publicFetch`
 * is guaranteed credential-free.
 */
export declare function createReactiveAuthController(options: ReactiveAuthControllerOptions): LoginController;
/**
 * Validate user input as a WebID: it must parse as a URL and be **`https:`** —
 * because the WebID's origin is added to the credential boundary (the session's
 * DPoP token may be attached to it), so a cleartext `http:` WebID would let the
 * token be sent over plaintext. `http:` is allowed ONLY for a loopback host
 * (`localhost`/`127.0.0.1`/`[::1]`) and ONLY when `allowInsecureLoopback` is set
 * (dev CSS over HTTP) — every other `http:` WebID is rejected.
 */
export declare function validateWebId(input: string, allowInsecureLoopback?: boolean): string;
export type { LoginController, LoginResult, RecentLoginAccount, RestoreOutcome, } from "../login-controller.js";
export type { InstallProactiveAuthFetchOptions, ProactiveAllowedOriginsInputs, ProactiveFetchConfig, ProactiveFetchInstall, ProactiveFetchState, ProactiveTokenProvider, } from "./proactive-fetch.js";
export { __resetProactiveFetchForTests, deriveProactiveAllowedOrigins, installProactiveAuthFetch, isProviderOAuthRequest, isReactiveAuthResetError, proactiveAuthenticatedFetch, } from "./proactive-fetch.js";
