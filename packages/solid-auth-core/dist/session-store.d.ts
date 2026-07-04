/**
 * The token-endpoint client-authentication method a persisted session's refresh
 * grant must use (RFC 6749 §2.3 / OIDC Core §9). Absent/`"none"` for the common
 * public-client case.
 */
export type TokenEndpointAuthMethod = "none" | "client_secret_basic" | "client_secret_post";
/**
 * A persisted (restorable) session credential: the DPoP-bound refresh token +
 * the non-extractable key pair that sender-constrains it, keyed by issuer.
 * (Structural mirror of @jeswr/solid-session-restore's `PersistedSession`.)
 */
export interface PersistedSession {
    /** The OIDC issuer this session belongs to (the store key). */
    issuer: string;
    /** The authenticated WebID (ID-token `webid`/`sub`), for instant UI restore. */
    webId: string;
    /** The DPoP-bound refresh token (unusable without {@link dpopKey}). */
    refreshToken: string;
    /**
     * The DPoP key pair that sender-constrains {@link refreshToken} — persisted as
     * a structured-cloneable CryptoKeyPair whose private key is `extractable:
     * false`, so the raw bytes never leave the browser's key store.
     */
    dpopKey: CryptoKeyPair;
    /** The Client Identifier Document URL used, when the session was static-client. */
    clientId?: string;
    /** The token-endpoint auth method the refresh grant must use (default `none`). */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
    /** The CONFIDENTIAL client's secret — rare (ESS dynamic path); never logged. */
    clientSecret?: string;
    /** Epoch ms the (now-discarded) access token would have expired — advisory. */
    expiresAt?: number;
}
/**
 * The durable, issuer-keyed credential store seam (structural mirror of
 * @jeswr/solid-session-restore's `SessionStore`). The default is that package's
 * IndexedDB store; inject your own for tests / non-browser hosts. An injected
 * store is assumed DURABLE (survives a reload) — brand it `durable: false`
 * (a non-typed own property) if it is not, so the engine suppresses the
 * silent-restore pointer for it.
 */
export interface SessionStore {
    get(issuer: string): Promise<PersistedSession | undefined>;
    put(session: PersistedSession): Promise<void>;
    delete(issuer: string): Promise<void>;
}
//# sourceMappingURL=session-store.d.ts.map