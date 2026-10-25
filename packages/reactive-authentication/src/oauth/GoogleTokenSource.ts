import { SessionSupersededError } from "../SessionSupersededError.js";
import {
  type AccessToken,
  type AccessTokenRequest,
  type AccessTokenSource,
  AuthorizationFailedError,
  InteractionRequiredError,
} from "./AccessTokenSource.js";

/*
 * Structural types for the parts of Google Identity Services (`google.accounts.oauth2`, token model) used here.
 * https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

export interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number | string;
  readonly scope?: string;
  readonly token_type?: string;
  readonly error?: string;
  readonly error_description?: string;
}

export interface GoogleErrorResponse {
  /** `popup_failed_to_open`, `popup_closed` or `unknown`. */
  readonly type: string;
  readonly message?: string;
}

/** Google's `prompt` values for the token model. */
export type GooglePrompt = "" | "none" | "consent" | "select_account";

export interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: GoogleErrorResponse) => void;
  prompt?: GooglePrompt;
  login_hint?: string;
  include_granted_scopes?: boolean;
}

export interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: GooglePrompt }): void;
}

export interface GoogleRevocationResponse {
  readonly successful?: boolean;
  readonly error?: string;
  readonly error_description?: string;
}

/** The injected `google.accounts.oauth2` namespace (load the GIS script yourself). */
export interface GoogleOAuth2 {
  initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
  hasGrantedAllScopes(
    response: GoogleTokenResponse,
    firstScope: string,
    ...restScopes: string[]
  ): boolean;
  /** `done` is optional in Google's reference; this source always passes one to learn the outcome. */
  revoke?(accessToken: string, done: (response?: GoogleRevocationResponse) => void): void;
}

export interface GoogleTokenSourceOptions {
  readonly clientId: string;
  /** The Google API scopes this source's tokens are for (e.g. `https://www.googleapis.com/auth/drive.readonly`). */
  readonly scopes: readonly string[];
  /** `prompt` for the first authorization (e.g. `consent`, `select_account`); later renewals send none. */
  readonly prompt?: GooglePrompt;
  /**
   * `login_hint`: email or ID of the expected account. Advisory — Google may still let the user pick another
   * account, and the access token does not tell you which one; it is not account enforcement.
   */
  readonly loginHint?: string;
  /** Called when a reactive request needs a click-driven {@link GoogleTokenSource.authorize}. */
  readonly onInteractionRequired?: (source: GoogleTokenSource) => void;
  /**
   * Also revoke the access token at Google on {@link GoogleTokenSource.forget} (after local state is cleared);
   * `forget` then rejects if revocation is unavailable, fails or does not complete. @defaultValue false
   */
  readonly revokeOnForget?: boolean;
}

/** One authorization: its own SDK client and callbacks, so no callback can settle another authorization. */
type Operation = { settle: (token: AccessToken | undefined, error?: unknown) => void };

const revocationTimeoutMs = 10_000;

/** Tokens this close to expiry are treated as expired; Google tokens last about an hour. */
const expirySkewMs = 60_000;

/**
 * Google API access through Google Identity Services' token model: the SDK runs the OAuth popup; this source
 * keeps the resulting access token in memory for {@link OAuthBearerTokenProvider}.
 *
 * Google's browser token model has no refresh token: new tokens need {@link authorize} from a user gesture.
 * A reactive retry therefore never opens a popup; it uses the cached token or fails with
 * {@link InteractionRequiredError} (after calling `onInteractionRequired`) so the application can ask for a
 * click. Access tokens authorize API calls only — they are not proof of who signed in to your app; use
 * Sign in with Google (ID tokens verified by your backend) or {@link OAuthCodeSource} with `openid` for that.
 */
export class GoogleTokenSource implements AccessTokenSource {
  readonly #google: GoogleOAuth2;
  readonly #options: GoogleTokenSourceOptions;
  #token: AccessToken | undefined;
  #current: Operation | undefined;
  #prompted = false;
  readonly id: string;

  constructor(google: GoogleOAuth2, options: GoogleTokenSourceOptions) {
    if (options.scopes.length === 0) throw new TypeError("At least one scope is required");
    this.#google = google;
    this.#options = options;
    this.id = JSON.stringify([
      "google",
      options.clientId,
      [...options.scopes].sort(),
      options.loginHint ?? "",
    ]);
  }

  /**
   * Requests a token with Google's popup. **Call from a user gesture** (e.g. a click handler): the SDK
   * request is made synchronously, before this method awaits anything, so browsers allow the popup. While
   * one authorization is open, another is refused (`interaction_in_progress`) rather than opening a second
   * popup. Aborting `signal` settles immediately; the SDK's eventual callback is then ignored.
   */
  authorize(signal?: AbortSignal): Promise<AccessToken> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.#current !== undefined) {
      return Promise.reject(
        new AuthorizationFailedError(
          "interaction_in_progress",
          "A Google authorization is already in progress",
        ),
      );
    }

    const { promise, resolve, reject } = Promise.withResolvers<AccessToken>();
    const operation: Operation = {
      settle: (token, error) => {
        if (this.#current !== operation) return; // late: aborted, forgotten or already settled
        this.#current = undefined;
        signal?.removeEventListener("abort", onAbort);
        if (token === undefined) return reject(error);
        this.#token = token;
        resolve(token);
      },
    };
    const onAbort = () => operation.settle(undefined, signal!.reason);
    this.#current = operation;
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const client = this.#google.initTokenClient({
        client_id: this.#options.clientId,
        scope: this.#options.scopes.join(" "),
        callback: (response) => this.#onResponse(operation, response),
        error_callback: (error) =>
          operation.settle(
            undefined,
            new AuthorizationFailedError(
              error.type,
              error.message ?? `Google authorization failed: ${error.type}`,
              error,
            ),
          ),
        ...(this.#options.loginHint === undefined ? {} : { login_hint: this.#options.loginHint }),
      });
      const prompt = this.#prompted ? undefined : this.#options.prompt;
      this.#prompted = true;
      client.requestAccessToken(prompt === undefined ? {} : { prompt });
    } catch (error) {
      operation.settle(
        undefined,
        new AuthorizationFailedError(
          "sdk_error",
          "Google Identity Services could not start the request",
          error,
        ),
      );
    }
    return promise;
  }

  async getAccessToken({ signal, rejectedToken }: AccessTokenRequest): Promise<AccessToken> {
    signal.throwIfAborted();
    if (rejectedToken !== undefined && this.#token?.token === rejectedToken)
      this.#token = undefined;
    const token = this.#token;
    if (
      token !== undefined &&
      token.expiresAt !== undefined &&
      Date.now() < token.expiresAt - expirySkewMs
    )
      return token;
    this.#token = undefined;
    this.#options.onInteractionRequired?.(this);
    throw new InteractionRequiredError(this.id, () => this.authorize());
  }

  /**
   * Local logout: drops the token and rejects the authorization in flight. With `revokeOnForget`, then asks
   * Google to revoke the token and reports the outcome (`invalid_token` means it was already expired or
   * revoked, which counts as done).
   */
  async forget(): Promise<void> {
    const token = this.#token;
    this.#token = undefined;
    this.#prompted = false;
    this.#current?.settle(undefined, new SessionSupersededError());
    if (token === undefined || this.#options.revokeOnForget !== true) return;

    const revoke = this.#google.revoke;
    if (revoke === undefined)
      throw new AuthorizationFailedError(
        "revocation_unavailable",
        "Local logout done; this Google SDK cannot revoke tokens",
      );
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(
      () =>
        reject(
          new AuthorizationFailedError(
            "revocation_timeout",
            "Local logout done; Google did not confirm revocation",
          ),
        ),
      revocationTimeoutMs,
    );
    try {
      revoke.call(this.#google, token.token, (response) => {
        if (response?.successful === false && response.error !== "invalid_token") {
          reject(
            new AuthorizationFailedError(
              response.error ?? "revocation_failed",
              response.error_description ?? "Local logout done; Google did not revoke the token",
            ),
          );
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(
        new AuthorizationFailedError(
          "revocation_failed",
          "Local logout done; Google revocation could not start",
          error,
        ),
      );
    }
    try {
      await promise;
    } finally {
      clearTimeout(timer); // every settling path, including a synchronous SDK throw
    }
  }

  #onResponse(operation: Operation, response: GoogleTokenResponse) {
    if (response.error !== undefined) {
      return operation.settle(
        undefined,
        new AuthorizationFailedError(
          response.error,
          response.error_description ?? `Google authorization failed: ${response.error}`,
        ),
      );
    }
    const expiresIn = Number(response.expires_in);
    if (
      !response.access_token ||
      response.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return operation.settle(
        undefined,
        new AuthorizationFailedError(
          "invalid_token_response",
          "Google returned no usable Bearer access token with a lifetime",
        ),
      );
    }
    const [first, ...rest] = this.#options.scopes;
    // The user may grant only some scopes; the SDK knows scope aliases, so ask it.
    if (!this.#google.hasGrantedAllScopes(response, first!, ...rest)) {
      return operation.settle(
        undefined,
        new AuthorizationFailedError(
          "partial_grant",
          "Not all requested Google scopes were granted",
        ),
      );
    }
    operation.settle({ token: response.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  }
}
