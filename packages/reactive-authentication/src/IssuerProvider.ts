import type { ChallengeContext } from "./challenge.js";

/** Provides the authorization server (issuer) URI to use for a request. */
export interface IssuerProvider {
  getIssuer(request: Request, challenge?: ChallengeContext): Promise<URL>;
}
