// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * The shared end-user OAuth2 engine: authorization-code + PKCE (S256) in a
 * popup. Generic — adapters supply only endpoints/scopes/params via
 * `OAuthAppConfig`.
 *
 * Security posture (docs/integrations-catalog.md):
 * - access tokens live in memory; refresh credentials may use an injected encrypted vault;
 * - the code is exchanged directly with the platform's token endpoint
 *   (public PKCE client), or with the adapter's declared token proxy when the
 *   platform refuses secretless exchanges — never anywhere else;
 * - `state` is checked on every callback; a mismatch is surfaced as a
 *   possible CSRF, never silently retried.
 *
 * The pure pieces (PKCE pair, URL building, callback parsing, code exchange)
 * are exported for vitest; only `authorize()` touches `window`.
 */
import { type ConnectorTokenVault, ConnectorVaultError, type VaultRecord } from "../vault.js";
import { readJson } from "./budget.js";
import { IntegrationAuthError, UnreadableCredentialError } from "./errors.js";
import { createSourceAuth } from "./import-runner.js";
import { clearToken } from "./token-store.js";
import type { IntegrationAdapter, OAuthAppConfig, SourceAuth, TokenSet } from "./types.js";

/** Where the popup lands; must exist in `public/` and postMessage back. */
export const OAUTH_CALLBACK_PATH = "/oauth-callback.html";

/** The message the callback page posts to its opener. */
export interface OAuthCallbackMessage {
  type: "pod-manager-oauth";
  url: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 verifier (43–128 chars) + S256 challenge, via WebCrypto. */
export async function generatePkcePair(): Promise<PkcePair> {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Random `state` for CSRF binding. */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Build the platform's authorize URL for a PKCE request. */
export function buildAuthorizationUrl(
  cfg: OAuthAppConfig,
  params: { state: string; challenge: string; redirectUri: string },
): string {
  if (!cfg.clientId) throw new Error("buildAuthorizationUrl requires a clientId");
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Parse the callback URL the popup bounced to. Verifies `state`, surfaces the
 * platform's `error` parameter, returns the authorization code.
 */
export function parseCallbackUrl(
  adapterId: string,
  callbackUrl: string,
  expectedState: string,
): { code: string } {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new IntegrationAuthError(adapterId, "exchange-failed", "Invalid authorization callback.");
  }
  const params = url.searchParams;
  const error = params.get("error");
  if (error === "access_denied") {
    throw new IntegrationAuthError(adapterId, "cancelled", "You declined the connection.");
  }
  if (error) {
    throw new IntegrationAuthError(
      adapterId,
      "exchange-failed",
      "The platform refused authorization.",
    );
  }
  if (params.get("state") !== expectedState) {
    throw new IntegrationAuthError(
      adapterId,
      "state-mismatch",
      "The sign-in answer didn't match this request (possible cross-site forgery) — try again.",
    );
  }
  const code = params.get("code");
  if (!code) {
    throw new IntegrationAuthError(adapterId, "exchange-failed", "No authorization code returned.");
  }
  return { code };
}

/** Optional, host-owned persistence. account must remain stable between runs. */
export interface OAuthVaultOptions {
  readonly vault?: ConnectorTokenVault;
  readonly account: string;
  readonly signal?: AbortSignal;
}

async function tokenRequest(
  adapterId: string,
  cfg: OAuthAppConfig,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  options?: OAuthVaultOptions,
): Promise<TokenSet> {
  const endpoint = cfg.tokenExchange === "proxy" ? cfg.tokenProxyUrl : cfg.tokenEndpoint;
  if (!endpoint || !cfg.clientId) throw new IntegrationAuthError(adapterId, "not-configured");
  let failureStatus: number | undefined;
  try {
    options?.signal?.throwIfAborted();
    const url = new URL(endpoint);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password
    )
      throw new Error();
    body.set("client_id", cfg.clientId);
    const headers = new Headers({
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    });
    let requestBody: BodyInit = body;
    if (cfg.tokenExchange === "public" && cfg.clientSecret) {
      if (cfg.tokenRequest === "basic-form" || cfg.tokenRequest === "basic-json") {
        headers.set("authorization", `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`);
        if (cfg.tokenRequest === "basic-json") {
          body.delete("client_id");
          headers.set("content-type", "application/json");
          requestBody = JSON.stringify(Object.fromEntries(body));
        }
      } else body.set("client_secret", cfg.clientSecret);
    } else if (cfg.basicAuthForToken)
      headers.set("authorization", `Basic ${btoa(`${cfg.clientId}:`)}`);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: typeof requestBody === "string" ? requestBody : body.toString(),
      redirect: "error",
      credentials: "omit",
      signal: options?.signal,
    });
    if (!response.ok) {
      failureStatus = response.status;
      if (body.get("grant_type") !== "refresh_token") {
        await response.body?.cancel();
        throw new Error();
      }
    }
    const json = (await readJson(response, adapterId, endpoint, 64 * 1024)) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      if (body.get("grant_type") === "refresh_token" && json?.error === "invalid_grant") {
        throw new IntegrationAuthError(adapterId, "reauthorise", "Reconnect this source account.");
      }
      throw new Error();
    }
    if (
      !json ||
      typeof json.access_token !== "string" ||
      !json.access_token.trim() ||
      json.access_token.length > 16384 ||
      (json.token_type !== undefined &&
        (typeof json.token_type !== "string" || json.token_type.toLowerCase() !== "bearer")) ||
      (json.refresh_token !== undefined &&
        (typeof json.refresh_token !== "string" ||
          !json.refresh_token.trim() ||
          json.refresh_token.length > 16384)) ||
      (json.expires_in !== undefined &&
        (typeof json.expires_in !== "number" ||
          !Number.isFinite(json.expires_in) ||
          json.expires_in <= 0 ||
          json.expires_in > 315360000))
    )
      throw new Error();
    let scope: string | undefined;
    if (typeof json.scope === "string") scope = json.scope;
    else if (Array.isArray(json.scope) && json.scope.every((item) => typeof item === "string"))
      scope = json.scope.join(" ");
    if (scope !== undefined && scope.length > 4096) throw new Error();
    const token: TokenSet = {
      accessToken: json.access_token,
      tokenType: (json.token_type as string | undefined) ?? "Bearer",
      refreshToken:
        (json.refresh_token as string | undefined) ?? body.get("refresh_token") ?? undefined,
      scope: scope || undefined,
      expiresAt:
        typeof json.expires_in === "number" ? Date.now() + json.expires_in * 1000 : undefined,
    };
    if (json.refresh_token && options?.vault) {
      const key = { connectorId: adapterId, account: options.account };
      const previous =
        body.get("grant_type") === "refresh_token" ? await options.vault.get(key) : undefined;
      await options.vault.put(key, {
        refreshToken: json.refresh_token as string,
        scope: token.scope ?? previous?.scope,
        tokenType: token.tokenType,
        obtainedAt: Date.now(),
        providerMeta: previous?.providerMeta,
      });
    }
    options?.signal?.throwIfAborted();
    return token;
  } catch (error) {
    if (error instanceof IntegrationAuthError && error.reason === "reauthorise") throw error;
    throw new IntegrationAuthError(
      adapterId,
      "exchange-failed",
      failureStatus === undefined
        ? "Source token exchange failed."
        : `Token exchange failed (${failureStatus}).`,
    );
  }
}

/** Code exchange; persistence completes before returning any access token. */
export async function exchangeCodeForToken(
  adapterId: string,
  cfg: OAuthAppConfig,
  params: { code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch,
  options?: OAuthVaultOptions,
): Promise<TokenSet> {
  return withVaultLock(adapterId, options, () =>
    tokenRequest(
      adapterId,
      cfg,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.verifier,
      }),
      fetchImpl,
      options,
    ),
  );
}

function withVaultLock<T>(
  adapterId: string,
  options: OAuthVaultOptions | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return options?.vault?.withLock
    ? options.vault.withLock({ connectorId: adapterId, account: options.account }, fn)
    : fn();
}

/** Refresh without sending an API bearer credential to the token endpoint. */
export async function refreshAccessToken(
  adapterId: string,
  cfg: OAuthAppConfig,
  refreshToken: string,
  fetchImpl: typeof fetch,
  options?: OAuthVaultOptions,
): Promise<TokenSet> {
  return withVaultLock(adapterId, options, async () => {
    const token = await refreshWithinLock(adapterId, cfg, refreshToken, fetchImpl, options);
    if (!token)
      throw new IntegrationAuthError(adapterId, "reauthorise", "Reconnect this source account.");
    return token;
  });
}

async function readSaved(
  adapterId: string,
  options?: OAuthVaultOptions,
): Promise<VaultRecord | undefined> {
  try {
    return await options?.vault?.get({ connectorId: adapterId, account: options.account });
  } catch (error) {
    if (error instanceof ConnectorVaultError) throw new UnreadableCredentialError(adapterId);
    throw error;
  }
}

/** Caller holds the store's account lock across reads, network exchange and mutations. */
async function refreshWithinLock(
  adapterId: string,
  cfg: OAuthAppConfig,
  refreshToken: string | undefined,
  fetchImpl: typeof fetch,
  options?: OAuthVaultOptions,
): Promise<TokenSet | undefined> {
  const key = { connectorId: adapterId, account: options?.account ?? "default" };
  const saved = await readSaved(adapterId, options);
  if (saved?.expiresAt !== undefined && saved.expiresAt <= Date.now()) {
    await options?.vault?.delete(key);
    throw new IntegrationAuthError(adapterId, "reauthorise", "Reconnect this source account.");
  }
  // With a vault, the record is the source of truth: a missing record means another session
  // disconnected (or revocation deleted it), so an in-memory credential must not revive it.
  // Without a stored or in-memory credential the host may still start interactive login.
  if (options?.vault && !saved && refreshToken)
    throw new IntegrationAuthError(adapterId, "reauthorise", "Reconnect this source account.");
  let sent = saved?.refreshToken ?? refreshToken;
  if (!sent) return undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await tokenRequest(
        adapterId,
        cfg,
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: sent }),
        fetchImpl,
        options,
      );
      return { ...token, scope: token.scope ?? saved?.scope };
    } catch (error) {
      if (!(error instanceof IntegrationAuthError) || error.reason !== "reauthorise") throw error;
      const latest = await readSaved(adapterId, options);
      // A writer without locking may have replaced the rejected credential. Never delete it.
      if (latest && latest.refreshToken !== sent) {
        if (attempt === 0) {
          sent = latest.refreshToken;
          continue;
        }
      } else if (latest?.refreshToken === sent) await options?.vault?.delete(key);
      throw error;
    }
  }
  return undefined;
}

/** Return a live token, restore from the vault, or let the host start interactive login. */
export async function getOAuthToken(
  adapterId: string,
  cfg: OAuthAppConfig,
  fetchImpl: typeof fetch,
  options: OAuthVaultOptions & { token?: TokenSet },
): Promise<TokenSet | undefined> {
  if (options.signal?.aborted)
    throw new IntegrationAuthError(adapterId, "cancelled", "Source authorization cancelled.");
  if (
    options.token &&
    (options.token.expiresAt === undefined || options.token.expiresAt > Date.now())
  )
    return options.token;
  return withVaultLock(adapterId, options, async () => {
    const token = await refreshWithinLock(
      adapterId,
      cfg,
      options.token?.refreshToken,
      fetchImpl,
      options,
    );
    return token ? { ...token, scope: token.scope ?? options.token?.scope } : undefined;
  });
}

/** A per-account session: bounded retries, single-flight refresh, durable disconnect. */
export function createOAuthSourceAuth(
  adapter: IntegrationAdapter,
  cfg: OAuthAppConfig,
  sourceFetch: typeof fetch,
  options: OAuthVaultOptions & { token?: TokenSet },
): SourceAuth & { disconnect(): Promise<void> } {
  let token = options.token;
  let refreshing: Promise<TokenSet | undefined> | undefined;
  let disconnected = false;
  const id = adapter.metadata.id;
  const safeSource: typeof fetch = async (input, init) => {
    try {
      return await sourceFetch(input, init);
    } catch {
      throw new IntegrationAuthError(id, "exchange-failed", "Source request failed.");
    }
  };
  const refresh = (force: boolean) => {
    refreshing ??= getOAuthToken(id, cfg, sourceFetch, {
      ...options,
      token: force && token ? { ...token, expiresAt: 0 } : token,
    })
      .then((next) => {
        if (!disconnected) token = next;
        return next;
      })
      .catch((error: unknown) => {
        if (error instanceof IntegrationAuthError && error.reason === "reauthorise") {
          token = undefined;
          disconnected = true;
        }
        throw error;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  const check = () => {
    if (options.signal?.aborted)
      throw new IntegrationAuthError(id, "cancelled", "Source authorization cancelled.");
    if (disconnected || !token)
      throw new IntegrationAuthError(id, "reauthorise", "Reconnect this source account.");
  };
  return {
    async fetch(input, init) {
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const checkRequest = () => {
        if (requestSignal?.aborted)
          throw new IntegrationAuthError(id, "cancelled", "Source request cancelled.");
      };
      checkRequest();
      if (options.signal?.aborted)
        throw new IntegrationAuthError(id, "cancelled", "Source authorization cancelled.");
      if (disconnected) check();
      if (!token || (token.expiresAt !== undefined && token.expiresAt <= Date.now()))
        await refresh(false);
      check();
      checkRequest();
      const used = token;
      const transport = () => createSourceAuth(id, adapter, token, safeSource);
      const response = await transport().fetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (response.status !== 401 || method.toUpperCase() !== "GET") return response;
      try {
        await response.body?.cancel();
      } catch {
        throw new IntegrationAuthError(id, "exchange-failed", "Source request failed.");
      }
      if (token === used) await refresh(true);
      check();
      checkRequest();
      return transport().fetch(input, init);
    },
    async disconnect() {
      disconnected = true;
      token = undefined;
      clearToken(id);
      try {
        await refreshing;
      } catch {
        /* Deletion must still follow a failed refresh. */
      }
      await withVaultLock(id, options, async () => {
        await options.vault?.delete({ connectorId: id, account: options.account });
      });
    },
  };
}

/**
 * Run the full popup flow in the browser and return the token set.
 * Browser-only (uses `window`); the UI calls this for live-mode connects.
 */
export async function authorize(
  adapterId: string,
  cfg: OAuthAppConfig,
  sourceFetch: typeof fetch,
  options?: OAuthVaultOptions,
): Promise<TokenSet> {
  if (!cfg.clientId) throw new IntegrationAuthError(adapterId, "not-configured");
  const redirectUri = new URL(OAUTH_CALLBACK_PATH, window.location.href).toString();
  const { verifier, challenge } = await generatePkcePair();
  const state = generateState();
  const authUrl = buildAuthorizationUrl(cfg, { state, challenge, redirectUri });

  const popup = window.open(authUrl, "pod-manager-oauth", "popup,width=520,height=720");
  if (!popup) throw new IntegrationAuthError(adapterId, "popup-blocked");

  const callbackUrl = await waitForCallback(adapterId, popup);
  const { code } = parseCallbackUrl(adapterId, callbackUrl, state);
  return exchangeCodeForToken(
    adapterId,
    cfg,
    { code, verifier, redirectUri },
    sourceFetch,
    options,
  );
}

/** Resolve with the callback URL posted by the popup; reject if it closes first. */
function waitForCallback(adapterId: string, popup: Window): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Partial<OAuthCallbackMessage> | undefined;
      if (data?.type !== "pod-manager-oauth" || typeof data.url !== "string") return;
      cleanup();
      popup.close();
      resolve(data.url);
    };
    const closedPoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new IntegrationAuthError(adapterId, "cancelled", "The sign-in window was closed."));
      }
    }, 500);
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(closedPoll);
    };
    window.addEventListener("message", onMessage);
  });
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
