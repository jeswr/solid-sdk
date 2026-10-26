import { CredentialBoundary } from "../CredentialBoundary.js";
import type { ChallengeContext } from "../challenge.js";
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";
import { SessionFence } from "../SessionFence.js";
import type { TokenProvider } from "../TokenProvider.js";
import type { AccessToken, AccessTokenSource } from "./AccessTokenSource.js";

export interface OAuthBearerTokenProviderOptions {
  /**
   * The API URLs this provider's tokens are for (e.g. `https://www.googleapis.com/drive/`). Required and
   * checked in `matches`, `upgrade` and immediately before transport initiation, independently of the
   * manager's boundary, so tokens for one API never reach another.
   */
  readonly resources: CredentialBoundary | Iterable<string | URL>;

  /** Orders token use against logout. Defaults to a private fence. */
  readonly fence?: SessionFence;
}

/**
 * Standard OAuth 2.0 Bearer access (RFC 6750) for ordinary APIs (Google, Microsoft Graph, any OAuth-protected
 * API): on a 401 from one of its configured resources, attaches `Authorization: Bearer` from its
 * {@link AccessTokenSource}. Only unauthenticated or `Bearer` challenges are answered (never DPoP or UMA),
 * and nothing is taken from the challenge: the issuer, audience and scopes are the source's fixed
 * configuration. Rejected tokens are renewed once via `rejectedToken`; logout ignores late results.
 */
export class OAuthBearerTokenProvider implements TokenProvider {
  readonly #source: AccessTokenSource;
  readonly #resources: CredentialBoundary;
  readonly #fence: SessionFence;
  #rejected: string | undefined;

  constructor(source: AccessTokenSource, options: OAuthBearerTokenProviderOptions) {
    this.#source = source;
    this.#resources =
      options.resources instanceof CredentialBoundary
        ? options.resources
        : new CredentialBoundary(options.resources);
    if (this.#resources.entries.length === 0)
      throw new TypeError("OAuthBearerTokenProvider needs at least one resource");
    this.#fence =
      options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, { broadcast: false });
  }

  async matches(request: Request, challenge?: ChallengeContext): Promise<boolean> {
    if (!this.#resources.allows(request.url)) return false;
    const challenges = challenge?.challenges ?? [];
    return challenges.length === 0 || challenges.some((c) => c.scheme === "bearer");
  }

  async upgrade(request: Request): Promise<Request> {
    this.assertAllowed(request);
    // The fence signal is captured before any await, so a logout from here on aborts this upgrade.
    const signal = AbortSignal.any([request.signal, this.#fence.signal]);
    const generation = await this.#fence.generation();

    const token = await this.#token(signal);
    signal.throwIfAborted();
    await this.#fence.assertCurrent(generation);
    this.assertAllowed(request);

    const headers = new Headers(request.headers);
    headers.delete("DPoP"); // a stale proof bound to another token must not accompany a Bearer token
    headers.set("Authorization", `Bearer ${token.token}`);
    return new Request(request, { headers });
  }

  assertAllowed(request: Request): void {
    if (!this.#resources.allows(request.url))
      throw new ReactiveAuthenticationError(
        `${request.url} is not a resource of ${this.#source.id}`,
      );
  }

  async invalidate(upgraded: Request): Promise<void> {
    const token = upgraded.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (token !== undefined) this.#rejected = token;
  }

  /**
   * Supersedes the fence (aborting in-flight upgrades, so late tokens are never attached), then lets the
   * source clean up. The source runs outside the fence's lock: it may share the same fence (and take it).
   */
  async forget(): Promise<void> {
    this.#rejected = undefined;
    await this.#fence.supersede();
    await this.#source.forget?.();
  }

  async #token(signal: AbortSignal): Promise<AccessToken> {
    const rejected = this.#rejected;
    let token = await this.#source.getAccessToken({
      signal,
      ...(rejected === undefined ? {} : { rejectedToken: rejected }),
    });
    if (token.token === rejected || expired(token)) {
      token = await this.#source.getAccessToken({ signal, rejectedToken: token.token });
    }
    if (token.token === rejected || expired(token)) {
      throw new ReactiveAuthenticationError(
        `${this.#source.id} returned an expired or rejected token`,
      );
    }
    if (this.#rejected === rejected) this.#rejected = undefined;
    return token;
  }
}

/** Sources renew ahead of expiry; the provider only refuses tokens already past it. */
function expired(token: AccessToken): boolean {
  return token.expiresAt !== undefined && Date.now() >= token.expiresAt;
}
