// AUTHORED-BY Claude Fable 5
/**
 * Server-side SERVICE identity for pod IO (L4): a DPoP-bound
 * OAuth `client_credentials` session for an app's OWN WebID, used where a
 * pod enforces WAC against that WebID (a grant the pod owner materialises
 * names the service agent; enforcement stays at the pod, never in app code).
 *
 * Extracted verbatim from the reviewed reference implementation (only the
 * jose v6 `KeyLike` → `CryptoKey` type rename).
 *
 * Shape matches the standard Solid service-account pattern (CSS/ESS client credentials):
 * the operator provisions a confidential client at an issuer that binds the client to the
 * service's WebID; this module discovers the token endpoint, obtains a DPoP-bound
 * RFC 9068 access token, and mints a fresh single-use RFC 9449 proof per request.
 *
 * Fail-closed posture:
 *   - https-only endpoints and resources (loopback http under the explicit dev flag);
 *   - every request refuses redirects (a credentialed hop must never leave the origin
 *     the caller named);
 *   - token-endpoint failures throw — callers surface them as 5xx, never as anonymous
 *     retries;
 *   - the client secret is never echoed into errors.
 *
 * SERVER-ONLY — never import from browser code: the client secret lives in server env.
 */
import { createHash, randomUUID } from "node:crypto";
import { base64url, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

/** Options for {@link createServicePodFetch}. */
export interface ServicePodFetchOptions {
  /** OIDC issuer that authenticates the service identity. */
  issuer: string;
  /** Confidential client id registered for the service identity. */
  clientId: string;
  /** Confidential client secret. Server env only — never bundled client-side. */
  clientSecret: string;
  /** Permit `http:` for LOOPBACK hosts only (dev/e2e issuers and pods). Default false. */
  allowInsecureLoopback?: boolean;
  /**
   * Transport seam (tests). The seam is wrapped with `redirect: "error"` on every call,
   * so an injected fetch cannot re-enable credentialed redirect following.
   */
  fetch?: typeof fetch;
  /** Seconds before token expiry at which a refresh is forced. Default 30. */
  refreshSkewSeconds?: number;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validate a URL the credentialed session may touch: https, or loopback http in dev. */
function assertServiceUrl(value: string, label: string, allowInsecureLoopback: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid absolute URL`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label} must not carry userinfo credentials`);
  }
  const loopbackOk =
    allowInsecureLoopback && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackOk) {
    throw new Error(`${label} must be https (loopback http under allowInsecureLoopback only)`);
  }
  return url;
}

/** RFC 9449: `htu` binds scheme/authority/path only — never query or fragment. */
function htuOf(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

interface DpopKey {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

/**
 * Build the service identity's pod fetch. Construction is cheap and lazy: no key is
 * generated and no network is touched until the first request. The returned fetch caches
 * the access token until near expiry and mints a fresh single-use DPoP proof per call.
 */
export function createServicePodFetch(options: ServicePodFetchOptions): typeof fetch {
  const allowLoopback = options.allowInsecureLoopback === true;
  const issuerUrl = assertServiceUrl(options.issuer, "service issuer", allowLoopback);
  const issuerBase = issuerUrl.href.replace(/\/+$/u, "");
  const refreshSkewMs = (options.refreshSkewSeconds ?? 30) * 1000;
  const baseFetch = options.fetch ?? fetch;
  // Redirect refusal is enforced HERE, outside any seam (see the option doc).
  const transport: typeof fetch = (input, init) => baseFetch(input, { ...init, redirect: "error" });

  let keyPromise: Promise<DpopKey> | undefined;
  const getKey = (): Promise<DpopKey> => {
    keyPromise ??= (async () => {
      const keys = await generateKeyPair("ES256", { extractable: true });
      return { privateKey: keys.privateKey, publicJwk: await exportJWK(keys.publicKey) };
    })();
    return keyPromise;
  };

  async function proof(
    key: DpopKey,
    method: string,
    htu: string,
    accessToken?: string,
  ): Promise<string> {
    const claims: Record<string, unknown> = { htm: method, htu, jti: randomUUID() };
    if (accessToken !== undefined) {
      claims.ath = base64url.encode(createHash("sha256").update(accessToken, "ascii").digest());
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", jwk: key.publicJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(key.privateKey);
  }

  let tokenEndpointPromise: Promise<string> | undefined;
  const getTokenEndpoint = (): Promise<string> => {
    tokenEndpointPromise ??= (async () => {
      const response = await transport(`${issuerBase}/.well-known/openid-configuration`);
      if (!response.ok) {
        throw new Error(`service issuer discovery failed (${response.status})`);
      }
      const document = (await response.json()) as { token_endpoint?: unknown };
      if (typeof document.token_endpoint !== "string") {
        throw new Error("service issuer discovery document has no token_endpoint");
      }
      return assertServiceUrl(document.token_endpoint, "service token endpoint", allowLoopback)
        .href;
    })();
    // A failed discovery must not poison the session forever — retry next call.
    tokenEndpointPromise.catch(() => {
      tokenEndpointPromise = undefined;
    });
    return tokenEndpointPromise;
  };

  let cachedToken: { value: string; expiresAtMs: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function requestToken(): Promise<string> {
    const tokenEndpoint = new URL(await getTokenEndpoint());
    const key = await getKey();
    const response = await transport(tokenEndpoint.href, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        dpop: await proof(key, "POST", htuOf(tokenEndpoint)),
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "webid",
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
    });
    if (!response.ok) {
      // Status only — the response body may echo request material.
      throw new Error(`service token request was refused (${response.status})`);
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || body.access_token === "") {
      throw new Error("service token response carried no access token");
    }
    const lifetimeMs =
      typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in * 1000 : 60_000;
    cachedToken = { value: body.access_token, expiresAtMs: Date.now() + lifetimeMs };
    return body.access_token;
  }

  function accessToken(): Promise<string> {
    if (cachedToken !== undefined && Date.now() < cachedToken.expiresAtMs - refreshSkewMs) {
      return Promise.resolve(cachedToken.value);
    }
    // Single-flight: concurrent requests share one refresh.
    refreshing ??= requestToken().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  return async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const url = assertServiceUrl(request.url, "service pod request", allowLoopback);
    const token = await accessToken();
    const key = await getKey();
    const headers = new Headers(request.headers);
    headers.set("authorization", `DPoP ${token}`);
    headers.set("dpop", await proof(key, request.method, htuOf(url), token));
    return transport(new Request(request, { headers }));
  };
}
