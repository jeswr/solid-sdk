// AUTHORED-BY Codex GPT-6.1-Sol
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fixture, ISSUER, REDIRECT, RESOURCE, SESSION } from "../test/fixtures.js";
import { createAuthorizationServer } from "./index.js";
import { CODE_TTL, digest, GRANT_TTL, LOGIN_TTL, OAuthError } from "./protocol.js";

describe("metadata and complete OAuth flow", () => {
  it.each([
    "https://mcp.example:443/auth",
    "https://MCP.EXAMPLE/auth",
    "https://MCP.EXAMPLE:443/auth/",
  ])("routes normalized endpoint URLs while retaining issuer %s", async (issuer) => {
    const f = fixture({ issuer });
    const metadataResponse = await f.server.handle(
      new Request("https://mcp.example/.well-known/oauth-authorization-server/auth"),
    );
    expect(metadataResponse.status).toBe(200);
    const metadata = await metadataResponse.json();
    expect(metadata).toMatchObject({
      issuer,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      revocation_endpoint: `${ISSUER}/revoke`,
      jwks_uri: `${ISSUER}/jwks`,
    });
    expect((await f.server.handle(new Request(metadata.jwks_uri))).status).toBe(200);
    expect(f.server.protectedResourceMetadata().authorization_servers).toEqual([issuer]);
    const id = await f.register();
    expect((await f.server.handle(f.authRequest(id))).status).toBe(302);
    expect(f.provider.begin).toHaveBeenCalledWith(SESSION.webId, `${ISSUER}/callback`);
    const callback = await f.server.handle(new Request(`${ISSUER}/callback?state=upstream-state`));
    expect(callback.status).toBe(302);
    const params = new URL(callback.headers.get("location") as string).searchParams;
    expect(params.get("iss")).toBe(issuer);
    const exchange = await f.exchange(id, params.get("code") as string);
    expect(exchange.status).toBe(200);
    const tokens = await exchange.json();
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
    );
    expect(claims.iss).toBe(issuer);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).resolves.toBeDefined();
    const refreshed = await f.refresh(id, tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    const rotated = await refreshed.json();
    const revoke = await f.form("revoke", { client_id: id, token: rotated.refresh_token });
    expect(revoke.status).toBe(200);
    await expect(f.server.verifyAccessToken(rotated.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
  });

  it("serves RFC metadata with inserted well-known paths and only advertised capabilities", async () => {
    const f = fixture();
    const as = await f.server.handle(
      new Request("https://mcp.example/.well-known/oauth-authorization-server/auth"),
    );
    expect(as.status).toBe(200);
    expect(as.headers.get("content-type")).toContain("application/json");
    expect(await as.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      revocation_endpoint: `${ISSUER}/revoke`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp", "read"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    const rs = await f.server.handle(
      new Request("https://mcp.example/.well-known/oauth-protected-resource/mcp"),
    );
    expect(rs.status).toBe(200);
    expect(await rs.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: ["mcp", "read"],
      bearer_methods_supported: ["header"],
    });
    const jwks = await f.server.handle(new Request(`${ISSUER}/jwks`));
    expect(await jwks.json()).toEqual(f.server.jwks());
    const key = f.server.jwks().keys[0];
    expect(key).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      kid: f.key.kid,
    });
    expect(key).not.toHaveProperty("d");
    if (key) key.kid = "mutated";
    expect(f.server.jwks().keys[0]?.kid).toBe(f.key.kid);
    expect(as.headers.get("cache-control")).toBe("no-store");
  });

  it("registers, brokers login, checks consent, exchanges a code and validates the JWT using JWKS", async () => {
    const f = fixture();
    const clientId = await f.register({ client_name: "Test client", ignored: "discard" });
    const registered = await f.stores.clients.get(clientId);
    expect(registered).toMatchObject({
      client_id: clientId,
      client_name: "Test client",
      client_id_issued_at: f.now(),
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    expect(registered).not.toHaveProperty("ignored");
    expect(registered).not.toHaveProperty("client_secret");
    const begin = await f.server.handle(f.authRequest(clientId));
    expect(begin.status).toBe(302);
    expect(begin.headers.get("location")).toBe("https://pod.example/authorize");
    expect(f.provider.begin).toHaveBeenCalledWith(SESSION.webId, `${ISSUER}/callback`);
    const callback = await f.server.handle(
      new Request(`${ISSUER}/callback?state=upstream-state&code=pod-code`),
    );
    expect(callback.status).toBe(302);
    const destination = new URL(callback.headers.get("location") as string);
    expect(destination.origin + destination.pathname).toBe("https://client.example/callback");
    expect(Object.fromEntries(destination.searchParams)).toMatchObject({
      existing: "1",
      state: "client-state",
      iss: ISSUER,
    });
    expect(f.consent).toHaveBeenCalledWith(
      expect.objectContaining({
        session: SESSION,
        authorization: expect.objectContaining({ resource: RESOURCE, clientId }),
      }),
    );
    const code = destination.searchParams.get("code") as string;
    expect(await f.stores.codes.get(code)).toBeUndefined();
    const response = await f.exchange(clientId, code);
    expect(response.status).toBe(200);
    const tokens = await response.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 600, scope: "mcp" });
    const [header, payload, signature] = tokens.access_token.split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({
      aud: RESOURCE,
      iss: ISSUER,
      sub: SESSION.webId,
      client_id: clientId,
      iat: f.now(),
      exp: f.now() + 600,
      scope: "mcp",
    });
    const publicKey = createPublicKey({
      key: f.server.jwks().keys[0] as JsonWebKey,
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(await f.server.verifyAccessToken(tokens.access_token, RESOURCE)).toMatchObject({
      clientId,
      webId: SESSION.webId,
      sessionId: SESSION.id,
      resource: RESOURCE,
      scope: "mcp",
    });
    expect(await f.stores.refreshTokens.get(tokens.refresh_token)).toBeUndefined();
    expect(await f.stores.refreshTokens.get(digest(tokens.refresh_token))).toBeDefined();
    expect(JSON.stringify(tokens)).not.toContain("fixture-pod-token");
    expect(JSON.stringify(claims)).not.toContain(SESSION.id);
    expect(JSON.stringify(await f.stores.grants.get(claims.sid))).not.toContain(
      "fixture-pod-token",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const refreshed = await f.refresh(clientId, tokens.refresh_token, { scope: "mcp" });
    expect(refreshed.status).toBe(200);
    const rotated = await refreshed.json();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.access_token).not.toBe(tokens.access_token);
    const revoked = await f.form("revoke", { client_id: clientId, token: rotated.access_token });
    expect(revoked.status).toBe(200);
    expect(await revoked.text()).toBe("");
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
    expect((await f.refresh(clientId, rotated.refresh_token)).status).toBe(400);
    expect(f.provider.fetchFor).not.toHaveBeenCalled();
    expect(f.provider.revoke).not.toHaveBeenCalled();
  });

  it("supports root issuer paths, defaults and empty scopes", async () => {
    const f = fixture();
    const server = createAuthorizationServer({
      issuer: "https://root.example/",
      resource: "https://root.example/",
      podSessions: f.provider,
      consent: f.consent,
    });
    expect(
      (
        await server.handle(
          new Request("https://root.example/.well-known/oauth-authorization-server"),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await server.handle(
          new Request("https://root.example/.well-known/oauth-protected-resource"),
        )
      ).status,
    ).toBe(200);
    expect(server.authorizationServerMetadata().scopes_supported).toEqual([]);
    const registered = await server.handle(
      new Request("https://root.example/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [REDIRECT] }),
      }),
    );
    expect((await registered.json()).client_id_issued_at).toBeGreaterThan(0);
    const id = await f.register({ grant_types: ["authorization_code"] });
    const auth = await f.server.authorize(f.authRequest(id, { scope: undefined }), SESSION);
    const code = new URL(auth.headers.get("location") as string).searchParams.get("code") as string;
    const tokens = await (await f.exchange(id, code)).json();
    expect(tokens.scope).toBe("");
    expect(tokens).not.toHaveProperty("refresh_token");
  });
});

describe("authorization restrictions and upstream transactions", () => {
  it.each([
    ["state", undefined],
    ["state", ""],
    ["redirect_uri", undefined],
    ["redirect_uri", ""],
    ["redirect_uri", "https://evil.example/cb"],
    ["redirect_uri", `${REDIRECT}&extra=1`],
    ["client_id", undefined],
    ["client_id", ""],
  ])("keeps untrusted %s=%s errors local", async (field, value) => {
    const f = fixture();
    const clientId = await f.register();
    const response = await f.server.handle(f.authRequest(clientId, { [field]: value }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(response.headers.has("location")).toBe(false);
    expect(f.provider.begin).not.toHaveBeenCalled();
    expect(f.consent).not.toHaveBeenCalled();
  });

  it("keeps unknown client errors local even with a registered redirect", async () => {
    const f = fixture();
    const response = await f.server.handle(f.authRequest("unknown-client"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
    expect(response.headers.has("location")).toBe(false);
    expect(f.provider.begin).not.toHaveBeenCalled();
  });

  it.each([
    "client_id",
    "redirect_uri",
    "state",
  ])("keeps duplicate %s errors local", async (name) => {
    const f = fixture();
    const id = await f.register();
    const request = new Request(`${f.authRequest(id).url}&${name}=ambiguous`);
    const response = await f.server.handle(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(response.headers.has("location")).toBe(false);
    expect(f.provider.begin).not.toHaveBeenCalled();
  });

  it.each([
    ["code_challenge_method", "plain", "invalid_request"],
    ["code_challenge_method", undefined, "invalid_request"],
    ["code_challenge", undefined, "invalid_request"],
    ["code_challenge", "short", "invalid_request"],
    ["response_type", "token", "unsupported_response_type"],
    ["response_type", undefined, "invalid_request"],
    ["resource", "https://pod.example/", "invalid_target"],
    ["resource", undefined, "invalid_request"],
    ["scope", "write", "invalid_scope"],
    ["scope", "mcp  read", "invalid_scope"],
    ["webid", undefined, "invalid_request"],
  ])("redirects trusted %s=%s errors before pod login", async (field, value, error) => {
    const f = fixture();
    const clientId = await f.register();
    const state = "client-state +&=#/?";
    const response = await f.server.handle(f.authRequest(clientId, { [field]: value, state }));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe("https://client.example/callback");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      existing: "1",
      error,
      state,
      iss: ISSUER,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.provider.begin).not.toHaveBeenCalled();
    expect(f.consent).not.toHaveBeenCalled();
  });

  it.each([
    { scope: "write", error: "invalid_scope" },
    { response_type: "token", error: "unsupported_response_type" },
  ])("redirects trusted completion validation errors: $error", async ({ error, ...changes }) => {
    const issuer = "https://MCP.EXAMPLE:443/auth/";
    const f = fixture({ issuer });
    const id = await f.register();
    const response = await f.server.authorize(f.authRequest(id, changes), SESSION);
    expect(response.status).toBe(302);
    expect(
      Object.fromEntries(new URL(response.headers.get("location") as string).searchParams),
    ).toEqual({
      existing: "1",
      error,
      state: "client-state",
      iss: issuer,
    });
    expect(f.consent).not.toHaveBeenCalled();
  });

  it.each([
    ISSUER,
    "https://MCP.EXAMPLE:443/auth/",
  ])("identifies issuer %s on consent denial", async (issuer) => {
    const f = fixture({ issuer });
    f.consent.mockResolvedValue(false);
    const clientId = await f.register();
    const response = await f.server.authorize(f.authRequest(clientId), SESSION);
    const location = new URL(response.headers.get("location") as string);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      existing: "1",
      error: "access_denied",
      state: "client-state",
      iss: issuer,
    });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await f.server.handle(f.authRequest(clientId));
    const callback = await f.server.handle(new Request(`${ISSUER}/callback?state=upstream-state`));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(response.headers.get("location"));
  });

  it("isolates consent snapshots from the grant", async () => {
    const f = fixture({
      consent: async (context) => {
        context.authorization.resource = "https://evil.example/";
        context.session.webId = "https://mallory.example/#me";
        context.client.redirect_uris.length = 0;
        return true;
      },
    });
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    expect(await f.server.verifyAccessToken(tokens.access_token, RESOURCE)).toMatchObject({
      webId: SESSION.webId,
      resource: RESOURCE,
    });
  });

  it("rejects callback replay, unknown state, missing state and expired state", async () => {
    const f = fixture();
    const id = await f.register();
    await f.server.handle(f.authRequest(id));
    const callback = new Request(`${ISSUER}/callback?state=upstream-state`);
    expect((await f.server.handle(callback)).status).toBe(302);
    expect((await f.server.handle(callback)).status).toBe(400);
    expect((await f.server.handle(new Request(`${ISSUER}/callback?state=unknown`))).status).toBe(
      400,
    );
    expect((await f.server.handle(new Request(`${ISSUER}/callback`))).status).toBe(400);
    const other = fixture();
    await other.server.handle(other.authRequest(await other.register()));
    other.advance(LOGIN_TTL);
    expect((await other.server.handle(callback)).status).toBe(400);
    expect(other.provider.complete).not.toHaveBeenCalled();
  });

  it("rejects changed metadata redirects on callback", async () => {
    const f = fixture();
    const id = "https://client.example/metadata";
    f.metadataFetch.mockResolvedValueOnce(
      Response.json(
        { client_id: id, redirect_uris: [REDIRECT] },
        { headers: { "cache-control": "no-store" } },
      ),
    );
    f.metadataFetch.mockResolvedValueOnce(
      Response.json({ client_id: id, redirect_uris: ["https://other.example/callback"] }),
    );
    expect((await f.server.handle(f.authRequest(id))).status).toBe(302);
    const response = await f.server.handle(new Request(`${ISSUER}/callback?state=upstream-state`));
    expect(response.status).toBe(400);
    expect(f.consent).not.toHaveBeenCalled();
  });

  it("fails closed on unsafe upstream URLs, absent broker state, missing identity and broker errors", async () => {
    const f = fixture();
    const id = await f.register();
    vi.mocked(f.provider.begin).mockResolvedValueOnce({
      authorizeUrl: "http://evil.example/",
      state: "x",
    });
    const unsafe = await f.server.handle(f.authRequest(id));
    expect(unsafe.status).toBe(302);
    expect(new URL(unsafe.headers.get("location") as string).searchParams.get("error")).toBe(
      "invalid_request",
    );
    vi.mocked(f.provider.begin).mockResolvedValueOnce({
      authorizeUrl: "https://pod.example/",
      state: "",
    });
    const assertServerError = (response: Response) => {
      expect(response.status).toBe(302);
      expect(
        Object.fromEntries(new URL(response.headers.get("location") as string).searchParams),
      ).toEqual({
        existing: "1",
        error: "server_error",
        state: "client-state",
        iss: ISSUER,
      });
    };
    assertServerError(await f.server.handle(f.authRequest(id)));
    assertServerError(
      await f.server.authorize(f.authRequest(id), { id: "", webId: SESSION.webId }),
    );
    assertServerError(await f.server.authorize(f.authRequest(id), { id: SESSION.id, webId: "" }));
    vi.mocked(f.provider.begin).mockRejectedValueOnce(new Error("sensitive broker detail"));
    assertServerError(await f.server.handle(f.authRequest(id)));
  });
});

describe("token replay, binding, expiry and revocation", () => {
  it.each([
    "read mcp",
    "mcp read",
    "read mcp read",
  ])("refreshes equivalent scope sets: %s", async (scope) => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id, { scope: "mcp read" }))).json();
    const response = await f.refresh(id, tokens.refresh_token, { scope });
    expect(response.status).toBe(200);
    const rotated = await response.json();
    expect(rotated.scope).toBe("mcp read");
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    await expect(f.server.verifyAccessToken(rotated.access_token, RESOURCE)).resolves.toMatchObject(
      {
        scope: "mcp read",
      },
    );
  });

  it.each([
    "read",
    "mcp read write",
    "read write",
    "MCP read",
    "mcp  read",
    "",
  ])("rejects changed refresh scope without consuming the token: %s", async (scope) => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id, { scope: "mcp read" }))).json();
    const rejected = await f.refresh(id, tokens.refresh_token, { scope });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: "invalid_scope" });
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).resolves.toBeDefined();
    const retried = await f.refresh(id, tokens.refresh_token);
    expect(retried.status).toBe(200);
    const rotated = await retried.json();
    await expect(f.server.verifyAccessToken(rotated.access_token, RESOURCE)).resolves.toBeDefined();
    expect((await f.refresh(id, tokens.refresh_token)).status).toBe(400);
    await expect(f.server.verifyAccessToken(rotated.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
  });

  it("keeps a code usable after rejecting its requested scope", async () => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    expect(await (await f.exchange(id, code, { scope: "read" })).json()).toEqual({
      error: "invalid_scope",
    });
    expect((await f.exchange(id, code)).status).toBe(200);
  });

  it("refreshes an empty scope set", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id, { scope: undefined }))).json();
    const response = await f.refresh(id, tokens.refresh_token, { scope: "" });
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toBe("");
  });

  it.each([
    { code_verifier: "b".repeat(43) },
    { code_verifier: "plain" },
    { code_verifier: "!".repeat(43) },
    { redirect_uri: "https://evil.example/" },
    { client_id: "other-client" },
    { code: "unknown-code" },
  ])("rejects incorrect code binding %o", async (changes) => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    const response = await f.exchange(id, code, changes);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });

  it("rejects code replay and invalidates its access/refresh family", async () => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    const tokens = await (await f.exchange(id, code)).json();
    expect((await f.exchange(id, code)).status).toBe(400);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toBeInstanceOf(
      OAuthError,
    );
    expect((await f.refresh(id, tokens.refresh_token)).status).toBe(400);
  });

  it("revokes every generation on refresh reuse, while leaving another family valid", async () => {
    const f = fixture();
    const id = await f.register();
    const original = await (await f.exchange(id, await f.code(id))).json();
    const second = await (await f.refresh(id, original.refresh_token)).json();
    const third = await (await f.refresh(id, second.refresh_token)).json();
    const unrelated = await (await f.exchange(id, await f.code(id))).json();
    expect((await f.refresh(id, original.refresh_token)).status).toBe(400);
    for (const tokens of [original, second, third]) {
      await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject(
        { error: "invalid_token" },
      );
    }
    expect((await f.refresh(id, third.refresh_token)).status).toBe(400);
    await expect(
      f.server.verifyAccessToken(unrelated.access_token, RESOURCE),
    ).resolves.toMatchObject({ clientId: id });
  });

  it("rejects concurrent refresh reuse without resurrecting the family", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    const responses = await Promise.all([
      f.refresh(id, tokens.refresh_token),
      f.refresh(id, tokens.refresh_token),
    ]);
    expect(responses.some((response) => response.status === 400)).toBe(true);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
    for (const response of responses) {
      if (response.status === 200) {
        const rotated = await response.json();
        await expect(
          f.server.verifyAccessToken(rotated.access_token, RESOURCE),
        ).rejects.toMatchObject({ error: "invalid_token" });
      }
    }
  });

  it("rejects wrong resources/audiences, missing PKCE and invalid scope", async () => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    expect(await (await f.exchange(id, code, { resource: "https://pod.example/" })).json()).toEqual(
      { error: "invalid_target" },
    );
    const missing = await f.form("token", {
      client_id: id,
      grant_type: "authorization_code",
      code,
      resource: RESOURCE,
      redirect_uri: REDIRECT,
    });
    expect(await missing.json()).toEqual({ error: "invalid_request" });
    const tokens = await (await f.exchange(id, code)).json();
    expect((await f.refresh("other-client", tokens.refresh_token)).status).toBe(400);
    expect((await f.refresh(id, "unknown-token")).status).toBe(400);
    expect(
      await (
        await f.refresh(id, tokens.refresh_token, { resource: "https://other.example/" })
      ).json(),
    ).toEqual({ error: "invalid_target" });
    await expect(
      f.server.verifyAccessToken(tokens.access_token, "https://other.example/"),
    ).rejects.toMatchObject({ error: "invalid_token" });
    expect(await (await f.refresh(id, tokens.refresh_token, { scope: "read" })).json()).toEqual({
      error: "invalid_scope",
    });
  });

  it("expires codes at five minutes, access at ten, and families absolutely at thirty days", async () => {
    const f = fixture();
    const id = await f.register();
    const expiredCode = await f.code(id);
    f.advance(CODE_TTL);
    expect((await f.exchange(id, expiredCode)).status).toBe(400);
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    f.advance(600);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
    f.advance(GRANT_TTL - 601);
    const last = await (await f.refresh(id, tokens.refresh_token)).json();
    expect(last.expires_in).toBe(1);
    f.advance(1);
    expect((await f.refresh(id, last.refresh_token)).status).toBe(400);
  });

  it("does not allow a different client to revoke a known token", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    expect(
      (await f.form("revoke", { client_id: "other", token: tokens.refresh_token })).status,
    ).toBe(200);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).resolves.toBeDefined();
    expect(
      (
        await f.form("revoke", {
          client_id: id,
          token: tokens.refresh_token,
          token_type_hint: "unknown",
        })
      ).status,
    ).toBe(200);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
    expect((await f.form("revoke", { client_id: id, token: "unknown" })).status).toBe(200);
  });

  it("binds existing families independently of metadata refresh failures", async () => {
    const f = fixture();
    const id = "https://client.example/id.json";
    f.metadataFetch.mockResolvedValueOnce(
      Response.json({ client_id: id, redirect_uris: [REDIRECT] }),
    );
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    f.advance(301);
    expect((await f.refresh(id, tokens.refresh_token)).status).toBe(200);
    expect(f.metadataFetch).toHaveBeenCalledTimes(1);
  });

  it("returns a generic error when the revocation store fails", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    vi.spyOn(f.stores.grants, "get").mockRejectedValueOnce(new Error("sensitive storage detail"));
    const response = await f.form("revoke", { client_id: id, token: tokens.access_token });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });

  it("rejects concurrent code exchange and never leaves usable credentials after replay", async () => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    const responses = await Promise.all([f.exchange(id, code), f.exchange(id, code)]);
    expect(responses.some((response) => response.status === 400)).toBe(true);
    for (const response of responses) {
      if (response.status === 200) {
        const tokens = await response.json();
        await expect(
          f.server.verifyAccessToken(tokens.access_token, RESOURCE),
        ).rejects.toMatchObject({ error: "invalid_token" });
        expect((await f.refresh(id, tokens.refresh_token)).status).toBe(400);
      }
    }
  });

  it("observes revocation during refresh storage writes", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    const originalPut = f.stores.refreshTokens.put.bind(f.stores.refreshTokens);
    vi.spyOn(f.stores.refreshTokens, "put").mockImplementationOnce(async (hash, record) => {
      await originalPut(hash, record);
      await f.stores.grants.revoke(record.grantId);
    });
    expect((await f.refresh(id, tokens.refresh_token)).status).toBe(400);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
  });

  it("rejects unavailable, expired or inconsistent grant records", async () => {
    const f = fixture();
    const id = await f.register();
    const tokens = await (await f.exchange(id, await f.code(id))).json();
    const grantId = (await f.stores.refreshTokens.get(digest(tokens.refresh_token)))
      ?.grantId as string;
    const grant = await f.stores.grants.get(grantId);
    if (!grant) throw new Error("Missing fixture grant");
    const get = vi.spyOn(f.stores.grants, "get");
    for (const value of [
      undefined,
      { ...grant, expiresAt: f.now() },
      { ...grant, resource: "https://other.example/" },
      { ...grant, clientId: "other" },
      { ...grant, session: { id: SESSION.id, webId: "https://other.example/#me" } },
      { ...grant, scope: "read" },
    ]) {
      get.mockResolvedValueOnce(value);
      await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject(
        { error: "invalid_token" },
      );
    }
    const code = await f.code(id);
    get.mockResolvedValueOnce(undefined);
    expect((await f.exchange(id, code)).status).toBe(400);
  });
});

describe("HTTP parser and configuration", () => {
  it.each([
    ["/token", "GET", 405],
    ["/register", "GET", 405],
    ["/authorize", "POST", 405],
    ["/callback", "POST", 405],
    ["/jwks", "POST", 405],
    ["/revoke", "GET", 405],
    ["/unknown", "GET", 404],
  ])("rejects %s %s", async (path, method, status) => {
    expect(
      (await fixture().server.handle(new Request(`${ISSUER}${path}`, { method }))).status,
    ).toBe(status);
  });

  it("rejects foreign origins and unrelated paths", async () => {
    const f = fixture();
    expect((await f.server.handle(new Request("https://evil.example/auth/token"))).status).toBe(
      404,
    );
    expect((await f.server.handle(new Request("https://mcp.example/elsewhere"))).status).toBe(404);
  });

  it("rejects missing/wrong media types, malformed JSON and oversized bodies", async () => {
    const f = fixture();
    for (const path of ["register", "token", "revoke"]) {
      const response = await f.server.handle(
        new Request(`${ISSUER}/${path}`, { method: "POST", body: "x" }),
      );
      expect(response.status).toBe(415);
    }
    const request = (body: string, headers = {}) =>
      new Request(`${ISSUER}/register`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      });
    expect(await (await f.server.handle(request("{"))).json()).toEqual({
      error: "invalid_client_metadata",
    });
    expect((await f.server.handle(request(" ".repeat(65537)))).status).toBe(413);
    expect((await f.server.handle(request("{}", { "content-length": "65537" }))).status).toBe(413);
    expect((await f.server.handle(request("null"))).status).toBe(400);
  });

  it("rejects ambiguous parameters, client authentication and unsupported grants", async () => {
    const f = fixture();
    const id = await f.register();
    const duplicate = new Request(`${f.authRequest(id).url}&state=second`);
    expect((await f.server.handle(duplicate)).status).toBe(400);
    const form = new Request(`${ISSUER}/token`, {
      method: "POST",
      body: new URLSearchParams("client_id=x&client_id=y"),
    });
    expect((await f.server.handle(form)).status).toBe(400);
    for (const path of ["token", "revoke", "register"]) {
      const response = await f.server.handle(
        new Request(`${ISSUER}/${path}`, {
          method: "POST",
          headers: { authorization: "Basic fixture-only" },
        }),
      );
      expect(response.status).toBe(401);
    }
    expect((await f.form("token", { client_id: id, client_secret: "fixture-only" })).status).toBe(
      401,
    );
    expect(await (await f.form("token", { client_id: id, grant_type: "password" })).json()).toEqual(
      { error: "unsupported_grant_type" },
    );
  });

  it("validates issuer/resource/scope configuration", () => {
    expect(() => fixture({ issuer: "http://mcp.example/" })).toThrow();
    expect(() => fixture({ issuer: `${ISSUER}?query=1` })).toThrow("queries");
    expect(() => fixture({ resource: `${RESOURCE}?query=1` })).toThrow("queries");
    expect(() => fixture({ scopes: ["invalid scope"] })).toThrow("scope tokens");
  });
});
