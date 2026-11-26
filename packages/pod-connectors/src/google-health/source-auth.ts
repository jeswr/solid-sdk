// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.2
// AUTHORED-BY Claude Opus 5.5
// Without an onToken sink, a rotated refresh token lives only in this session.
// Hosts needing it after restart must save it through onToken (e.g. in their token vault).
import { refuseRedirects, snapshotFetchInput } from "@jeswr/guarded-fetch";
import { RunBudget, readJson } from "../core/budget.js";
import { IntegrationAuthError, IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { createSourceAuth } from "../core/import-runner.js";
import { grantedScope, scopeList, TOKEN_REQUEST_TIMEOUT_MS } from "../core/oauth.js";
import { during, SourceTimeoutError } from "../core/source-timeout.js";
import type { OAuthAppConfig, SourceAuth, TokenSet } from "../core/types.js";
import { googleHealthAdapter } from "./adapter.js";
import { API, ID, quotaDenied, ROLLUP_PATH, readGoogleError, record } from "./api.js";

/** RFC 6750 bearer syntax also covers the Google refresh tokens in this profile. */
const credential = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 16_384 &&
  /^[A-Za-z0-9._~+/-]+=*$/.test(value);

/** Method-override headers (Google API conventions), stripped from every forwarded request. */
const METHOD_OVERRIDES = ["x-http-method-override", "x-http-method", "x-method-override"];

/**
 * The one non-GET request forwarded: a dailyRollUp query (read-only, but a POST by the API's
 * design) to the Health origin with no query string and a bounded JSON string body, which can
 * be replayed after a refresh.
 */
function rollupQuery(input: string | Request, init: RequestInit | undefined): boolean {
  if (typeof input !== "string" || typeof init?.body !== "string" || init.body.length > 4096)
    return false;
  if (!URL.canParse(input)) return false;
  const url = new URL(input);
  return url.origin === new URL(API).origin && !url.search && ROLLUP_PATH.test(url.pathname);
}

const TOKEN_RESOURCE = "Google OAuth token endpoint";

async function readRefreshResponse(res: Response, budget: RunBudget, signal: AbortSignal) {
  if (res.ok) return readJson(res, ID, TOKEN_RESOURCE, 64 * 1024, budget, signal);
  let body: unknown;
  if (res.status === 400 || res.status === 403) body = await readGoogleError(res, budget, signal);
  else void res.body?.cancel().catch(() => {});
  if (res.status === 429 || (res.status === 403 && quotaDenied(body)))
    throw new RateLimitedError(ID, TOKEN_RESOURCE);
  const temporary =
    res.status === 400 &&
    record(body) &&
    (body.error === "temporarily_unavailable" || body.error === "server_error");
  // Includes OAuth invalid_grant (400) for an expired or revoked refresh credential.
  if (!temporary && [400, 401, 403].includes(res.status))
    throw new IntegrationAuthError(
      ID,
      "reauthorise",
      "Google token refresh failed. Re-authorize Google Health.",
    );
  throw new IntegrationSyncError(ID, `Google token refresh failed (${res.status}).`, {
    status: res.status,
  });
}

/** Host-owned, memory-only Google OAuth session. Retries a Health read once after 401. */
export function createGoogleHealthSourceAuth(options: {
  config: OAuthAppConfig;
  token: TokenSet;
  fetch: typeof fetch;
  /** A returned promise must settle successfully before the refreshed token is used. */
  onToken?: (token: TokenSet) => void;
}): SourceAuth {
  if (
    !credential(options.token.accessToken) ||
    (options.token.refreshToken !== undefined && !credential(options.token.refreshToken))
  )
    throw new IntegrationAuthError(ID, "exchange-failed", "Invalid Google token response.");
  let token = options.token;
  const transport = refuseRedirects(options.fetch);
  // Includes hidden refresh/replay traffic as well as ordinary source requests.
  const budget = new RunBudget(ID, { maxRequests: 4096, maxItems: 1, maxBytes: 4 * 1024 * 1024 });
  const metered: typeof fetch = (input, init) => {
    budget.request();
    return transport(input, init);
  };
  const auth = () =>
    createSourceAuth(ID, googleHealthAdapter, token, metered, [new URL(API).origin]);
  let refreshing: Promise<void> | undefined;
  async function requestToken(): Promise<TokenSet> {
    const cfg = options.config;
    // Match authorizeLoopback: a locally supplied Desktop secret selects direct
    // exchange even when the registry's default configuration uses a Web proxy.
    const direct = cfg.tokenExchange === "public" || !!cfg.clientSecret;
    const endpoint = direct ? cfg.tokenEndpoint : cfg.tokenProxyUrl;
    if (!token.refreshToken)
      throw new IntegrationAuthError(
        ID,
        "reauthorise",
        "Re-authorize Google Health to refresh access.",
      );
    if (!cfg.clientId || !endpoint)
      throw new IntegrationAuthError(
        ID,
        "not-configured",
        "Google token transport is not configured.",
      );
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new IntegrationAuthError(ID, "not-configured", "Invalid Google token transport.");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: cfg.clientId,
    });
    if (direct && cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new SourceTimeoutError(ID, TOKEN_RESOURCE)),
      TOKEN_REQUEST_TIMEOUT_MS,
    );
    let json: unknown;
    try {
      const request = metered(url.href, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
      });
      const res = await during(controller.signal, () => request);
      json = await readRefreshResponse(res, budget, controller.signal);
    } catch (error) {
      controller.signal.throwIfAborted();
      if (
        error instanceof IntegrationAuthError ||
        (error instanceof IntegrationSyncError && !(error.cause instanceof SyntaxError))
      )
        throw error;
      throw new IntegrationSyncError(ID, "Google token refresh failed.");
    } finally {
      clearTimeout(timer);
    }
    if (
      !record(json) ||
      !credential(json.access_token) ||
      (json.token_type !== undefined &&
        (typeof json.token_type !== "string" || json.token_type.toLowerCase() !== "bearer")) ||
      (json.refresh_token !== undefined && !credential(json.refresh_token))
    )
      throw new IntegrationAuthError(ID, "exchange-failed", "Invalid Google token response.");
    return {
      accessToken: json.access_token,
      tokenType: "Bearer",
      refreshToken:
        typeof json.refresh_token === "string" ? json.refresh_token : token.refreshToken,
      expiresAt:
        typeof json.expires_in === "number" &&
        Number.isFinite(json.expires_in) &&
        json.expires_in > 0 &&
        json.expires_in <= 365 * 86400
          ? Date.now() + json.expires_in * 1000
          : undefined,
      // Google repeats the granted scopes on refresh; otherwise the original grant stands.
      scope: grantedScope(json.scope) ?? token.scope,
    };
  }
  let pendingToken: TokenSet | undefined;
  async function refresh(): Promise<void> {
    // If the sink fails, retry delivery with the rotated credential still in memory.
    pendingToken ??= await requestToken();
    try {
      await options.onToken?.(pendingToken);
    } catch {
      throw new IntegrationSyncError(ID, "Could not save the refreshed Google Health token.");
    }
    token = pendingToken;
    pendingToken = undefined;
  }
  return {
    /** Granted scopes of the current token, when Google listed them (`ImportContext.scopes`). */
    get scopes() {
      return scopeList(token.scope);
    },
    fetch: async (input, init) => {
      const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
      const request = typeof snapshot.input === "string" ? undefined : snapshot.input;
      const method = snapshot.init?.method ?? request?.method ?? "GET";
      const signal = snapshot.init?.signal ?? request?.signal;
      signal?.throwIfAborted();
      // This adapter has no write operations. Fail before credentials leave the host.
      const verb = method.toUpperCase();
      if (verb !== "GET" && !(verb === "POST" && rollupQuery(snapshot.input, snapshot.init)))
        throw new IntegrationAuthError(
          ID,
          "not-configured",
          "Google Health transport accepts reads only.",
        );
      // A method override would let Google treat a forwarded read as a write: never send one.
      const headers = new Headers(snapshot.init?.headers ?? request?.headers);
      for (const name of METHOD_OVERRIDES) headers.delete(name);
      const forwarded: RequestInit = { ...snapshot.init, headers };
      const used = token;
      const response = await auth().fetch(snapshot.input, forwarded);
      if (response.status !== 401) return response;
      void response.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (token === used) {
        refreshing ??= refresh().finally(() => {
          refreshing = undefined;
        });
        await refreshing;
      }
      signal?.throwIfAborted();
      return auth().fetch(snapshot.input, forwarded);
    },
  };
}
