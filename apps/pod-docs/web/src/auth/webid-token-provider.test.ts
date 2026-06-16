// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Regression test for the CROSS-USER SESSION LEAK (the HIGH roborev finding).
 *
 * The bug: `WebIdDPoPTokenProvider` caches the resolved issuer + the per-issuer
 * session (DPoP key + access token) + the authenticated-WebID claim in memory.
 * If logout only clears React state, a later login as a DIFFERENT WebID would
 * reuse the previous user's session, and a login-detection probe that merely
 * checks "is a token attached" would look authenticated with the STALE token.
 *
 * The fix has two halves, both pinned here:
 *  1. `reset()` drops EVERYTHING per-identity — issuer, sessions, the
 *     authenticated-WebID claim, and the running token-attach count — so nothing
 *     from a prior login can be reused by the next.
 *  2. the provider records the WebID the OP actually authenticated AS (the
 *     id_token `webid`/`sub` claim), exposed via `authenticatedWebId()`, and
 *     `webIdsEqual` is the strict comparison the login flow uses to confirm the
 *     authenticated identity matches the requested one — never inferring "logged
 *     in" purely from a token being attached.
 *
 * The full OAuth/DPoP/profile-fetch stack is mocked so this runs with no browser
 * and no network: we control exactly which WebID each authentication "returns".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the heavy auth dependencies so #authenticate is fully controllable. ---
// A module-level switch lets each test decide which WebID the next id_token
// authenticates AS, so we can simulate user A then a DIFFERENT user B.
const authState = { webId: "https://alice.example/profile/card#me", accessToken: "tok-A" };

vi.mock("@jeswr/fetch-rdf", () => ({
  // Issuer resolution dereferences the WebID profile; the dataset content is
  // irrelevant because resolveIssuers is mocked below.
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));

vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  // One issuer for every WebID — keeps issuer resolution deterministic.
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
    dynamicClientRegistrationRequest: vi.fn(),
    processDynamicClientRegistrationResponse: vi.fn(),
    generateKeyPair: vi.fn(async () => ({ publicKey: {}, privateKey: {} })),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code" })),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    // The token response carries the access token for the CURRENT authState.
    processAuthorizationCodeResponse: vi.fn(async () => ({
      access_token: authState.accessToken,
    })),
    // The id_token claims pin the WebID the OP vouched for.
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

// Import AFTER the mocks are registered.
const { WebIdDPoPTokenProvider, webIdsEqual, PROBE_ID_HEADER, ReactiveAuthResetError } =
  await import("./webid-token-provider");

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";

const REDIRECT = "https://app.example/callback.html?code=auth-code&state=state";

/** Build a provider whose getWebId returns the WebID currently in `authState`. */
function makeProvider(
  getCode: (uri: URL, signal: AbortSignal) => Promise<string> = async () => REDIRECT,
) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    // getCode — the popup; returns a redirect URL with the auth code.
    getCode,
    // getWebId — hand back whichever WebID the current attempt is for.
    async () => authState.webId,
    { clientId: "https://app.example/clientid.jsonld" },
  );
}

/** A deferred whose `getCode` resolves only when the test calls `release()`. */
function deferredGetCode() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const getCode = async () => {
    await gate;
    return REDIRECT;
  };
  return { getCode, release };
}

/** A login probe Request carrying a per-attempt probe id (FIX 3). */
function probeRequest(url: string, probeId: string): Request {
  return new Request(url, { headers: { [PROBE_ID_HEADER]: probeId } });
}

describe("webIdsEqual", () => {
  it("treats identical WebIDs as equal", () => {
    expect(webIdsEqual(WEBID_A, WEBID_A)).toBe(true);
  });

  it("is case-insensitive on scheme + host only, strict on path/fragment", () => {
    expect(
      webIdsEqual("https://Alice.Example/profile/card#me", "https://alice.example/profile/card#me"),
    ).toBe(true);
    // Different fragment = different identity.
    expect(
      webIdsEqual(
        "https://alice.example/profile/card#me",
        "https://alice.example/profile/card#you",
      ),
    ).toBe(false);
    // Different path = different identity.
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
    // The minted token (A's) is what got attached.
    expect(req.headers.get("Authorization")).toBe("DPoP tok-A");
  });

  it("reset() drops the cached issuer, session, authenticated WebID and attach count", async () => {
    const provider = makeProvider();
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.tokensAttachedCount()).toBe(1);

    provider.reset();

    // Nothing from A's identity may survive the reset.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("after logout (reset) a login as WebID-B never surfaces WebID-A's session or token", async () => {
    const provider = makeProvider();

    // --- User A logs in. ---
    const reqA = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(reqA.headers.get("Authorization")).toBe("DPoP tok-A");

    // --- Logout: the provider is reset (the Finding-1 fix). ---
    provider.reset();

    // --- A DIFFERENT user, B, logs in on the same provider instance. ---
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    const reqB = await provider.upgrade(new Request("https://bob.example/storage/"));

    // The provider must now report B's identity + B's token — never A's.
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(provider.authenticatedWebId()).not.toBe(WEBID_A);
    expect(reqB.headers.get("Authorization")).toBe("DPoP tok-B");
    // The login flow's gate: B's authenticated WebID matches the requested B,
    // and does NOT match A.
    expect(webIdsEqual(provider.authenticatedWebId(), WEBID_B)).toBe(true);
    expect(webIdsEqual(provider.authenticatedWebId(), WEBID_A)).toBe(false);
  });

  it("WITHOUT reset, a stale issuer cache would pin the first identity (proves reset is load-bearing)", async () => {
    const provider = makeProvider();
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // Switch the would-be user to B but DO NOT reset: the memoised issuer +
    // cached session are still A's, so the provider keeps reporting A. This is
    // exactly the leak reset() prevents — asserting it here documents why the
    // logout/new-login reset is mandatory, not cosmetic.
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    const reqStale = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A); // leaked without reset
    expect(reqStale.headers.get("Authorization")).toBe("DPoP tok-A"); // A's token reused
  });
});

describe("FIX 2 — reset() fences in-flight auth work (no contamination after logout/re-login)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("an upgrade() that resolves AFTER reset() writes NO provider state and is discarded", async () => {
    // Stall the popup so user A's upgrade is in flight when logout/reset fires.
    const { getCode, release } = deferredGetCode();
    const provider = makeProvider(getCode);

    const inflight = provider.upgrade(new Request("https://alice.example/storage/"));
    // Let the flow reach the (stalled) getCode, then log out mid-flight.
    await Promise.resolve();
    provider.reset();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);

    // Now let A's stalled flow complete — it must NOT write any state.
    release();
    await expect(inflight).rejects.toBeInstanceOf(ReactiveAuthResetError);

    // The superseded upgrade contaminated nothing: clean baseline survives.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("after a fenced in-flight upgrade, a fresh login as B reports ONLY B (no A residue)", async () => {
    // A's popup is stalled, so A's upgrade is in flight when logout fires.
    const { getCode: getCodeA, release: releaseA } = deferredGetCode();
    const provider = makeProvider(getCodeA);
    const inflightA = provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();

    // Logout (reset) fences A, then user B is the new identity.
    provider.reset();
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";

    // Release A's stalled flow — it must reject as superseded, writing nothing.
    releaseA();
    await expect(inflightA).rejects.toBeInstanceOf(ReactiveAuthResetError);

    // B logs in on the same provider (the gate is now open, so B's flow completes).
    const reqB = await provider.upgrade(probeRequest("https://bob.example/storage/", "p-b"));
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(provider.authenticatedWebId()).not.toBe(WEBID_A);
    expect(reqB.headers.get("Authorization")).toBe("DPoP tok-B");
    // A's fenced attempt left no probe-upgrade record; only B's probe is recorded.
    expect(provider.wasProbeUpgraded("p-b")).toBe(true);
  });
});

describe("FIX 3 — login proof is PER-PROBE, not a provider-wide counter", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("records the upgraded probe's own id, and only that id", async () => {
    const provider = makeProvider();
    const req = await provider.upgrade(probeRequest("https://alice.example/storage/", "probe-1"));
    expect(req.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.wasProbeUpgraded("probe-1")).toBe(true);
    // A DIFFERENT id (e.g. another login attempt's probe) is NOT satisfied.
    expect(provider.wasProbeUpgraded("probe-2")).toBe(false);
  });

  it("a concurrent same-WebID upgrade does NOT make a non-upgraded probe look logged in", async () => {
    const provider = makeProvider();

    // A concurrent upgraded request for the SAME WebID — e.g. a data-layer read —
    // bumps the provider-wide attach count, but carries NO probe id of OUR login.
    const before = provider.tokensAttachedCount();
    await provider.upgrade(new Request("https://alice.example/data/doc"));
    const after = provider.tokensAttachedCount();
    expect(after).toBeGreaterThan(before); // the provider-wide counter DID advance

    // Our login's OWN probe (id "my-login") was NEVER upgraded (imagine its target
    // was public, so no upgrade ran for it). The per-probe proof must be false even
    // though the provider-wide count moved — this is the spurious-pass FIX 3 closes.
    expect(provider.wasProbeUpgraded("my-login")).toBe(false);
  });

  it("reset() clears the per-probe upgrade record", async () => {
    const provider = makeProvider();
    await provider.upgrade(probeRequest("https://alice.example/storage/", "probe-x"));
    expect(provider.wasProbeUpgraded("probe-x")).toBe(true);
    provider.reset();
    expect(provider.wasProbeUpgraded("probe-x")).toBe(false);
  });
});
