// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.2
import { describe, expect, it, vi } from "vitest";
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { IntegrationAuthError, IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { TOKEN_REQUEST_TIMEOUT_MS } from "../core/oauth.js";
import { SourceTimeoutError } from "../core/source-timeout.js";
import { googleHealthAdapter } from "./adapter.js";
import { endpoint } from "./api.js";
import { createGoogleHealthSourceAuth } from "./source-auth.js";

const config = createGoogleOAuthConfig("health", {
  clientType: "desktop",
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
});
const token = { accessToken: "fixture-old", refreshToken: "fixture-refresh", tokenType: "Bearer" };
const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

describe("Google Health source authentication", () => {
  it("rejects hostile initial credentials before headers or source transport can expose them", () => {
    const transport = vi.fn<typeof fetch>();
    for (const accessToken of ["a b", "a\u0000b", "a".repeat(16_385)]) {
      expect(() =>
        createGoogleHealthSourceAuth({
          config,
          token: { ...token, accessToken },
          fetch: transport,
        }),
      ).toThrow("Invalid Google token response");
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("matches Node loopback's local-secret precedence over a configured Web proxy", async () => {
    const cfg = {
      ...createGoogleOAuthConfig("health", {
        clientId: "fixture-client",
        tokenProxyUrl: "https://proxy.test/token",
      }),
      clientSecret: "fixture-local-secret",
    };
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).not.toBe(cfg.tokenProxyUrl);
      if (String(input) === cfg.tokenEndpoint) {
        expect(new URLSearchParams(String(init?.body)).get("client_secret")).toBe(
          "fixture-local-secret",
        );
        return response(200, { access_token: "fixture-new" });
      }
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    expect(
      (
        await createGoogleHealthSourceAuth({ config: cfg, token, fetch: transport }).fetch(
          endpoint("steps"),
        )
      ).status,
    ).toBe(200);
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("refreshes once on 401, preserves separate transports and retains rotated tokens only in memory", async () => {
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === config.tokenEndpoint) {
        expect(init?.redirect).toBe("manual");
        expect(init?.credentials).toBe("omit");
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
          grant_type: "refresh_token",
          refresh_token: "fixture-refresh",
          client_id: "fixture-client",
          client_secret: "fixture-secret",
        });
        return response(200, {
          access_token: "fixture-new",
          refresh_token: "fixture-rotated",
          expires_in: 3600,
        });
      }
      expect(String(input)).toBe(endpoint("steps"));
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport, onToken });
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    expect(transport.mock.calls.filter(([url]) => url === config.tokenEndpoint)).toHaveLength(1);
    expect(onToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fixture-new", refreshToken: "fixture-rotated" }),
    );
    expect(token.accessToken).toBe("fixture-old");
  });

  it("uses the host's Web token proxy, never sending a secret or bearer token to it", async () => {
    const cfg = createGoogleOAuthConfig("health", {
      clientId: "fixture-client",
      tokenProxyUrl: "https://proxy.test/token",
    });
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === cfg.tokenProxyUrl) {
        expect(new URLSearchParams(String(init?.body)).has("client_secret")).toBe(false);
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return response(200, { access_token: "fixture-new" });
      }
      expect(String(input)).not.toBe(config.tokenEndpoint);
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = googleHealthAdapter.createSourceAuth!(cfg, token, transport);
    expect((await auth.fetch(endpoint("weight"))).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("shares simultaneous refreshes and does not loop on a second 401", async () => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input) === config.tokenEndpoint
        ? response(200, { access_token: "fixture-new" })
        : response(401),
    );
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    expect(
      (await Promise.all([auth.fetch(endpoint("steps")), auth.fetch(endpoint("sleep"))])).map(
        (r) => r.status,
      ),
    ).toEqual([401, 401]);
    expect(transport.mock.calls.filter(([url]) => url === config.tokenEndpoint)).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(5);
  });

  it.each([
    null,
    {},
    { access_token: "" },
    { access_token: "a\r\nb" },
    { access_token: "a\u0000b" },
    { access_token: "a b" },
    { access_token: "\u2603" },
    { access_token: "a", refresh_token: 7 },
    { access_token: "a", token_type: "Basic" },
    { access_token: "a", token_type: 7 },
  ])("rejects malformed token response %j", async (body) => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      response(String(input) === config.tokenEndpoint ? 200 : 401, body),
    );
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    await expect(auth.fetch(endpoint("steps"))).rejects.toThrow(/token response/);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, { error: "invalid_grant", error_description: "private detail" }],
    [401, {}],
    [403, { error: { status: "PERMISSION_DENIED" } }],
  ] as const)("requires reauthorisation after refresh refusal %i", async (status, body) => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      response(String(input) === config.tokenEndpoint ? status : 401, body),
    );
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    const failure = await auth.fetch(endpoint("steps")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(IntegrationAuthError);
    expect(failure).toMatchObject({
      reason: "reauthorise",
      message: expect.stringMatching(/Re-authorize Google Health/),
    });
    expect(String(failure)).not.toContain("private detail");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    [503, { error: "invalid_grant" }, IntegrationSyncError, 503],
    [400, { error: "temporarily_unavailable" }, IntegrationSyncError, 400],
    [400, { error: "server_error" }, IntegrationSyncError, 400],
    [429, {}, RateLimitedError, 429],
    [403, { error: { status: "RESOURCE_EXHAUSTED" } }, RateLimitedError, 429],
    [403, { error: { errors: [{ reason: "quotaExceeded" }] } }, RateLimitedError, 429],
  ] as const)("keeps a transient refresh HTTP %i (%j) retryable", async (status, body, errorType, expectedStatus) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(status, body));
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    const failure = await auth.fetch(endpoint("steps")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(errorType);
    expect(failure).toMatchObject({ status: expectedStatus });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("keeps refresh network failures retryable without exposing transport details", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockRejectedValueOnce(new TypeError("private detail"));
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    const failure = await auth.fetch(endpoint("steps")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(IntegrationSyncError);
    expect(String(failure)).not.toContain("private detail");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("fails with reauthorization guidance when no Google refresh token exists", async () => {
    const transport = vi.fn<typeof fetch>(async () => response(401));
    const auth = createGoogleHealthSourceAuth({
      config,
      token: { ...token, refreshToken: undefined },
      fetch: transport,
    });
    await expect(auth.fetch(endpoint("steps"))).rejects.toMatchObject({
      name: "IntegrationAuthError",
      reason: "reauthorise",
      message: expect.stringMatching(/Re-authorize Google Health/),
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    "http://health.googleapis.com/v4/users/me",
    "https://evil.test/data",
    "https://health.googleapis.com.evil.test/data",
    "https://user@health.googleapis.com/data",
  ])("refuses unsafe credential destination %s", async (url) => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      createGoogleHealthSourceAuth({ config, token, fetch: transport }).fetch(url),
    ).rejects.toThrow(/allowed API origins/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses redirects and non-read operations", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location: "https://evil.test" } }),
    );
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    await expect(auth.fetch(endpoint("steps"))).rejects.toThrow();
    await expect(auth.fetch(endpoint("steps"), { method: "POST" })).rejects.toThrow(/reads only/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("delivers a rotated token before honouring cancellation and lets another caller replay", async () => {
    const controller = new AbortController();
    const sinkStarted = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<void>();
    const onToken = vi.fn(async () => {
      sinkStarted.resolve();
      await saved.promise;
    });
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === config.tokenEndpoint) {
        expect(init?.signal).not.toBe(controller.signal);
        controller.abort(new Error("cancelled"));
        expect(init?.signal?.aborted).toBe(false);
        return response(200, { access_token: "fixture-new", refresh_token: "fixture-rotated" });
      }
      if (String(input) === endpoint("steps")) expect(init?.signal).toBe(controller.signal);
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport, onToken });
    const cancelled = expect(
      auth.fetch(endpoint("steps"), { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    const other = auth.fetch(endpoint("sleep"));
    await sinkStarted.promise;
    expect(onToken).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ refreshToken: "fixture-rotated" }),
    );
    expect(transport).toHaveBeenCalledTimes(3);
    saved.resolve();
    await cancelled;
    expect((await other).status).toBe(200);
    expect(transport.mock.calls[3]?.[0]).toBe(endpoint("sleep"));
    await expect(auth.fetch(endpoint("steps"), { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("retains rotation in this session when no sink is supplied", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { access_token: "next", refresh_token: "rotated" }))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { access_token: "newest" }))
      .mockResolvedValueOnce(response(200));
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    const refreshes = transport.mock.calls.filter(([url]) => url === config.tokenEndpoint);
    expect(
      refreshes.map(([, init]) => new URLSearchParams(String(init?.body)).get("refresh_token")),
    ).toEqual([token.refreshToken, "rotated"]);
  });

  it("retries a failed sink before using the rotated token, without repeating the exchange", async () => {
    const onToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("vault unavailable"))
      .mockResolvedValueOnce(undefined);
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { access_token: "next", refresh_token: "rotated" }))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200));
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport, onToken });
    await expect(auth.fetch(endpoint("steps"))).rejects.toThrow(
      "Could not save the refreshed Google Health token.",
    );
    expect(transport).toHaveBeenCalledTimes(2);
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[1]).toEqual(onToken.mock.calls[0]);
    expect(onToken.mock.calls[1]?.[0].refreshToken).toBe("rotated");
    expect(transport.mock.calls.filter(([url]) => url === config.tokenEndpoint)).toHaveLength(1);
  });

  it.each([
    "headers",
    "token body",
    "error body",
  ])("bounds stalled refresh %s independently of the caller", async (stage) => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const cancel = vi.fn();
      const transport = vi.fn<typeof fetch>(async (url) => {
        if (url !== config.tokenEndpoint) return response(401);
        if (stage === "headers") return new Promise<Response>(() => {});
        return new Response(new ReadableStream({ cancel }), {
          status: stage === "token body" ? 200 : 403,
        });
      });
      const onToken = vi.fn();
      const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport, onToken });
      const expired = expect(
        auth.fetch(endpoint("steps"), { signal: controller.signal }),
      ).rejects.toBeInstanceOf(SourceTimeoutError);
      await vi.advanceTimersByTimeAsync(TOKEN_REQUEST_TIMEOUT_MS - 1);
      const signal = transport.mock.calls[1]?.[1]?.signal;
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expired;
      expect(signal?.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      if (stage !== "headers") expect(cancel).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledTimes(2);
      expect(onToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps token response bytes and cancels the reader", async () => {
    const cancel = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input) === config.tokenEndpoint
        ? new Response(new ReadableStream({ cancel }), { headers: { "content-length": "65537" } })
        : response(401),
    );
    await expect(
      createGoogleHealthSourceAuth({ config, token, fetch: transport }).fetch(endpoint("steps")),
    ).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("exposes the granted scopes and keeps them current across a refresh", async () => {
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === config.tokenEndpoint)
        return response(200, { access_token: "fixture-new", scope: "a b c" });
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createGoogleHealthSourceAuth({
      config,
      token: { ...token, scope: "a b" },
      fetch: transport,
    });
    expect(auth.scopes).toEqual(["a", "b"]);
    expect((await auth.fetch(endpoint("steps"))).status).toBe(200);
    expect(auth.scopes).toEqual(["a", "b", "c"]);
    expect(
      createGoogleHealthSourceAuth({ config, token, fetch: transport }).scopes,
    ).toBeUndefined();
  });
});
