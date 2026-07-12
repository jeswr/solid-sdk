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
 * The structural contract the element drives. An implementation OWNS the real
 * auth flow; the element owns only presentation + event emission. Every method
 * is async and MUST be safe to call from the element's render lifecycle.
 *
 * The two fetches are the credential-leak boundary:
 *   - `authenticatedFetch` — the session-bound fetch (after login). Sends the
 *     DPoP-bound token. Use ONLY for the user's own origin(s).
 *   - `publicFetch` — the PRISTINE native fetch captured BEFORE reactive-auth
 *     patches `globalThis.fetch`. Carries NO credentials and never upgrades on a
 *     401. Use for foreign-origin / public reads so a session token can never
 *     leak cross-origin.
 * Before login both are the pristine fetch (there is no session to bind).
 */
export interface LoginController {
    /**
     * The pristine native fetch, captured before any patching of the global. NEVER
     * carries the session — the foreign-origin / public-read boundary.
     */
    readonly publicFetch: typeof fetch;
    /**
     * The session-bound authenticated fetch. Before login this equals
     * {@link publicFetch} (nothing to bind). After login it attaches the user's
     * DPoP-bound token. The element exposes this as its `.fetch`.
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
     * authenticated WebID on success; REJECTS on cancellation or failure (the
     * element surfaces the message). After resolve, {@link authenticatedFetch} and
     * {@link webId} reflect the new session.
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
 * `webId` may legitimately be a URL with a fragment (`#me`). For display we keep
 * it verbatim; this helper is only the dedup/identity comparison used by the
 * recent-accounts list and the restore WebID re-check, normalising trailing
 * whitespace but NOT case (WebIDs are case-sensitive URLs). Exported for tests.
 */
export declare function sameWebId(a: string | null | undefined, b: string | null | undefined): boolean;
