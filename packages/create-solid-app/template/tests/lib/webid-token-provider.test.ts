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

const {
  WebIdDPoPTokenProvider,
  webIdsEqual,
  registerProbeRequest,
  discardProbeRegistration,
  ReactiveAuthResetError,
} = await import("@/lib/solid/webid-token-provider");

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";

const REDIRECT = "https://app.example/callback.html?code=auth-code&state=state";

/** Build a provider whose getWebId returns the WebID currently in `authState`. */
function makeProvider(
  getCode: (uri: URL, signal: AbortSignal) => Promise<string> = async () => REDIRECT,
) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    getCode,
    async () => authState.webId,
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

/**
 * A login probe Request tagged with a per-attempt probe id via the Request
 * registry — NOT a network header (the round-3 CORS fix). The id travels in
 * process memory only, so the returned Request carries NO app-custom header.
 */
function probeRequest(url: string, probeId: string): Request {
  const req = new Request(url);
  registerProbeRequest(req, probeId);
  return req;
}

/**
 * Re-wrap a Request exactly as `ReactiveFetchManager.#fetch` does
 * (`new Request(input, init)`) before it calls `provider.upgrade(request)`. This
 * produces a DIFFERENT object than the one the login flow registered, so it proves
 * the side channel survives the manager's re-wrap (object identity is lost; the
 * single-use URL channel carries the id across).
 */
function asManagerWraps(req: Request): Request {
  return new Request(req);
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

describe("FIX 2 (round 3) — a STALE issuer rejection after reset() must not clear the NEW generation's #issuer", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("a superseded issuer resolution rejecting late leaves the current generation's single-flight intact", async () => {
    // Drive issuer resolution timing via a controllable getWebId. The FIRST
    // resolution (generation 0) is stalled, then rejected — but only AFTER reset()
    // advanced the generation and a SECOND resolution (generation 1) is in flight.
    // The stale rejection must NOT clear #issuer, or the current generation loses
    // single-flight and the in-flight (and later) upgrades re-prompt / fail.
    let calls = 0;
    let rejectFirst!: (e: Error) => void;
    const firstGate = new Promise<void>((_resolve, reject) => {
      rejectFirst = (e) => reject(e);
    });
    const getWebId = async () => {
      calls += 1;
      if (calls === 1) {
        await firstGate; // the soon-to-be-superseded resolution stalls here.
        return WEBID_A;
      }
      return WEBID_B; // the second resolution (after reset) succeeds immediately.
    };
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      getWebId,
    );

    // Generation 0: first upgrade; its issuer resolution stalls in getWebId.
    const firstUpgrade = provider.upgrade(new Request("https://alice.example/storage/"));
    firstUpgrade.catch(() => {});
    await Promise.resolve();

    // reset() → generation 1. The stalled first resolution is now superseded.
    provider.reset();

    // Generation 1: a fresh upgrade kicks off a SECOND resolution (calls===2) which
    // succeeds and establishes B's session.
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    const secondReq = await provider.upgrade(new Request("https://bob.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(secondReq.headers.get("Authorization")).toBe("DPoP tok-B");

    // NOW reject the stale first resolution. Its catch must NOT clear #issuer.
    rejectFirst(new Error("stale issuer resolution aborted"));
    await firstUpgrade.catch(() => {});
    await Promise.resolve();

    // The current generation's single-flight is intact: a further upgrade reuses B's
    // issuer/session WITHOUT a third resolution (calls stays at 2). If the stale
    // catch had cleared #issuer, this would re-resolve (calls === 3).
    const callsBefore = calls;
    const thirdReq = await provider.upgrade(new Request("https://bob.example/other/"));
    expect(calls).toBe(callsBefore); // no re-resolution — #issuer survived
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(thirdReq.headers.get("Authorization")).toBe("DPoP tok-B");
  });
});

describe("FIX (round 3) — probe id is a Request-registry side channel, NOT a network header (CORS)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("the probe Request carries NO app-custom header (no x-reactive-auth-probe-id, nothing non-standard)", () => {
    const req = probeRequest("https://alice.example/storage/", "probe-cors");
    const headerNames = [...req.headers.keys()];
    expect(headerNames).not.toContain("x-reactive-auth-probe-id");
    expect(headerNames).toEqual([]);
  });

  it("wasProbeUpgraded resolves true via the registry when the SAME object reaches upgrade()", async () => {
    const provider = makeProvider();
    const req = probeRequest("https://alice.example/storage/", "probe-obj");
    const upgraded = await provider.upgrade(req);
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(upgraded.headers.get("x-reactive-auth-probe-id")).toBeNull();
    expect(provider.wasProbeUpgraded("probe-obj")).toBe(true);
  });

  it("survives the manager re-wrap: a new Request(input) copy still resolves the probe id (URL channel)", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/", "probe-rewrap");
    const wrapped = asManagerWraps(registered);
    expect(wrapped).not.toBe(registered);
    const upgraded = await provider.upgrade(wrapped);
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.wasProbeUpgraded("probe-rewrap")).toBe(true);
  });

  it("the URL channel is SINGLE-USE: a later same-URL request does NOT inherit the probe id", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/", "probe-single");
    await provider.upgrade(asManagerWraps(registered));
    expect(provider.wasProbeUpgraded("probe-single")).toBe(true);

    provider.reset();

    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.wasProbeUpgraded("probe-single")).toBe(false);
  });

  it("discardProbeRegistration drops an unconsumed URL entry so no later request inherits it", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/", "probe-discard");
    discardProbeRegistration(registered);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.wasProbeUpgraded("probe-discard")).toBe(false);
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
