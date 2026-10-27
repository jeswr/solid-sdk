// AUTHORED-BY Codex GPT-6.1-Sol
import { type DpopKeyPair, importDpopKeyPairJwk } from "@jeswr/solid-dpop";
import { assertSecureTransport, buildDpopCustomFetch } from "./dpopFetch.js";
import type { SolidJwtState } from "./session.js";
import type { FetchLike } from "./types.js";

const OAUTH_ERROR_CODES = [
  "invalid_grant",
  "invalid_client",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_dpop_proof",
  "use_dpop_nonce",
  "server_error",
  "temporarily_unavailable",
] as const;

/** Safe, bounded error codes; arbitrary authorization-server text is never exposed. */
export type SolidSessionRefreshErrorCode =
  | (typeof OAUTH_ERROR_CODES)[number]
  | "invalid_session"
  | "invalid_options"
  | "invalid_response"
  | "oauth_error"
  | "network";

/** A refresh failure containing no tokens, JWKs, response bodies, URLs or upstream error causes. */
export class SolidSessionRefreshError extends Error {
  readonly code: SolidSessionRefreshErrorCode;

  constructor(code: SolidSessionRefreshErrorCode) {
    super(`Solid session refresh failed (${code}).`);
    this.name = "SolidSessionRefreshError";
    this.code = code;
  }
}

/** Options for {@link refreshSolidSession}; use the same client registration as the provider. */
export interface RefreshSolidSessionOptions {
  /** The original provider's client identifier. */
  readonly clientId: string;
  /** Confidential clients authenticate with Basic, matching Solid(); omit for public clients. */
  readonly clientSecret?: string;
  /** Required pristine fetch captured BEFORE any global patch; used for discovery and token HTTP. */
  readonly fetch: FetchLike;
  /** Permit HTTP on loopback only, for development. Default false. */
  readonly allowInsecure?: boolean;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function secureUrl(
  raw: string,
  allowInsecure: boolean,
  code: "invalid_session" | "invalid_response",
): URL {
  assertSecureTransport(raw, allowInsecure, () => new SolidSessionRefreshError(code));
  const url = new URL(raw);
  if (url.username || url.password || url.hash) {
    throw new SolidSessionRefreshError(code);
  }
  return url;
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      throw new Error();
    }
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error();
    }
    return body as Record<string, unknown>;
  } catch {
    throw new SolidSessionRefreshError("invalid_response");
  }
}

/** RFC 6749 §2.3.1 requires form-encoding BOTH Basic credentials before base64 encoding. */
function formEncode(value: string): string {
  return new URLSearchParams([["", value]]).toString().slice(1);
}

/**
 * Redeem a persisted Auth.js Solid session's refresh token (RFC 6749 §6).
 *
 * Discovers `<issuer>/.well-known/openid-configuration`, validates issuer equality and transport,
 * then uses the provider's DPoP token seam with the SAME persisted private key, no `ath`, redirect
 * refusal, and at most one nonce retry. Requires a pristine fetch; never reads global fetch.
 *
 * Returns new state, preserving the verified identity, ID token and key. An absent rotated refresh
 * token retains the old one. `expiresAt` is epoch SECONDS, counted from the token request's start;
 * an omitted `expires_in` clears the previous expiry because the new token's lifetime is unknown.
 * Does not verify or adopt an ID token returned by refresh. Callers own persistence and concurrency
 * control when an authorization server rotates single-use refresh tokens.
 *
 * @throws {@link SolidSessionRefreshError} for invalid inputs, malformed metadata/token responses,
 * OAuth failures, or network/redirect failures. Never includes raw server or upstream error text.
 */
export async function refreshSolidSession(
  session: SolidJwtState,
  options: RefreshSolidSessionOptions,
): Promise<SolidJwtState> {
  if (
    !options ||
    !nonemptyString(options.clientId) ||
    typeof options.fetch !== "function" ||
    (options.clientSecret !== undefined && !nonemptyString(options.clientSecret))
  ) {
    throw new SolidSessionRefreshError("invalid_options");
  }
  if (!session || !nonemptyString(session.refreshToken) || !nonemptyString(session.issuer)) {
    throw new SolidSessionRefreshError("invalid_session");
  }
  const allowInsecure = options.allowInsecure === true;
  const expectedIssuer = session.issuer;
  const issuer = secureUrl(expectedIssuer, allowInsecure, "invalid_session");
  if (issuer.search) {
    throw new SolidSessionRefreshError("invalid_session");
  }

  let keyPair: DpopKeyPair;
  try {
    const jwk = session.dpopKeyJwk;
    if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || !nonemptyString(jwk.d)) {
      throw new Error();
    }
    keyPair = await importDpopKeyPairJwk(jwk);
  } catch {
    throw new SolidSessionRefreshError("invalid_session");
  }

  // Same OIDC discovery location and manual redirect policy used by Auth.js's oauth4webapi.
  const discoveryUrl = new URL(issuer.href);
  discoveryUrl.pathname = `${issuer.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let discovery: Response;
  try {
    discovery = await options.fetch(discoveryUrl.href, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      credentials: "omit",
    });
  } catch {
    throw new SolidSessionRefreshError("network");
  }
  if (discovery.status !== 200) {
    throw new SolidSessionRefreshError("invalid_response");
  }
  const metadata = await jsonObject(discovery);
  // OIDC Discovery §§4.3–5 requires identifier equality without URL normalization.
  if (metadata.issuer !== expectedIssuer) {
    throw new SolidSessionRefreshError("invalid_response");
  }
  if (!nonemptyString(metadata.token_endpoint)) {
    throw new SolidSessionRefreshError("invalid_response");
  }
  const endpoint = secureUrl(metadata.token_endpoint, allowInsecure, "invalid_response");
  const tokenFetch = buildDpopCustomFetch(keyPair, options.fetch, allowInsecure);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: options.clientId,
  });
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  });
  if (options.clientSecret !== undefined) {
    headers.set(
      "authorization",
      `Basic ${btoa(`${formEncode(options.clientId)}:${formEncode(options.clientSecret)}`)}`,
    );
  }
  const requestedAt = Math.floor(Date.now() / 1000);
  let response: Response;
  try {
    response = await tokenFetch(endpoint.href, {
      method: "POST",
      headers,
      body: body.toString(),
      credentials: "omit",
    });
  } catch {
    // Do not retain the original exception: redirect URLs and custom-fetch errors may hold secrets.
    throw new SolidSessionRefreshError("network");
  }
  const token = await jsonObject(response);
  if (response.status !== 200) {
    if (!nonemptyString(token.error)) {
      throw new SolidSessionRefreshError("invalid_response");
    }
    const code = OAUTH_ERROR_CODES.find((code) => code === token.error) ?? "oauth_error";
    throw new SolidSessionRefreshError(code);
  }
  if (
    token.error !== undefined ||
    typeof token.token_type !== "string" ||
    token.token_type.toLowerCase() !== "dpop" ||
    !nonemptyString(token.access_token) ||
    (token.expires_in !== undefined &&
      (typeof token.expires_in !== "number" ||
        !Number.isSafeInteger(token.expires_in) ||
        token.expires_in < 0 ||
        !Number.isSafeInteger(requestedAt + token.expires_in))) ||
    (token.refresh_token !== undefined && !nonemptyString(token.refresh_token))
  ) {
    throw new SolidSessionRefreshError("invalid_response");
  }
  const { expiresAt: _expiresAt, ...withoutExpiry } = session;
  return {
    ...withoutExpiry,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    ...(token.expires_in === undefined ? {} : { expiresAt: requestedAt + token.expires_in }),
  };
}
