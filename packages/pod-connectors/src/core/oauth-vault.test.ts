// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { spotifyAdapter } from "../spotify/adapter.js";
import { ConnectorTokenVault, generateBrowserVaultKey, MemoryVaultStore } from "../vault.js";
import { IntegrationAuthError } from "./errors.js";
import {
  createOAuthSourceAuth,
  exchangeCodeForToken,
  getOAuthToken,
  parseCallbackUrl,
  refreshAccessToken,
} from "./oauth.js";
import type { OAuthAppConfig } from "./types.js";

const key = { connectorId: "spotify", account: "fixture-owner" };
const config: OAuthAppConfig = { ...spotifyAdapter.oauth!, clientId: "synthetic-client" };
const params = {
  code: "synthetic-code",
  verifier: "synthetic-verifier",
  redirectUri: "https://app.test/callback",
};
const sensitive = "sensitive-refresh-access-key";
async function fixture() {
  const store = new MemoryVaultStore();
  const vault = new ConnectorTokenVault(await generateBrowserVaultKey(), store);
  return { store, vault, options: { vault, account: key.account } };
}
async function safeError(operation: Promise<unknown>, reason = "exchange-failed") {
  const error = await operation.catch((error) => error);
  expect(error).toBeInstanceOf(IntegrationAuthError);
  expect(error.reason).toBe(reason);
  expect(error.message).not.toContain(sensitive);
  expect(error.cause).toBeUndefined();
}
describe("OAuth refresh vault wiring", () => {
  it("retires a session after invalid_grant and never reuses its rejected in-memory refresh token", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: sensitive, obtainedAt: 1 });
    const send = vi.fn<typeof fetch>(async (input) =>
      String(input) === config.tokenEndpoint
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : new Response(null, { status: 401 }),
    );
    const session = createOAuthSourceAuth(spotifyAdapter, config, send, {
      ...options,
      token: { accessToken: "old", tokenType: "Bearer", refreshToken: sensitive },
    });
    await safeError(session.fetch("https://api.spotify.com/v1/me"), "reauthorise");
    const count = send.mock.calls.length;
    await safeError(session.fetch("https://api.spotify.com/v1/me"), "reauthorise");
    expect(send).toHaveBeenCalledTimes(count);
    expect(await vault.get(key)).toBeUndefined();
  });
  it("honors a caller abort while a shared refresh is pending without starting an API request", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: "first", obtainedAt: 1 });
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const send = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    });
    const session = createOAuthSourceAuth(spotifyAdapter, config, send, options);
    const controller = new AbortController();
    const request = session.fetch("https://api.spotify.com/v1/me", { signal: controller.signal });
    await started.promise;
    controller.abort(new Error(sensitive));
    response.resolve(Response.json({ access_token: "new", refresh_token: "rotated" }));
    await safeError(request, "cancelled");
    expect(send).toHaveBeenCalledTimes(1);
    await safeError(
      session.fetch("https://api.spotify.com/v1/me", { signal: controller.signal }),
      "cancelled",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("returns the second 401 without a refresh loop and masks source transport errors", async () => {
    const { options } = await fixture();
    const send = vi.fn<typeof fetch>(async (input) =>
      String(input) === config.tokenEndpoint
        ? Response.json({ access_token: "new" })
        : new Response(null, { status: 401 }),
    );
    const session = createOAuthSourceAuth(spotifyAdapter, config, send, {
      ...options,
      token: { accessToken: "old", tokenType: "Bearer", refreshToken: sensitive },
    });
    expect((await session.fetch("https://api.spotify.com/v1/me")).status).toBe(401);
    expect(send).toHaveBeenCalledTimes(3);
    await safeError(
      createOAuthSourceAuth(
        spotifyAdapter,
        config,
        async () => {
          throw new Error(sensitive);
        },
        { ...options, token: { accessToken: "live", tokenType: "Bearer" } },
      ).fetch("https://api.spotify.com/v1/me"),
    );
  });
  it("persists code exchange refresh credentials, never the access token", async () => {
    const { vault, store, options } = await fixture();
    const token = await exchangeCodeForToken(
      "spotify",
      config,
      params,
      async (_input, init) => {
        expect(init?.credentials).toBe("omit");
        expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe(
          "authorization_code",
        );
        return Response.json({
          access_token: sensitive,
          refresh_token: "refresh",
          expires_in: 60,
          scope: "read",
        });
      },
      options,
    );
    expect(token.accessToken).toBe(sensitive);
    expect(await vault.get(key)).toMatchObject({
      refreshToken: "refresh",
      tokenType: "Bearer",
      scope: "read",
    });
    expect(await vault.get(key)).not.toHaveProperty("expiresAt");
    expect(await store.get(JSON.stringify([key.connectorId, key.account]))).not.toContain(
      sensitive,
    );
    expect(await vault.get(key)).not.toHaveProperty("accessToken");
  });
  it("restores without login, rotates before returning, and retains an omitted refresh credential", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: "first", scope: "read", obtainedAt: 1 });
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe(
        calls++ ? "rotated" : "first",
      );
      return Response.json({
        access_token: sensitive,
        ...(calls === 1 ? { refresh_token: "rotated" } : {}),
        expires_in: 60,
      });
    };
    expect((await getOAuthToken("spotify", config, fetch, options))?.accessToken).toBe(sensitive);
    expect((await vault.get(key))?.refreshToken).toBe("rotated");
    expect((await getOAuthToken("spotify", config, fetch, options))?.refreshToken).toBe("rotated");
    expect((await vault.get(key))?.refreshToken).toBe("rotated");
    const live = { accessToken: "live", tokenType: "Bearer" };
    expect(await getOAuthToken("spotify", config, vi.fn(), { ...options, token: live })).toBe(live);
  });
  it("deletes invalid_grant and exposes typed reauthorise, while transient failures retain the record", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: sensitive, obtainedAt: 1 });
    await safeError(
      getOAuthToken(
        "spotify",
        config,
        async () =>
          Response.json({ error: "server_error", error_description: sensitive }, { status: 503 }),
        options,
      ),
    );
    expect(await vault.get(key)).toBeDefined();
    await safeError(
      getOAuthToken(
        "spotify",
        config,
        async () =>
          Response.json({ error: "invalid_grant", error_description: sensitive }, { status: 400 }),
        options,
      ),
      "reauthorise",
    );
    expect(await vault.get(key)).toBeUndefined();
    expect(await getOAuthToken("spotify", config, vi.fn(), options)).toBeUndefined();
    await vault.put(key, { refreshToken: sensitive, obtainedAt: 1, expiresAt: 2 });
    await safeError(getOAuthToken("spotify", config, vi.fn(), options), "reauthorise");
    expect(await vault.get(key)).toBeUndefined();
  });
  it("fails closed if rotation cannot be persisted and masks network/parser/validation errors", async () => {
    const { vault, options } = await fixture();
    vi.spyOn(vault, "put").mockRejectedValue(new Error(sensitive));
    const failures: (typeof fetch)[] = [
      async () => {
        throw new Error(sensitive);
      },
      async () => new Response(sensitive),
      async () => Response.json({ access_token: sensitive, refresh_token: "rotated" }),
      async () => Response.json({ error: sensitive }, { status: 400 }),
      ...[
        null,
        {},
        { access_token: 1 },
        { access_token: "" },
        { access_token: "x".repeat(16385) },
        { access_token: "x", refresh_token: "" },
        { access_token: "x", expires_in: Infinity },
        { access_token: "x", token_type: sensitive },
        { access_token: "x", expires_in: -1 },
        { access_token: "x", expires_in: 1e30 },
      ].map((json) => async () => Response.json(json)),
      async () => new Response("{}", { headers: { "content-length": "65537" } }),
      async () => new Response(sensitive.repeat(65536)),
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://evil.test/${sensitive}` },
        }),
    ];
    for (const fetch of failures)
      await safeError(exchangeCodeForToken("spotify", config, params, fetch, options));
    const cancelled = new AbortController();
    cancelled.abort(new Error(sensitive));
    await safeError(
      refreshAccessToken("spotify", config, sensitive, vi.fn(), {
        ...options,
        signal: cancelled.signal,
      }),
    );
    await safeError(
      exchangeCodeForToken(
        "spotify",
        { ...config, tokenEndpoint: `http://bad.test/${sensitive}` },
        params,
        vi.fn(),
      ),
    );
    expect(() => parseCallbackUrl("spotify", `https://app.test/?error=${sensitive}`, "x")).toThrow(
      "The platform refused authorization.",
    );
  });
  it.each([
    "form",
    "basic-form",
    "basic-json",
  ] as const)("uses configured Node client auth on refresh: %s", async (tokenRequest) => {
    await refreshAccessToken(
      "spotify",
      { ...config, clientSecret: "secret", tokenRequest },
      sensitive,
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        const body =
          tokenRequest === "basic-json"
            ? JSON.parse(String(init?.body))
            : Object.fromEntries(new URLSearchParams(String(init?.body)));
        expect(body.refresh_token).toBe(sensitive);
        expect(body.client_secret).toBe(tokenRequest === "form" ? "secret" : undefined);
        expect(headers.get("authorization")).toBe(
          tokenRequest === "form" ? null : `Basic ${btoa("synthetic-client:secret")}`,
        );
        return Response.json({ access_token: "new" });
      },
    );
  });
  it("keeps proxy credentials isolated from an installed-app secret", async () => {
    await refreshAccessToken(
      "spotify",
      {
        ...config,
        clientSecret: sensitive,
        tokenExchange: "proxy",
        tokenProxyUrl: "https://proxy.test/token",
      },
      "refresh",
      async (input, init) => {
        expect(String(input)).toBe("https://proxy.test/token");
        expect(String(init?.body)).not.toContain(sensitive);
        return Response.json({ access_token: "new" });
      },
    );
  });
  it("shares concurrent refresh, retries a GET once, and disconnects durably", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: "first", obtainedAt: 1 });
    let refreshes = 0;
    const source: typeof fetch = async (input, init) => {
      if (String(input) === config.tokenEndpoint) {
        refreshes++;
        return Response.json({ access_token: "new", refresh_token: "rotated" });
      }
      return new Response(null, {
        status: new Headers(init?.headers).get("authorization") === "Bearer old" ? 401 : 200,
      });
    };
    const session = createOAuthSourceAuth(spotifyAdapter, config, source, {
      ...options,
      token: { accessToken: "old", tokenType: "Bearer" },
    });
    expect(
      (
        await Promise.all([
          session.fetch("https://api.spotify.com/v1/me"),
          session.fetch("https://api.spotify.com/v1/me"),
        ])
      ).map((r) => r.status),
    ).toEqual([200, 200]);
    expect(refreshes).toBe(1);
    expect((await vault.get(key))?.refreshToken).toBe("rotated");
    await session.disconnect();
    expect(await vault.get(key)).toBeUndefined();
    await safeError(session.fetch("https://api.spotify.com/v1/me"), "reauthorise");
  });
  it("waits for in-flight refresh before deleting on disconnect; no late resurrection", async () => {
    const { vault, options } = await fixture();
    await vault.put(key, { refreshToken: "first", obtainedAt: 1 });
    let release!: (response: Response) => void;
    const started = Promise.withResolvers<void>();
    const session = createOAuthSourceAuth(
      spotifyAdapter,
      config,
      async () => {
        started.resolve();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
      options,
    );
    const request = session.fetch("https://api.spotify.com/v1/me");
    await started.promise;
    const disconnected = session.disconnect();
    release(Response.json({ access_token: "new", refresh_token: "rotated" }));
    await safeError(request, "reauthorise");
    await disconnected;
    expect(await vault.get(key)).toBeUndefined();
  });
  it("does not retry mutations or loop on repeated 401; aborts and refuses off-origin sends", async () => {
    const { options } = await fixture();
    const send = vi.fn(async () => new Response(null, { status: 401 }));
    const session = createOAuthSourceAuth(spotifyAdapter, config, send, {
      ...options,
      token: { accessToken: "live", tokenType: "Bearer", refreshToken: "refresh" },
    });
    expect((await session.fetch("https://api.spotify.com/v1/me", { method: "POST" })).status).toBe(
      401,
    );
    expect(send).toHaveBeenCalledTimes(1);
    await expect(session.fetch("https://evil.test/")).rejects.toThrow("Source request is outside");
    expect(send).toHaveBeenCalledTimes(1);
    const abort = new AbortController();
    abort.abort();
    await expect(
      createOAuthSourceAuth(spotifyAdapter, config, send, {
        ...options,
        signal: abort.signal,
      }).fetch("https://api.spotify.com/v1/me"),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
