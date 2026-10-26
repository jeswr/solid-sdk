// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { request, Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthAppConfig } from "../core/types.js";
import { createRegistry } from "../registry.js";
import { authorizeLoopback } from "./loopback.js";

const cfg: OAuthAppConfig = {
  clientId: "synthetic-source-client",
  authorizationEndpoint: "https://source.test/authorize",
  tokenEndpoint: "https://source.test/token",
  scopes: ["read"],
  tokenExchange: "public",
};
function callback(url: string, headers?: Record<string, string>, method = "GET", path?: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { method, headers, ...(path ? { path } : {}) }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode as number));
    });
    req.on("error", reject);
    req.end();
  });
}
function answer(url: string) {
  const auth = new URL(url);
  const redirect = new URL(auth.searchParams.get("redirect_uri") as string);
  redirect.searchParams.set("state", auth.searchParams.get("state") as string);
  redirect.searchParams.set("code", "synthetic-code");
  return { auth, redirect };
}

describe("source loopback login", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    null,
    "socket-path",
    { address: "::", family: "IPv6", port: 1 },
  ])("refuses an unexpected listener address #%#", async (address) => {
    vi.spyOn(Server.prototype, "address").mockReturnValue(address);
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), { openAuthorizationUrl: vi.fn() }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
  it("handles cancellation between listener startup and callback registration", async () => {
    const controller = new AbortController();
    const original = Server.prototype.address;
    vi.spyOn(Server.prototype, "address").mockImplementation(function (this: Server) {
      controller.abort();
      return original.call(this);
    });
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), {
        signal: controller.signal,
        openAuthorizationUrl: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("binds only 127.0.0.1 on a random port, rejects foreign hosts/paths/methods, and exchanges S256 once", async () => {
    let authorization: URL;
    let redirect: URL;
    const exchange = vi.fn(async (input, init) => {
      expect(input).toBe(cfg.tokenEndpoint);
      expect(init.redirect).toBe("manual");
      const body = new URLSearchParams(init.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("synthetic-code");
      expect(body.get("client_secret")).toBe("synthetic-desktop-secret");
      expect(body.get("redirect_uri")).toBe(authorization.searchParams.get("redirect_uri"));
      expect(
        createHash("sha256")
          .update(body.get("code_verifier") as string)
          .digest("base64url"),
      ).toBe(authorization.searchParams.get("code_challenge"));
      return Response.json({
        access_token: "synthetic-source-token",
        refresh_token: "synthetic-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    const token = await authorizeLoopback(
      "source",
      { ...cfg, clientSecret: "synthetic-desktop-secret" },
      exchange,
      {
        async openAuthorizationUrl(url) {
          ({ auth: authorization, redirect } = answer(url));
          expect(redirect.hostname).toBe("127.0.0.1");
          expect(Number(redirect.port)).toBeGreaterThan(0);
          expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
          expect(authorization.searchParams.get("state")).toMatch(/^[\w-]{22}$/);
          expect(await callback(redirect.href, { host: `localhost:${redirect.port}` })).toBe(400);
          expect(await callback(redirect.href, undefined, "POST")).toBe(405);
          expect(await callback(new URL("/other", redirect).href)).toBe(404);
          expect(
            await callback(redirect.href, undefined, "GET", "//foreign.test/oauth-callback"),
          ).toBe(404);
          expect(await callback(redirect.href, undefined, "GET", "//[invalid")).toBe(400);
          expect(
            await callback(redirect.href, undefined, "GET", "https://foreign.test/callback"),
          ).toBe(400);
          expect(await callback(redirect.href)).toBe(200);
        },
      },
    );
    expect(token.accessToken).toBe("synthetic-source-token");
    expect(exchange).toHaveBeenCalledTimes(1);
    await expect(callback(redirect!.href)).rejects.toThrow();
  });
  it.each([
    "github",
    "strava",
    "twitch",
  ])("exchanges %s directly with a local secret, even when a proxy is configured", async (id) => {
    const oauth = createRegistry().adapterById(id)?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    for (const tokenProxyUrl of [undefined, "https://proxy.test/token"]) {
      const transport = vi.fn(async (url, init) => {
        expect(url).toBe(oauth.tokenEndpoint);
        expect(init.redirect).toBe("manual");
        expect(new URLSearchParams(init.body).get("client_secret")).toBe("synthetic-secret");
        return Response.json({ access_token: "synthetic-token" });
      });
      const token = await authorizeLoopback(
        id,
        { ...oauth, clientId: "synthetic-client", clientSecret: "synthetic-secret", tokenProxyUrl },
        transport,
        {
          async openAuthorizationUrl(url) {
            expect(url).not.toContain("synthetic-secret");
            await callback(answer(url).redirect.href);
          },
        },
      );
      expect(token.accessToken).toBe("synthetic-token");
      expect(transport).toHaveBeenCalledTimes(1);
      expect(oauth.tokenExchange).toBe("proxy");
    }
  });
  it.each([
    "mismatch",
    "missing-state",
    "duplicate-state",
    "missing-code",
    "duplicate-code",
    "denied",
    "same-length-state",
    "empty-code",
  ])("refuses %s without token exchange and closes the listener", async (kind) => {
    let redirect: URL;
    const exchange = vi.fn();
    await expect(
      authorizeLoopback("source", cfg, exchange, {
        async openAuthorizationUrl(url) {
          redirect = answer(url).redirect;
          if (kind === "mismatch") redirect.searchParams.set("state", "wrong");
          if (kind === "missing-state") redirect.searchParams.delete("state");
          if (kind === "duplicate-state") redirect.searchParams.append("state", "wrong");
          if (kind === "missing-code") redirect.searchParams.delete("code");
          if (kind === "duplicate-code") redirect.searchParams.append("code", "other");
          if (kind === "denied") redirect.searchParams.set("error", "access_denied");
          if (kind === "same-length-state") redirect.searchParams.set("state", "x".repeat(22));
          if (kind === "empty-code") redirect.searchParams.set("code", "");
          await callback(redirect.href).catch(() => undefined);
        },
      }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(exchange).not.toHaveBeenCalled();
    await expect(callback(redirect!.href)).rejects.toThrow();
  });
  it("times out and supports host cancellation without retaining the port", async () => {
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), { openAuthorizationUrl() {}, timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: "auth" });
    const controller = new AbortController();
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), {
        signal: controller.signal,
        openAuthorizationUrl() {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), {
        signal: controller.signal,
        openAuthorizationUrl: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
  it.each([
    { ...cfg, clientId: undefined },
    { ...cfg, authorizationEndpoint: "http://source.test/auth" },
    { ...cfg, tokenEndpoint: "https://user:pass@source.test/token" },
    { ...cfg, extraAuthParams: { state: "override" } },
    { ...cfg, tokenExchange: "proxy" as const },
  ])("refuses unsafe/unconfigured OAuth before opening a listener #%#", async (config) => {
    const open = vi.fn();
    await expect(
      authorizeLoopback("source", config, vi.fn(), { openAuthorizationUrl: open }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    302,
    400,
    "invalid-json",
    "missing-token",
    "wrong-type",
    "invalid-expiry",
    "invalid-refresh",
  ])("sanitizes token failure %s", async (kind) => {
    const transport = vi.fn(async () => {
      if (typeof kind === "number")
        return new Response("synthetic-private-error", {
          status: kind,
          headers: { location: "https://elsewhere.test/" },
        });
      if (kind === "invalid-json") return new Response("not-json");
      return Response.json({
        access_token: kind === "missing-token" ? 123 : "synthetic-token",
        token_type: kind === "wrong-type" ? "DPoP" : "Bearer",
        ...(kind === "invalid-expiry" ? { expires_in: -1 } : {}),
        ...(kind === "invalid-refresh" ? { refresh_token: 123 } : {}),
      });
    });
    await expect(
      authorizeLoopback("source", cfg, transport, {
        async openAuthorizationUrl(url) {
          await callback(answer(url).redirect.href);
        },
      }),
    ).rejects.toMatchObject({
      kind: "auth",
      message: "Source loopback login failed or timed out.",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("supports a configured token proxy and safely handles opener rejection", async () => {
    const transport = vi.fn(async (url, init) => {
      expect(url).toBe("https://proxy.test/token");
      expect(new URLSearchParams(init.body).has("client_secret")).toBe(false);
      return Response.json({ access_token: "synthetic-token" });
    });
    await authorizeLoopback(
      "source",
      {
        ...cfg,
        tokenExchange: "proxy",
        tokenProxyUrl: "https://proxy.test/token",
        basicAuthForToken: true,
      },
      transport,
      {
        async openAuthorizationUrl(url) {
          await callback(answer(url).redirect.href);
        },
      },
    );
    await expect(
      authorizeLoopback("source", cfg, vi.fn(), {
        openAuthorizationUrl() {
          throw new Error("synthetic-private-error");
        },
      }),
    ).rejects.not.toThrow("synthetic-private-error");
  });
});
