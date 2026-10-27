// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { request, Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthAppConfig } from "../core/types.js";
import { createRegistry } from "../registry.js";
import { authorizeLoopback, type NodeOAuthConfig } from "./loopback.js";

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

/** Exercise provider exchanges without opening a socket; callback socket coverage stays separate. */
function mockLoopbackCallback() {
  let listener: Server | undefined;
  vi.spyOn(Server.prototype, "listen").mockImplementation(function (
    this: Server,
    ...args: unknown[]
  ) {
    listener = this;
    const listening = args.at(-1);
    if (typeof listening === "function") listening();
    return this;
  });
  vi.spyOn(Server.prototype, "address").mockReturnValue({
    address: "127.0.0.1",
    family: "IPv4",
    port: 49152,
  });
  return (url: string) => {
    if (!listener) throw new Error("Missing fixture listener");
    const { redirect } = answer(url);
    listener.emit(
      "request",
      { method: "GET", headers: { host: redirect.host }, url: redirect.pathname + redirect.search },
      { setHeader: vi.fn(), writeHead: vi.fn().mockReturnThis(), end: vi.fn() },
    );
  };
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
    "secret",
    "proxy",
  ])("requires Twitch's registered callback port before opening the browser (%s)", async (mode) => {
    const oauth = createRegistry().adapterById("twitch")?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    const open = vi.fn();
    const listen = vi.spyOn(Server.prototype, "listen");
    const exchange = vi.fn();
    await expect(
      authorizeLoopback(
        "twitch",
        {
          ...oauth,
          clientId: "synthetic-client",
          ...(mode === "secret"
            ? { clientSecret: "synthetic-secret" }
            : { tokenProxyUrl: "https://proxy.test/token" }),
        },
        exchange,
        { openAuthorizationUrl: open },
      ),
    ).rejects.toMatchObject({ kind: "config", message: expect.stringContaining("callbackPort") });
    expect(listen).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
  it.each([
    null,
    true,
    "49152",
    0,
    1023,
    65536,
    49152.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid programmatic callback port %s before listening", async (callbackPort) => {
    const listen = vi.spyOn(Server.prototype, "listen");
    const open = vi.fn();
    await expect(
      authorizeLoopback("source", { ...cfg, callbackPort } as NodeOAuthConfig, vi.fn(), {
        openAuthorizationUrl: open,
      }),
    ).rejects.toMatchObject({ kind: "config" });
    expect(listen).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    "secret",
    "proxy",
  ])("uses the configured Twitch port for binding, authorization and %s exchange", async (mode) => {
    const completeCallback = mockLoopbackCallback();
    const callbackPort = 49152;
    const oauth = createRegistry().adapterById("twitch")?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    const config = {
      ...oauth,
      clientId: "synthetic-client",
      ...(mode === "secret"
        ? { clientSecret: "synthetic-secret" }
        : { tokenProxyUrl: "https://proxy.test/token" }),
      callbackPort,
    };
    const exchange = vi.fn(async (input, init) => {
      expect(input).toBe(mode === "secret" ? oauth.tokenEndpoint : config.tokenProxyUrl);
      expect(new URLSearchParams(init.body).get("redirect_uri")).toBe(
        `http://127.0.0.1:${callbackPort}/oauth-callback`,
      );
      return Response.json({ access_token: "synthetic-token" });
    });
    await expect(
      authorizeLoopback("twitch", config, exchange, {
        openAuthorizationUrl(url) {
          expect(answer(url).auth.searchParams.get("redirect_uri")).toBe(
            `http://127.0.0.1:${callbackPort}/oauth-callback`,
          );
          completeCallback(url);
        },
      }),
    ).resolves.toMatchObject({ accessToken: "synthetic-token" });
    expect(Server.prototype.listen).toHaveBeenCalledWith(
      { host: "127.0.0.1", port: callbackPort, exclusive: true },
      expect.any(Function),
    );
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it("refuses a busy fixed callback port before opening the browser", async () => {
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      queueMicrotask(() =>
        this.emit("error", Object.assign(new Error("Port in use"), { code: "EADDRINUSE" })),
      );
      return this;
    });
    const open = vi.fn(),
      exchange = vi.fn();
    await expect(
      authorizeLoopback("source", { ...cfg, callbackPort: 49152 }, exchange, {
        openAuthorizationUrl: open,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(open).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
  it.each([
    "github",
    "strava",
    "twitch",
  ])("exchanges %s directly with a local secret, even when a proxy is configured", async (id) => {
    const completeCallback = mockLoopbackCallback();
    const oauth = createRegistry().adapterById(id)?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    for (const tokenProxyUrl of [undefined, "https://proxy.test/token"]) {
      const transport = vi.fn(async (url, init) => {
        expect(url).toBe(oauth.tokenEndpoint);
        expect(init.redirect).toBe("manual");
        expect(new Headers(init.headers).get("accept")).toBe("application/json");
        expect(new URLSearchParams(init.body).get("client_secret")).toBe("synthetic-secret");
        return Response.json({ access_token: "synthetic-token" });
      });
      const token = await authorizeLoopback(
        id,
        {
          ...oauth,
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          tokenProxyUrl,
          callbackPort: 49152,
        },
        transport,
        {
          openAuthorizationUrl(url) {
            expect(url).not.toContain("synthetic-secret");
            completeCallback(url);
          },
        },
      );
      expect(token.accessToken).toBe("synthetic-token");
      expect(transport).toHaveBeenCalledTimes(1);
      expect(oauth.tokenExchange).toBe("proxy");
    }
  });
  it.each([
    undefined,
    "https://proxy.test/token",
  ])("exchanges Notion directly with Basic authentication and JSON (proxy: %s)", async (tokenProxyUrl) => {
    const completeCallback = mockLoopbackCallback();
    const oauth = createRegistry().adapterById("notion")?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    let authorization: URL;
    const transport = vi.fn(async (url, init) => {
      expect(url).toBe(oauth.tokenEndpoint);
      expect(init.redirect).toBe("manual");
      const headers = new Headers(init.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("authorization")).toBe(
        `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`,
      );
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        grant_type: "authorization_code",
        code: "synthetic-code",
        redirect_uri: authorization.searchParams.get("redirect_uri"),
        code_verifier: expect.any(String),
      });
      expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(
        authorization.searchParams.get("code_challenge"),
      );
      return Response.json({ access_token: "synthetic-token" });
    });
    const token = await authorizeLoopback(
      "notion",
      { ...oauth, clientId: "synthetic-client", clientSecret: "synthetic-secret", tokenProxyUrl },
      transport,
      {
        openAuthorizationUrl(url) {
          authorization = answer(url).auth;
          expect(url).not.toContain("synthetic-secret");
          completeCallback(url);
        },
      },
    );
    expect(token.accessToken).toBe("synthetic-token");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(oauth.tokenExchange).toBe("proxy");
  });
  it.each([
    ["fitbit", undefined],
    ["fitbit", "https://proxy.test/token"],
    ["pinterest", undefined],
    ["pinterest", "https://proxy.test/token"],
  ])("exchanges %s directly with Basic authentication and a form (proxy: %s)", async (id, tokenProxyUrl) => {
    const completeCallback = mockLoopbackCallback();
    const oauth = createRegistry().adapterById(id)?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    let authorization: URL;
    const transport = vi.fn(async (url, init) => {
      expect(url).toBe(oauth.tokenEndpoint);
      expect(init.redirect).toBe("manual");
      const headers = new Headers(init.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(headers.get("authorization")).toBe(
        `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`,
      );
      const body = new URLSearchParams(init.body);
      expect(Object.fromEntries(body)).toEqual({
        grant_type: "authorization_code",
        client_id: "synthetic-client",
        code: "synthetic-code",
        redirect_uri: authorization.searchParams.get("redirect_uri"),
        code_verifier: expect.any(String),
      });
      expect(body.has("client_secret")).toBe(false);
      expect(String(init.body)).not.toContain("synthetic-secret");
      expect(
        createHash("sha256")
          .update(body.get("code_verifier") as string)
          .digest("base64url"),
      ).toBe(authorization.searchParams.get("code_challenge"));
      return Response.json({ access_token: "synthetic-token" });
    });
    await expect(
      authorizeLoopback(
        id,
        { ...oauth, clientId: "synthetic-client", clientSecret: "synthetic-secret", tokenProxyUrl },
        transport,
        {
          openAuthorizationUrl(url) {
            authorization = answer(url).auth;
            expect(url).not.toContain("synthetic-secret");
            completeCallback(url);
          },
        },
      ),
    ).resolves.toMatchObject({ accessToken: "synthetic-token" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "notion",
    "fitbit",
    "pinterest",
  ])("keeps %s's form proxy contract without a local secret", async (id) => {
    const completeCallback = mockLoopbackCallback();
    const oauth = createRegistry().adapterById(id)?.oauth;
    if (!oauth) throw new Error("Missing fixture OAuth configuration");
    const transport = vi.fn(async (url, init) => {
      expect(url).toBe("https://proxy.test/token");
      expect(init.redirect).toBe("manual");
      const headers = new Headers(init.headers);
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(headers.has("authorization")).toBe(false);
      const body = new URLSearchParams(init.body);
      expect(body.get("client_id")).toBe("synthetic-client");
      expect(body.has("client_secret")).toBe(false);
      expect(body.get("code")).toBe("synthetic-code");
      return Response.json({ access_token: "synthetic-token" });
    });
    await expect(
      authorizeLoopback(
        id,
        { ...oauth, clientId: "synthetic-client", tokenProxyUrl: "https://proxy.test/token" },
        transport,
        {
          openAuthorizationUrl: completeCallback,
        },
      ),
    ).resolves.toMatchObject({ accessToken: "synthetic-token" });
    expect(transport).toHaveBeenCalledTimes(1);
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
