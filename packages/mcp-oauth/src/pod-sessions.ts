// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf } from "@jeswr/fetch-rdf";
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import { exportDpopKeyPairJwk, importDpopKeyPairJwk } from "@jeswr/solid-dpop";
import {
  type AuthorizationRequestState,
  createSolidOidcClient,
  type SolidOidcClient,
} from "@jeswr/solid-openid-client";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import {
  digest,
  GRANT_TTL,
  LOGIN_TTL,
  mediaType,
  opaque,
  parameter,
  readBody,
  secureUrl,
  unique,
} from "./protocol.js";
import type { PodSession, PodSessionProvider } from "./types.js";
import type { SessionVault } from "./vault.js";

const OIDC_ISSUER = "http://www.w3.org/ns/solid/terms#oidcIssuer";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const MAX_CACHED_CLIENTS = 256;
const CLIENT_CACHE_TTL = 300;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
type PrivateJwk = Awaited<ReturnType<typeof exportDpopKeyPairJwk>>;
type CachedClient = { bytes: Uint8Array; client: SolidOidcClient };

class Profile extends TermWrapper {
  get issuers(): Set<string> {
    return SetFrom.subjectPredicate(this, OIDC_ISSUER, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get storages(): Set<string> {
    return SetFrom.subjectPredicate(this, STORAGE, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

interface Pending {
  kind: "pending";
  issuer: string;
  expectedWebId?: string;
  state: AuthorizationRequestState;
  key: PrivateJwk;
  expiresAt: number;
}
interface StoredPodSession {
  kind: "session";
  identity: PodSession;
  issuer: string;
  redirect: string;
  clientId: string;
  key: PrivateJwk;
  refreshToken: string;
  roots: string[];
  expiresAt: number;
  accessExpiresAt: number;
  refreshing: boolean;
}

/** Solid-OIDC public client configuration; MCP-11 serves the Client ID Document. */
export interface PodSessionProviderOptions {
  clientId: string;
  /** Exact registered redirect URI, also checked against begin()/complete(). */
  redirectUri: string;
  vault: SessionVault;
  /** Trusted DNS-pinned, bounded transport; fixtures may inject an offline issuer. */
  fetch?: typeof fetch;
  now?: () => number;
}

/** Upstream login broker. Only the two identity fields cross the MCP protocol boundary. */
export function createPodSessionProvider(options: PodSessionProviderOptions): PodSessionProvider & {
  isActive(sessionId: string): Promise<boolean>;
} {
  secureUrl(options.clientId);
  const redirectUri = secureUrl(options.redirectUri);
  if (redirectUri.search) throw new Error("Pod callback must not contain a query");
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const fetcher = refuseRedirects(
    options.fetch ??
      createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 8_000, maxRedirects: 0 }),
  );
  const vault = options.vault;
  const clients = new Map<
    string,
    CachedClient & { expiresAt: number; timer: ReturnType<typeof setTimeout> }
  >();
  const forgetClient = (id: string) => {
    const cached = clients.get(id);
    if (cached) {
      clearTimeout(cached.timer);
      clients.delete(id);
    }
  };
  const pruneClients = () => {
    for (const [id, cached] of clients) {
      if (cached.expiresAt <= now()) forgetClient(id);
    }
  };
  const cacheClient = (
    value: Pick<StoredPodSession, "identity" | "expiresAt" | "accessExpiresAt">,
    bytes: Uint8Array,
    client: SolidOidcClient,
  ) => {
    pruneClients();
    const id = value.identity.id;
    forgetClient(id);
    const cached = { bytes, client };
    const expiresAt = Math.min(value.expiresAt, value.accessExpiresAt, now() + CLIENT_CACHE_TTL);
    if (expiresAt > now()) {
      if (clients.size >= MAX_CACHED_CLIENTS) forgetClient(clients.keys().next().value as string);
      const timer = setTimeout(() => forgetClient(id), (expiresAt - now()) * 1000);
      timer.unref();
      clients.set(id, { ...cached, expiresAt, timer });
    }
    return cached;
  };
  const pendingKey = (state: string) => `login:${digest(state)}`;
  const sessionKey = (id: string) => `session:${id}`;
  const webUrl = (value: string) => {
    const url = new URL(value);
    url.hash = "";
    secureUrl(url.href);
    if (/[\s\\]/u.test(value)) throw new Error("Invalid WebID");
    return url;
  };
  const profile = async (webId: string) => {
    const { dataset } = await fetchRdf(webUrl(webId).href, { fetch: fetcher });
    return new Profile(webId, dataset, DataFactory);
  };
  const clientFor = async (issuer: string, key?: PrivateJwk) =>
    createSolidOidcClient({
      issuer,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      scope: "openid webid offline_access",
      ...(key === undefined ? {} : { dpopKeyPair: await importDpopKeyPairJwk(key) }),
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const response = await fetcher(request, { credentials: "omit" });
        const url = new URL(request.url);
        if (url.pathname.endsWith("/.well-known/openid-configuration") && response.status === 200) {
          const metadata = JSON.parse(await readBody(response.clone()));
          if (metadata.issuer !== issuer) throw new Error("Pod issuer mismatch");
        }
        return response;
      },
    });
  const readSession = async (id: string) => {
    pruneClients();
    try {
      const bytes = await vault.get(sessionKey(id));
      if (!bytes) {
        forgetClient(id);
        return undefined;
      }
      const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as StoredPodSession;
      if (
        value.kind !== "session" ||
        value.identity.id !== id ||
        value.clientId !== options.clientId ||
        value.redirect !== options.redirectUri
      )
        throw new Error("Invalid pod session");
      if (!(value.expiresAt > now())) {
        forgetClient(id);
        return undefined;
      }
      return { bytes, value };
    } catch (error) {
      forgetClient(id);
      throw error;
    }
  };
  const provider = {
    async begin(webIdOrIssuer: string, redirect: string) {
      if (redirect !== options.redirectUri) throw new Error("Pod callback mismatch");
      webUrl(webIdOrIssuer);
      let issuer = webIdOrIssuer;
      let expectedWebId: string | undefined;
      const discovery = new URL(webIdOrIssuer);
      discovery.hash = "";
      discovery.pathname = `${discovery.pathname.replace(/\/$/u, "")}/.well-known/openid-configuration`;
      const response = await fetcher(discovery, { credentials: "omit" });
      if (response.status === 404) {
        const view = await profile(webIdOrIssuer);
        if (view.issuers.size !== 1) throw new Error("WebID must advertise exactly one issuer");
        issuer = [...view.issuers][0] as string;
        expectedWebId = webIdOrIssuer;
      } else {
        if (response.status !== 200 || mediaType(response) !== "application/json")
          throw new Error("Pod discovery failed");
        const metadata = JSON.parse(await readBody(response));
        if (metadata.issuer !== issuer) throw new Error("Pod issuer mismatch");
      }
      secureUrl(issuer);
      const client = await clientFor(issuer);
      const authorization = await client.authorizationUrl({ prompt: "consent" });
      const pending: Pending = {
        kind: "pending",
        issuer,
        expectedWebId,
        state: authorization.state,
        key: await exportDpopKeyPairJwk(client.dpopKeyPair),
        expiresAt: now() + LOGIN_TTL,
      };
      if (
        !(await vault.compareAndSwap(
          pendingKey(authorization.state.state),
          undefined,
          encode(pending),
        ))
      )
        throw new Error("Login collision");
      return { authorizeUrl: authorization.url, state: authorization.state.state };
    },
    async complete(callbackUrl: string, state: string): Promise<PodSession> {
      const callback = new URL(callbackUrl);
      if (callback.origin + callback.pathname !== options.redirectUri || callback.hash)
        throw new Error("Pod callback mismatch");
      unique(callback.searchParams);
      if (parameter(callback.searchParams, "state") !== state)
        throw new Error("Pod state mismatch");
      const id = pendingKey(state);
      const bytes = await vault.get(id);
      if (!bytes) throw new Error("Unknown pod login");
      const pending = JSON.parse(Buffer.from(bytes).toString("utf8")) as Pending;
      if (
        pending.kind !== "pending" ||
        !(await vault.compareAndSwap(id, bytes, encode({ kind: "used" })))
      )
        throw new Error("Pod login already consumed");
      await vault.delete(id);
      if (pending.expiresAt <= now()) throw new Error("Expired pod login");
      const client = await clientFor(pending.issuer, pending.key);
      const session = await client.handleCallback({ url: callbackUrl }, pending.state);
      if (pending.expectedWebId !== undefined && session.webId !== pending.expectedWebId)
        throw new Error("Pod WebID mismatch");
      const view = await profile(session.webId);
      if (!view.issuers.has(pending.issuer)) throw new Error("WebID issuer mismatch");
      if (!session.tokens.refreshToken) throw new Error("offline_access was not granted");
      const roots = [...view.storages];
      for (const root of roots) secureUrl(root);
      const identity = { id: opaque(), webId: session.webId };
      const stored: StoredPodSession = {
        kind: "session",
        identity,
        issuer: session.issuer,
        redirect: options.redirectUri,
        clientId: options.clientId,
        key: pending.key,
        refreshToken: session.tokens.refreshToken,
        roots,
        expiresAt: now() + GRANT_TTL,
        accessExpiresAt: now() + (session.tokens.expiresIn ?? 0),
        refreshing: false,
      };
      const secret = encode(stored);
      if (!(await vault.compareAndSwap(sessionKey(identity.id), undefined, secret)))
        throw new Error("Pod session collision");
      cacheClient(stored, secret, client);
      return { ...identity };
    },
    async isActive(id: string) {
      return (await readSession(id)) !== undefined;
    },
    async fetchFor(id: string): Promise<typeof fetch> {
      if (!(await provider.isActive(id))) throw new Error("Pod session is inactive");
      return async (input, init) => {
        const stored = await readSession(id);
        if (!stored) throw new Error("Pod session is inactive");
        const { value, bytes } = stored;
        const url = input instanceof Request ? input.url : input.toString();
        if (!value.roots.some((root) => isWithinPodScope(root, url)))
          throw new Error("Outside pod session scope");
        const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((v, k) => {
          requestHeaders.set(k, v);
        });
        if (
          requestHeaders.has("authorization") ||
          requestHeaders.has("dpop") ||
          requestHeaders.has("cookie")
        )
          throw new Error("Caller credentials are forbidden");
        let cached: CachedClient | undefined = clients.get(id);
        if (!cached || !Buffer.from(cached.bytes).equals(bytes) || value.accessExpiresAt <= now()) {
          forgetClient(id);
          if (value.refreshing) throw new Error("Pod refresh is already claimed");
          const claimed = encode({ ...value, refreshing: true });
          if (!(await vault.compareAndSwap(sessionKey(id), bytes, claimed)))
            throw new Error("Pod session conflict");
          try {
            const client = await clientFor(value.issuer, value.key);
            const tokens = await client.refresh(value.refreshToken);
            const webId = client.currentWebId();
            if (webId !== undefined && webId !== value.identity.webId)
              throw new Error("Refreshed WebID mismatch");
            const updated = {
              ...value,
              refreshToken: tokens.refreshToken,
              accessExpiresAt: now() + (tokens.expiresIn ?? 0),
              refreshing: false,
            };
            const secret = encode(updated);
            if (!(await vault.compareAndSwap(sessionKey(id), claimed, secret)))
              throw new Error("Pod session was revoked");
            cached = cacheClient(updated, secret, client);
          } catch (error) {
            forgetClient(id);
            await vault.delete(sessionKey(id));
            throw error;
          }
        }
        if (!(await provider.isActive(id))) throw new Error("Pod session is inactive");
        return cached.client.fetch(input, { ...init, redirect: "manual", credentials: "omit" });
      };
    },
    async revoke(id: string) {
      forgetClient(id);
      await vault.delete(sessionKey(id));
    },
  };
  return provider;
}
