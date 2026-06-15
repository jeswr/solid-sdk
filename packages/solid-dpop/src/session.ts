/**
 * Server-side Solid-OIDC session: the consumer custodies one DPoP keypair + access token
 * per connection and uses them to make sender-constrained (RFC 9449) requests to a pod.
 *
 * Token acquisition here uses the **client-credentials** grant (CSS `.account` API):
 * the connection is provisioned with a CSS client-credentials token `{id, secret}` that
 * is exchanged at the OIDC `token_endpoint` for a DPoP-bound access token. This is the
 * grant a self-hosted / service-account consumer uses. A user-delegated consumer would
 * instead hold a refresh token from an authorization-code flow; the resource-request half
 * (`authedFetch`) is identical, only `acquireToken` differs.
 */
import { createDpopProof, type DpopKeyPair, generateDpopKeyPair } from "./dpop.js";

export interface ClientCredentials {
  /** OIDC issuer base URL (the pod's IdP), e.g. http://localhost:3099/ */
  readonly issuer: string;
  /** CSS client-credentials token id. */
  readonly id: string;
  /** CSS client-credentials token secret. */
  readonly secret: string;
}

interface OidcConfig {
  readonly token_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface SolidSessionState {
  readonly keyPair: DpopKeyPair;
  accessToken: string;
  /** epoch ms after which the token is considered expired. */
  expiresAt: number;
  /** Last DPoP nonce handed back by the resource/AS server, if any. */
  nonce?: string;
}

/**
 * Minimal fetch-like signature so tests can inject a transport. Consumers only ever send a
 * `string` or `Uint8Array` body; both are valid runtime `BodyInit`s for global fetch, but we
 * keep the narrow union here (rather than DOM `BodyInit`) so tests can supply a simple stub.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  },
) => Promise<Response>;

/**
 * The default transport: global fetch, adapted to FetchLike. A thin wrapper is needed because
 * the lib DOM `fetch` type and our narrow `FetchLike` body union are not structurally
 * assignable in both directions under strict settings; the runtime values are compatible.
 */
const defaultFetch: FetchLike = (input, init) =>
  globalThis.fetch(input, init as RequestInit | undefined);

/**
 * Build the OIDC Discovery URL for an issuer. Per OpenID Connect Discovery 1.0 §4, the well-known
 * suffix is APPENDED to the issuer (including any path), so `https://host/realm` →
 * `https://host/realm/.well-known/openid-configuration`. The naive `new URL(".well-known/...",
 * issuer)` resolves relative to the issuer's *parent* and drops the last path segment (`/realm`),
 * breaking non-root issuers like Keycloak realms.
 */
export function discoveryUrl(issuer: string): string {
  const u = new URL(issuer);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  return u.toString();
}

async function discoverTokenEndpoint(issuer: string, fetchImpl: FetchLike): Promise<string> {
  const url = discoveryUrl(issuer);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }
  const cfg = (await res.json()) as OidcConfig;
  if (!cfg.token_endpoint) {
    throw new Error(`No token_endpoint in OIDC config at ${url}`);
  }
  return cfg.token_endpoint;
}

/** Generate a fresh DPoP keypair for a new session. node:crypto/jose only — no hand-rolled keygen. */
export async function generateSessionKeyPair(): Promise<DpopKeyPair> {
  return generateDpopKeyPair();
}

/**
 * Exchange client-credentials for a DPoP-bound access token. Handles the RFC 9449 §8
 * `use_dpop_nonce` challenge: if the AS rejects the first attempt demanding a nonce, we
 * retry once with the supplied `DPoP-Nonce`.
 */
export async function acquireToken(
  creds: ClientCredentials,
  keyPair: DpopKeyPair,
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ accessToken: string; expiresAt: number; nonce?: string }> {
  const tokenEndpoint = await discoverTokenEndpoint(creds.issuer, fetchImpl);
  const authHeader =
    "Basic " +
    Buffer.from(`${encodeURIComponent(creds.id)}:${encodeURIComponent(creds.secret)}`).toString(
      "base64",
    );

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "webid",
  }).toString();

  const attempt = async (nonce?: string): Promise<Response> => {
    const dpop = await createDpopProof({
      keyPair,
      htm: "POST",
      htu: tokenEndpoint,
      ...(nonce !== undefined ? { nonce } : {}),
    });
    return fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        authorization: authHeader,
        "content-type": "application/x-www-form-urlencoded",
        dpop,
      },
      body,
    });
  };

  let res = await attempt();
  let nonce = res.headers.get("DPoP-Nonce") ?? undefined;
  if (res.status === 400 && nonce) {
    // RFC 9449 §8 nonce challenge — retry once with the nonce.
    res = await attempt(nonce);
    nonce = res.headers.get("DPoP-Nonce") ?? nonce;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const token = (await res.json()) as TokenResponse;
  const expiresAt = Date.now() + (token.expires_in ?? 300) * 1000;
  return { accessToken: token.access_token, expiresAt, ...(nonce ? { nonce } : {}) };
}

/** Create a fully-initialised server-side session (keypair + first token). */
export async function createSession(
  creds: ClientCredentials,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SolidSessionState> {
  const keyPair = await generateSessionKeyPair();
  const { accessToken, expiresAt, nonce } = await acquireToken(creds, keyPair, fetchImpl);
  return { keyPair, accessToken, expiresAt, ...(nonce ? { nonce } : {}) };
}

/**
 * Make a DPoP-bound request to a pod resource. Sends `Authorization: DPoP <token>` plus a
 * fresh per-request DPoP proof carrying the `ath` binding. Handles the §8 nonce challenge
 * (401 + DPoP-Nonce) with a single retry, persisting the nonce on the session.
 *
 * `creds` is the client-credentials token used to silently re-mint an expired access token. It is
 * OPTIONAL: a user-delegated (authorization-code) session has no client-credentials and instead
 * refreshes via `refreshSession` from `authCode.ts`, so it passes `undefined` here — in that case
 * an expired token is left as-is for the caller (or its own refresh loop) to handle.
 */
export async function authedFetch(
  session: SolidSessionState,
  creds: ClientCredentials | undefined,
  method: string,
  url: string,
  init: { headers?: Record<string, string>; body?: string | Uint8Array } = {},
  fetchImpl: FetchLike = defaultFetch,
): Promise<Response> {
  if (creds && Date.now() >= session.expiresAt) {
    const refreshed = await acquireToken(creds, session.keyPair, fetchImpl);
    session.accessToken = refreshed.accessToken;
    session.expiresAt = refreshed.expiresAt;
    if (refreshed.nonce) session.nonce = refreshed.nonce;
  }

  const doRequest = async (nonce?: string): Promise<Response> => {
    const dpop = await createDpopProof({
      keyPair: session.keyPair,
      htm: method,
      htu: url,
      accessToken: session.accessToken,
      ...(nonce !== undefined ? { nonce } : {}),
    });
    const headers: Record<string, string> = {
      ...(init.headers ?? {}),
      authorization: `DPoP ${session.accessToken}`,
      dpop,
    };
    return fetchImpl(url, {
      method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  };

  let res = await doRequest(session.nonce);
  const challenge = res.headers.get("DPoP-Nonce");
  if (res.status === 401 && challenge && challenge !== session.nonce) {
    session.nonce = challenge;
    res = await doRequest(session.nonce);
    const next = res.headers.get("DPoP-Nonce");
    if (next) session.nonce = next;
  } else {
    const next = res.headers.get("DPoP-Nonce");
    if (next) session.nonce = next;
  }
  return res;
}

/**
 * Build an RDF-capable fetch (the signature `@jeswr/fetch-rdf` expects) bound to this session.
 * Adapts the standard DOM `fetch` signature down onto `authedFetch`, so RDF helpers that take a
 * `fetch` option can transparently issue DPoP-bound requests.
 */
export function rdfFetchFor(
  session: SolidSessionState,
  creds: ClientCredentials | undefined,
  fetchImpl: FetchLike = defaultFetch,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        headers[k] = v;
      });
    }
    const body = init?.body as string | Uint8Array | undefined;
    return authedFetch(
      session,
      creds,
      method,
      url,
      { headers, ...(body !== undefined ? { body } : {}) },
      fetchImpl,
    );
  }) as typeof globalThis.fetch;
}
