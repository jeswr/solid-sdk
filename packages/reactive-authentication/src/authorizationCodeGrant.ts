import * as oauth from "oauth4webapi";
import type { CodeProvider } from "./CodeProvider.js";
import { withDPoPNonceRetry } from "./dpopNonce.js";
import { clientAuthFor, expectedNonce, isEssMissingIssInteractionNeeded } from "./serverQuirks.js";
import { assertSecureUrl, type HttpOptions, oauthOptions } from "./transport.js";

export interface AuthorizationCodeGrantOptions {
  readonly authorizationServer: oauth.AuthorizationServer;
  readonly client: oauth.Client;
  readonly redirectUri: string;
  readonly codeProvider: CodeProvider;
  readonly scopes: readonly string[];
  readonly signal: AbortSignal;
  readonly dpop?: oauth.DPoPHandle;
  readonly http?: HttpOptions;

  /** Extra authorization request parameters, e.g. `login_hint`. Protocol parameters cannot be overridden. */
  readonly parameters?: Readonly<Record<string, string>>;

  /**
   * Use `prompt=consent` for the interactive attempt when `offline_access` is requested, as OpenID Connect
   * Core §11 requires unless the provider has other grounds to permit offline access.
   * @defaultValue true
   */
  readonly consentForOfflineAccess?: boolean;

  /** Apply the compatibility exceptions in `serverQuirks.ts` for the listed issuers. @defaultValue true */
  readonly serverQuirks?: boolean;

  /**
   * Try `prompt=none` first and fall back to an interactive attempt (OpenID Connect behaviour).
   * Generic OAuth servers may not support `prompt`, so generic sources turn this off. @defaultValue true
   */
  readonly silentFirst?: boolean;

  /** Refuse servers that do not support the S256 PKCE method instead of falling back to `plain`. @defaultValue false */
  readonly requireS256?: boolean;

  /**
   * `prompt` for the interactive attempt (e.g. `login`, `consent`, `select_account`). Overrides the
   * `offline_access` consent default. The silent attempt always uses `none`.
   */
  readonly prompt?: string;

  /** Extra token request parameters, e.g. an RFC 8707 `resource`. */
  readonly tokenParameters?: Readonly<Record<string, string>>;
}

const protectedParameters = new Set([
  "client_id",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "nonce",
  "code_challenge",
  "code_challenge_method",
  "prompt",
]);
const protectedTokenParameters = new Set([
  "grant_type",
  "code",
  "redirect_uri",
  "code_verifier",
  "client_id",
  "client_secret",
  "client_assertion",
  "client_assertion_type",
  "refresh_token",
  "scope",
]);
const interactionErrors = new Set([
  "interaction_required",
  "consent_required",
  "login_required",
  "account_selection_required",
]);

/**
 * OAuth 2.0 authorization code grant with PKCE, state and nonce, fresh for every authorization request.
 *
 * A silent attempt (`prompt=none`) is made first; if the provider needs user interaction, an interactive
 * attempt follows. The code provider (popup, redirect, service-worker bridge…) supplies the redirect URL.
 */
export async function authorizationCodeGrant(
  options: AuthorizationCodeGrantOptions,
): Promise<oauth.TokenEndpointResponse> {
  for (const name of Object.keys(options.parameters ?? {})) {
    if (protectedParameters.has(name))
      throw new TypeError(`Authorization parameter ${name} cannot be overridden`);
  }
  for (const name of Object.keys(options.tokenParameters ?? {})) {
    if (protectedTokenParameters.has(name))
      throw new TypeError(`Token parameter ${name} cannot be overridden`);
  }

  if (options.silentFirst !== false) {
    try {
      return await attempt(options, "none");
    } catch (e) {
      if (!needsInteraction(e, options.authorizationServer.issuer, options.serverQuirks ?? true))
        throw e;
    }
  }

  const offline =
    options.scopes.includes("offline_access") && options.consentForOfflineAccess !== false;
  return await attempt(options, options.prompt ?? (offline ? "consent" : undefined));
}

async function attempt(
  options: AuthorizationCodeGrantOptions,
  prompt: string | undefined,
): Promise<oauth.TokenEndpointResponse> {
  const { authorizationServer: as, client, signal } = options;
  options.signal.throwIfAborted();

  const openid = options.scopes.includes("openid");
  const state = oauth.generateRandomState();
  // A nonce binds an ID token to this request; without openid there is no ID token to bind.
  const nonce = openid ? oauth.generateRandomNonce() : undefined;
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const pkce = pkceMethod(as);
  if (pkce !== "S256" && options.requireS256 === true)
    throw new Error(`${as.issuer} does not support the S256 PKCE method`);

  if (as.authorization_endpoint === undefined)
    throw new Error(`${as.issuer} has no authorization_endpoint`);
  const url = new URL(as.authorization_endpoint);
  // The user is sent here with the code challenge: HTTPS only, unless insecure requests were opted into.
  assertSecureUrl(url, options.http);
  const params = url.searchParams;
  params.set("client_id", client.client_id);
  params.set("redirect_uri", options.redirectUri);
  params.set("response_type", "code");
  params.set("scope", options.scopes.join(" "));
  params.set("state", state);
  if (nonce !== undefined) params.set("nonce", nonce);
  params.set("code_challenge_method", pkce);
  params.set(
    "code_challenge",
    pkce === "S256" ? await oauth.calculatePKCECodeChallenge(codeVerifier) : codeVerifier,
  );
  if (prompt !== undefined) params.set("prompt", prompt);
  for (const [name, value] of Object.entries(options.parameters ?? {})) params.set(name, value);

  let callbackParameters: URLSearchParams;
  {
    using response = await options.codeProvider.getCode(url, signal);
    const callback = new URL(response.value);
    assertRedirectUri(callback, options.redirectUri);
    callbackParameters = oauth.validateAuthResponse(as, client, callback, state);
  }

  const requestOptions = {
    ...oauthOptions(options.http, signal),
    ...(options.dpop === undefined ? {} : { DPoP: options.dpop }),
    ...(options.tokenParameters === undefined
      ? {}
      : { additionalParameters: options.tokenParameters }),
  };
  return await withDPoPNonceRetry(async () => {
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuthFor(as.issuer, client, options.serverQuirks ?? true),
      callbackParameters,
      options.redirectUri,
      codeVerifier,
      requestOptions,
    );
    return await oauth.processAuthorizationCodeResponse(as, client, response, {
      ...(nonce === undefined
        ? {}
        : { expectedNonce: expectedNonce(as.issuer, nonce, options.serverQuirks ?? true) }),
      requireIdToken: openid,
    });
  });
}

/**
 * The authorization response must come back to the configured redirect URI — same origin and path, every fixed
 * query parameter of the redirect URI unchanged, no credentials or fragment — in addition to the state and
 * issuer checks: a code delivered anywhere else is not ours to redeem.
 */
function assertRedirectUri(callback: URL, redirectUri: string) {
  const expected = new URL(redirectUri);
  const fixed = [...expected.searchParams].every(([name, value]) => {
    const values = callback.searchParams.getAll(name);
    return values.length === 1 && values[0] === value;
  });
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    !fixed ||
    callback.username !== "" ||
    callback.password !== "" ||
    callback.hash !== ""
  ) {
    throw new Error(`Authorization response did not arrive at the redirect URI ${expected.href}`);
  }
}

/** S256 unless the server advertises only `plain`. */
function pkceMethod(as: oauth.AuthorizationServer): "S256" | "plain" {
  const methods = as.code_challenge_methods_supported;
  return methods !== undefined && !methods.includes("S256") && methods.includes("plain")
    ? "plain"
    : "S256";
}

function needsInteraction(e: unknown, issuer: string, quirks: boolean): boolean {
  return (
    (e instanceof oauth.AuthorizationResponseError && interactionErrors.has(e.error)) ||
    // TODO: Eliminate once ESS bug fixed
    isEssMissingIssInteractionNeeded(e, issuer, quirks)
  );
}
