import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import * as DPoP from "dpop";
import * as oauth from "oauth4webapi";
import type { AuthorizationServerProvider } from "./AuthorizationServerProvider.js";
import type { ClientProvider } from "./ClientProvider.js";
import type { CodeProvider } from "./CodeProvider.js";
import type { ContextKey } from "./ContextKey.js";
import { type ChallengeContext, findChallenge } from "./challenge.js";
import { withDPoPNonceRetry } from "./dpopNonce.js";
import { FencedCache, type FenceTicket, type Stamped } from "./FencedCache.js";
import {
  type DPoPTokenCacheEntry,
  idTokenUsable,
  OidcSession,
  type OidcSessionOptions,
} from "./OidcSession.js";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";
import { SessionFence } from "./SessionFence.js";
import { storageContextKey } from "./StorageContext.js";
import type { TokenProvider } from "./TokenProvider.js";
import { assertSecureUrl, oauthOptions, secureFetch } from "./transport.js";
import { parseHttpUrl } from "./url.js";
import { sameIssuer } from "./webId.js";

/** The UMA grant type (UMA 2.0 Grant §3.3.1). */
export const UMA_TICKET_GRANT = "urn:ietf:params:oauth:grant-type:uma-ticket";

/** Solid-OIDC §9.2: the claim token format / UMA profile for pushing a Solid-OIDC ID token. */
export const ID_TOKEN_CLAIM_FORMAT = "http://openid.net/specs/openid-connect-core-1_0.html#IDToken";

/** Decides whether an UMA authorization server named by a challenge may receive the user's ID token. */
export type UmaServerPolicy = (binding: {
  authorizationServer: URL;
  resource: URL;
}) => boolean | Promise<boolean>;

/** Trusts exactly the listed UMA authorization servers (`as_uri` values). */
export function trustUmaServers(uris: Iterable<string | URL>): UmaServerPolicy {
  const trusted = new Set([...uris].map((u) => new URL(u).href));
  return ({ authorizationServer }) => trusted.has(authorizationServer.href);
}

const sameOriginAsResource: UmaServerPolicy = ({ authorizationServer, resource }) =>
  authorizationServer.origin === resource.origin;

/**
 * The authorization server did not issue an RPT (UMA 2.0 Grant §3.3.6). `need_info` may carry a
 * `redirectUser` claims-interaction URL or `requiredClaims`; claims gathering is not performed automatically
 * (it needs application UI) — handle it and retry the request, or treat access as denied.
 */
export class UmaAuthorizationError extends ReactiveAuthenticationError {
  constructor(
    readonly error: string,
    readonly ticket?: string,
    readonly redirectUser?: string,
    readonly requiredClaims?: unknown,
    cause?: unknown,
  ) {
    super(`UMA authorization failed: ${error}`, cause);
    this.name = "UmaAuthorizationError";
  }
}

/** A requesting party token, bound to the DPoP key of the ID token that obtained it. */
export type UmaRpt = {
  accessToken: string;
  tokenType: "dpop" | "bearer";
  dpopKey: CryptoKeyPair;
  expiresAt?: number;
};

export interface SolidUmaTokenProviderOptions extends OidcSessionOptions {
  /**
   * Which UMA authorization servers may receive the ID token. Checked before any identity or credential
   * operation. Default: the authorization server must be on the requested resource's origin.
   */
  readonly trustAuthorizationServer?: UmaServerPolicy;

  /** Groups requests that may share an RPT. Defaults to {@link storageContextKey} (exact URL when unverified). */
  readonly context?: ContextKey;

  /** RPT cache (memory by default); requires `namespace` and a shared `fence`. */
  readonly rptStore?: KeyValueStore<Stamped<UmaRpt>>;

  /** UMA authorization server metadata cache (public), keyed by `as_uri`. */
  readonly metadataStore?: KeyValueStore<oauth.AuthorizationServer>;
}

/**
 * Solid-OIDC §9 with an UMA 2.0 authorization server: answers `WWW-Authenticate: UMA as_uri="…", ticket="…"`
 * by pushing the user's DPoP-bound Solid-OIDC ID token as a claim token (`claim_token_format` =
 * {@link ID_TOKEN_CLAIM_FORMAT}) with a DPoP proof made with the ID token's key (§9.3), and presents the
 * resulting RPT (DPoP-bound when `token_type` is DPoP) with a fresh proof per request.
 *
 * The ID token comes from the shared {@link OidcSession} (same login, refresh and logout machinery as
 * {@link DPoPTokenProvider}); RPTs are generation-stamped in a {@link FencedCache} sharing the same fence.
 */
export class SolidUmaTokenProvider implements TokenProvider {
  readonly #openIdProvider: AuthorizationServerProvider;
  readonly #options: SolidUmaTokenProviderOptions;
  readonly #session: OidcSession;
  readonly #rpts: FencedCache<UmaRpt>;
  readonly #metadata: KeyValueStore<oauth.AuthorizationServer>;
  readonly #context: ContextKey;
  readonly #issued = new Map<string, string>();
  readonly #contexts = new Map<string, string>();
  readonly #callbackUri: string;

  constructor(
    callbackUri: string,
    codeProvider: CodeProvider,
    openIdProvider: AuthorizationServerProvider,
    clientProvider: ClientProvider,
    options: SolidUmaTokenProviderOptions = {},
  ) {
    const supplied =
      options.cache !== undefined ||
      options.sessionStore !== undefined ||
      options.rptStore !== undefined;
    if (supplied && options.fence === undefined)
      throw new TypeError(
        "Supplied credential stores require a SessionFence shared by every instance using them",
      );
    if (options.metadataStore !== undefined && !options.namespace)
      throw new TypeError("A namespace is required when supplying a store");

    const fence =
      options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, { broadcast: false });
    this.#openIdProvider = openIdProvider;
    this.#callbackUri = callbackUri;
    this.#options = options;
    this.#session = new OidcSession(callbackUri, codeProvider, clientProvider, {
      ...options,
      fence,
    });
    this.#rpts = new FencedCache("uma", {
      fence,
      ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
      ...(options.rptStore === undefined ? {} : { store: options.rptStore }),
    });
    this.#metadata = options.metadataStore ?? createMemoryStore();
    this.#context =
      options.context ??
      storageContextKey({
        mappings: createMemoryStore(),
        ...(options.http === undefined ? {} : { http: options.http }),
      });
  }

  /** Only UMA challenges with `as_uri` and `ticket`. */
  async matches(_: Request, challenge?: ChallengeContext): Promise<boolean> {
    return findChallenge(challenge, ["as_uri", "ticket"], "uma") !== undefined;
  }

  async upgrade(request: Request, challenge?: ChallengeContext): Promise<Request> {
    const params = findChallenge(challenge, ["as_uri", "ticket"], "uma")?.params;
    const nonce = challenge?.response.headers.get("DPoP-Nonce") ?? undefined;
    if (
      params === undefined &&
      nonce !== undefined &&
      findChallenge(challenge, [], "dpop")?.params["error"] === "use_dpop_nonce"
    ) {
      const response = challenge!.response;
      if (response.url !== "" && new URL(response.url).origin !== new URL(request.url).origin)
        throw new ReactiveAuthenticationError("DPoP nonce came from a different resource origin");
      const ticket = await this.#rpts.ticket(request.signal);
      // A nonce challenge has no UMA ticket or AS binding. Reuse only the context already verified
      // for this exact resource, and never acquire new credentials from this challenge alone. Use actual
      // expiry here: the cache's renewal margin must not prevent replaying a short-lived, valid RPT.
      const key = this.#contexts.get(request.url);
      const rpt = key === undefined ? undefined : await this.#rpts.read(key, ticket);
      if (
        rpt === undefined ||
        rpt.tokenType !== "dpop" ||
        (rpt.expiresAt !== undefined && Date.now() >= rpt.expiresAt)
      )
        throw new ReactiveAuthenticationError("No usable verified UMA RPT context for nonce retry");
      return await this.#present(request, rpt, key!, ticket, nonce);
    }
    const asUri = params?.["as_uri"];
    const as = parseHttpUrl(asUri ?? "");
    const permissionTicket = params?.["ticket"];
    if (asUri === undefined || as === undefined || !permissionTicket)
      throw new ReactiveAuthenticationError("UMA challenge lacks a valid as_uri or ticket");
    assertSecureUrl(as, this.#options.http);

    // Captured before any await, so a logout while the policy (or anything later) is pending wins.
    const ticket = await this.#rpts.ticket(request.signal);

    // Trust first: no discovery, login or credential use for an untrusted authorization server.
    const policy = this.#options.trustAuthorizationServer ?? sameOriginAsResource;
    if (!(await policy({ authorizationServer: as, resource: new URL(request.url) }))) {
      throw new ReactiveAuthenticationError(
        `UMA authorization server ${as.href} is not trusted for ${request.url}`,
      );
    }
    await this.#rpts.assertCurrent(ticket);

    // The OP is resolved only after the trust decision, and the same result is used to obtain the ID token.
    const op = await this.#openIdProvider.getAuthorizationServer(request, challenge);
    // RPTs are per UMA server and resource context, and per session configuration (OP, redirect URI,
    // account, scopes), so providers sharing an RPT store never receive another account's RPT.
    const o = this.#options;
    const key = await this.#rpts.key([
      as.href,
      await this.#context(request, challenge),
      op.issuer,
      this.#callbackUri,
      o.account ?? "default",
      (o.scopes ?? ["openid", "webid"]).join(" "),
    ]);
    const rpt = await this.#rpts.locked(key, ticket, async () => {
      const cached = await this.#rpts.read(key, ticket);
      if (
        cached !== undefined &&
        (cached.expiresAt === undefined || Date.now() < cached.expiresAt - 10_000)
      )
        return cached;
      await this.#rpts.remove(key);
      return await this.#rpts.write(
        key,
        await this.#obtain(op, asUri, permissionTicket, ticket),
        ticket,
      );
    });

    return await this.#present(request, rpt, key, ticket, nonce);
  }

  async #present(
    request: Request,
    rpt: UmaRpt,
    key: string,
    ticket: FenceTicket,
    nonce: string | undefined,
  ): Promise<Request> {
    const headers = new Headers(request.headers);
    if (rpt.tokenType === "dpop") {
      const htu = new URL(request.url);
      htu.search = htu.hash = "";
      headers.set(
        "DPoP",
        await DPoP.generateProof(rpt.dpopKey, htu.href, request.method, nonce, rpt.accessToken),
      );
    }
    await this.#rpts.assertCurrent(ticket);
    this.#issued.set(rpt.accessToken, key);
    this.#contexts.set(request.url, key);
    headers.set(
      "Authorization",
      `${rpt.tokenType === "dpop" ? "DPoP" : "Bearer"} ${rpt.accessToken}`,
    );
    return new Request(request, { headers });
  }

  async invalidate(upgraded: Request): Promise<void> {
    const rejected = upgraded.headers.get("Authorization")?.replace(/^(DPoP|Bearer) /, "");
    const key = rejected === undefined ? undefined : this.#issued.get(rejected);
    if (key !== undefined) await this.#rpts.removeIf(key, (rpt) => rpt.accessToken === rejected);
  }

  async forget(): Promise<void> {
    this.#issued.clear();
    this.#contexts.clear();
    await this.#rpts.forget();
    await this.#session.forget();
  }

  async #obtain(
    op: oauth.AuthorizationServer,
    asUri: string,
    permissionTicket: string,
    ticket: FenceTicket,
  ): Promise<UmaRpt> {
    const uma = await this.#discover(asUri, ticket.signal);
    await this.#rpts.assertCurrent(ticket);

    // The ID token identifies the user to any trusted authorization server; RPTs are then per AS and context.
    const entry = (await this.#session.get(
      op,
      "",
      ticket.signal,
      idTokenUsable,
      true,
      ticket.generation,
    ))!;
    await this.#session.assertCurrent(entry, ticket.signal);
    return await this.#exchange(uma, entry, permissionTicket, ticket.signal);
  }

  /** UMA 2.0 Grant §2: metadata at `as_uri` + `/.well-known/uma2-configuration`; `issuer` must be `as_uri`. */
  async #discover(asUri: string, signal: AbortSignal): Promise<oauth.AuthorizationServer> {
    const cached = await this.#metadata.getItem(asUri);
    if (cached !== null) return cached;

    const response = await secureFetch(
      new URL(`${asUri.replace(/\/$/, "")}/.well-known/uma2-configuration`),
      { signal, headers: { accept: "application/json" }, redirect: "error" },
      this.#options.http,
    );
    if (!response.ok)
      throw new ReactiveAuthenticationError(`UMA discovery failed (${response.status})`);
    const metadata = (await response.json()) as oauth.AuthorizationServer;
    if (typeof metadata.issuer !== "string" || !sameIssuer(metadata.issuer, asUri)) {
      throw new ReactiveAuthenticationError(
        `UMA metadata issuer ${String(metadata.issuer)} does not match as_uri ${asUri}`,
      );
    }
    const tokenEndpoint = parseHttpUrl(
      typeof metadata.token_endpoint === "string" ? metadata.token_endpoint : "",
    );
    if (tokenEndpoint === undefined)
      throw new ReactiveAuthenticationError("UMA metadata lacks a token_endpoint");
    assertSecureUrl(tokenEndpoint, this.#options.http);
    const profiles = metadata["uma_profiles_supported"];
    if (!Array.isArray(profiles) || !profiles.includes(ID_TOKEN_CLAIM_FORMAT)) {
      throw new ReactiveAuthenticationError(
        "UMA authorization server does not advertise the Solid-OIDC ID token profile (uma_profiles_supported)",
      );
    }
    if (
      metadata.grant_types_supported !== undefined &&
      !metadata.grant_types_supported.includes(UMA_TICKET_GRANT)
    ) {
      throw new ReactiveAuthenticationError(
        "UMA authorization server does not support the uma-ticket grant",
      );
    }

    await this.#metadata.setItem(asUri, metadata);
    return metadata;
  }

  async #exchange(
    uma: oauth.AuthorizationServer,
    entry: DPoPTokenCacheEntry,
    permissionTicket: string,
    signal: AbortSignal,
  ): Promise<UmaRpt> {
    const client: oauth.Client = { client_id: entry.identity?.clientId ?? entry.client.client_id };
    const dpop = oauth.DPoP(client, entry.dpopKey); // the key the ID token is bound to (cnf), Solid-OIDC §9.3
    // The ID token is a compact JWT, already base64url segments, so it is pushed as-is (§3.3.1 "unless
    // specified otherwise by the claim token format").
    const parameters = new URLSearchParams({
      ticket: permissionTicket,
      claim_token: entry.tokenResult.id_token!,
      claim_token_format: ID_TOKEN_CLAIM_FORMAT,
    });

    let result: oauth.TokenEndpointResponse;
    try {
      result = await withDPoPNonceRetry(async () => {
        const response = await oauth.genericTokenEndpointRequest(
          uma,
          client,
          oauth.None(),
          UMA_TICKET_GRANT,
          parameters,
          { ...oauthOptions(this.#options.http, signal), DPoP: dpop },
        );
        return await oauth.processGenericTokenEndpointResponse(uma, client, response);
      });
    } catch (e) {
      if (
        e instanceof oauth.ResponseBodyError &&
        [
          "need_info",
          "request_denied",
          "request_submitted",
          "invalid_grant",
          "invalid_scope",
        ].includes(e.error)
      ) {
        const body = e.cause as Record<string, unknown>;
        throw new UmaAuthorizationError(
          e.error,
          str(body["ticket"]),
          str(body["redirect_user"]),
          body["required_claims"],
          e,
        );
      }
      throw e;
    }

    const tokenType = result.token_type as string;
    if (tokenType !== "dpop" && tokenType !== "bearer") {
      throw new ReactiveAuthenticationError(`Unsupported RPT token_type ${tokenType}`);
    }
    const rpt: UmaRpt = {
      accessToken: result.access_token,
      tokenType: tokenType as "dpop" | "bearer",
      dpopKey: entry.dpopKey,
    };
    if (result.expires_in !== undefined) rpt.expiresAt = Date.now() + result.expires_in * 1000;
    return rpt;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
