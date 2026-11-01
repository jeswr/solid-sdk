// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { createSessionVault, MemoryVaultStore, type PodSessionProvider } from "@jeswr/mcp-oauth";
import { describe, expect, it, vi } from "vitest";
import { navigation } from "../test/navigation.js";
import { createApp } from "./handler.js";

const ORIGIN = "https://mcp.example";
const CLIENT_ORIGIN = "https://client.example";
const publicOAuthRoutes = [
  ["/.well-known/oauth-authorization-server/auth", "GET"],
  ["/.well-known/oauth-protected-resource/mcp", "GET"],
  ["/auth/jwks", "GET"],
  ["/auth/register", "POST"],
  ["/auth/token", "POST"],
  ["/auth/revoke", "POST"],
] as const;
const verifier = "v".repeat(43);
const csrf = (html: string) => {
  const value = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  if (!value) throw new Error("Missing CSRF input");
  return value;
};
const request = (path: string, init?: RequestInit) => new Request(new URL(path, ORIGIN), init);
const post = (path: string, cookie: string, fields: Record<string, string>, origin = ORIGIN) =>
  request(path, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

async function fixture(upstreamFetch?: typeof fetch, allowedOrigins: readonly string[] = []) {
  let now = Math.floor(Date.now() / 1000);
  const vault = createSessionVault({
    key: Buffer.alloc(32, 8).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const active = new Set<string>();
  const sessions: PodSessionProvider = {
    begin: vi.fn(async () => ({
      state: "upstream-state",
      authorizeUrl: "https://pod.example/authorize?state=upstream-state",
    })),
    complete: vi.fn(async () => {
      active.add("pod-session");
      return { id: "pod-session", webId: "https://pod.example/profile/card#me" };
    }),
    fetchFor: vi.fn(async () => {
      throw new Error("Unexpected pod read");
    }),
    revoke: vi.fn(async (id) => {
      active.delete(id);
    }),
    isActive: async (id) => active.has(id),
  };
  const options = {
    publicOrigin: ORIGIN,
    vault,
    podSessions: sessions,
    now: () => now,
    upstreamFetch,
    allowedOrigins,
  };
  const app = await createApp(options);
  const registration = await app(
    request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: '<script>alert("x")</script>',
        redirect_uris: ["http://127.0.0.1:4321/callback"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  const { client_id: clientId } = await registration.json();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://127.0.0.1:4321/callback",
    response_type: "code",
    resource: `${ORIGIN}/mcp`,
    state: "mcp-state",
    scope: "mcp",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  async function start(changes: Record<string, string> = {}) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) query.set(key, value);
    const response = await app(request(`/auth/authorize?${query}`));
    return {
      cookie: response.headers.getSetCookie()[0]?.split(";")[0] as string,
      csrf: csrf(await response.text()),
      response,
    };
  }
  async function consent() {
    const login = await start();
    expect(
      (
        await app(
          post("/auth/login", login.cookie, { csrf: login.csrf, webid: "https://pod.example/" }),
        )
      ).status,
    ).toBe(200);
    const response = await app(
      request("/auth/callback?code=pod-code&state=upstream-state", {
        headers: { cookie: login.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    return { cookie: login.cookie, csrf: csrf(html), html, response };
  }
  async function token(code: string, extra: Record<string, string> = {}) {
    return app(
      post("/auth/token", "", {
        grant_type: "authorization_code",
        client_id: clientId,
        resource: `${ORIGIN}/mcp`,
        redirect_uri: params.get("redirect_uri") as string,
        code_verifier: verifier,
        code,
        ...extra,
      }),
    );
  }
  return {
    app,
    start,
    consent,
    token,
    sessions,
    options,
    clientId,
    advance: () => {
      now += 601;
    },
  };
}

describe("OAuth composition", () => {
  it.each(
    publicOAuthRoutes,
  )("allows browser preflight and responses on %s", async (path, method) => {
    const { app } = await fixture(undefined, [CLIENT_ORIGIN]);
    const preflight = await app(
      request(path, {
        method: "OPTIONS",
        headers: {
          origin: CLIENT_ORIGIN,
          "access-control-request-method": method,
          "access-control-request-headers": "content-type, mcp-protocol-version",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(await preflight.text()).toBe("");
    expect(preflight.headers.get("access-control-allow-methods")).toBe(`${method}, OPTIONS`);
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toBe(
      "content-type, mcp-protocol-version",
    );
    const response = await app(request(path, { method, headers: { origin: CLIENT_ORIGIN } }));
    // Invalid POST bodies still return readable OAuth errors to the allowed browser.
    expect(response.status).toBe(method === "GET" ? 200 : 415);
    for (const result of [preflight, response]) {
      expect(result.headers.get("access-control-allow-origin")).toBe(CLIENT_ORIGIN);
      expect(result.headers.get("vary")).toBe("Origin");
      expect(result.headers.get("access-control-allow-credentials")).toBeNull();
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("completes registration, PKCE token exchange and revocation for an allowed browser", async () => {
    const f = await fixture(undefined, [CLIENT_ORIGIN]);
    const registration = await f.app(
      request("/auth/register", {
        method: "POST",
        headers: { origin: CLIENT_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:4321/callback"],
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    expect(registration.status).toBe(201);
    expect(registration.headers.get("access-control-allow-origin")).toBe(CLIENT_ORIGIN);
    const { client_id: clientId } = await registration.json();
    const login = await f.start({ client_id: clientId });
    await f.app(
      post("/auth/login", login.cookie, { csrf: login.csrf, webid: "https://pod.example/" }),
    );
    const consent = await f.app(
      request("/auth/callback?code=pod-code&state=upstream-state", {
        headers: { cookie: login.cookie },
      }),
    );
    const approved = await f.app(
      post("/auth/consent", login.cookie, { csrf: csrf(await consent.text()), decision: "allow" }),
    );
    const token = await f.app(
      post(
        "/auth/token",
        "",
        {
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: "http://127.0.0.1:4321/callback",
          resource: `${ORIGIN}/mcp`,
          code_verifier: verifier,
          code: (await navigation(approved)).searchParams.get("code") as string,
        },
        CLIENT_ORIGIN,
      ),
    );
    expect(token.status).toBe(200);
    expect(token.headers.get("access-control-allow-origin")).toBe(CLIENT_ORIGIN);
    const tokens = await token.json();
    const revoked = await f.app(
      post("/auth/revoke", "", { token: tokens.refresh_token, client_id: clientId }, CLIENT_ORIGIN),
    );
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("access-control-allow-origin")).toBe(CLIENT_ORIGIN);
    expect(f.sessions.revoke).toHaveBeenCalledWith("pod-session");
  });

  it("rejects unlisted origins and invalid preflight methods without widening browser form access", async () => {
    const f = await fixture(undefined, [CLIENT_ORIGIN]);
    for (const [path, method] of publicOAuthRoutes) {
      for (const origin of ["https://evil.example", `${CLIENT_ORIGIN}.evil.example`, "null"]) {
        for (const init of [
          { method, headers: { origin } },
          { method: "OPTIONS", headers: { origin, "access-control-request-method": method } },
        ]) {
          const response = await f.app(request(path, init));
          expect(response.status).toBe(403);
          expect(response.headers.get("access-control-allow-origin")).toBeNull();
        }
      }
      const preflight = await f.app(
        request(path, {
          method: "OPTIONS",
          headers: { origin: CLIENT_ORIGIN, "access-control-request-method": "DELETE" },
        }),
      );
      expect(preflight.status).toBe(405);
      expect(preflight.headers.get("access-control-allow-methods")).toBeNull();
      for (const headers of [{}, { origin: ORIGIN }]) {
        const response = await f.app(request(path, { method, headers }));
        expect(response.status).toBe(method === "GET" ? 200 : 415);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
      const noOrigin = await f.app(
        request(path, { method: "OPTIONS", headers: { "access-control-request-method": method } }),
      );
      expect(noOrigin.status).toBe(405);
      expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
    }
    const login = await f.start();
    const consent = await f.consent();
    for (const [path, cookie, fields] of [
      ["/auth/login", login.cookie, { csrf: login.csrf, webid: "https://pod.example/" }],
      ["/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "allow" }],
    ] as const) {
      const response = await f.app(post(path, cookie, fields, CLIENT_ORIGIN));
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      const preflight = await f.app(
        request(path, {
          method: "OPTIONS",
          headers: { origin: CLIENT_ORIGIN, "access-control-request-method": "POST" },
        }),
      );
      expect(preflight.status).toBe(405);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(f.sessions.begin).toHaveBeenCalledOnce();
  });

  it("keeps public OAuth browser access disabled without an allowlist", async () => {
    const { app } = await fixture();
    for (const [path, method] of publicOAuthRoutes) {
      const response = await app(request(path, { method, headers: { origin: CLIENT_ORIGIN } }));
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("serves health, exact Client ID Document, metadata and security headers", async () => {
    const { app } = await fixture();
    for (const path of [
      "/healthz",
      "/client-id.jsonld",
      "/.well-known/oauth-authorization-server/auth",
      "/.well-known/oauth-protected-resource/mcp",
      "/missing",
    ]) {
      const response = await app(request(path));
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const response = await app(request("/client-id.jsonld"));
    expect(response.headers.get("content-type")).toBe("application/ld+json");
    expect(await response.json()).toMatchObject({
      client_id: `${ORIGIN}/client-id.jsonld`,
      redirect_uris: [`${ORIGIN}/auth/callback`],
      scope: "openid webid offline_access",
      token_endpoint_auth_method: "none",
    });
    expect((await app(request("/healthz", { headers: { host: "attacker.example" } }))).status).toBe(
      403,
    );
    expect((await app(request("/mcp"))).headers.get("www-authenticate")).toContain(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(
      (await app(request("/mcp", { headers: { origin: "https://attacker.example" } }))).status,
    ).toBe(403);
  });

  it("requires explicit approval, escapes metadata, issues only MCP tokens and persists across workers", async () => {
    const f = await fixture();
    const consent = await f.consent();
    expect(consent.html).not.toContain("<script>");
    expect(consent.html).toContain("&lt;script&gt;");
    expect(consent.html).toContain("read only");
    expect(consent.html).not.toContain("pod-code");
    const second = await createApp(f.options);
    const response = await second(
      post("/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "allow" }),
    );
    const redirect = await navigation(response);
    expect(redirect.searchParams.get("state")).toBe("mcp-state");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const tokenResponse = await f.token(redirect.searchParams.get("code") as string);
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 600 });
    expect(JSON.stringify(tokens)).not.toContain("pod-code");
    const keys = await (await second(request("/auth/jwks"))).json();
    expect(keys).toEqual(await (await f.app(request("/auth/jwks"))).json());
    // Verification on another worker reaches its pod factory, rather than failing auth.
    expect(
      (
        await second(
          request("/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${tokens.access_token}` },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(500);
    expect(f.sessions.fetchFor).toHaveBeenCalledWith("pod-session");
    expect(
      (
        await f.app(
          post("/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "allow" }),
        )
      ).status,
    ).toBe(400);
    await f.app(post("/auth/revoke", "", { token: tokens.refresh_token, client_id: f.clientId }));
    expect(f.sessions.revoke).toHaveBeenCalledWith("pod-session");
    expect(
      (
        await second(
          request("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` } }),
        )
      ).status,
    ).toBe(401);
  });

  it("denies consent and destroys the upstream session", async () => {
    const f = await fixture();
    const consent = await f.consent();
    const response = await f.app(
      post("/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "deny" }),
    );
    expect((await navigation(response)).searchParams.get("error")).toBe("access_denied");
    expect(f.sessions.revoke).toHaveBeenCalledWith("pod-session");
  });

  it("resolves fragment WebIDs before discovery and rejects a different verified owner", async () => {
    const f = await fixture(
      async () =>
        new Response(
          "<https://pod.example/profile/card#other> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://pod.example/>.",
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    const login = await f.start();
    expect(
      (
        await f.app(
          post("/auth/login", login.cookie, {
            csrf: login.csrf,
            webid: "https://pod.example/profile/card#other",
          }),
        )
      ).status,
    ).toBe(200);
    expect(f.sessions.begin).toHaveBeenCalledWith(
      "https://pod.example/",
      `${ORIGIN}/auth/callback`,
    );
    const response = await f.app(
      request("/auth/callback?code=x&state=upstream-state", { headers: { cookie: login.cookie } }),
    );
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "access_denied",
    );
    expect(f.sessions.revoke).toHaveBeenCalledWith("pod-session");
  });

  it("rejects PKCE mismatch without consuming the code, and retires the session on code reuse", async () => {
    const f = await fixture();
    const consent = await f.consent();
    const approved = await f.app(
      post("/auth/consent", consent.cookie, {
        csrf: consent.csrf,
        decision: "allow",
        sessionId: "attacker-selected",
      }),
    );
    const code = (await navigation(approved)).searchParams.get("code") as string;
    expect((await f.token(code, { code_verifier: "x".repeat(43) })).status).toBe(400);
    expect((await f.token(code)).status).toBe(200);
    expect((await f.token(code)).status).toBe(400);
    expect(f.sessions.revoke).toHaveBeenCalledWith("pod-session");
    expect(f.sessions.revoke).not.toHaveBeenCalledWith("attacker-selected");
  });

  it("rejects consent CSRF and callback replay while preserving a valid approval", async () => {
    const f = await fixture();
    const consent = await f.consent();
    expect(
      (await f.app(post("/auth/consent", consent.cookie, { csrf: "wrong", decision: "allow" })))
        .status,
    ).toBe(403);
    expect(
      (
        await f.app(
          post(
            "/auth/consent",
            consent.cookie,
            { csrf: consent.csrf, decision: "allow" },
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.app(
          request("/auth/callback?code=x&state=upstream-state", {
            headers: { cookie: consent.cookie },
          }),
        )
      ).status,
    ).toBe(400);
    expect(f.sessions.complete).toHaveBeenCalledOnce();
    expect(
      (
        await f.app(
          post("/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "allow" }),
        )
      ).status,
    ).toBe(200);
  });

  it("rejects missing cookies, wrong state, foreign origins and CSRF before broker completion", async () => {
    const f = await fixture();
    const login = await f.start();
    expect(login.response.headers.get("set-cookie")).toContain("Secure");
    expect(login.response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    for (const [cookie, token, origin] of [
      ["", login.csrf, ORIGIN],
      [login.cookie, "wrong", ORIGIN],
      [login.cookie, login.csrf, "https://evil.example"],
    ]) {
      expect(
        (
          await f.app(
            post(
              "/auth/login",
              cookie as string,
              { csrf: token as string, webid: "https://pod.example/" },
              origin,
            ),
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(f.sessions.begin).not.toHaveBeenCalled();
    await f.app(
      post("/auth/login", login.cookie, { csrf: login.csrf, webid: "https://pod.example/" }),
    );
    for (const [query, cookie] of [
      ["state=wrong", login.cookie],
      ["state=upstream-state", ""],
      ["state=upstream-state&state=upstream-state", login.cookie],
    ]) {
      expect(
        (
          await f.app(
            request(`/auth/callback?code=x&${query}`, { headers: { cookie: cookie as string } }),
          )
        ).status,
      ).toBe(400);
    }
    expect(f.sessions.complete).not.toHaveBeenCalled();
  });

  it("consumes consent exactly once during concurrent approval and rejects expiry", async () => {
    const f = await fixture();
    const consent = await f.consent();
    const responses = await Promise.all(
      [1, 2].map(() =>
        f.app(post("/auth/consent", consent.cookie, { csrf: consent.csrf, decision: "allow" })),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const other = await fixture();
    const expired = await other.consent();
    other.advance();
    expect(
      (
        await other.app(
          post("/auth/consent", expired.cookie, { csrf: expired.csrf, decision: "allow" }),
        )
      ).status,
    ).toBe(400);
    expect(other.sessions.revoke).toHaveBeenCalled();
  });

  it.each([
    { code_challenge_method: "plain" },
    { resource: "https://evil.example/mcp" },
    { redirect_uri: "https://evil.example/callback" },
  ])("rejects invalid OAuth parameters before contacting the pod: %j", async (changes) => {
    const f = await fixture();
    const login = await f.start(changes);
    const response = await f.app(
      post("/auth/login", login.cookie, { csrf: login.csrf, webid: "https://pod.example/" }),
    );
    expect(response.status === 400 || (await navigation(response)).searchParams.has("error")).toBe(
      true,
    );
    expect(f.sessions.begin).not.toHaveBeenCalled();
  });
});
