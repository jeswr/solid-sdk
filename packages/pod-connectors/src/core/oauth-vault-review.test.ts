// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { spotifyAdapter } from "../spotify/adapter.js";
import { createSpotifySourceAuth } from "../spotify/source-auth.js";
import { ConnectorTokenVault, generateBrowserVaultKey, MemoryVaultStore } from "../vault.js";
import { UnreadableCredentialError } from "./errors.js";
import {
  createOAuthSourceAuth,
  exchangeCodeForToken,
  getOAuthToken,
  refreshAccessToken,
} from "./oauth.js";

const key = { connectorId: "spotify", account: "synthetic" };
const config = { ...spotifyAdapter.oauth!, clientId: "synthetic-client" };
const params = { code: "code", verifier: "verifier", redirectUri: "https://app.test/callback" };
async function fixture(locked = true) {
  const store = new MemoryVaultStore();
  const port = locked
    ? store
    : {
        get: store.get.bind(store),
        put: store.put.bind(store),
        delete: store.delete.bind(store),
        list: store.list.bind(store),
      };
  const cryptoKey = await generateBrowserVaultKey();
  const vault = new ConnectorTokenVault(cryptoKey, port);
  await vault.put(key, { refreshToken: "RT1", obtainedAt: 1 });
  return { store, cryptoKey, vault, options: { vault, account: key.account } };
}
describe("adversarial refresh regressions", () => {
  it.each([
    "refresh",
    "login",
  ])("persists rotation after abort during the %s response body read", async (grant) => {
    const { vault, options } = await fixture();
    const abort = new AbortController();
    const send: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ access_token: "AT2", refresh_token: "RT2" }),
              ),
            );
            abort.abort(new Error("synthetic-sensitive"));
            controller.close();
          },
        }),
      );
    const opts = { ...options, signal: abort.signal };
    await expect(
      grant === "refresh"
        ? refreshAccessToken("spotify", config, "RT1", send, opts)
        : exchangeCodeForToken("spotify", config, params, send, opts),
    ).rejects.toMatchObject({ reason: "exchange-failed" });
    expect((await vault.get(key))?.refreshToken).toBe("RT2");
  });
  it("two independent engines serialize refresh and reread RT2 before sending", async () => {
    const { store, cryptoKey, vault, options } = await fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const sent: string[] = [];
    const send: typeof fetch = async (input, init) => {
      if (String(input) !== config.tokenEndpoint) return new Response(null, { status: 200 });
      const rt = new URLSearchParams(String(init?.body)).get("refresh_token")!;
      sent.push(rt);
      if (sent.length === 1) {
        started.resolve();
        await release.promise;
      }
      if (sent.length > 1 && rt === "RT1")
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "AT2", refresh_token: "RT2" });
    };
    const first = createOAuthSourceAuth(spotifyAdapter, config, send, options);
    const second = createOAuthSourceAuth(spotifyAdapter, config, send, {
      vault: new ConnectorTokenVault(cryptoKey, store),
      account: key.account,
      token: { accessToken: "expired", refreshToken: "RT1", tokenType: "Bearer", expiresAt: 0 },
    });
    const one = first.fetch("https://api.spotify.com/v1/me");
    await started.promise;
    const two = second.fetch("https://api.spotify.com/v1/me");
    release.resolve();
    expect((await Promise.all([one, two])).map((r) => r.status)).toEqual([200, 200]);
    expect(sent).toEqual(["RT1", "RT2"]);
    expect((await vault.get(key))?.refreshToken).toBe("RT2");
  });
  it.each([
    false,
    true,
  ])("a stale invalid_grant retries once without deleting a newer rotation (second rejection: %s)", async (rejectRetry) => {
    const { store, cryptoKey, vault, options } = await fixture(false);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const staleSend = vi.fn<typeof fetch>(async (_input, init) => {
      const rt = new URLSearchParams(String(init?.body)).get("refresh_token");
      if (rt === "RT1") {
        started.resolve();
        await release.promise;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      expect(rt).toBe("RT2");
      if (rejectRetry) {
        await vault.put(key, { refreshToken: "RT3", obtainedAt: 3 });
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ access_token: "valid" });
    });
    const stale = getOAuthToken("spotify", config, staleSend, options);
    // Attach a handler before allowing either endpoint response to complete.
    const outcome = stale.catch((error: unknown) => error);
    await started.promise;
    await refreshAccessToken(
      "spotify",
      config,
      "RT1",
      async () => Response.json({ access_token: "AT2", refresh_token: "RT2" }),
      {
        vault: new ConnectorTokenVault(cryptoKey, store),
        account: key.account,
      },
    );
    release.resolve();
    expect(await outcome).toMatchObject(
      rejectRetry ? { reason: "reauthorise" } : { accessToken: "valid" },
    );
    expect(staleSend).toHaveBeenCalledTimes(2);
    expect((await vault.get(key))?.refreshToken).toBe(rejectRetry ? "RT3" : "RT2");
  });
  it("requires reauthorisation for a rotated key and permits fresh login to replace the record", async () => {
    const { store } = await fixture();
    const vault = new ConnectorTokenVault(await generateBrowserVaultKey(), store);
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "AT2", refresh_token: "RT2" }),
    );
    const options = { vault, account: key.account };
    const unreadable = await getOAuthToken("spotify", config, send, options).catch((e) => e);
    expect(unreadable).toBeInstanceOf(UnreadableCredentialError);
    expect(unreadable).toMatchObject({
      reason: "reauthorise",
      message: "Reconnect this source account.",
    });
    expect(unreadable.cause).toBeUndefined();
    await expect(refreshAccessToken("spotify", config, "RT1", send, options)).rejects.toMatchObject(
      { reason: "reauthorise" },
    );
    expect(send).not.toHaveBeenCalled();
    await exchangeCodeForToken("spotify", config, params, send, options);
    expect((await vault.get(key))?.refreshToken).toBe("RT2");
  });
  it("a disconnect is not undone by another session's in-memory refresh credential", async () => {
    const { store, cryptoKey, vault, options } = await fixture();
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "AT2", refresh_token: "RT2" }),
    );
    const live = {
      accessToken: "AT1",
      refreshToken: "RT1",
      tokenType: "Bearer",
      expiresAt: Date.now() + 60_000,
    };
    const a = createOAuthSourceAuth(spotifyAdapter, config, send, { ...options, token: live });
    const b = createOAuthSourceAuth(spotifyAdapter, config, send, {
      vault: new ConnectorTokenVault(cryptoKey, store),
      account: key.account,
      token: { ...live, expiresAt: 0 },
    });
    await a.disconnect();
    await expect(b.fetch("https://api.spotify.com/v1/me")).rejects.toMatchObject({
      reason: "reauthorise",
    });
    await expect(b.fetch("https://api.spotify.com/v1/me")).rejects.toMatchObject({
      reason: "reauthorise",
    });
    await expect(refreshAccessToken("spotify", config, "RT1", send, options)).rejects.toMatchObject(
      { reason: "reauthorise" },
    );
    await expect(
      getOAuthToken("spotify", config, send, { ...options, token: { ...live, expiresAt: 0 } }),
    ).rejects.toMatchObject({ reason: "reauthorise" });
    expect(send).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
    expect(await vault.get(key)).toBeUndefined();
    // No stored or in-memory credential still lets the host start interactive login.
    expect(await getOAuthToken("spotify", config, send, options)).toBeUndefined();
    // Vault-less sessions keep their in-memory refresh credential.
    await expect(refreshAccessToken("spotify", config, "RT1", send)).resolves.toMatchObject({
      accessToken: "AT2",
      refreshToken: "RT2",
    });
  });
  it("refuses the Spotify-specific factory when given a vault", async () => {
    const { vault } = await fixture();
    expect(() =>
      createSpotifySourceAuth({
        clientId: "synthetic",
        token: { accessToken: "AT", tokenType: "Bearer" },
        fetch: vi.fn(),
        vault,
        account: key.account,
      }),
    ).toThrow("Vault hosts must use createOAuthSourceAuth.");
  });
});

describe("synthetic provider token responses", () => {
  it.each([
    [
      "Twitch",
      {
        access_token: "twitch-at",
        refresh_token: "twitch-rt",
        expires_in: 14400,
        scope: ["user:read:follows", "user:read:email"],
        token_type: "bearer",
      },
      "user:read:follows user:read:email",
    ],
    [
      "Google",
      {
        access_token: "google-at",
        refresh_token: "google-rt",
        expires_in: 3599,
        scope: "openid email",
        token_type: "Bearer",
        id_token: "ignored",
      },
      "openid email",
    ],
    [
      "GitHub JSON (requested with Accept)",
      { access_token: "github-at", scope: "read:user,repo", token_type: "bearer" },
      "read:user,repo",
    ],
    [
      "Spotify",
      {
        access_token: "spotify-at",
        refresh_token: "spotify-rt",
        expires_in: 3600,
        scope: "user-library-read",
        token_type: "Bearer",
      },
      "user-library-read",
    ],
  ])("accepts %s", async (_provider, json, scope) => {
    const { options, vault } = await fixture();
    const result = await exchangeCodeForToken(
      "spotify",
      config,
      params,
      async (_url, init) => {
        expect(new Headers(init?.headers).get("accept")).toBe("application/json");
        return Response.json(json);
      },
      options,
    );
    expect(result.scope).toBe(scope);
    if ("refresh_token" in json) expect((await vault.get(key))?.scope).toBe(scope);
  });
  it.each([null, 1, {}, ["read", 1], [], ""])("drops unsupported/empty scope %j", async (scope) => {
    const { options } = await fixture();
    expect(
      (
        await exchangeCodeForToken(
          "spotify",
          config,
          params,
          async () => Response.json({ access_token: "AT", refresh_token: "RT", scope }),
          options,
        )
      ).scope,
    ).toBeUndefined();
  });
  it("rejects oversized normalized scopes and unsupported form token responses", async () => {
    for (const response of [
      Response.json({ access_token: "AT", scope: ["x".repeat(4097)] }),
      new Response("access_token=github-at&scope=repo&token_type=bearer", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    ])
      await expect(
        exchangeCodeForToken("spotify", config, params, async () => response),
      ).rejects.toMatchObject({ reason: "exchange-failed" });
  });
  it.each([
    "http://localhost:3001/token",
    "http://127.0.0.1:3001/token",
    "http://[::1]:3001/token",
    "https://proxy.test/token",
  ])("permits configured proxy %s", async (tokenProxyUrl) => {
    await expect(
      exchangeCodeForToken(
        "spotify",
        { ...config, tokenExchange: "proxy", tokenProxyUrl },
        params,
        async () => Response.json({ access_token: "AT" }),
      ),
    ).resolves.toMatchObject({ accessToken: "AT" });
  });
  it.each([
    "http://proxy.test/token",
    "http://localhost.evil.test/token",
    "http://[::ffff:127.0.0.1]/token",
    "https://user:secret@proxy.test/token",
    "file:///tmp/token",
  ])("refuses unsafe endpoint %s before sending", async (tokenEndpoint) => {
    const send = vi.fn();
    await expect(
      exchangeCodeForToken("spotify", { ...config, tokenEndpoint }, params, send),
    ).rejects.toMatchObject({ reason: "exchange-failed" });
    expect(send).not.toHaveBeenCalled();
  });
});
