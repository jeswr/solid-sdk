// AUTHORED-BY Codex GPT-6.1-Sol
import { timingSafeEqual } from "node:crypto";
import { Clients, clientMetadata } from "./clients.js";
import { generateSigningKey, JwtService } from "./jwt.js";
import {
  ACCESS_TTL,
  CODE_TTL,
  digest,
  GRANT_TTL,
  json,
  LOGIN_TTL,
  mediaType,
  OAuthError,
  opaque,
  parameter,
  readBody,
  redirect,
  secureUrl,
  unique,
} from "./protocol.js";
import { createMemoryStores } from "./stores.js";
import type {
  AccessPrincipal,
  Authorization,
  AuthorizationServerOptions,
  Client,
  Grant,
  OAuthStores,
  PodSession,
} from "./types.js";

/** OAuth AS/RS core. HTTP composition, browser consent UI and pod OIDC remain injected. */
export class AuthorizationServer {
  private readonly stores: OAuthStores;
  private readonly now: () => number;
  private readonly clients: Clients;
  private readonly jwt: JwtService;
  private readonly scopes: readonly string[];
  private readonly issuer: string;
  private readonly resource: string;
  private readonly base: string;

  constructor(private readonly options: AuthorizationServerOptions) {
    const issuer = secureUrl(options.issuer);
    const resource = secureUrl(options.resource);
    if (issuer.search || resource.search)
      throw new Error("Issuer and resource must not contain queries");
    this.issuer = options.issuer;
    this.resource = options.resource;
    this.base = options.issuer.replace(/\/$/u, "");
    this.stores = options.stores ?? createMemoryStores();
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.scopes = [...(options.scopes ?? [])];
    if (this.scopes.some((scope) => !/^[\x21\x23-\x5B\x5D-\x7E]+$/u.test(scope))) {
      throw new Error("Scopes must be OAuth scope tokens");
    }
    this.clients = new Clients(this.stores.clients, this.now, options.metadataFetch);
    this.jwt = new JwtService(options.signingKey ?? generateSigningKey(), this.issuer, this.now);
  }

  /** RFC 8414 metadata, including PKCE, revocation and CIMD capabilities. */
  authorizationServerMetadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.base}/authorize`,
      token_endpoint: `${this.base}/token`,
      registration_endpoint: `${this.base}/register`,
      revocation_endpoint: `${this.base}/revoke`,
      jwks_uri: `${this.base}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...this.scopes],
      client_id_metadata_document_supported: true,
    };
  }

  /** RFC 9728 protected resource metadata; tokens are accepted only as bearer headers. */
  protectedResourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [...this.scopes],
      bearer_methods_supported: ["header"],
    };
  }

  /** Public verification keys, never the private signing key. */
  jwks() {
    return { keys: [structuredClone(this.jwt.jwk)] };
  }

  /** Web Request→Response handler. Errors are JSON until a redirect is trusted. */
  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const asMetadata = metadataUrl(this.issuer, "oauth-authorization-server");
      const resourceMetadata = metadataUrl(this.resource, "oauth-protected-resource");
      if (request.method === "GET" && url.origin + url.pathname === asMetadata) {
        return json(this.authorizationServerMetadata());
      }
      if (request.method === "GET" && url.origin + url.pathname === resourceMetadata) {
        return json(this.protectedResourceMetadata());
      }
      const endpoint = url.origin + url.pathname;
      if (!endpoint.startsWith(`${this.base}/`)) return json({ error: "not_found" }, 404);
      const path = endpoint.slice(this.base.length);
      if (path === "/jwks" && request.method === "GET") return json(this.jwks());
      if (path === "/authorize" && request.method === "GET") return await this.begin(request);
      if (path === "/callback" && request.method === "GET") return await this.callback(request);
      if (["/register", "/token", "/revoke"].includes(path) && request.method === "POST") {
        if (request.headers.has("authorization")) throw new OAuthError("invalid_client", 401);
        if (path === "/register") {
          if (mediaType(request) !== "application/json")
            throw new OAuthError("invalid_request", 415);
          let data: unknown;
          try {
            data = JSON.parse(await readBody(request));
          } catch (error) {
            if (error instanceof OAuthError) throw error;
            throw new OAuthError("invalid_client_metadata");
          }
          const client = clientMetadata(data, opaque(), this.now());
          await this.stores.clients.put(client.client_id, client);
          return json(client, 201);
        }
        if (mediaType(request) !== "application/x-www-form-urlencoded")
          throw new OAuthError("invalid_request", 415);
        const params = new URLSearchParams(await readBody(request));
        unique(params);
        if (params.has("client_secret")) throw new OAuthError("invalid_client", 401);
        return path === "/token" ? await this.token(params) : await this.revoke(params);
      }
      if (["/authorize", "/callback", "/jwks", "/register", "/token", "/revoke"].includes(path)) {
        return json({ error: "invalid_request" }, 405);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return error instanceof OAuthError
        ? json({ error: error.error }, error.status)
        : json({ error: "server_error" }, 500);
    }
  }

  /** Complete a trusted, browser-authenticated flow (MCP-11 owns UI/CSRF protection). */
  async authorize(request: Request, session: PodSession): Promise<Response> {
    const { authorization, client } = await this.validateAuthorization(
      new URL(request.url).searchParams,
    );
    return this.finish(request, authorization, client, session);
  }

  /** Verify signature, issuer, exact audience, expiry and live family before returning identity. */
  async verifyAccessToken(token: string, resource: string): Promise<AccessPrincipal> {
    if (resource !== this.resource) throw new OAuthError("invalid_token", 401);
    const claims = this.jwt.verify(token, resource);
    const grant = await this.stores.grants.get(claims.sid as string);
    if (
      !grant ||
      grant.revoked ||
      grant.expiresAt <= this.now() ||
      grant.resource !== resource ||
      grant.clientId !== claims.client_id ||
      grant.session.webId !== claims.sub ||
      grant.scope !== claims.scope
    ) {
      throw new OAuthError("invalid_token", 401);
    }
    return {
      clientId: grant.clientId,
      webId: grant.session.webId,
      sessionId: grant.session.id,
      resource,
      scope: grant.scope,
      grantId: grant.id,
    };
  }

  private async validateAuthorization(
    params: URLSearchParams,
  ): Promise<{ authorization: Authorization; client: Client }> {
    unique(params);
    const client = await this.clients.get(parameter(params, "client_id"));
    const redirectUri = parameter(params, "redirect_uri");
    if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError("invalid_request");
    if (parameter(params, "response_type") !== "code")
      throw new OAuthError("unsupported_response_type");
    if (parameter(params, "code_challenge_method") !== "S256")
      throw new OAuthError("invalid_request");
    const challenge = parameter(params, "code_challenge");
    if (!/^[A-Za-z0-9_-]{43}$/u.test(challenge)) throw new OAuthError("invalid_request");
    const resource = parameter(params, "resource");
    if (resource !== this.resource) throw new OAuthError("invalid_target");
    const scope = params.get("scope") ?? "";
    if (scope.length > 0 && scope.split(" ").some((item) => !this.scopes.includes(item)))
      throw new OAuthError("invalid_scope");
    return {
      client,
      authorization: {
        clientId: client.client_id,
        redirectUri,
        resource,
        scope,
        challenge,
        state: parameter(params, "state"),
      },
    };
  }

  private async begin(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const { authorization } = await this.validateAuthorization(params);
    const upstream = await this.options.podSessions.begin(
      parameter(params, "webid"),
      `${this.base}/callback`,
    );
    secureUrl(upstream.authorizeUrl);
    if (!upstream.state) throw new Error("Pod broker returned no state");
    await this.stores.pending.put(digest(upstream.state), {
      authorization,
      expiresAt: this.now() + LOGIN_TTL,
    });
    return redirect(upstream.authorizeUrl, {});
  }

  private async callback(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    unique(params);
    const state = parameter(params, "state");
    const pending = await this.stores.pending.consume(digest(state));
    if (!pending?.firstUse || pending.value.expiresAt <= this.now())
      throw new OAuthError("invalid_request");
    const authorization = pending.value.authorization;
    const session = await this.options.podSessions.complete(request.url, state);
    // Re-check redirect registration after the upstream round trip/cache expiration.
    const client = await this.clients.get(authorization.clientId);
    if (!client.redirect_uris.includes(authorization.redirectUri))
      throw new OAuthError("invalid_request");
    return this.finish(request, authorization, client, session);
  }

  private async finish(
    request: Request,
    authorization: Authorization,
    client: Client,
    session: PodSession,
  ): Promise<Response> {
    const identity = { id: session.id, webId: session.webId };
    if (!identity.id || !identity.webId) throw new Error("Pod identity is required");
    const permitted = await this.options.consent(
      structuredCloneContext(request, client, authorization, identity),
    );
    if (!permitted)
      return redirect(authorization.redirectUri, {
        error: "access_denied",
        state: authorization.state,
      });
    const id = opaque();
    await this.stores.grants.put(id, {
      id,
      clientId: authorization.clientId,
      session: identity,
      resource: authorization.resource,
      scope: authorization.scope,
      expiresAt: this.now() + GRANT_TTL,
      revoked: false,
      refreshAllowed: client.grant_types.includes("refresh_token"),
    });
    const code = opaque();
    await this.stores.codes.put(digest(code), {
      authorization,
      grantId: id,
      expiresAt: this.now() + CODE_TTL,
    });
    return redirect(authorization.redirectUri, {
      code,
      state: authorization.state,
      iss: this.issuer,
    });
  }

  private async token(params: URLSearchParams): Promise<Response> {
    const clientId = parameter(params, "client_id");
    const type = parameter(params, "grant_type");
    if (type !== "authorization_code" && type !== "refresh_token")
      throw new OAuthError("unsupported_grant_type");
    // Client registration is bound into each server-side credential. Do not refetch CIMD on refresh.
    const resource = parameter(params, "resource");
    if (resource !== this.resource) throw new OAuthError("invalid_target");
    let grantId: string;
    if (type === "authorization_code") {
      const hash = digest(parameter(params, "code"));
      const record = await this.stores.codes.get(hash);
      if (!record || record.authorization.clientId !== clientId)
        throw new OAuthError("invalid_grant");
      const verifier = parameter(params, "code_verifier");
      if (
        parameter(params, "redirect_uri") !== record.authorization.redirectUri ||
        !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) ||
        !timingSafeEqual(Buffer.from(digest(verifier)), Buffer.from(record.authorization.challenge))
      )
        throw new OAuthError("invalid_grant");
      const used = await this.stores.codes.consume(hash);
      if (!used?.firstUse) {
        await this.stores.grants.revoke(record.grantId);
        throw new OAuthError("invalid_grant");
      }
      if (record.expiresAt <= this.now()) throw new OAuthError("invalid_grant");
      grantId = record.grantId;
    } else {
      const hash = digest(parameter(params, "refresh_token"));
      const record = await this.stores.refreshTokens.get(hash);
      if (!record || record.clientId !== clientId) throw new OAuthError("invalid_grant");
      const used = await this.stores.refreshTokens.consume(hash);
      if (!used?.firstUse) {
        await this.stores.grants.revoke(record.grantId);
        throw new OAuthError("invalid_grant");
      }
      if (record.expiresAt <= this.now()) throw new OAuthError("invalid_grant");
      grantId = record.grantId;
    }
    const grant = await this.stores.grants.get(grantId);
    if (!grant || grant.revoked || grant.expiresAt <= this.now() || grant.resource !== resource)
      throw new OAuthError("invalid_grant");
    if (params.has("scope") && params.get("scope") !== grant.scope)
      throw new OAuthError("invalid_scope");
    const accessToken = this.jwt.issue(grant);
    let refreshToken: string | undefined;
    if (grant.refreshAllowed) {
      refreshToken = opaque();
      await this.stores.refreshTokens.put(digest(refreshToken), {
        grantId,
        clientId,
        expiresAt: grant.expiresAt,
      });
    }
    // Re-read after asynchronous writes so concurrent replay/revocation cannot resurrect a grant.
    const current = await this.stores.grants.get(grantId);
    if (!current || current.revoked) throw new OAuthError("invalid_grant");
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.min(ACCESS_TTL, grant.expiresAt - this.now()),
      ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
      scope: grant.scope,
    });
  }

  private async revoke(params: URLSearchParams): Promise<Response> {
    const clientId = parameter(params, "client_id");
    const token = parameter(params, "token");
    const refresh = await this.stores.refreshTokens.get(digest(token));
    let grant: Grant | undefined;
    if (refresh) {
      grant = await this.stores.grants.get(refresh.grantId);
    } else {
      try {
        const claims = this.jwt.verify(token, this.resource);
        grant = await this.stores.grants.get(claims.sid as string);
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
      }
    }
    if (grant && grant.clientId === clientId) await this.stores.grants.revoke(grant.id);
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }
}

/** Construct the framework-neutral MCP OAuth core. */
export function createAuthorizationServer(
  options: AuthorizationServerOptions,
): AuthorizationServer {
  return new AuthorizationServer(options);
}

function metadataUrl(identifier: string, suffix: string): string {
  const url = new URL(identifier);
  return `${url.origin}/.well-known/${suffix}${url.pathname.replace(/\/$/u, "")}`;
}

function structuredCloneContext(
  request: Request,
  client: Client,
  authorization: Authorization,
  session: PodSession,
) {
  return { request, ...structuredClone({ client, authorization, session }) };
}
