import type { JWK } from "jose";
import type { AuthCodeSession, ClientRegistration, OidcProviderMetadata } from "./authCode.js";
/** Bump when the on-disk shape changes incompatibly. */
declare const STORE_VERSION: 1;
/** The JSON-serialisable form of an {@link AuthCodeSession}. */
export interface StoredSession {
    readonly version: typeof STORE_VERSION;
    /** DPoP keypair as a private JWK — reused on refresh to keep the `jkt` binding (see file header). */
    readonly keyPairJwk: JWK;
    readonly accessToken: string;
    /** epoch ms after which the access token is considered expired. */
    readonly expiresAt: number;
    readonly refreshToken?: string;
    readonly nonce?: string;
    readonly client: ClientRegistration;
    readonly providerMetadata: OidcProviderMetadata;
}
/** Serialise a live session to its on-disk JSON shape (keypair exported as a private JWK). */
export declare function serializeSession(session: AuthCodeSession): Promise<StoredSession>;
/** Reconstruct a live {@link AuthCodeSession} (keypair rebuilt from the stored private JWK). */
export declare function deserializeSession(stored: StoredSession): Promise<AuthCodeSession>;
/**
 * Persist a session to `path` as `0600` JSON. Creates the parent directory if needed. The chmod is
 * applied AFTER the write (and the write opens with mode `0600`) so the secret is never briefly
 * world-readable.
 */
export declare function saveSession(path: string, session: AuthCodeSession): Promise<void>;
/** Load a persisted session from `path`, or `undefined` if the file does not exist. Throws on corruption. */
export declare function loadSession(path: string): Promise<AuthCodeSession | undefined>;
export {};
//# sourceMappingURL=sessionStore.d.ts.map