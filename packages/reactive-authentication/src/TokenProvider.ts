import type { ChallengeContext } from "./challenge.js";
import type { SessionFence } from "./SessionFence.js";

/**
 * Upgrades a request that was answered with 401 so that it carries credentials.
 *
 * Providers are consulted in order; the first whose {@link matches} resolves `true` handles the request.
 * The challenge argument is optional so that providers written for earlier versions keep working.
 */
export interface TokenProvider {
  /**
   * The fence used by this provider's upgrades. The client captures its generation before upgrading
   * and validates it immediately before sending. Share this same fence with the client to order
   * transport initiation against logout across realms under the shared fence lock.
   */
  readonly fence?: SessionFence;

  /** Whether this provider can answer the challenge (e.g. by scheme or challenge parameters). */
  matches(request: Request, challenge?: ChallengeContext): Promise<boolean>;

  /**
   * Returns a copy of `request` with credentials attached. Must honour `request.signal`, and must attach
   * credentials only for `request.url` (e.g. a fresh DPoP proof per request). The returned request must
   * retain cancellation for the provider's captured generation, including after this method resolves.
   */
  upgrade(request: Request, challenge?: ChallengeContext): Promise<Request>;

  /**
   * Throws if this provider's current resource policy forbids sending `request`. The client calls this
   * synchronous guard immediately before transport initiation, after cleanup and fence validation.
   */
  assertAllowed?(request: Request): void;

  /**
   * Marks the credentials attached to `upgraded` as rejected so the next {@link upgrade} renews them
   * (refresh grant or new authorization). Implementations must ignore the call when the cached
   * credentials have already been replaced by a concurrent renewal.
   */
  invalidate?(upgraded: Request, rejection: ChallengeContext): Promise<void>;

  /** Discards all credentials held by this provider (logout / account switch). */
  forget?(): Promise<void>;
}
