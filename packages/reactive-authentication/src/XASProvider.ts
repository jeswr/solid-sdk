import * as oauth from "oauth4webapi";
import type { AuthorizationServerProvider } from "./AuthorizationServerProvider.js";
import type { ChallengeContext } from "./challenge.js";
import type { IssuerProvider } from "./IssuerProvider.js";
import { type HttpOptions, oauthOptions } from "./transport.js";

/** Obtains an issuer for the request and performs OpenID Connect discovery on it. */
export class XASProvider implements AuthorizationServerProvider {
  readonly #issuerProvider: IssuerProvider;
  readonly #http: HttpOptions | undefined;

  constructor(issuerProvider: IssuerProvider, http?: HttpOptions) {
    this.#issuerProvider = issuerProvider;
    this.#http = http;
  }

  async getAuthorizationServer(
    request: Request,
    challenge?: ChallengeContext,
  ): Promise<oauth.AuthorizationServer> {
    const issuer = await this.#issuerProvider.getIssuer(request, challenge);
    const discoveryResponse = await oauth.discoveryRequest(
      issuer,
      oauthOptions(this.#http, request.signal),
    );
    return await oauth.processDiscoveryResponse(issuer, discoveryResponse);
  }
}
