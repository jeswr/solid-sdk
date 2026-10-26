// AUTHORED-BY Codex GPT-6.1-Sol
import type { SessionFence } from "../SessionFence.js";

/** An authentication credential to present to an authorization server as an RFC 8693 subject token. */
export interface SubjectCredential {
  /** The serialized credential (a JWT, or a base64url-encoded SAML assertion). */
  readonly token: string;

  /** The RFC 8693 `subject_token_type`, e.g. {@link TokenType.idToken}. */
  readonly tokenType: string;

  /** Client identifier to present with the token request (`client_id`). */
  readonly clientId: string;

  /** When the credential stops being valid (ms since epoch), if known. */
  readonly expiresAt?: number;
}

/** What a credential is for. */
export interface CredentialRequest {
  /** The authorization server that will receive the credential (`as_uri`). */
  readonly authorizationServer: URL;

  /** The storage the access token is for (`realm`, sent as `resource`). */
  readonly resource: URL;

  readonly signal: AbortSignal;

  /** Generation captured by the enclosing operation; credential sessions must use the same fence. */
  readonly expectedGeneration?: number;
}

/**
 * Acquires authentication credentials (the "who am I" part), independently of how they are exchanged
 * for access tokens and how requests are upgraded. Implementations exist for each LWS authentication
 * suite; any other token type can be supported by implementing this interface.
 */
export interface CredentialSource {
  /**
   * A stable, secret-free identifier of the credential context (e.g. subject, issuer and client), used
   * to key access-token caches so different identities never share tokens.
   */
  readonly id: string;

  /** Session-backed sources require the enclosing provider to use this same fence. */
  readonly fence?: SessionFence;

  getCredential(request: CredentialRequest): Promise<SubjectCredential>;

  /** Discards cached credentials (logout). */
  forget?(): Promise<void>;
}
