import { type SessionStore } from "@jeswr/solid-session-restore";
import type { AuthorizationCodeFlow, GetCodeCallback } from "@solid/reactive-authentication";
import type { LoginController } from "../login-controller.js";
import { AmbiguousIssuerError, InvalidWebIdError, MissingAuthFlowError, NoSolidIssuerError } from "./errors.js";
import { computeAllowedOrigins, htuOf, isOriginAllowed, validateWebId } from "./origin.js";
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
export type { AllowedOriginsInputs } from "./origin.js";
export { computeAllowedOrigins, htuOf, isOriginAllowed, isUseDpopNonceChallenge, parseWwwAuthenticate, validateWebId, };
/**
 * Build a {@link LoginController} that wires @solid/reactive-authentication +
 * @jeswr/solid-session-restore for <jeswr-login-panel>. Constructing this captures
 * the pristine native fetch BEFORE the ReactiveFetchManager exists, so `publicFetch`
 * is guaranteed credential-free.
 */
export declare function createReactiveAuthController(options: ReactiveAuthControllerOptions): LoginController;
export type { LoginController, LoginResult, RecentLoginAccount, RestoreOutcome, } from "../login-controller.js";
export type { InstallProactiveAuthFetchOptions, ProactiveAllowedOriginsInputs, ProactiveFetchConfig, ProactiveFetchInstall, ProactiveFetchState, ProactiveTokenProvider, } from "./proactive-fetch.js";
export { __resetProactiveFetchForTests, deriveProactiveAllowedOrigins, installProactiveAuthFetch, isProviderOAuthRequest, isReactiveAuthResetError, proactiveAuthenticatedFetch, } from "./proactive-fetch.js";
