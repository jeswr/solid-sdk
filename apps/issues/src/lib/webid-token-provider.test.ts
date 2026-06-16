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

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  const expectNoNonce = Symbol("expectNoNonce");
  const nopkce = Symbol("nopkce");
  return {
    allowInsecureRequests,
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
    processDynamicClientRegistrationResponse: vi.fn(() => ({ client_id: "dyn-client" })),
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
