// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { readJson } from "../core/budget.js";
import { IntegrationAuthError } from "../core/errors.js";
import { createSourceAuth } from "../core/import-runner.js";
import { SOURCE_RESPONSE_TIMEOUT_MS } from "../core/source-timeout.js";
import type { SourceAuth, TokenSet } from "../core/types.js";
import { spotifyAdapter } from "./adapter.js";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const MAX_TOKEN_BYTES = 64 * 1024;

/**
 * One token refresh shared by concurrent 401 retries. It runs on its own controller: a
 * waiter's signal cancels only that waiter, and the refresh is aborted once every cancellable
 * waiter has left (a waiter without a signal keeps it running). The same shape as pod-auth's
 * shared restore; no exported helper exists in a package this one depends on.
 */
interface SharedRefresh {
  readonly promise: Promise<void>;
  readonly controller: AbortController;
  waiters: number;
  uncancellable: boolean;
}

function join(shared: SharedRefresh, signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) {
    shared.uncancellable = true;
    return shared.promise;
  }
  signal.throwIfAborted();
  shared.waiters++;
  return new Promise<void>((resolve, reject) => {
    let left = false;
    const leave = (settle: () => void) => {
      if (left) return;
      left = true;
      signal.removeEventListener("abort", cancel);
      shared.waiters--;
      settle();
    };
    const cancel = () =>
      leave(() => {
        if (shared.waiters === 0 && !shared.uncancellable) shared.controller.abort(signal.reason);
        reject(signal.reason);
      });
    signal.addEventListener("abort", cancel, { once: true });
    shared.promise.then(
      () => leave(resolve),
      (error: unknown) => leave(() => reject(error)),
    );
  });
}

/** Host-owned, memory-only Spotify PKCE session; retry one GET after a 401 refresh. */
export function createSpotifySourceAuth(options: {
  clientId: string;
  token: TokenSet;
  fetch: typeof fetch;
  onToken?: (token: TokenSet) => void;
}): SourceAuth {
  let token = options.token;
  let refreshing: SharedRefresh | undefined;
  const transport = refuseRedirects(options.fetch);
  const auth = () =>
    createSourceAuth("spotify", spotifyAdapter, token, transport, ["https://api.spotify.com"]);
  async function refresh(signal: AbortSignal): Promise<void> {
    if (!token.refreshToken || !options.clientId)
      throw new IntegrationAuthError(
        "spotify",
        "not-configured",
        "Spotify requires reauthorization.",
      );
    signal.throwIfAborted();
    const response = await transport(TOKEN_ENDPOINT, {
      signal,
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
      const explicitSignal = init?.signal;
      const signal =
        init && "signal" in init
          ? explicitSignal
          : input instanceof Request
            ? input.signal
            : undefined;
      signal?.throwIfAborted();
      const usedToken = token;
      const response = await auth().fetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (response.status !== 401 || method.toUpperCase() !== "GET") return response;
      await response.body?.cancel().catch(() => undefined);
      if (token === usedToken) {
        // A refresh abandoned by all its waiters is never joined; a later 401 starts afresh.
        if (!refreshing || refreshing.controller.signal.aborted) {
          const controller = new AbortController();
          const promise = refresh(
            AbortSignal.any([controller.signal, AbortSignal.timeout(SOURCE_RESPONSE_TIMEOUT_MS)]),
          ).finally(() => {
            if (refreshing?.promise === promise) refreshing = undefined;
          });
          promise.catch(() => undefined);
          refreshing = { promise, controller, waiters: 0, uncancellable: false };
        }
        await join(refreshing, signal);
      }
      signal?.throwIfAborted();
      return auth().fetch(input, init);
    },
  };
}
