import type * as oauth from "oauth4webapi";
import type { ChallengeContext } from "./challenge.js";

/** Provides validated authorization server metadata for a request. */
export interface AuthorizationServerProvider {
  getAuthorizationServer(
    request: Request,
    challenge?: ChallengeContext,
  ): Promise<oauth.AuthorizationServer>;
}
