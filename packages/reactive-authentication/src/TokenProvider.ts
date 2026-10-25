import type { ChallengeContext } from "./challenge.js";

/**
 * Upgrades a request that was answered with 401 so that it carries credentials.
 *
 * Providers are consulted in order; the first whose {@link matches} resolves `true` handles the request.
 * The challenge argument is optional so that providers written for earlier versions keep working.
 */
export interface TokenProvider {
  /** Whether this provider can answer the challenge (e.g. by scheme or challenge parameters). */
  matches(request: Request, challenge?: ChallengeContext): Promise<boolean>;

  /**
   * Returns a copy of `request` with credentials attached. Must honour `request.signal`, and must attach
   * credentials only for `request.url` (e.g. a fresh DPoP proof per request).
   */
  upgrade(request: Request, challenge?: ChallengeContext): Promise<Request>;

  /**
   * Marks the credentials attached to `upgraded` as rejected so the next {@link upgrade} renews them
   * (refresh grant or new authorization). Implementations must ignore the call when the cached
   * credentials have already been replaced by a concurrent renewal.
   */
  invalidate?(upgraded: Request, rejection: ChallengeContext): Promise<void>;

  /** Discards all credentials held by this provider (logout / account switch). */
  forget?(): Promise<void>;
}
