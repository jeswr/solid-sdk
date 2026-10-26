// AUTHORED-BY Codex GPT-6.1-Sol
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { readJson } from "../core/budget.js";
import { IntegrationAuthError } from "../core/errors.js";
import { createSourceAuth } from "../core/import-runner.js";
import type { SourceAuth, TokenSet } from "../core/types.js";
import { spotifyAdapter } from "./adapter.js";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const MAX_TOKEN_BYTES = 64 * 1024;

/** Host-owned, memory-only Spotify PKCE session; retry one GET after a 401 refresh. */
export function createSpotifySourceAuth(options: {
  clientId: string;
  token: TokenSet;
  fetch: typeof fetch;
  onToken?: (token: TokenSet) => void;
}): SourceAuth {
  let token = options.token;
  let refreshing: Promise<void> | undefined;
  const transport = refuseRedirects(options.fetch);
  const auth = () =>
    createSourceAuth("spotify", spotifyAdapter, token, transport, ["https://api.spotify.com"]);
  async function refresh(): Promise<void> {
    if (!token.refreshToken || !options.clientId)
      throw new IntegrationAuthError(
        "spotify",
        "not-configured",
        "Spotify requires reauthorization.",
      );
    const response = await transport(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        client_id: options.clientId,
      }),
    });
    if (!response.ok)
      throw new IntegrationAuthError("spotify", "exchange-failed", "Spotify token refresh failed.");
    const json = (await readJson(response, "spotify", TOKEN_ENDPOINT, MAX_TOKEN_BYTES).catch(
      (cause: unknown) => {
        throw new IntegrationAuthError(
          "spotify",
          "exchange-failed",
          "Invalid Spotify token response.",
          { cause },
        );
      },
    )) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (!json || typeof json.access_token !== "string" || !json.access_token.trim())
      throw new IntegrationAuthError(
        "spotify",
        "exchange-failed",
        "Invalid Spotify token response.",
      );
    token = {
      accessToken: json.access_token,
      tokenType: "Bearer",
      refreshToken:
        typeof json.refresh_token === "string" && json.refresh_token
          ? json.refresh_token
          : token.refreshToken,
      expiresAt:
        typeof json.expires_in === "number" &&
        Number.isFinite(json.expires_in) &&
        json.expires_in > 0
          ? Date.now() + json.expires_in * 1000
          : undefined,
    };
    options.onToken?.(token);
  }
  return {
    fetch: async (input, init) => {
      const usedToken = token;
      const response = await auth().fetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (response.status !== 401 || method.toUpperCase() !== "GET") return response;
      await response.body?.cancel();
      if (token === usedToken) {
        refreshing ??= refresh().finally(() => {
          refreshing = undefined;
        });
        await refreshing;
      }
      return auth().fetch(input, init);
    },
  };
}
