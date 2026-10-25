import type * as oauth from "oauth4webapi";
import type { ClientProvider } from "../ClientProvider.js";
import type { CodeProvider } from "../CodeProvider.js";
import type { Identity } from "../Identity.js";
import { TokenType } from "../lws/constants.js";
import { idTokenUsable, OidcSession, type OidcSessionOptions } from "../OidcSession.js";
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";
import type { CredentialRequest, CredentialSource, SubjectCredential } from "./CredentialSource.js";

/**
 * LWS OpenID Connect suite: an ID token from the user's OpenID provider (authorization code flow) is the
 * credential, exchanged at the storage's authorization server as `urn:ietf:params:oauth:token-type:id_token`.
 *
 * The OpenID provider is fixed per source; add one source per provider the application supports.
 *
 * The suite reads LWS identifiers from signed claims, so the provider must be configured to issue ID tokens
 * with `sub` as a URI (the agent's identifier) and an `azp` claim (the client identifier); tokens without
 * them are refused here rather than exchanged. The suite RECOMMENDs (SHOULD) that `aud` include the target
 * authorization server; set `requireAudience` to refuse tokens whose audience does not.
 */
export class OidcIdTokenSource implements CredentialSource {
  readonly #issuer: oauth.AuthorizationServer;
  readonly #session: OidcSession;

  /**
   * @param openIdProvider Discovered metadata of the user's OpenID provider (e.g. from {@link XASProvider}).
   */
  readonly #requireAudience: boolean;
  readonly #id: string;

  constructor(
    openIdProvider: oauth.AuthorizationServer,
    callbackUri: string,
    codeProvider: CodeProvider,
    clientProvider: ClientProvider,
    options: OidcSessionOptions & { requireAudience?: boolean } = {},
  ) {
    this.#issuer = openIdProvider;
    this.#requireAudience = options.requireAudience ?? false;
    // Every non-secret dimension that selects a different credential, so access-token caches keyed by
    // this ID never cross accounts or configurations.
    this.#id = JSON.stringify([
      "oidc",
      openIdProvider.issuer,
      callbackUri,
      options.namespace ?? "default",
      options.account ?? "default",
      [...(options.scopes ?? ["openid"])].sort(),
    ]);
    this.#session = new OidcSession(callbackUri, codeProvider, clientProvider, {
      scopes: ["openid"],
      ...options,
    });
  }

  get id(): string {
    return this.#id;
  }

  async getCredential(request: CredentialRequest): Promise<SubjectCredential> {
    // The ID token identifies the user to any authorization server (aud is chosen by the provider), so one
    // session serves every realm; access tokens are then realm-bound by the exchange.
    const entry = (await this.#session.get(this.#issuer, "", request.signal, idTokenUsable))!;
    const idToken = entry.tokenResult.id_token!;
    const identity = entry.identity;
    // Claims were validated by oauth4webapi when the token response was processed.
    if (identity === undefined || !isUri(identity.subject)) {
      throw new ReactiveAuthenticationError(
        "ID token sub is not a URI, as the LWS OpenID suite requires; configure the provider to use URI subjects",
      );
    }
    if (identity.clientId === undefined) {
      throw new ReactiveAuthenticationError(
        "ID token lacks the azp claim the LWS OpenID suite uses as client identifier",
      );
    }
    if (this.#requireAudience && !identity.audience?.includes(request.authorizationServer.href)) {
      throw new ReactiveAuthenticationError(
        `ID token audience does not include ${request.authorizationServer.href}`,
      );
    }
    return {
      token: idToken,
      tokenType: TokenType.idToken,
      clientId: identity.clientId,
      ...(entry.idTokenExpiresAt === undefined ? {} : { expiresAt: entry.idTokenExpiresAt }),
    };
  }

  async identity(): Promise<Identity | undefined> {
    return await this.#session.identity(this.#issuer.issuer, "");
  }

  async forget(): Promise<void> {
    await this.#session.forget();
  }
}

function isUri(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/.test(value);
}
