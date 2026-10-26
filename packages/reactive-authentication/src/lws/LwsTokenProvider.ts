// AUTHORED-BY Codex GPT-6.1-Sol
import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import type * as oauth from "oauth4webapi";
import { type ChallengeContext, findChallenge } from "../challenge.js";
import type { CredentialSource } from "../credentials/CredentialSource.js";
import { FencedCache, type FenceTicket, type Stamped } from "../FencedCache.js";
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";
import type { SessionFence } from "../SessionFence.js";
import { describes, isInRealm, resolveStorageContext } from "../StorageContext.js";
import type { TokenProvider } from "../TokenProvider.js";
import { assertSecureUrl, type HttpOptions, secureFetch } from "../transport.js";
import { parseHttpUrl, withoutFragment } from "../url.js";
import { discoverLwsAuthorizationServer, exchangeToken } from "./tokenExchange.js";

/** What a challenge asks the client to do: send a credential to `authorizationServer` for `realm`. */
export interface ChallengeBinding {
  readonly authorizationServer: URL;
  readonly realm: URL;
  /** The URL that was actually requested (and is inside the application's credential boundary). */
  readonly resource: URL;
}

/** Decides whether a challenge's authorization server and realm may be trusted for the requested resource. */
export type AuthorizationServerPolicy = (binding: ChallengeBinding) => boolean | Promise<boolean>;

/** LWS access token, cached per authorization server, realm and credential context. */
export type LwsAccessToken = { accessToken: string; expiresAt?: number };

export interface LwsTokenProviderOptions {
  readonly http?: HttpOptions;

  /**
   * Which challenge bindings are trusted. With RFC 9728, defaults to any server listed by validated,
   * same-origin, resource-bound metadata; `realm` is the verified storage Link. A supplied policy narrows
   * that list. Legacy `as_uri`/`realm` challenges default to both URLs on the resource's origin; separately
   * hosted servers need an explicit policy ({@link trustAuthorizationServers}, {@link trustBindings}).
   */
  readonly trustAuthorizationServer?: AuthorizationServerPolicy;

  /** Answer pre-2026-10-14 `as_uri`/`realm` challenges. RFC 9728 takes precedence. @defaultValue true */
  readonly legacyLwsChallenge?: boolean;

  /**
   * Shared with the manager and session-backed source; required when the source supplies a fence.
   * Defaults to a private fence for sources without one.
   */
  readonly fence?: SessionFence;

  /** Required with supplied stores. */
  readonly namespace?: string;

  /**
   * Access token cache (memory by default). Values are bearer tokens: persist only deliberately. Requires
   * `namespace` and a `fence` shared by every instance using the store.
   */
  readonly tokenStore?: KeyValueStore<Stamped<LwsAccessToken>>;

  /** Authorization server metadata cache (public data), keyed by issuer. Memory by default. */
  readonly metadataStore?: KeyValueStore<oauth.AuthorizationServer>;
}

const sameOriginAsResource: AuthorizationServerPolicy = ({
  authorizationServer,
  realm,
  resource,
}) => authorizationServer.origin === resource.origin && realm.origin === resource.origin;

/**
 * Trusts the listed authorization servers for realms on the requested resource's origin. Cross-origin
 * realms still need {@link trustBindings}.
 */
export function trustAuthorizationServers(uris: Iterable<string | URL>): AuthorizationServerPolicy {
  const trusted = new Set([...uris].map((u) => new URL(u).href));
  return ({ authorizationServer, realm, resource }) =>
    trusted.has(authorizationServer.href) && realm.origin === resource.origin;
}

/** Trusts exact (authorization server, realm) pairs, e.g. a storage whose description lives on another origin. */
export function trustBindings(
  pairs: Iterable<{ authorizationServer: string | URL; realm: string | URL }>,
): AuthorizationServerPolicy {
  const trusted = new Set(
    [...pairs].map((p) =>
      JSON.stringify([new URL(p.authorizationServer).href, new URL(p.realm).href]),
    ),
  );
  return ({ authorizationServer, realm }) =>
    trusted.has(JSON.stringify([authorizationServer.href, realm.href]));
}

/**
 * LWS 1.0 authorization: answers RFC 9728 `resource_metadata` challenges and, by default, legacy
 * `as_uri`/`realm` challenges by exchanging
 * a subject credential (from any {@link CredentialSource}) for an audience-restricted access token with
 * OAuth 2.0 Token Exchange (RFC 8693), and presents it as a Bearer token (RFC 6750).
 *
 * RFC 9728 validates same-origin, resource-bound PRM and a confirmed StorageRoot before selecting a
 * trusted server. Legacy bindings pass the trust policy before any discovery, then require realm
 * containment. Credentials are acquired only after discovery succeeds. Access tokens are
 * generation-stamped in a {@link FencedCache}, so logout (local or through a shared fence) invalidates them.
 */
export class LwsTokenProvider implements TokenProvider {
  readonly #source: CredentialSource;
  readonly #options: LwsTokenProviderOptions;
  readonly #tokens: FencedCache<LwsAccessToken>;
  readonly #metadata: KeyValueStore<oauth.AuthorizationServer>;
  readonly #issued = new Map<string, string>();
  // Outstanding requests must outlive the bounded token history used for request copies.
  #requests = new WeakMap<Request, string>();

  constructor(source: CredentialSource, options: LwsTokenProviderOptions = {}) {
    if (source.fence !== undefined && source.fence !== options.fence)
      throw new TypeError("LWS provider and credential source must share the same SessionFence");
    if (options.metadataStore !== undefined && !options.namespace)
      throw new TypeError("A namespace is required when supplying a store");
    this.#source = source;
    this.#options = options;
    this.#tokens = new FencedCache("lws", {
      ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
      ...(options.tokenStore === undefined ? {} : { store: options.tokenStore }),
      ...(options.fence === undefined ? {} : { fence: options.fence }),
    });
    this.#metadata = options.metadataStore ?? createMemoryStore();
  }

  get fence(): SessionFence {
    return this.#tokens.fence;
  }

  async matches(_: Request, challenge?: ChallengeContext): Promise<boolean> {
    return (
      findChallenge(challenge, ["resource_metadata"], "bearer") !== undefined ||
      (this.#options.legacyLwsChallenge !== false &&
        findChallenge(challenge, ["as_uri", "realm"], "bearer") !== undefined)
    );
  }

  async upgrade(request: Request, challenge?: ChallengeContext): Promise<Request> {
    const ticket = await this.#tokens.ticket(request.signal);
    const { as, realm, renewalWindow } = await this.#verifiedChallenge(
      request,
      challenge,
      ticket.signal,
    );
    const key = await this.#tokens.key([as.href, realm.href, this.#source.id]);

    const token = await this.#tokens.locked(key, ticket, async () => {
      const cached = await this.#tokens.read(key, ticket);
      if (cached !== undefined && usable(cached, renewalWindow)) return cached;
      await this.#tokens.remove(key);
      return await this.#tokens.write(key, await this.#exchange(as, realm, ticket), ticket);
    });

    await this.#tokens.assertCurrent(ticket);
    this.#remember(token.accessToken, key);
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token.accessToken}`);
    const upgraded = new Request(request, { headers, signal: ticket.signal });
    this.#requests.set(upgraded, key);
    return upgraded;
  }

  async invalidate(upgraded: Request): Promise<void> {
    const rejected = upgraded.headers.get("Authorization")?.replace(/^Bearer /, "");
    const key =
      this.#requests.get(upgraded) ??
      (rejected === undefined ? undefined : this.#issued.get(rejected));
    if (key !== undefined)
      await this.#tokens.removeIf(key, (token) => token.accessToken === rejected);
  }

  async forget(): Promise<void> {
    this.#issued.clear();
    this.#requests = new WeakMap();
    await this.#tokens.forget();
    await this.#source.forget?.();
  }

  async #verifiedChallenge(
    request: Request,
    challenge: ChallengeContext | undefined,
    signal: AbortSignal,
  ): Promise<{ as: URL; realm: URL; renewalWindow: number }> {
    const metadata = findChallenge(challenge, ["resource_metadata"], "bearer");
    if (metadata !== undefined)
      return await this.#verifiedResourceMetadata(
        request,
        challenge!,
        metadata.params["resource_metadata"]!,
        signal,
      );

    // Only the LWS Bearer challenge: e.g. a UMA challenge also carrying realm/as_uri is not LWS.
    const params =
      this.#options.legacyLwsChallenge === false
        ? undefined
        : findChallenge(challenge, ["as_uri", "realm"], "bearer")?.params;
    const as = parseHttpUrl(params?.["as_uri"] ?? "");
    const realm = parseHttpUrl(params?.["realm"] ?? "");
    if (as === undefined || realm === undefined)
      throw new ReactiveAuthenticationError("LWS challenge lacks valid as_uri/realm");
    assertSecureUrl(as, this.#options.http);
    assertSecureUrl(realm, this.#options.http);

    // Trust first: nothing (not even the realm's description) is fetched for an untrusted binding.
    const policy = this.#options.trustAuthorizationServer ?? sameOriginAsResource;
    if (!(await policy({ authorizationServer: as, realm, resource: new URL(request.url) }))) {
      throw new ReactiveAuthenticationError(
        `Authorization server ${as.href} and realm ${realm.href} are not trusted for ${request.url}`,
      );
    }

    const inRealm = await isInRealm(request.url, realm, {
      signal,
      ...(this.#options.http === undefined ? {} : { http: this.#options.http }),
    });
    if (!inRealm)
      throw new ReactiveAuthenticationError(
        `${request.url} is not contained in realm ${realm.href}`,
      );

    return { as, realm, renewalWindow: 10_000 };
  }

  async #verifiedResourceMetadata(
    request: Request,
    challenge: ChallengeContext,
    metadataUrl: string,
    signal: AbortSignal,
  ): Promise<{ as: URL; realm: URL; renewalWindow: number }> {
    const resource = new URL(request.url);
    const url = parseHttpUrl(metadataUrl);
    if (url === undefined || url.origin !== resource.origin)
      throw new ReactiveAuthenticationError(
        "LWS resource_metadata must be on the request's origin",
      );

    const response = await secureFetch(
      url,
      {
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        signal,
        headers: { accept: "application/json" },
      },
      this.#options.http,
    );
    if (!response.ok || !describes(response, url.href))
      throw new ReactiveAuthenticationError(
        "LWS protected resource metadata could not be retrieved without redirects",
      );
    const prm = (await response.json()) as {
      resource?: unknown;
      authorization_servers?: unknown;
    } | null;
    // Compare the serialized Request URL with its fragment stripped and query kept, without
    // normalizing the returned string (LWS Discovery Validation 2 / RFC 9728 §3.3).
    if (prm?.resource !== withoutFragment(resource))
      throw new ReactiveAuthenticationError(
        "LWS protected resource metadata resource does not match the request URL",
      );

    const storage = await resolveStorageContext(request.url, challenge.response, {
      signal,
      ...(this.#options.http === undefined ? {} : { http: this.#options.http }),
    });
    // The existing resolver requires a same-origin, containing StorageRoot that confirms this Link.
    if (storage.source !== "lws")
      throw new ReactiveAuthenticationError(
        "LWS storage Link has no verified same-origin StorageRoot",
      );
    const realm = new URL(storage.storage!);

    if (!Array.isArray(prm.authorization_servers))
      throw new ReactiveAuthenticationError(
        "LWS protected resource metadata lacks authorization_servers",
      );
    for (const identifier of prm.authorization_servers) {
      const as = typeof identifier === "string" ? parseHttpUrl(identifier) : undefined;
      if (as === undefined) continue;
      const policy = this.#options.trustAuthorizationServer;
      if (policy !== undefined && !(await policy({ authorizationServer: as, realm, resource })))
        continue;
      assertSecureUrl(as, this.#options.http);
      return { as, realm, renewalWindow: 30_000 };
    }
    throw new ReactiveAuthenticationError(
      "No trusted LWS authorization server in protected resource metadata",
    );
  }

  async #exchange(as: URL, realm: URL, ticket: FenceTicket): Promise<LwsAccessToken> {
    const metadata = await this.#discover(as, ticket.signal);
    await this.#tokens.assertCurrent(ticket);
    const credential = await this.#source.getCredential({
      authorizationServer: as,
      resource: realm,
      signal: ticket.signal,
      expectedGeneration: ticket.generation,
    });
    await this.#tokens.assertCurrent(ticket);
    const result = await exchangeToken(
      metadata,
      credential,
      realm,
      ticket.signal,
      this.#options.http,
    );
    return result.expires_in === undefined
      ? { accessToken: result.access_token }
      : { accessToken: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  }

  async #discover(as: URL, signal: AbortSignal): Promise<oauth.AuthorizationServer> {
    const cached = await this.#metadata.getItem(as.href);
    if (cached !== null) return cached;
    // Only successful discovery is cached.
    const fresh = await discoverLwsAuthorizationServer(as, signal, this.#options.http);
    await this.#metadata.setItem(as.href, fresh);
    return fresh;
  }

  #remember(accessToken: string, key: string) {
    this.#issued.set(accessToken, key);
    if (this.#issued.size > 100) this.#issued.delete(this.#issued.keys().next().value!);
  }
}

function usable(token: LwsAccessToken, renewalWindow: number): boolean {
  return token.expiresAt === undefined || Date.now() < token.expiresAt - renewalWindow;
}
