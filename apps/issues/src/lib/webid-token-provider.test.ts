// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial unit tests for the full-page-redirect (autologin) login path in
// WebIdDPoPTokenProvider — the security-critical invariants:
//   (a) ENFORCE the requested WebID: completeRedirectLogin fail-closed THROWS,
//       before ANY session/issuer state is written, when the OP authenticated a
//       DIFFERENT WebID than the persisted target (and when the id_token has no
//       usable webid claim at all).
//   (b) seed BOTH the per-issuer session AND #issuer before publishing, so later
//       upgrades reuse it (only on the success path).
//   (c) beginRedirectLogin builds an authorization URL with prompt=none and the
//       app-root redirect_uri (not callback.html).
//
// oauth4webapi is fully mocked so the test is hermetic (no network, no real IdP)
// and can drive the id_token's `webid` claim. The DPoP key is exercised through
// real WebCrypto (Node 20+ `crypto.subtle`) so the JWK export/import round-trips.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mock state the oauth4webapi mock + tests share ───────────────────
const h = vi.hoisted(() => ({
  // The `webid` claim the mocked token exchange returns (the OP-vouched identity).
  idTokenWebId: undefined as string | undefined,
  // Capture of the last authorization URL beginRedirectLogin built (asserted in (c)).
  lastAuthEndpoint: "https://issuer.example/authorize",
}));

const h2 = vi.hoisted(() => ({
  // The client registration the (mocked) dynamic client registration returns. Tests
  // flip this to a CONFIDENTIAL client to prove the auth method + secret round-trip
  // across the full-page redirect (the Medium fix).
  dynamicClientRegistration: { client_id: "dyn-client" } as Record<string, unknown>,
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  const customFetch = Symbol("customFetch");
  const expectNoNonce = Symbol("expectNoNonce");
  const nopkce = Symbol("nopkce");
  return {
    allowInsecureRequests,
    customFetch,
    expectNoNonce,
    nopkce,
    // Discovery → a minimal authorization server advertising S256 PKCE.
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async (issuer: URL) => ({
      issuer: issuer.href,
      authorization_endpoint: h.lastAuthEndpoint,
      token_endpoint: "https://issuer.example/token",
      code_challenge_methods_supported: ["S256"],
    })),
    // PKCE / DPoP / random material — deterministic stand-ins.
    generateRandomCodeVerifier: vi.fn(() => "verifier-xyz"),
    generateRandomNonce: vi.fn(() => "nonce-xyz"),
    generateRandomState: vi.fn(() => "state-xyz"),
    calculatePKCECodeChallenge: vi.fn(async () => "challenge-xyz"),
    generateKeyPair: vi.fn(async (_alg: string, opts?: { extractable?: boolean }) =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, opts?.extractable ?? false, [
        "sign",
        "verify",
      ]),
    ),
    DPoP: vi.fn(() => ({})),
    None: vi.fn(() => () => {}),
    ClientSecretBasic: vi.fn(() => () => {}),
    // Token exchange — returns an access token; the id_token claims carry the webid.
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code", state: "state-xyz" })),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => ({ access_token: "at-123" })),
    getValidatedIdTokenClaims: vi.fn(() => ({ webid: h.idTokenWebId, sub: h.idTokenWebId })),
    // Unused by the redirect path but referenced by the module — harmless stubs.
    refreshTokenGrantRequest: vi.fn(async () => ({})),
    processRefreshTokenResponse: vi.fn(async () => ({ access_token: "at-refresh" })),
    dynamicClientRegistrationRequest: vi.fn(async () => ({})),
    processDynamicClientRegistrationResponse: vi.fn(() => h2.dynamicClientRegistration),
    AuthorizationResponseError: class extends Error {},
  };
});

// fetchRdf is the WebID-profile read inside #resolveIssuer — return an issuer so
// beginRedirectLogin can proceed without a network call.
vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: {} })),
}));

// resolveIssuers reads the (mocked) dataset; stub it to a single issuer.
vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => new URL(s.trim()).toString(),
  resolveIssuers: () => ["https://issuer.example"],
}));

import * as oauth from "oauth4webapi";
import { webIdsEqual, WebIdDPoPTokenProvider } from "./webid-token-provider";

const ALICE = "https://alice.example/profile/card#me";
const MALLORY = "https://mallory.example/profile/card#me";

// ── A fake sessionStorage backed by a Map (the redirect flow persists here) ──
function installSessionStorage(): Map<string, string> {
  const m = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
  vi.stubGlobal("sessionStorage", fake);
  return m;
}

function newProvider(): WebIdDPoPTokenProvider {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "unused",
    async () => ALICE,
    { clientId: "https://app.example/clientid.jsonld" },
  );
}

/**
 * Persist a redirect-flow record under the requested WebID, by running
 * beginRedirectLogin (which exports a real DPoP key + writes sessionStorage), then
 * point the mocked id_token at `opAuthenticatedWebId`. Returns the provider.
 */
async function beginThenSetOpClaim(
  store: Map<string, string>,
  requestedWebId: string,
  opAuthenticatedWebId: string | undefined,
): Promise<{ provider: WebIdDPoPTokenProvider; onSession: ReturnType<typeof vi.fn> }> {
  const onSession = vi.fn();
  const provider = new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "unused",
    async () => requestedWebId,
    { clientId: "https://app.example/clientid.jsonld", onSession },
  );
  await provider.beginRedirectLogin("https://app.example/");
  expect(store.has("solid-issues.autologin.flow")).toBe(true);
  h.idTokenWebId = opAuthenticatedWebId;
  return { provider, onSession };
}

describe("webIdsEqual", () => {
  it("is true for identical WebIDs and case-different scheme/host (normalisation)", () => {
    expect(webIdsEqual(ALICE, ALICE)).toBe(true);
    expect(webIdsEqual(ALICE, "https://ALICE.example/profile/card#me")).toBe(true);
    expect(webIdsEqual("HTTPS://alice.example/profile/card#me", ALICE)).toBe(true);
  });
  it("is false for a different path / fragment / host", () => {
    expect(webIdsEqual(ALICE, "https://alice.example/profile/card#you")).toBe(false);
    expect(webIdsEqual(ALICE, "https://alice.example/other#me")).toBe(false);
    expect(webIdsEqual(ALICE, MALLORY)).toBe(false);
  });
  it("FAILS CLOSED when either side is missing or unparseable", () => {
    expect(webIdsEqual(undefined, ALICE)).toBe(false);
    expect(webIdsEqual(ALICE, undefined)).toBe(false);
    expect(webIdsEqual("", ALICE)).toBe(false);
    expect(webIdsEqual("not a url", ALICE)).toBe(false);
  });
});

describe("beginRedirectLogin (invariant c)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installSessionStorage();
    h.idTokenWebId = ALICE;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("builds an authorization URL with prompt=none and the app-root redirect_uri", async () => {
    const provider = newProvider();
    const { authorizationUrl } = await provider.beginRedirectLogin("https://app.example/");
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid webid offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The persisted record reuses the SAME app-root redirect_uri byte-for-byte.
    const flow = JSON.parse(store.get("solid-issues.autologin.flow")!);
    expect(flow.redirectUri).toBe("https://app.example/");
    expect(flow.webId).toBe(ALICE);
  });
});

describe("completeRedirectLogin — WebID enforcement (invariant a) + seeding (invariant b)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installSessionStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ESTABLISHES the session + emits it (invariant b) when the OP authenticated AS the requested WebID", async () => {
    const { provider, onSession } = await beginThenSetOpClaim(store, ALICE, ALICE);
    const result = await provider.completeRedirectLogin(
      "https://app.example/?code=auth-code&state=state-xyz",
    );
    expect(result.webId).toBe(ALICE);
    // (b) the authenticated identity is published…
    expect(provider.authenticatedWebId()).toBe(ALICE);
    // (b) …and the restorable session is emitted (seeded for persistence + reuse).
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession.mock.calls[0][0]).toMatchObject({ issuer: "https://issuer.example/" });
    // …and the persisted record is cleared (single-use code/verifier/key).
    expect(store.has("solid-issues.autologin.flow")).toBe(false);
  });

  it("FAILS CLOSED (throws) and writes NO state when the OP authenticated a DIFFERENT WebID", async () => {
    // The deep-link requested ALICE, but the OP's live session is MALLORY's.
    const { provider, onSession } = await beginThenSetOpClaim(store, ALICE, MALLORY);
    await expect(
      provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz"),
    ).rejects.toThrow(/different WebID/i);
    // (a) NO identity published, NO session emitted — reset-clean, not half-established.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(onSession).not.toHaveBeenCalled();
    // The persisted record is still cleared (finally) so the single-use code can't replay.
    expect(store.has("solid-issues.autologin.flow")).toBe(false);
  });

  it("FAILS CLOSED when the id_token carries NO usable webid/sub claim", async () => {
    const { provider, onSession } = await beginThenSetOpClaim(store, ALICE, undefined);
    await expect(
      provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz"),
    ).rejects.toThrow(/different WebID/i);
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(onSession).not.toHaveBeenCalled();
  });

  it("throws (no replay) when there is no persisted record to complete", async () => {
    const provider = newProvider();
    await expect(
      provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz"),
    ).rejects.toThrow(/no pending redirect login/i);
  });
});

// ── Medium fix: the persisted client registration round-trips across the redirect ─
//
// completeRedirectLogin must reconstruct the SAME client the authorization request
// used — from the PERSISTED registration, not a hardcoded `token_endpoint_auth_method:
// "none"`. Otherwise a dynamic-registration confidential client (an auth method other
// than `none`, and/or a client_secret) is lost across the full-page redirect and the
// token exchange FAILS. The static public-client (`clientid.jsonld`) path is `none`
// with no secret and must stay byte-identical.
describe("completeRedirectLogin — persisted client-registration round-trip (Medium fix)", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installSessionStorage();
    h.idTokenWebId = ALICE;
    h2.dynamicClientRegistration = { client_id: "dyn-client" };
    vi.mocked(oauth.authorizationCodeGrantRequest).mockClear();
    vi.mocked(oauth.ClientSecretBasic).mockClear();
    vi.mocked(oauth.None).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("PUBLIC client (static clientid.jsonld): persists + reconstructs `none`, no secret", async () => {
    const provider = newProvider(); // has clientId → static public client, auth `none`
    await provider.beginRedirectLogin("https://app.example/");

    const flow = JSON.parse(store.get("solid-issues.autologin.flow")!);
    // The FULL client registration is persisted (a public client, auth `none`).
    expect(flow.client.client_id).toBe("https://app.example/clientid.jsonld");
    expect(flow.client.token_endpoint_auth_method).toBe("none");
    expect(flow.client.client_secret).toBeUndefined();

    await provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz");

    // The client handed to the token exchange is the SAME public client.
    const client = vi.mocked(oauth.authorizationCodeGrantRequest).mock.calls[0][1];
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret).toBeUndefined();
    // Public-client path uses `None()` auth, never `ClientSecretBasic`.
    expect(oauth.None).toHaveBeenCalled();
    expect(oauth.ClientSecretBasic).not.toHaveBeenCalled();
  });

  it("CONFIDENTIAL client (dynamic registration): the auth method + secret round-trip", async () => {
    // Dynamic registration (no static clientId) returns a confidential client with
    // EXTRA metadata oauth4webapi consults during response validation — the whole
    // record must round-trip across the redirect, not just id/method/secret.
    h2.dynamicClientRegistration = {
      client_id: "dyn-client",
      token_endpoint_auth_method: "client_secret_basic",
      client_secret: "s3cr3t-from-registration",
      id_token_signed_response_alg: "ES256",
      require_auth_time: true,
    };
    const onSession = vi.fn();
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => "unused",
      async () => ALICE,
      { onSession }, // NO clientId → dynamic client registration path
    );

    await provider.beginRedirectLogin("https://app.example/");

    // beginRedirectLogin persisted the FULL confidential client registration…
    const flow = JSON.parse(store.get("solid-issues.autologin.flow")!);
    expect(flow.client.client_id).toBe("dyn-client");
    expect(flow.client.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(flow.client.client_secret).toBe("s3cr3t-from-registration");
    // …including the extra registration metadata (would diverge if we persisted a subset).
    expect(flow.client.id_token_signed_response_alg).toBe("ES256");
    expect(flow.client.require_auth_time).toBe(true);

    const result = await provider.completeRedirectLogin(
      "https://app.example/?code=auth-code&state=state-xyz",
    );
    expect(result.webId).toBe(ALICE);

    // …and completeRedirectLogin reconstructed the SAME confidential client for the
    // token exchange (NOT a hardcoded `none`/secret-less public client), preserving
    // every registration field, with redirect_uris pinned to the persisted URI.
    const client = vi.mocked(oauth.authorizationCodeGrantRequest).mock.calls[0][1];
    expect(client.client_id).toBe("dyn-client");
    expect(client.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(client.client_secret).toBe("s3cr3t-from-registration");
    expect(client.id_token_signed_response_alg).toBe("ES256");
    expect(client.require_auth_time).toBe(true);
    expect(client.redirect_uris).toEqual(["https://app.example/"]);
    // The confidential auth method drives ClientSecretBasic with the persisted secret.
    expect(oauth.ClientSecretBasic).toHaveBeenCalledWith("s3cr3t-from-registration");
    // The record is cleared (single-use), so the secret never outlives the round-trip.
    expect(store.has("solid-issues.autologin.flow")).toBe(false);
  });

  it("secret WITHOUT an explicit auth method defaults to `client_secret_basic` (not `none`)", async () => {
    // Per RFC 7591 / OIDC: an OP that returns a client_secret while OMITTING
    // token_endpoint_auth_method relies on the default `client_secret_basic` (a
    // CONFIDENTIAL client). The fix must NOT reconstruct a public `none` client and
    // drop the secret.
    h2.dynamicClientRegistration = {
      client_id: "dyn-client",
      client_secret: "s3cr3t-no-method",
      // NOTE: no token_endpoint_auth_method.
    };
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => "unused",
      async () => ALICE,
      {}, // dynamic registration path
    );
    await provider.beginRedirectLogin("https://app.example/");

    const flow = JSON.parse(store.get("solid-issues.autologin.flow")!);
    expect(flow.client.client_secret).toBe("s3cr3t-no-method");
    expect(flow.client.token_endpoint_auth_method).toBeUndefined();

    await provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz");

    const client = vi.mocked(oauth.authorizationCodeGrantRequest).mock.calls[0][1];
    expect(client.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(client.client_secret).toBe("s3cr3t-no-method");
    // The secret is actually USED for client auth (not silently dropped via None()).
    expect(oauth.ClientSecretBasic).toHaveBeenCalledWith("s3cr3t-no-method");
    expect(oauth.None).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on an unsupported confidential auth method (e.g. client_secret_post)", async () => {
    // #clientAuth implements only `none` + `client_secret_basic`; any other method
    // would silently send NO client auth on the token exchange. completeRedirectLogin
    // must refuse explicitly rather than reconstruct a client it cannot authenticate.
    h2.dynamicClientRegistration = {
      client_id: "dyn-client",
      token_endpoint_auth_method: "client_secret_post",
      client_secret: "s3cr3t-post",
    };
    const onSession = vi.fn();
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => "unused",
      async () => ALICE,
      { onSession },
    );
    await provider.beginRedirectLogin("https://app.example/");
    expect(store.has("solid-issues.autologin.flow")).toBe(true);

    await expect(
      provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz"),
    ).rejects.toThrow(/unsupported token-endpoint authentication method/i);

    // No token exchange attempted, no session published, record cleared (no replay).
    expect(oauth.authorizationCodeGrantRequest).not.toHaveBeenCalled();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(onSession).not.toHaveBeenCalled();
    expect(store.has("solid-issues.autologin.flow")).toBe(false);
  });

  it("minimal record (client carries neither auth method nor secret) falls back to `none`", async () => {
    // A persisted client with no token_endpoint_auth_method and no client_secret is a
    // public client: it must reconstruct as `none`, never accidentally confidential.
    const provider = newProvider();
    await provider.beginRedirectLogin("https://app.example/");
    const flow = JSON.parse(store.get("solid-issues.autologin.flow")!);
    delete flow.client.token_endpoint_auth_method;
    delete flow.client.client_secret;
    store.set("solid-issues.autologin.flow", JSON.stringify(flow));

    await provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state-xyz");

    const client = vi.mocked(oauth.authorizationCodeGrantRequest).mock.calls[0][1];
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret).toBeUndefined();
    expect(oauth.ClientSecretBasic).not.toHaveBeenCalled();
  });
});
