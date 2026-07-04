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
     * Subscribe to session changes (a completed login, a completed/attempted
     * restore, a logout). The listener receives the CURRENT identity (webId null
     * when logged out). Returns an unsubscribe function. Listeners are called
     * AFTER the internal state settled, and a throwing listener never disturbs
     * the auth flow (errors are swallowed).
     */
    onSessionChange(listener: (session: {
        webId: string | null;
    }) => void): () => void;
}
/**
 * `webId` may legitimately be a URL with a fragment (`#me`). For display we keep
 * it verbatim; this helper is only the dedup/identity comparison used by the
 * recent-accounts list and the restore WebID re-check, normalising trailing
 * whitespace but NOT case (WebIDs are case-sensitive URLs). Exported for tests.
 */
export declare function sameWebId(a: string | null | undefined, b: string | null | undefined): boolean;
//# sourceMappingURL=types.d.ts.map