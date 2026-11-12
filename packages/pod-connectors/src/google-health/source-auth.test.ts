// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
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
  ])("rejects malformed token response %j", async (body) => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      response(String(input) === config.tokenEndpoint ? 200 : 401, body),
    );
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    await expect(auth.fetch(endpoint("steps"))).rejects.toThrow(/token response/);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    400, 500,
  ])("does not retry refresh HTTP %i or advance to a source replay", async (status) => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      response(String(input) === config.tokenEndpoint ? status : 401),
    );
    await expect(
      createGoogleHealthSourceAuth({ config, token, fetch: transport }).fetch(endpoint("steps")),
    ).rejects.toThrow(/refresh failed/);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("fails with reauthorization guidance when no Google refresh token exists", async () => {
    const transport = vi.fn<typeof fetch>(async () => response(401));
    const auth = createGoogleHealthSourceAuth({
      config,
      token: { ...token, refreshToken: undefined },
      fetch: transport,
    });
    await expect(auth.fetch(endpoint("steps"))).rejects.toThrow(/Re-authorize Google Health/);
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

  it("preserves request abort signals through refresh and cancels before a replay", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.signal).toBe(controller.signal);
      if (String(input) === config.tokenEndpoint) {
        controller.abort(new Error("cancelled"));
        return response(200, { access_token: "fixture-new" });
      }
      return response(401);
    });
    const auth = createGoogleHealthSourceAuth({ config, token, fetch: transport });
    await expect(auth.fetch(endpoint("steps"), { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(auth.fetch(endpoint("steps"), { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(transport).toHaveBeenCalledTimes(2);
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
});
