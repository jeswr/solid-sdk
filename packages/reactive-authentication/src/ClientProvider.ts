import type * as oauth from "oauth4webapi";

/** Provides the OAuth client (registration) to use with an authorization server and redirect URI. */
export interface ClientProvider {
  getClient(
    as: oauth.AuthorizationServer,
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<oauth.Client>;
}
