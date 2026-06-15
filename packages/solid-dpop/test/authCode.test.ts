/**
 * Offline unit tests for the authorization-code + PKCE + DPoP flow. No CSS, no network: every
 * test either exercises pure functions (PKCE, URL construction, the issuer guard) or injects a
 * stub transport. The live CSS exercise lives in test/live-authcode.test.ts.
 */

import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import {
  assertIssuerTransport,
  buildAuthorizationUrl,
  type ClientRegistration,
  DEFAULT_SCOPE,
  discoverProvider,
  exchangeCode,
  type FetchLike,
  generatePkce,
  isLoopbackHost,
  type OidcProviderMetadata,
  pkceChallengeS256,
  refreshSession,
  registerClient,
  startLoopbackListener,
  staticClient,
} from "../src/index.js";

const META: OidcProviderMetadata = {
  issuer: "http://localhost:3086/",
  authorization_endpoint: "http://localhost:3086/.oidc/auth",
  token_endpoint: "http://localhost:3086/.oidc/token",
  registration_endpoint: "http://localhost:3086/.oidc/reg",
};

const REDIRECT = "http://127.0.0.1:54321/callback";

// ─────────────────────────────────────────── issuer transport guard ───────────────────────────

describe("assertIssuerTransport — the reactive-auth 0.1.3 http-issuer bug class", () => {
  it("accepts any https issuer", () => {
    expect(() => assertIssuerTransport("https://solidcommunity.net/")).not.toThrow();
    expect(() => assertIssuerTransport("https://pod.example.com:8443/idp/")).not.toThrow();
  });

  it("accepts http ONLY for loopback hosts (the fix reactive-auth 0.1.3 lacks)", () => {
    expect(() => assertIssuerTransport("http://localhost:3086/")).not.toThrow();
    expect(() => assertIssuerTransport("http://127.0.0.1:3000/")).not.toThrow();
    expect(() => assertIssuerTransport("http://[::1]:3000/")).not.toThrow();
  });

  it("REJECTS http for non-loopback hosts (must not regress to allowing real-domain http)", () => {
    expect(() => assertIssuerTransport("http://idp.example.com/")).toThrow(/loopback/);
    expect(() => assertIssuerTransport("http://192.168.1.5:3000/")).toThrow(/loopback/);
  });

  it("rejects unsupported schemes", () => {
    expect(() => assertIssuerTransport("ftp://idp.example.com/")).toThrow(/scheme/);
  });

  it("isLoopbackHost classifies hosts case-insensitively", () => {
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});

// ─────────────────────────────────────────────────── PKCE (RFC 7636) ──────────────────────────

describe("PKCE S256 (RFC 7636)", () => {
  it("matches the RFC 7636 Appendix-B test vector", () => {
    // RFC 7636 Appendix B: verifier -> code_challenge (S256).
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(pkceChallengeS256(verifier)).toBe(expected);
  });

  it("generatePkce yields a verifier in the 43–128 unreserved-char range with an S256 challenge", () => {
    const { verifier, challenge, method } = generatePkce();
    expect(method).toBe("S256");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/); // base64url unreserved alphabet
    expect(challenge).toBe(pkceChallengeS256(verifier));
    expect(challenge).not.toContain("=");
  });

  it("generates distinct verifiers per call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

// ─────────────────────────────────────────── authorization URL ────────────────────────────────

describe("buildAuthorizationUrl (RFC 6749 §4.1.1 + RFC 7636 + OIDC)", () => {
  const client: ClientRegistration = { client_id: "client-xyz", redirect_uris: [REDIRECT] };
  const pkce = generatePkce();

  it("constructs response_type=code with PKCE S256, state, nonce, and the Solid-OIDC scope", () => {
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "st-1",
      nonce: "nc-1",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(META.authorization_endpoint);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-xyz");
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.get("scope")).toBe(DEFAULT_SCOPE);
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("state")).toBe("st-1");
    expect(u.searchParams.get("nonce")).toBe("nc-1");
    expect(u.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    // DEFAULT_SCOPE includes offline_access, so prompt defaults to consent (CSS refresh requirement).
    expect(u.searchParams.get("prompt")).toBe("consent");
  });

  it("sets prompt when supplied (forced consent)", () => {
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "s",
      nonce: "n",
      prompt: "consent",
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("consent");
  });

  it("honours a custom scope override", () => {
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "s",
      nonce: "n",
      scope: "openid webid",
    });
    expect(new URL(url).searchParams.get("scope")).toBe("openid webid");
  });

  it("DEFAULTS prompt=consent when offline_access is requested (CSS refresh-token requirement)", () => {
    // Default scope includes offline_access → prompt should default to consent.
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "s",
      nonce: "n",
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("consent");
  });

  it("does NOT default prompt when offline_access is absent", () => {
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "s",
      nonce: "n",
      scope: "openid webid",
    });
    expect(new URL(url).searchParams.get("prompt")).toBeNull();
  });

  it("lets an explicit prompt override the offline_access default", () => {
    const url = buildAuthorizationUrl({
      meta: META,
      client,
      redirectUri: REDIRECT,
      pkce,
      state: "s",
      nonce: "n",
      prompt: "none",
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("none");
  });
});

// ─────────────────────────────────────────── discovery + DCR ──────────────────────────────────

describe("discoverProvider", () => {
  it("guards the issuer transport before fetching (rejects real-domain http)", async () => {
    const fetchImpl: FetchLike = async () => new Response("{}");
    await expect(discoverProvider("http://idp.example.com/", fetchImpl)).rejects.toThrow(
      /loopback/,
    );
  });

  it("returns the metadata for a loopback http issuer", async () => {
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toContain(".well-known/openid-configuration");
      return new Response(JSON.stringify(META), {
        headers: { "content-type": "application/json" },
      });
    };
    const meta = await discoverProvider("http://localhost:3086/", fetchImpl);
    expect(meta.token_endpoint).toBe(META.token_endpoint);
  });

  it("throws when authorization_endpoint or token_endpoint is missing", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ issuer: "http://localhost:3086/" }));
    await expect(discoverProvider("http://localhost:3086/", fetchImpl)).rejects.toThrow(/missing/);
  });
});

describe("registerClient (DCR, RFC 7591) + staticClient", () => {
  it("registers an anonymous public native client and returns its client_id", async () => {
    let captured: { url: string; body?: string } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      captured = { url, body: init?.body as string };
      return new Response(JSON.stringify({ client_id: "dcr-123", redirect_uris: [REDIRECT] }), {
        status: 201,
      });
    };
    const reg = await registerClient(META, REDIRECT, { clientName: "my-cli" }, fetchImpl);
    expect(reg.client_id).toBe("dcr-123");
    expect(captured?.url).toBe(META.registration_endpoint);
    const sent = JSON.parse(captured?.body ?? "{}");
    expect(sent.redirect_uris).toContain(REDIRECT);
    expect(sent.token_endpoint_auth_method).toBe("none");
    expect(sent.grant_types).toContain("refresh_token");
  });

  it("throws a helpful error when the provider advertises no registration_endpoint", async () => {
    const noReg: OidcProviderMetadata = {
      issuer: META.issuer,
      authorization_endpoint: META.authorization_endpoint,
      token_endpoint: META.token_endpoint,
    };
    const fetchImpl: FetchLike = async () => new Response("{}");
    await expect(registerClient(noReg, REDIRECT, {}, fetchImpl)).rejects.toThrow(
      /staticClient|registration_endpoint/,
    );
  });

  it("staticClient builds a registration with no network call (Client Identifier Document seam)", () => {
    const reg = staticClient("https://app.example/clientid.jsonld", REDIRECT);
    expect(reg.client_id).toBe("https://app.example/clientid.jsonld");
    expect(reg.redirect_uris).toEqual([REDIRECT]);
    expect(reg.client_secret).toBeUndefined();
  });
});

// ─────────────────────────────────────────── loopback listener ───────────────────────────────

describe("startLoopbackListener (RFC 8252 loopback redirect)", () => {
  it("binds 127.0.0.1 on an ephemeral port and resolves the code/state from the redirect", async () => {
    const listener = await startLoopbackListener("/callback");
    try {
      expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const codeP = listener.waitForCode(5000);
      const res = await fetch(`${listener.redirectUri}?code=abc&state=xyz`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Login complete");
      const { code, state } = await codeP;
      expect(code).toBe("abc");
      expect(state).toBe("xyz");
    } finally {
      await listener.close();
    }
  });

  it("rejects when the redirect carries an OAuth error", async () => {
    const listener = await startLoopbackListener();
    try {
      // Attach the rejection assertion BEFORE triggering the redirect so there is no window in
      // which the rejected promise is momentarily unhandled.
      const assertion = expect(listener.waitForCode(5000)).rejects.toThrow(/access_denied/);
      await fetch(`${listener.redirectUri}?error=access_denied`);
      await assertion;
    } finally {
      await listener.close();
    }
  });
});

// ─────────────────────────────────────────── code exchange + DPoP ─────────────────────────────

function tokenJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    access_token: "at-aaa",
    token_type: "DPoP",
    expires_in: 300,
    refresh_token: "rt-111",
    ...over,
  });
}

describe("exchangeCode — DPoP-bound authorization_code grant", () => {
  it("POSTs grant_type=authorization_code with the PKCE verifier and a DPoP proof", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    let captured: { url: string; init?: Parameters<FetchLike>[1] } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      captured = { url, init };
      return new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    };
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "the-code",
      codeVerifier: "the-verifier",
      fetchImpl,
    });
    expect(session.accessToken).toBe("at-aaa");
    expect(session.refreshToken).toBe("rt-111");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(session.keyPair.thumbprint).toBeTruthy();

    expect(captured?.url).toBe(META.token_endpoint);
    const body = new URLSearchParams(captured?.init?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("client_id")).toBe("pub-1");

    const dpop = captured?.init?.headers?.["dpop"];
    expect(dpop).toBeTruthy();
    expect(decodeProtectedHeader(dpop as string).typ).toBe("dpop+jwt");
    const payload = decodeJwt(dpop as string);
    expect(payload["htm"]).toBe("POST");
    expect(payload["htu"]).toBe(META.token_endpoint);
  });

  it("retries once with the server nonce on a 400 use_dpop_nonce challenge (RFC 9449 §8)", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    let hits = 0;
    const fetchImpl: FetchLike = async () => {
      hits += 1;
      if (hits === 1)
        return new Response("{}", { status: 400, headers: { "DPoP-Nonce": "srv-n" } });
      return new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    };
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });
    expect(hits).toBe(2);
    expect(session.nonce).toBe("srv-n");
  });

  it("uses Basic auth when the client is confidential (has a secret)", async () => {
    const client: ClientRegistration = {
      client_id: "conf-1",
      client_secret: "shh",
      redirect_uris: [REDIRECT],
    };
    let auth: string | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      auth = init?.headers?.["authorization"];
      return new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    };
    await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });
    expect(auth).toMatch(/^Basic /);
  });
});

// ─────────────────────────────────────────── refresh rotation ─────────────────────────────────

describe("refreshSession — refresh-token rotation with DPoP", () => {
  it("adopts a rotated refresh token and keeps the same DPoP keypair", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    const fetchImpl: FetchLike = async () =>
      new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });
    const originalThumbprint = session.keyPair.thumbprint;

    const refreshFetch: FetchLike = async (_url, init) => {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-111");
      return new Response(tokenJson({ access_token: "at-bbb", refresh_token: "rt-222" }), {
        headers: { "content-type": "application/json" },
      });
    };
    await refreshSession(session, refreshFetch);
    expect(session.accessToken).toBe("at-bbb");
    expect(session.refreshToken).toBe("rt-222"); // rotated
    expect(session.keyPair.thumbprint).toBe(originalThumbprint); // same binding
  });

  it("keeps the old refresh token when the AS does not rotate it", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    const fetchImpl: FetchLike = async () =>
      new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });
    const noRotate: FetchLike = async () =>
      new Response(
        JSON.stringify({ access_token: "at-ccc", token_type: "DPoP", expires_in: 300 }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    await refreshSession(session, noRotate);
    expect(session.accessToken).toBe("at-ccc");
    expect(session.refreshToken).toBe("rt-111"); // unchanged
  });

  it("fires onRefresh AFTER rotation with the rotated tokens + same keypair (re-persist hook)", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    const fetchImpl: FetchLike = async () =>
      new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });
    const originalThumbprint = session.keyPair.thumbprint;

    let observed:
      | { accessToken: string; refreshToken: string | undefined; thumbprint: string }
      | undefined;
    session.onRefresh = (s) => {
      // Hook sees the ALREADY-rotated state, so a re-persist captures the new refresh token.
      observed = {
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        thumbprint: s.keyPair.thumbprint,
      };
    };

    const refreshFetch: FetchLike = async () =>
      new Response(tokenJson({ access_token: "at-bbb", refresh_token: "rt-222" }), {
        headers: { "content-type": "application/json" },
      });
    await refreshSession(session, refreshFetch);

    expect(observed).toEqual({
      accessToken: "at-bbb",
      refreshToken: "rt-222",
      thumbprint: originalThumbprint,
    });
  });

  it("awaits an async onRefresh before resolving (re-persist completes)", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    const seed: FetchLike = async () =>
      new Response(tokenJson(), { headers: { "content-type": "application/json" } });
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl: seed,
    });
    let persisted = false;
    session.onRefresh = async () => {
      await Promise.resolve();
      persisted = true;
    };
    await refreshSession(session, seed);
    expect(persisted).toBe(true);
  });

  it("throws when there is no refresh token", async () => {
    const client: ClientRegistration = { client_id: "pub-1", redirect_uris: [REDIRECT] };
    const noRt: FetchLike = async () =>
      new Response(JSON.stringify({ access_token: "at", token_type: "DPoP", expires_in: 300 }), {
        headers: { "content-type": "application/json" },
      });
    const session = await exchangeCode({
      meta: META,
      client,
      redirectUri: REDIRECT,
      code: "c",
      codeVerifier: "v",
      fetchImpl: noRt,
    });
    await expect(refreshSession(session, noRt)).rejects.toThrow(/offline_access|refresh token/);
  });
});
