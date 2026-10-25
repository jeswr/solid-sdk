import type * as oauth from "oauth4webapi";
import type { ClientProvider } from "./ClientProvider.js";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";
import { type HttpOptions, secureFetch } from "./transport.js";

/**
 * Uses a Solid-OIDC Client Identifier Document: the client ID is the document's URL.
 *
 * The document is fetched and checked (its `client_id` must equal its URL and it must list the redirect
 * URI) so that configuration errors surface here rather than as an opaque authorization error.
 */
export class ClientIdClientProvider implements ClientProvider {
  readonly #clientIdDocUri: URL;
  readonly #http: HttpOptions | undefined;

  constructor(clientIdDocUri: URL, http?: HttpOptions) {
    this.#clientIdDocUri = clientIdDocUri;
    this.#http = http;
  }

  async getClient(
    _: oauth.AuthorizationServer,
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<oauth.Client> {
    const response = await secureFetch(
      this.#clientIdDocUri,
      { signal, headers: { accept: "application/ld+json, application/json;q=0.5" } },
      this.#http,
    );
    if (!response.ok)
      throw new ReactiveAuthenticationError(
        `Client ID document could not be retrieved (${response.status})`,
      );

    const client = (await response.json()) as oauth.Client;
    if (client.client_id !== this.#clientIdDocUri.href) {
      throw new ReactiveAuthenticationError("Client ID document client_id does not match its URL");
    }
    if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
      throw new ReactiveAuthenticationError("Client ID document does not list the redirect URI");
    }

    return client;
  }
}
