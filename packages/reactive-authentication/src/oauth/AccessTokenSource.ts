import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";

/** An opaque OAuth access token. Its contents are never inspected: it proves nothing about identity. */
export interface AccessToken {
  readonly token: string;
  /** Expiry (ms since epoch), when known. */
  readonly expiresAt?: number;
}

export interface AccessTokenRequest {
  readonly signal: AbortSignal;
  /**
   * The resource server rejected `rejectedToken`: return a different token (refresh, force-refresh the SDK
   * cache), never the rejected one.
   */
  readonly rejectedToken?: string;
}

/**
 * Obtains access tokens for one configured client, API audience/resource and scope set. Sources wrap an
 * OAuth flow (see {@link OAuthCodeSource}) or an official SDK (Google Identity Services, MSAL), which keep
 * their own token caches.
 */
export interface AccessTokenSource {
  /** Stable, secret-free identity of the configuration (provider, client, scopes, account). */
  readonly id: string;

  getAccessToken(request: AccessTokenRequest): Promise<AccessToken>;

  /** Local logout: drop tokens and ignore results of operations already in progress. */
  forget?(): Promise<void>;
}

/**
 * A token can only be obtained with user interaction (a popup opened from a click, or a redirect), which a
 * reactive retry after an awaited `fetch` cannot reliably start. Call {@link authorize} from a user gesture,
 * then retry the request.
 */
export class InteractionRequiredError extends ReactiveAuthenticationError {
  constructor(
    readonly source: string,
    readonly authorize: () => Promise<unknown>,
    cause?: unknown,
  ) {
    super(`User interaction required to obtain an access token (${source})`, cause);
    this.name = "InteractionRequiredError";
  }
}

/** The user closed the popup, it could not open, or the provider reported an OAuth error. */
export class AuthorizationFailedError extends ReactiveAuthenticationError {
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "AuthorizationFailedError";
  }
}
