// Regression test for the CROSS-USER SESSION LEAK in the auth token provider.
//
// The bug: `WebIdDPoPTokenProvider` caches the resolved issuer + the per-issuer
// session (DPoP key + access token) + the authenticated-WebID claim in memory.
// If logout only clears React state, a later login as a DIFFERENT WebID would
// reuse the previous user's session, and a login-detection probe that merely
// checks "is a token attached" would look authenticated with the STALE token.
//
// The fix has two halves, both pinned here:
//  1. `reset()` drops EVERYTHING per-identity — issuer, sessions, the
//     authenticated-WebID claim, and the running token-attach count — so nothing
//     from a prior login can be reused by the next.
//  2. the provider records the WebID the OP actually authenticated AS (the
//     id_token `webid`/`sub` claim), exposed via `authenticatedWebId()`, and
//     `webIdsEqual` is the strict comparison the login flow uses to confirm the
//     authenticated identity matches the requested one — never inferring "logged
//     in" purely from a token being attached.
//
// The full OAuth/DPoP/profile-fetch stack is mocked so this runs with no browser
// and no network: we control exactly which WebID each authentication "returns".
import { beforeEach, describe, expect, it, vi } from "vitest";

// A module-level switch lets each test decide which WebID the next id_token
// authenticates AS, so we can simulate user A then a DIFFERENT user B.
const authState = { webId: "https://alice.example/profile/card#me", accessToken: "tok-A" };

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));

vi.mock("@/lib/solid/login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => ["https://issuer.example/"],
}));

vi.mock("dpop", () => ({
  generateProof: vi.fn(async () => "dpop-proof"),
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  return {
    allowInsecureRequests,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    expectNoNonce: Symbol("expectNoNonce"),
    nopkce: Symbol("nopkce"),
    DPoP: () => ({}),
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: "https://issuer.example/",
      authorization_endpoint: "https://issuer.example/auth",
      token_endpoint: "https://issuer.example/token",
      code_challenge_methods_supported: ["S256"],
    })),
    dynamicClientRegistrationRequest: vi.fn(async () => ({})),
    processDynamicClientRegistrationResponse: vi.fn(async () => ({
      client_id: "dynamic-client",
      redirect_uris: ["https://app.example/callback.html"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })),
    generateKeyPair: vi.fn(async () => ({ publicKey: {}, privateKey: {} })),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code" })),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => ({
      access_token: authState.accessToken,
    })),
    getValidatedIdTokenClaims: vi.fn(() => ({
      iss: "https://issuer.example/",
      sub: authState.webId,
      webid: authState.webId,
      aud: "client",
      iat: 0,
      exp: 0,
    })),
    AuthorizationResponseError: class extends Error {},
  };
});

const { WebIdDPoPTokenProvider, webIdsEqual } = await import("@/lib/solid/webid-token-provider");

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";

/** Build a provider whose getWebId returns the WebID currently in `authState`. */
function makeProvider() {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "https://app.example/callback.html?code=auth-code&state=state",
    async () => authState.webId,
  );
}

describe("webIdsEqual", () => {
  it("treats identical WebIDs as equal", () => {
    expect(webIdsEqual(WEBID_A, WEBID_A)).toBe(true);
  });

  it("is case-insensitive on scheme + host only, strict on path/fragment", () => {
    expect(
      webIdsEqual(
        "https://Alice.Example/profile/card#me",
        "https://alice.example/profile/card#me",
      ),
    ).toBe(true);
    expect(
      webIdsEqual(
        "https://alice.example/profile/card#me",
        "https://alice.example/profile/card#you",
      ),
    ).toBe(false);
    expect(webIdsEqual(WEBID_A, "https://alice.example/other/card#me")).toBe(false);
  });

  it("fails closed for a missing or unparseable WebID", () => {
    expect(webIdsEqual(undefined, WEBID_A)).toBe(false);
    expect(webIdsEqual(WEBID_A, undefined)).toBe(false);
    expect(webIdsEqual("not a url", WEBID_A)).toBe(false);
  });

  it("never equates two DIFFERENT users' WebIDs", () => {
    expect(webIdsEqual(WEBID_A, WEBID_B)).toBe(false);
  });
});

describe("WebIdDPoPTokenProvider — no prior identity survives reset / re-login", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("records the WebID + token the session authenticated AS, and counts the attach", async () => {
    const provider = makeProvider();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);

    const req = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.tokensAttachedCount()).toBe(1);
    expect(req.headers.get("Authorization")).toBe("DPoP tok-A");
  });

  it("reset() drops the cached issuer, session, authenticated WebID and attach count", async () => {
    const provider = makeProvider();
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.tokensAttachedCount()).toBe(1);

    provider.reset();

    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("after logout (reset) a login as WebID-B never surfaces WebID-A's session or token", async () => {
    const provider = makeProvider();

    // User A logs in.
    const reqA = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(reqA.headers.get("Authorization")).toBe("DPoP tok-A");

    // Logout: the provider is reset.
    provider.reset();

    // A DIFFERENT user, B, logs in on the same provider instance.
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    const reqB = await provider.upgrade(new Request("https://bob.example/storage/"));

    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(provider.authenticatedWebId()).not.toBe(WEBID_A);
    expect(reqB.headers.get("Authorization")).toBe("DPoP tok-B");
    expect(webIdsEqual(provider.authenticatedWebId(), WEBID_B)).toBe(true);
    expect(webIdsEqual(provider.authenticatedWebId(), WEBID_A)).toBe(false);
  });

  it("WITHOUT reset, a stale issuer cache would pin the first identity (proves reset is load-bearing)", async () => {
    const provider = makeProvider();
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // Switch the would-be user to B but DO NOT reset: the memoised issuer +
    // cached session are still A's, so the provider keeps reporting A — the leak
    // reset() prevents.
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    const reqStale = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(reqStale.headers.get("Authorization")).toBe("DPoP tok-A");
  });
});
