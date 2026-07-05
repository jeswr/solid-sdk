/** A previously-used account, for the recent-accounts affordance. */
export interface RecentLoginAccount {
    /** The account's WebID (the canonical id, and the dedup key). */
    webId: string;
    /** A human display name (foaf:name), or the WebID if none. */
    displayName: string;
    /** An avatar URL (foaf:img / vcard:hasPhoto), if the profile has one. */
    avatarUrl?: string;
}
/** The result of a completed interactive login or a silent restore. */
export interface LoginResult {
    /** The authenticated WebID. */
    webId: string;
}
/**
 * The outcome of an on-load silent-restore attempt. `restored` means a session
 * was silently re-established from the persisted DPoP-bound refresh token (NO
 * redirect / popup / iframe); `login` means fall back to the login prompt. This
 * is the suite's silent-restore invariant — restore is fail-closed, so any
 * "could not rebuild / could not verify" path resolves to `login`, never a
 * falsely-asserted session.
 */
export type RestoreOutcome = {
    outcome: "restored";
    webId: string;
} | {
    outcome: "login";
};
/**
 * The interactive popup driver: given the OP's authorization URL, drive the user
 * interaction (popup / redirect capture) and resolve with the full CALLBACK URL
 * (carrying `code` + `state`). `signal` aborts a superseded attempt (best-effort).
 *
 * This is the same structural shape as @solid/reactive-authentication's
 * `<authorization-code-flow>` `getCode` — restated here (as that package does not
 * export the type from its entrypoint) so this core has no dependency on it. An
 * `<authorization-code-flow>` element satisfies `{ getCode }` directly.
 */
export type GetCodeCallback = (authorizationUrl: URL, signal?: AbortSignal) => Promise<string>;
/**
 * Options for {@link SolidAuth.beginRedirectLogin} — the FULL-PAGE-redirect login
 * (the App-Store / Pod-Manager `#autologin/<webid>` launch contract). Supply
 * EITHER `webId` (its issuer is resolved from the profile, and the OP is then
 * PROVEN to have authenticated as it — fail-closed) OR a bare `oidcIssuer` (used
 * directly; the OP's returned WebID is accepted after an https-scheme check).
 */
export interface BeginRedirectLoginOptions {
    /**
     * The WebID to log in as. Resolved to an issuer via its profile
     * (`solid:oidcIssuer`), and — because the launch carries only the PUBLIC WebID,
     * never a token — verified on return: the OP MUST authenticate as this exact
     * WebID or the login fails closed. Validated as an https WebID (untrusted input).
     */
    webId?: string;
    /**
     * A pre-resolved OIDC issuer to use directly (skips WebID→issuer resolution).
     * Use when the caller already knows the issuer and has no WebID to bind to; the
     * OP's returned WebID is accepted after an https-scheme check.
     */
    oidcIssuer?: string;
    /**
     * The app-root URL the broker redirects back to (must run the app so it can read
     * `?code&state` and call {@link SolidAuth.completeRedirectLogin}). It MUST be a
     * registered `redirect_uri` (listed in the Client Identifier Document for a static
     * client, or registered dynamically), and is persisted + reused VERBATIM in the
     * token exchange. Defaults to the configured `callbackUri`.
     */
    redirectUri?: string;
    /**
     * A Client Identifier Document URL to use for THIS redirect login, overriding the
     * one the auth object was constructed with. Defaults to the configured `clientId`
     * (else dynamic client registration).
     */
    clientId?: string;
    /**
     * `"none"` (silent SSO — the default for the `#autologin` deep-link path): the OP
     * returns the code without an interactive page when a live session exists, or
     * `?error=login_required` (caught fail-closed) when it does not. `"consent"` (the
     * default for a direct, user-initiated redirect login): `prompt=select_account
     * consent`, so the user can pick the account + the OP re-issues the offline_access
     * consent (a refresh token). Defaults to `"consent"`.
     */
    prompt?: "none" | "consent";
}
/**
 * The outcome of {@link SolidAuth.handleRedirect} — the one call an app makes on
 * load to drive the full-page-redirect (autologin) lifecycle:
 *  - `completed`   — a returning redirect login completed; a session is now live.
 *  - `redirecting` — a fresh `#autologin` deep-link began a redirect; the page is
 *                    navigating away (nothing else should run).
 *  - `error`       — a returning redirect failed / was declined (fail-closed; the
 *                    transient state was cleared). Fall back to the login prompt.
 *  - `none`        — no redirect activity on this load; the caller should proceed to
 *                    {@link SolidAuthController.restore}.
 */
export type RedirectOutcome = {
    outcome: "completed";
    webId: string;
} | {
    outcome: "redirecting";
} | {
    outcome: "error";
    error: string;
} | {
    outcome: "none";
};
/**
 * The structural contract an auth implementation exposes to an app / UI layer.
 * An implementation OWNS the real auth flow; a consumer owns only presentation.
 */
export interface SolidAuthController {
    /**
     * The pristine native fetch, captured before any patching of the global. NEVER
     * carries the session — the foreign-origin / public-read boundary.
     */
    readonly publicFetch: typeof fetch;
    /**
     * The session-bound authenticated fetch. Before login this equals
     * {@link publicFetch} (nothing to bind). After login it attaches the user's
     * DPoP-bound token for allowed origins only.
     */
    readonly authenticatedFetch: typeof fetch;
    /** The authenticated WebID, or null when logged out. */
    readonly webId: string | null;
    /**
     * Recent accounts for the returning-user affordance (most-recent-first,
     * deduplicated by WebID). Survives logout by design (logout clears the
     * session, not the account memory). Empty when none / unavailable.
     */
    recentAccounts(): RecentLoginAccount[];
    /**
     * Attempt a SILENT session restore on load from the persisted refresh token.
     * Resolves `restored` (logged in, no interaction) or `login` (show the prompt).
     * Fail-closed: any error resolves to `{ outcome: "login" }`, never throws.
     */
    restore(): Promise<RestoreOutcome>;
    /**
     * Run the interactive authorization-code (DPoP) login for `webId` (or, when
     * omitted, a re-login of the last/only recent account). Resolves with the
     * authenticated WebID on success; REJECTS on cancellation or failure. After
     * resolve, {@link authenticatedFetch} and {@link webId} reflect the new session.
     */
    login(webId?: string): Promise<LoginResult>;
    /**
     * Log out: clear the in-memory session AND the persisted credential, so a
     * subsequent restore falls back to login. After resolve, {@link webId} is null
     * and {@link authenticatedFetch} is the pristine fetch again.
     *
     * This is the FULL, definitive teardown — an intentional user sign-out, or a
     * DEFINITIVE auth failure (`invalid_grant` / a 401 proving the refresh token is
     * revoked). For a TRANSIENT failure (a network blip / 5xx / timeout on a
     * post-restore read) use the engine's `dropSession()` instead (see
     * {@link SolidAuth.dropSession}) — calling `logout()` there permanently deletes a
     * still-valid credential and forces a manual re-login.
     */
    logout(): Promise<void>;
}
/**
 * The full surface {@link createSolidAuth} returns: the controller contract plus
 * the resolved issuer and a session-change subscription (what the `/react`
 * SessionProvider — and any other reactive layer — hangs off).
 */
export interface SolidAuth extends SolidAuthController {
    /** The live session's issuer href, or null when logged out. */
    readonly issuer: string | null;
    /**
     * Drop the LIVE in-memory session WITHOUT deleting the durable credential or the
     * silent-restore pointer — the TRANSIENT-failure teardown. After resolve,
     * {@link SolidAuthController.webId} is null and
     * {@link SolidAuthController.authenticatedFetch} is the pristine fetch again
     * (exactly like {@link SolidAuthController.logout}), but the persisted DPoP-bound
     * refresh token AND the restore pointer SURVIVE — so the next page load (or a
     * later {@link SolidAuthController.restore} on this one) silently re-establishes
     * the session instead of forcing a manual re-login.
     *
     * WHICH TEARDOWN TO CALL (the silent-session-restore availability invariant):
     *  - `dropSession()` — a TRANSIENT failure after the session was armed (a network
     *    blip / 5xx / timeout on the app's post-restore profile/enrichment read): the
     *    credential is still good; keep it and let the next load retry.
     *  - `logout()` — an INTENTIONAL user sign-out, or a DEFINITIVE auth failure
     *    (`invalid_grant`, or a 401 proving the refresh token is revoked/expired):
     *    the credential is dead or unwanted; delete it.
     * Calling `logout()` on a transient failure permanently deletes a still-valid
     * credential — the availability regression this method exists to prevent. (The
     * engine's own restore/refresh grants already make this distinction internally:
     * a transient grant failure keeps the credential, only a definitive
     * `invalid_grant` clears it. This method extends the same distinction to the
     * teardown the APP performs around its own post-restore reads.)
     *
     * Like `logout()`, it supersedes any in-flight login/restore/refresh (their
     * results are discarded; an open login popup is aborted best-effort) and emits
     * the logged-out session change. Unlike `logout()`, it performs NO durable
     * delete, so it never rejects. Idempotent when already logged out.
     */
    dropSession(): Promise<void>;
    /**
     * Subscribe to session changes (a completed login, a completed/attempted
     * restore, a logout). The listener receives the CURRENT identity (webId null
     * when logged out). Returns an unsubscribe function. Listeners are called
     * AFTER the internal state settled, and a throwing listener never disturbs
     * the auth flow (errors are swallowed).
     */
    onSessionChange(listener: (session: {
        webId: string | null;
    }) => void): () => void;
    /**
     * Drive the full-page-redirect (autologin) lifecycle for THIS page load, from the
     * current URL + the persisted sessionStorage state. Call it once on load, BEFORE
     * {@link SolidAuthController.restore}: it inspects the URL and either COMPLETES a
     * returning redirect login (`?code&state` + a persisted record → `completed`),
     * ABORTS a declined one (`?error&state` → `error`, transient state cleared),
     * BEGINS a fresh redirect for a `#autologin/<webid>` deep-link (→ `redirecting`,
     * the page navigates away), or reports `none` (the caller then runs `restore()`).
     * Fail-closed: any failure resolves to `{ outcome: "error" }`, never throws.
     *
     * @param currentUrl the page URL to read (`?code`/`?error`/`#autologin`). Defaults
     *   to `globalThis.location.href`.
     */
    handleRedirect(currentUrl?: string): Promise<RedirectOutcome>;
    /**
     * PHASE 1: start a full-page-redirect login. Resolves the issuer (from `webId`'s
     * profile, or `oidcIssuer` directly), runs discovery + client resolution, mints an
     * EXTRACTABLE DPoP keypair + PKCE(S256) verifier + `state` + `nonce`, PERSISTS them
     * to sessionStorage, and NAVIGATES the page to the authorization endpoint. Returns
     * the authorization URL it navigated to (so a caller can override navigation via
     * the `navigate` config seam / assert it in a test). Every OIDC hop rides the
     * pristine fetch (the login-stall guarantee). DPoP-bound throughout.
     */
    beginRedirectLogin(options: BeginRedirectLoginOptions): Promise<{
        authorizationUrl: string;
    }>;
    /**
     * PHASE 2: complete a full-page-redirect login on the page the broker redirected
     * back to (carrying `?code&state`). Reads the persisted record, re-imports the DPoP
     * key, VALIDATES `state` + `nonce`, exchanges the code (DPoP-bound), ENFORCES the
     * DPoP token type + the requested-WebID match + the https-scheme guard (all
     * fail-closed BEFORE any session state is written), establishes + persists the
     * session, and CLEARS the transient sessionStorage record (success OR failure).
     * Resolves with the authenticated WebID; REJECTS on any failure, leaving NO
     * half-established session.
     *
     * @param callbackUrl the full return URL (`?code&state`). Defaults to
     *   `globalThis.location.href`.
     */
    completeRedirectLogin(callbackUrl?: string): Promise<LoginResult>;
    /** Whether a full-page-redirect login is mid-flight (a persisted record exists). */
    hasPendingRedirect(): boolean;
}
/**
 * `webId` may legitimately be a URL with a fragment (`#me`). For display we keep
 * it verbatim; this helper is only the dedup/identity comparison used by the
 * recent-accounts list and the restore WebID re-check, normalising trailing
 * whitespace but NOT case (WebIDs are case-sensitive URLs). Exported for tests.
 */
export declare function sameWebId(a: string | null | undefined, b: string | null | undefined): boolean;
//# sourceMappingURL=types.d.ts.map