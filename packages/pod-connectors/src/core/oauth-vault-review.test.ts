// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { spotifyAdapter } from "../spotify/adapter.js";
import { createSpotifySourceAuth } from "../spotify/source-auth.js";
import { ConnectorTokenVault, generateBrowserVaultKey, MemoryVaultStore } from "../vault.js";
import { UnreadableCredentialError } from "./errors.js";
import {
  createOAuthSourceAuth,
  exchangeCodeForToken,
  getOAuthToken,
  refreshAccessToken,
  TOKEN_REQUEST_TIMEOUT_MS,
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
  ])("persists rotation when the caller aborts mid-body of a real streamed %s response", async (grant) => {
    const { vault, options } = await fixture();
    const released = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      request.resume();
      const body = JSON.stringify({ access_token: "AT2", refresh_token: "RT2" });
      response.writeHead(200, { "content-type": "application/json" });
      response.write(body.slice(0, 12));
      void released.promise.then(() => response.end(body.slice(12)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const local = { ...config, tokenEndpoint: `http://127.0.0.1:${port}/token` };
      const abort = new AbortController();
      const responded = Promise.withResolvers<void>();
      const send: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        responded.resolve();
        return response;
      };
      const opts = { ...options, signal: abort.signal };
      const outcome = (
        grant === "refresh"
          ? refreshAccessToken("spotify", local, "RT1", send, opts)
          : exchangeCodeForToken("spotify", local, params, send, opts)
      ).catch((error: unknown) => error);
      await responded.promise;
      // The body is still streaming when the caller cancels.
      abort.abort(new Error("synthetic-sensitive"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      released.resolve();
      const error = (await outcome) as Error;
      expect(error).toMatchObject({ name: "AbortError" });
      expect(error.message).not.toContain("synthetic-sensitive");
      expect((await vault.get(key))?.refreshToken).toBe("RT2");
    } finally {
      released.resolve();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it("never sends a token request after the caller aborted and runs it on its own controller", async () => {
    const { vault, options } = await fixture();
    const aborted = new AbortController();
    aborted.abort();
    const unsent = vi.fn<typeof fetch>();
    for (const operation of [
      refreshAccessToken("spotify", config, "RT1", unsent, { ...options, signal: aborted.signal }),
      exchangeCodeForToken("spotify", config, params, unsent, {
        ...options,
        signal: aborted.signal,
      }),
    ])
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(unsent).not.toHaveBeenCalled();
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    await refreshAccessToken(
      "spotify",
      config,
      "RT1",
      async (_input, init) => {
        signal = init?.signal ?? undefined;
        return Response.json({ access_token: "AT2", refresh_token: "RT2" });
      },
      { ...options, signal: caller.signal },
    );
    expect(signal).toBeDefined();
    expect(signal).not.toBe(caller.signal);
    expect((await vault.get(key))?.refreshToken).toBe("RT2");
  });
  it("times out a stalled token request after 30 seconds without honoring the caller signal", async () => {
    const { vault, options } = await fixture();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let signal: AbortSignal | undefined;
      const sent = Promise.withResolvers<void>();
      const stalled: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          sent.resolve();
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        });
      const outcome = refreshAccessToken("spotify", config, "RT1", stalled, options).catch(
        (error: unknown) => error,
      );
      await sent.promise;
      await vi.advanceTimersByTimeAsync(TOKEN_REQUEST_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ reason: "exchange-failed" });
      expect((await vault.get(key))?.refreshToken).toBe("RT1");
    } finally {
      vi.useRealTimers();
    }
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
  it("a login without a refresh credential deletes the account's previous record", async () => {
    const { vault, options } = await fixture();
    await exchangeCodeForToken(
      "spotify",
      config,
      params,
      async () => Response.json({ access_token: "AT-other-account" }),
      options,
    );
    expect(await vault.get(key)).toBeUndefined();
    // A refresh without rotation keeps the stored credential.
    await vault.put(key, { refreshToken: "RT1", obtainedAt: 1 });
    await refreshAccessToken(
      "spotify",
      config,
      "RT1",
      async () => Response.json({ access_token: "AT2" }),
      options,
    );
    expect((await vault.get(key))?.refreshToken).toBe("RT1");
  });
  it("disconnect revokes at a configured RFC 7009 endpoint, best-effort, before local deletion", async () => {
    const revocationEndpoint = "https://oauth2.googleapis.com/revoke";
    const revoking = { ...config, revocationEndpoint };
    const live = { accessToken: "AT1", refreshToken: "RT-live", tokenType: "Bearer" };
    const { vault, options } = await fixture();
    const order: string[] = [];
    const caller = new AbortController();
    const send = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(revocationEndpoint);
      expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
      expect(init?.signal).not.toBe(caller.signal);
      expect(new Headers(init?.headers).get("content-type")).toBe(
        "application/x-www-form-urlencoded",
      );
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      order.push(`${body.token}:${(await vault.get(key))?.refreshToken ?? "deleted"}`);
      expect(body).toMatchObject({
        token_type_hint: "refresh_token",
        client_id: "synthetic-client",
      });
      return new Response(null, { status: 200 });
    });
    await createOAuthSourceAuth(spotifyAdapter, revoking, send, {
      ...options,
      signal: caller.signal,
      token: live,
    }).disconnect();
    // Both the stored and the session's credential are revoked while the record still exists.
    expect(order).toEqual(["RT1:RT1", "RT-live:RT1"]);
    expect(await vault.get(key)).toBeUndefined();

    // Endpoint failures are ignored and deletion still happens.
    for (const failing of [
      async () => {
        throw new Error("synthetic-network");
      },
      async () => new Response("synthetic", { status: 503 }),
    ] as (typeof fetch)[]) {
      await vault.put(key, { refreshToken: "RT1", obtainedAt: 1 });
      await expect(
        createOAuthSourceAuth(spotifyAdapter, revoking, failing, options).disconnect(),
      ).resolves.toBeUndefined();
      expect(await vault.get(key)).toBeUndefined();
    }
    // A cancelled caller or an unconfigured endpoint never sends; deletion still happens.
    const aborted = new AbortController();
    aborted.abort();
    const unsent = vi.fn<typeof fetch>();
    for (const [cfg, signal] of [
      [revoking, aborted.signal],
      [config, undefined],
    ] as const) {
      await vault.put(key, { refreshToken: "RT1", obtainedAt: 1 });
      await createOAuthSourceAuth(spotifyAdapter, cfg, unsent, {
        ...options,
        signal,
        token: live,
      }).disconnect();
      expect(await vault.get(key)).toBeUndefined();
    }
    expect(unsent).not.toHaveBeenCalled();
    expect(createGoogleOAuthConfig("calendar").revocationEndpoint).toBe(revocationEndpoint);
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
