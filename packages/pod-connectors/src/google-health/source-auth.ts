// AUTHORED-BY Codex GPT-6.1-Sol
import { refuseRedirects, snapshotFetchInput } from "@jeswr/guarded-fetch";
import { RunBudget, readJson } from "../core/budget.js";
import { IntegrationAuthError } from "../core/errors.js";
import { createSourceAuth } from "../core/import-runner.js";
import type { OAuthAppConfig, SourceAuth, TokenSet } from "../core/types.js";
import { googleHealthAdapter } from "./adapter.js";
import { API, ID, record } from "./api.js";

/** RFC 6750 bearer syntax also covers the Google refresh tokens in this profile. */
const credential = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 16_384 &&
  /^[A-Za-z0-9._~+/-]+=*$/.test(value);

/** Host-owned, memory-only Google OAuth session. Retries a Health GET once after 401. */
export function createGoogleHealthSourceAuth(options: {
  config: OAuthAppConfig;
  token: TokenSet;
  fetch: typeof fetch;
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
  async function refresh(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted();
    const cfg = options.config;
    // Match authorizeLoopback: a locally supplied Desktop secret selects direct
    // exchange even when the registry's default configuration uses a Web proxy.
    const direct = cfg.tokenExchange === "public" || !!cfg.clientSecret;
    const endpoint = direct ? cfg.tokenEndpoint : cfg.tokenProxyUrl;
    if (!token.refreshToken || !cfg.clientId || !endpoint)
      throw new IntegrationAuthError(
        ID,
        "not-configured",
        "Re-authorize Google Health; Fitbit tokens cannot be used.",
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
    const res = await metered(url.href, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
      redirect: "error",
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new IntegrationAuthError(
        ID,
        "exchange-failed",
        "Google token refresh failed; re-authorize Google Health.",
      );
    }
    const json: unknown = await readJson(res, ID, "Google OAuth token endpoint", 64 * 1024, budget);
    if (
      !record(json) ||
      !credential(json.access_token) ||
      (json.refresh_token !== undefined && !credential(json.refresh_token))
    )
      throw new IntegrationAuthError(ID, "exchange-failed", "Invalid Google token response.");
    signal?.throwIfAborted();
    token = {
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
    };
    options.onToken?.(token);
  }
  return {
    fetch: async (input, init) => {
      const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
      const request = typeof snapshot.input === "string" ? undefined : snapshot.input;
      const method = snapshot.init?.method ?? request?.method ?? "GET";
      const signal = snapshot.init?.signal ?? request?.signal;
      signal?.throwIfAborted();
      // This adapter has no write operations. Fail before credentials leave the host.
      if (method.toUpperCase() !== "GET")
        throw new IntegrationAuthError(
          ID,
          "not-configured",
          "Google Health transport accepts reads only.",
        );
      const used = token;
      const response = await auth().fetch(snapshot.input, snapshot.init);
      if (response.status !== 401) return response;
      await response.body?.cancel();
      signal?.throwIfAborted();
      if (token === used) {
        refreshing ??= refresh(signal ?? undefined).finally(() => {
          refreshing = undefined;
        });
        await refreshing;
      }
      signal?.throwIfAborted();
      return auth().fetch(snapshot.input, snapshot.init);
    },
  };
}
