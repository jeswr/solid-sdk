// AUTHORED-BY Codex GPT-6.1-Sol
import { exportDpopKeyPairJwk, generateDpopKeyPair } from "@jeswr/solid-dpop";
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FetchLike,
  refreshSolidSession,
  type SolidJwtState,
  SolidSessionRefreshError,
  type SolidSessionRefreshErrorCode,
} from "../src/index.js";

const ISSUER = "https://op.example/tenant";
const TOKEN_ENDPOINT = "https://tokens.example/refresh?aud=pod";
const CLIENT_ID = "https://app.example/client-id";
const NOW = 1_700_000_000;
let session: SolidJwtState;

beforeAll(async () => {
  session = Object.freeze({
    accessToken: "old-access-fixture",
    refreshToken: "old-refresh-fixture",
    expiresAt: NOW,
    issuer: ISSUER,
    webid: "https://alice.example/#me",
    idToken: "verified-id-fixture",
    dpopKeyJwk: await exportDpopKeyPairJwk(await generateDpopKeyPair()),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function tokens(extra: Record<string, unknown> = {}) {
  return {
    access_token: "new-access-fixture",
    token_type: "DPoP",
    expires_in: 600,
    ...extra,
  };
}

function mockEndpoint(
  reply: (init: RequestInit) => Response | Promise<Response> = () => json(tokens()),
  metadata: unknown = { issuer: ISSUER, token_endpoint: TOKEN_ENDPOINT },
) {
  const tokenCalls: RequestInit[] = [];
  const fetch = vi.fn<FetchLike>(async (input, init) => {
    const url = input.toString();
    if (init?.method === "GET") {
      return json(metadata);
    }
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init?.method).toBe("POST");
    tokenCalls.push(init as RequestInit);
    return reply(init as RequestInit);
  });
  return { fetch, tokenCalls };
}

async function expectCode(promise: Promise<unknown>, code: SolidSessionRefreshErrorCode) {
  await expect(promise).rejects.toMatchObject({ name: "SolidSessionRefreshError", code });
  await expect(promise).rejects.toBeInstanceOf(SolidSessionRefreshError);
}

describe("refreshSolidSession", () => {
  it("discovers the issuer, rotates tokens, and returns new state without changing identity or key", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000 + 999);
    const op = mockEndpoint(() =>
      json(tokens({ refresh_token: "rotated-refresh-fixture", id_token: "unverified-id-fixture" })),
    );
    const result = await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(result).toEqual({
      ...session,
      accessToken: "new-access-fixture",
      refreshToken: "rotated-refresh-fixture",
      expiresAt: NOW + 600,
    });
    expect(result).not.toBe(session);
    expect(result.dpopKeyJwk).toBe(session.dpopKeyJwk);
    expect(session.accessToken).toBe("old-access-fixture");
    expect(session.refreshToken).toBe("old-refresh-fixture");
    expect(op.fetch.mock.calls[0]?.[0]).toBe(`${ISSUER}/.well-known/openid-configuration`);
    const discovery = op.fetch.mock.calls[0]?.[1];
    expect(discovery?.redirect).toBe("manual");
    expect(new Headers(discovery?.headers).has("dpop")).toBe(false);
    expect(new Headers(discovery?.headers).has("authorization")).toBe(false);
    expect(discovery?.body).toBeUndefined();
    expect(op.tokenCalls).toHaveLength(1);
    const request = op.tokenCalls[0];
    expect(request?.redirect).toBe("manual");
    expect(request?.credentials).toBe("omit");
    expect(new URLSearchParams(String(request?.body))).toEqual(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "old-refresh-fixture",
        client_id: CLIENT_ID,
      }),
    );
    expect(new Headers(request?.headers).has("authorization")).toBe(false);
  });

  it("keeps the old refresh token when none is returned and accepts case-insensitive DPoP", async () => {
    const op = mockEndpoint(() => json(tokens({ token_type: "dPoP" })));
    const result = await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(result.refreshToken).toBe(session.refreshToken);
  });

  it.each([
    [NOW, "rotated-refresh-fixture"],
    [NOW, undefined],
    [undefined, "rotated-refresh-fixture"],
    [undefined, undefined],
  ])("accepts omitted lifetime with previous expiry %s and rotation %s", async (expiry, rotation) => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = session;
    const state = Object.freeze({
      ...withoutExpiry,
      ...(expiry === undefined ? {} : { expiresAt: expiry }),
    });
    const op = mockEndpoint(() => json(tokens({ expires_in: undefined, refresh_token: rotation })));
    const result = await refreshSolidSession(state, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(result).toEqual({
      ...withoutExpiry,
      accessToken: "new-access-fixture",
      refreshToken: rotation ?? state.refreshToken,
    });
    expect(result).not.toHaveProperty("expiresAt");
    expect(result).not.toBe(state);
    expect(result.dpopKeyJwk).toBe(state.dpopKeyJwk);
    expect(state.expiresAt).toBe(expiry);
    expect(state.refreshToken).toBe(session.refreshToken);
    expect(op.tokenCalls).toHaveLength(1);
  });

  it("verifies the proof signature against the persisted key, without ath or private key disclosure", async () => {
    const op = mockEndpoint();
    // Round-trip the session as Auth.js persistence would, without a live provider instance.
    const restored: SolidJwtState = JSON.parse(JSON.stringify(session));
    await refreshSolidSession(restored, { clientId: CLIENT_ID, fetch: op.fetch });
    const proof = new Headers(op.tokenCalls[0]?.headers).get("dpop") as string;
    const header = decodeProtectedHeader(proof);
    expect(header).toMatchObject({ alg: "ES256", typ: "dpop+jwt" });
    expect(header.jwk).not.toHaveProperty("d");
    expect(await calculateJwkThumbprint(header.jwk as never)).toBe(
      await calculateJwkThumbprint(session.dpopKeyJwk),
    );
    const { d: _d, ...publicJwk } = session.dpopKeyJwk;
    const { payload } = await jwtVerify(proof, await importJWK(publicJwk, "ES256"), {
      algorithms: ["ES256"],
      typ: "dpop+jwt",
    });
    expect(payload).toMatchObject({ htm: "POST", htu: "https://tokens.example/refresh" });
    expect(payload.ath).toBeUndefined();
    expect(payload.nonce).toBeUndefined();
    expect(typeof payload.jti).toBe("string");
  });

  it("retries once with the server nonce, the same key/body/auth and a fresh proof", async () => {
    const op = mockEndpoint(() =>
      op.tokenCalls.length === 1
        ? json({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "server-nonce-fixture" })
        : json(tokens()),
    );
    await refreshSolidSession(session, {
      clientId: CLIENT_ID,
      clientSecret: "secret-fixture",
      fetch: op.fetch,
    });
    expect(op.tokenCalls).toHaveLength(2);
    const proofs = op.tokenCalls.map((call) => new Headers(call.headers).get("dpop") as string);
    expect(decodeJwt(proofs[0] as string).nonce).toBeUndefined();
    expect(decodeJwt(proofs[1] as string).nonce).toBe("server-nonce-fixture");
    expect(decodeJwt(proofs[0] as string).jti).not.toBe(decodeJwt(proofs[1] as string).jti);
    for (const proof of proofs) {
      expect(decodeJwt(proof).ath).toBeUndefined();
      expect(await calculateJwkThumbprint(decodeProtectedHeader(proof).jwk as never)).toBe(
        await calculateJwkThumbprint(session.dpopKeyJwk),
      );
    }
    expect(op.tokenCalls[0]?.body).toBe(op.tokenCalls[1]?.body);
    expect(new Headers(op.tokenCalls[0]?.headers).get("authorization")).toBe(
      new Headers(op.tokenCalls[1]?.headers).get("authorization"),
    );
  });

  it("fails on a second nonce error without making a third request", async () => {
    const op = mockEndpoint(() =>
      json({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "persistent-nonce-fixture" }),
    );
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "use_dpop_nonce",
    );
    expect(op.tokenCalls).toHaveLength(2);
  });

  it("accepts a 401 nonce challenge and does not retry a success with a nonce header", async () => {
    const op = mockEndpoint(() =>
      op.tokenCalls.length === 1
        ? json({ error: "use_dpop_nonce" }, 401, { "dpop-nonce": "nonce-fixture" })
        : json(tokens(), 200, { "dpop-nonce": "next-nonce-fixture" }),
    );
    await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(op.tokenCalls).toHaveLength(2);
  });

  it("does not retry a 5xx even if it reports use_dpop_nonce with a nonce header", async () => {
    const op = mockEndpoint(() =>
      json({ error: "use_dpop_nonce" }, 500, { "dpop-nonce": "nonce-fixture" }),
    );
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "use_dpop_nonce",
    );
    expect(op.tokenCalls).toHaveLength(1);
  });

  it.each([
    400, 401,
  ])("does not retry a nonce error without a nonce header (%s)", async (status) => {
    const op = mockEndpoint(() => json({ error: "use_dpop_nonce" }, status));
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "use_dpop_nonce",
    );
    expect(op.tokenCalls).toHaveLength(1);
  });

  it("does not replay invalid_grant even when the server includes a nonce header", async () => {
    const op = mockEndpoint(() =>
      json({ error: "invalid_grant" }, 400, { "dpop-nonce": "irrelevant-nonce-fixture" }),
    );
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_grant",
    );
    expect(op.tokenCalls).toHaveLength(1);
  });

  it("encodes confidential client credentials for Basic auth as the provider does", async () => {
    const op = mockEndpoint();
    await refreshSolidSession(session, {
      clientId: "client :+é",
      clientSecret: "secret :+é",
      fetch: op.fetch,
    });
    const headers = new Headers(op.tokenCalls[0]?.headers);
    const decoded = Buffer.from(
      (headers.get("authorization") as string).slice(6),
      "base64",
    ).toString();
    expect(decoded).toBe("client+%3A%2B%C3%A9:secret+%3A%2B%C3%A9");
    expect(new URLSearchParams(String(op.tokenCalls[0]?.body)).has("client_secret")).toBe(false);
  });

  it("uses only the injected pristine fetch after a global patch", async () => {
    const op = mockEndpoint();
    const patched = vi.fn(() => {
      throw new Error("patched fetch re-entered");
    });
    vi.stubGlobal("fetch", patched);
    await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(op.fetch).toHaveBeenCalledTimes(2);
    expect(patched).not.toHaveBeenCalled();
  });

  it.each([
    ["missing type", { token_type: undefined }],
    ["Bearer downgrade", { token_type: "Bearer" }],
    ["non-string type", { token_type: 3 }],
    ["missing access token", { access_token: undefined }],
    ["empty access token", { access_token: "" }],
    ["non-string access token", { access_token: {} }],
    ["string expiry", { expires_in: "600" }],
    ["negative expiry", { expires_in: -1 }],
    ["fractional expiry", { expires_in: 0.5 }],
    ["unsafe expiry", { expires_in: Number.MAX_SAFE_INTEGER }],
    ["null expiry", { expires_in: null }],
    ["empty rotated refresh token", { refresh_token: "" }],
    ["null rotated refresh token", { refresh_token: null }],
    ["non-string rotated refresh token", { refresh_token: 7 }],
    ["error in success response", { error: "invalid_grant" }],
  ])("rejects %s without changing the session", async (_label, extra) => {
    const op = mockEndpoint(() => json(tokens(extra)));
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_response",
    );
    expect(op.tokenCalls).toHaveLength(1);
    expect(session.accessToken).toBe("old-access-fixture");
  });

  it("accepts a zero lifetime as already expired", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    const op = mockEndpoint(() => json(tokens({ expires_in: 0 })));
    expect(
      (await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch })).expiresAt,
    ).toBe(NOW);
  });

  it("counts lifetime from the request start so response latency cannot extend token validity", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    const op = mockEndpoint(() => {
      now.mockReturnValue((NOW + 90) * 1000);
      return json(tokens());
    });
    const result = await refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    expect(result.expiresAt).toBe(NOW + 600);
  });

  it.each([
    () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    () => json(null),
    () => json([]),
    () => json("not an object"),
    () => json(tokens(), 201),
    () => new Response(JSON.stringify(tokens()), { headers: { "content-type": "text/plain" } }),
    () => json({}, 500),
    () => json({ error: 123 }, 400),
    () => json(null, 400, { "dpop-nonce": "nonce-fixture" }),
    () => json("not an object", 400, { "dpop-nonce": "nonce-fixture" }),
    () => json([], 400, { "dpop-nonce": "nonce-fixture" }),
    () => new Response("", { status: 400, headers: { "dpop-nonce": "nonce-fixture" } }),
    () => new Response("not-json", { status: 400, headers: { "dpop-nonce": "nonce-fixture" } }),
    () =>
      new Response('{"access_token":"fixture","token_type":"DPoP","expires_in":1e999}', {
        headers: { "content-type": "application/json" },
      }),
  ])("rejects malformed or unsuccessful token responses (%#)", async (reply) => {
    const op = mockEndpoint(reply);
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_response",
    );
    expect(op.tokenCalls).toHaveLength(1);
  });

  it.each([
    "invalid_grant",
    "invalid_client",
    "invalid_request",
    "invalid_scope",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_dpop_proof",
    "server_error",
    "temporarily_unavailable",
  ] as const)("exposes the safe standard OAuth error code %s", async (code) => {
    const op = mockEndpoint(() => json({ error: code }, 400));
    await expectCode(refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }), code);
  });

  it("does not expose arbitrary server errors, descriptions, tokens or upstream exceptions", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const op = mockEndpoint(() =>
      json({ error: session.refreshToken, error_description: session.dpopKeyJwk.d }, 400),
    );
    const failed = refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch });
    await expectCode(failed, "oauth_error");
    const caught = await failed.catch((err: unknown) => err as SolidSessionRefreshError);
    expect(String(caught)).not.toContain(session.refreshToken);
    expect(String(caught)).not.toContain(session.dpopKeyJwk.d);
    expect(caught).not.toHaveProperty("cause");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    "discovery",
    "token",
    "retry",
  ])("wraps %s fetch failures without leaking credentials", async (leg) => {
    const op = mockEndpoint();
    const fetch: FetchLike = async (input, init) => {
      if (leg === "discovery" || (leg === "token" && init?.method === "POST")) {
        throw new Error(`upstream leaked ${session.refreshToken}`);
      }
      if (leg === "retry" && init?.method === "POST") {
        if (new Headers(init.headers).get("dpop") && op.tokenCalls.length === 0) {
          op.tokenCalls.push(init);
          return json({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "nonce-fixture" });
        }
        throw new Error(`upstream leaked ${session.refreshToken}`);
      }
      return op.fetch(input, init);
    };
    const failed = refreshSolidSession(session, { clientId: CLIENT_ID, fetch });
    await expectCode(failed, "network");
    expect(String(await failed.catch((err: unknown) => err))).not.toContain(session.refreshToken);
  });
});

describe("refreshSolidSession input and discovery boundaries", () => {
  it.each([
    null,
    { refreshToken: undefined },
    { refreshToken: "" },
    { issuer: undefined },
    { issuer: "" },
    { issuer: "not-a-url" },
    { issuer: "http://op.example" },
    { issuer: "https://user:password@op.example" },
    { issuer: "https://op.example?query=1" },
    { issuer: "https://op.example#fragment" },
    { dpopKeyJwk: undefined },
    { dpopKeyJwk: {} },
    { dpopKeyJwk: { kty: "oct", k: "secret-fixture", d: "invalid" } },
    { dpopKeyJwk: { kty: "EC", crv: "P-256", d: "invalid" } },
  ])("rejects unusable persisted state before any HTTP (%#)", async (patch) => {
    const op = mockEndpoint();
    const state = patch === null ? null : { ...session, ...patch };
    await expectCode(
      refreshSolidSession(state as never, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_session",
    );
    expect(op.fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { fetch: undefined },
    { clientId: "" },
    { clientId: undefined },
    { clientSecret: "" },
    { clientSecret: null },
  ])("rejects invalid options without falling back to global fetch (%#)", async (patch) => {
    const op = mockEndpoint();
    const options = patch === null ? null : { clientId: CLIENT_ID, fetch: op.fetch, ...patch };
    await expectCode(refreshSolidSession(session, options as never), "invalid_options");
    expect(op.fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { issuer: "https://other.example", token_endpoint: TOKEN_ENDPOINT },
    { issuer: "not-a-url", token_endpoint: TOKEN_ENDPOINT },
    { issuer: ISSUER },
    { issuer: ISSUER, token_endpoint: 123 },
    { issuer: ISSUER, token_endpoint: "http://tokens.example/refresh" },
    { issuer: ISSUER, token_endpoint: "https://user:password@tokens.example/refresh" },
    { issuer: ISSUER, token_endpoint: "https://tokens.example/refresh#fragment" },
    { issuer: ISSUER, token_endpoint: "not-a-url" },
  ])("rejects untrusted discovery before sending the refresh credential (%#)", async (metadata) => {
    const op = mockEndpoint(undefined, metadata);
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_response",
    );
    expect(op.fetch).toHaveBeenCalledTimes(1);
    expect(op.tokenCalls).toHaveLength(0);
  });

  it.each([
    ["https://op.example", "https://op.example/"],
    ["https://op.example/", "https://op.example"],
    [ISSUER, "https://OP.example/tenant"],
    ["https://OP.example/tenant", ISSUER],
    [ISSUER, "https://op.example:443/tenant"],
    ["https://op.example:443/tenant", ISSUER],
    [ISSUER, "https://op.example/other/../tenant"],
    ["https://op.example/other/../tenant", ISSUER],
  ])("rejects normalized-equivalent issuer %s versus %s before token HTTP", async (issuer, discovered) => {
    const op = mockEndpoint(undefined, { issuer: discovered, token_endpoint: TOKEN_ENDPOINT });
    await expectCode(
      refreshSolidSession({ ...session, issuer }, { clientId: CLIENT_ID, fetch: op.fetch }),
      "invalid_response",
    );
    expect(op.fetch).toHaveBeenCalledTimes(1);
    expect(op.tokenCalls).toHaveLength(0);
  });

  it.each([
    ["https://op.example", "https://op.example/.well-known/openid-configuration"],
    ["https://op.example/", "https://op.example/.well-known/openid-configuration"],
    ["https://OP.example/tenant", `${ISSUER}/.well-known/openid-configuration`],
    ["https://op.example:443/tenant", `${ISSUER}/.well-known/openid-configuration`],
    [`${ISSUER}/`, `${ISSUER}/.well-known/openid-configuration`],
  ])("accepts an exactly matching issuer identifier %s", async (issuer, discoveryUrl) => {
    const op = mockEndpoint(undefined, { issuer, token_endpoint: TOKEN_ENDPOINT });
    const result = await refreshSolidSession(
      { ...session, issuer },
      { clientId: CLIENT_ID, fetch: op.fetch },
    );
    expect(result.issuer).toBe(issuer);
    expect(result.accessToken).toBe("new-access-fixture");
    expect(op.fetch.mock.calls[0]?.[0]).toBe(discoveryUrl);
    expect(op.tokenCalls).toHaveLength(1);
  });

  it.each([
    () => json({}, 503),
    () => new Response("bad-json", { headers: { "content-type": "application/json" } }),
    () => new Response(null, { status: 302, headers: { location: "https://other.example" } }),
  ])("rejects discovery failures without following redirects (%#)", async (reply) => {
    const fetch = vi.fn<FetchLike>(async () => reply());
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch }),
      "invalid_response",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("refuses a token redirect (%s) without resending the credential", async (status) => {
    const op = mockEndpoint(
      () => new Response(null, { status, headers: { location: "https://attacker.example" } }),
    );
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch }),
      "network",
    );
    expect(op.tokenCalls).toHaveLength(1);
  });

  it("allows loopback HTTP only with the explicit development opt-in", async () => {
    const issuer = "http://localhost:3000/";
    const endpoint = "http://127.0.0.1:3000/token";
    const fetch = vi.fn<FetchLike>(async (_input, init) =>
      init?.method === "GET" ? json({ issuer, token_endpoint: endpoint }) : json(tokens()),
    );
    const state = { ...session, issuer };
    await expectCode(refreshSolidSession(state, { clientId: CLIENT_ID, fetch }), "invalid_session");
    expect(fetch).not.toHaveBeenCalled();
    await refreshSolidSession(state, { clientId: CLIENT_ID, fetch, allowInsecure: true });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${issuer}.well-known/openid-configuration`);
    expect(fetch.mock.calls[1]?.[0]).toBe(endpoint);
  });

  it("does not allow remote HTTP endpoints even with the loopback opt-in", async () => {
    const op = mockEndpoint(undefined, {
      issuer: ISSUER,
      token_endpoint: "http://remote.example/token",
    });
    await expectCode(
      refreshSolidSession(session, { clientId: CLIENT_ID, fetch: op.fetch, allowInsecure: true }),
      "invalid_response",
    );
    expect(op.tokenCalls).toHaveLength(0);
  });

  it("does not allow remote HTTP issuers even with the loopback opt-in", async () => {
    const op = mockEndpoint();
    await expectCode(
      refreshSolidSession(
        { ...session, issuer: "http://remote.example" },
        { clientId: CLIENT_ID, fetch: op.fetch, allowInsecure: true },
      ),
      "invalid_session",
    );
    expect(op.fetch).not.toHaveBeenCalled();
  });

  it("rejects a public-only persisted key before HTTP instead of generating a replacement", async () => {
    const op = mockEndpoint();
    const { d: _d, ...publicJwk } = session.dpopKeyJwk;
    await expectCode(
      refreshSolidSession(
        { ...session, dpopKeyJwk: publicJwk },
        { clientId: CLIENT_ID, fetch: op.fetch },
      ),
      "invalid_session",
    );
    expect(op.fetch).not.toHaveBeenCalled();
  });
});
