import { type ReactNode } from "react";
import { type SolidAuth, type SolidAuthConfig } from "../index.js";
/** The session state machine the suite's apps share. */
export type SolidSessionStatus = "restoring" | "unauthenticated" | "authenticated";
/** What {@link useSolidSession} returns. */
export interface SolidSession {
    /** `restoring` (on-load silent restore in flight) → `authenticated` | `unauthenticated`. */
    status: SolidSessionStatus;
    /** The authenticated WebID, or null. */
    webId: string | null;
    /**
     * The session-bound fetch (attaches the DPoP token for allowed origins; the
     * pristine fetch while logged out). STABLE identity across renders — safe in
     * dependency arrays; it reads the live session on every call.
     */
    fetch: typeof fetch;
    /** The pristine, credential-free fetch (foreign-origin / public reads). */
    publicFetch: typeof fetch;
    /** Interactive login (optionally for a specific WebID). Errors surface in {@link error}. */
    login: (webId?: string) => Promise<void>;
    /** Log out (clears the persisted credential; fail-closed to logged-out). */
    logout: () => Promise<void>;
    /** The last login/logout error message, or null. Cleared on the next attempt. */
    error: string | null;
    /** The underlying core object, for advanced use (recentAccounts, issuer, …). */
    auth: SolidAuth;
}
/** Props for {@link SessionProvider}: a ready `auth` OR a `config` to build one. */
export type SessionProviderProps = {
    children?: ReactNode;
} & ({
    auth: SolidAuth;
    config?: never;
} | {
    config: SolidAuthConfig;
    auth?: never;
});
/**
 * Mount ONE of these at the app root. It creates (or adopts) the core
 * {@link SolidAuth}, silently restores on load, and provides
 * {@link useSolidSession} to the tree.
 */
export declare function SessionProvider(props: SessionProviderProps): ReactNode;
/**
 * The session hook. Must be used under a {@link SessionProvider}; throws a
 * targeted error otherwise (the classic silent-null footgun).
 */
export declare function useSolidSession(): SolidSession;
export type { SolidAuth, SolidAuthConfig } from "../index.js";
//# sourceMappingURL=index.d.ts.map