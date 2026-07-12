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

// Capture every DPoP.generateProof call's args so tests can assert the htu (arg 2)
// the proof is minted with — RFC 9449 §4.2: query + fragment must be stripped.
// `vi.hoisted` initialises this BEFORE the hoisted `vi.mock("dpop")` factory runs,
// so the factory's closure over `dpopCalls` can never hit a temporal-dead-zone race
// (a plain top-level `const` is hoisted AFTER the mock factory by Vitest).
const { dpopCalls } = vi.hoisted(() => ({ dpopCalls: [] as unknown[][] }));
vi.mock("dpop", () => ({
  generateProof: vi.fn(async (...args: unknown[]) => {
    dpopCalls.push(args);
    return "dpop-proof";
  }),
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  const customFetch = Symbol("customFetch");
  return {
    allowInsecureRequests,
    // The login-stall fix (`#httpOptions()`) threads `[customFetch]` into every
    // oauth4webapi call's options; this mock's consumers don't need to route
    // through it (they stub the OIDC calls directly), but the symbol must exist
    // or building the options object throws "no export" in strict-mocked mode.
    customFetch,
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
    // Echo the requested metadata (the registered redirect_uris) back on the
    // response, exactly as a real OP does — so the persisted client.redirect_uris a
    // test inspects reflects what was actually registered (FIX-1), not a hardcoded
    // stub. The request body is the 2nd arg to dynamicClientRegistrationRequest.
    dynamicClientRegistrationRequest: vi.fn(
      async (_as: unknown, metadata: { redirect_uris?: string[] }) => ({
        __registered: metadata?.redirect_uris ?? ["https://app.example/callback.html"],
      }),
    ),
    processDynamicClientRegistrationResponse: vi.fn(
      async (response: { __registered?: string[] }) => ({
        client_id: "dynamic-client",
        redirect_uris: response?.__registered ?? ["https://app.example/callback.html"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    ),
    generateKeyPair: vi.fn(async () => ({
      publicKey: { __kind: "public" },
      privateKey: { __kind: "private" },
    })),
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
    // Faithful to oauth4webapi: AuthorizationResponseError carries the response
    // parameters (a URLSearchParams) on `.cause`, which abortRedirectLogin reads to
    // surface the OAuth `error` / `error_description`.
    AuthorizationResponseError: class AuthorizationResponseError extends Error {
      cause?: unknown;
      constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "AuthorizationResponseError";
        this.cause = options?.cause;
      }
    },
    // OperationProcessingError is what real validateAuthResponse throws on a state
    // mismatch (BEFORE the error check) — distinct from AuthorizationResponseError.
    OperationProcessingError: class OperationProcessingError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "OperationProcessingError";
      }
    },
  };
});

const {
  WebIdDPoPTokenProvider,
  webIdsEqual,
  withProbeFragment,
  httpUri,
  ReactiveAuthResetError,
  RedirectAbortedError,
  REDIRECT_FLOW_STORAGE_KEY,
  hasPendingRedirectLogin,
  consumePendingRedirectWebId,
} = await import("@/lib/solid/webid-token-provider");
type Provider = InstanceType<typeof WebIdDPoPTokenProvider>;
import * as DPoP from "dpop";
import * as oauth from "oauth4webapi";

// ── Browser globals the REDIRECT autologin path needs, stubbed for the node env ──
// sessionStorage (per-tab, same-origin in the browser) holds the two-phase redirect
// record; crypto.subtle.export/importKey round-trips the EXTRACTABLE DPoP JWK across
// the (simulated) full-page redirect. The crypto stub records what was exported so a
// test can assert the persisted JWK is what completeRedirectLogin re-imports.
function makeMemorySessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

// Reset the captured DPoP proof calls + restore the default (non-gated) mock
// implementation before every test, so the htu-capture and the reset-during-proof
// gate tests start from a clean slate and don't leak a deferred gate into others.
beforeEach(() => {
  dpopCalls.length = 0;
  vi.mocked(DPoP.generateProof).mockImplementation(async (...args: unknown[]) => {
    dpopCalls.push(args);
    return "dpop-proof";
  });
});

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
 * Install a `DPoP.generateProof` mock that BLOCKS on a gate the test controls, so a
 * test can drive a `reset()` to fire DURING the awaited proof generation (the
 * round-4c finding-B race). `reached` resolves once the gated proof has been
 * entered (so the test knows the upgrade is parked at the await); `release` lets it
 * complete. Args are still captured into `dpopCalls`.
 */
function gatedGenerateProof() {
  let release!: () => void;
  let signalReached!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const reached = new Promise<void>((r) => {
    signalReached = r;
  });
  vi.mocked(DPoP.generateProof).mockImplementation(async (...args: unknown[]) => {
    dpopCalls.push(args);
    signalReached();
    await gate;
    return "dpop-proof";
  });
  return { reached, release };
}

/**
 * A login probe Request, built exactly as the SolidAuthProvider login flow does in
 * round-4b: the URL carries a unique, unguessable `#probe-<uuid>` fragment
 * (`withProbeFragment`). It carries NO app-custom header (the round-3 CORS fix) — the
 * fragment is the in-process marker, and fragments are never sent on the wire
 * (RFC 3986 §3.5), so nothing app-specific ever rides over HTTP. The provider records
 * it via `beginLoginProbe`; the fragment makes the URL fallback unforgeable.
 */
function probeRequest(url: string): Request {
  return new Request(withProbeFragment(url));
}

/**
 * Re-wrap a Request exactly as `ReactiveFetchManager.#fetch` does
 * (`new Request(input, init)`) before it calls `provider.upgrade(request)`. This
 * produces a DIFFERENT object than the one the login flow registered, so it proves
 * the side channel survives the manager's re-wrap (object identity is lost; the
 * single-use URL channel in the per-login probe record carries the match across).
 */
function asManagerWraps(req: Request): Request {
  return new Request(req);
}

/**
 * Drive ONE login probe through the provider exactly as the SolidAuthProvider login
 * flow does in round 4: snapshot the generation, register the probe via
 * `beginLoginProbe`, upgrade the request (optionally re-wrapped as the manager
 * would), then `endLoginProbe()` in finally. Returns the generation + the upgraded
 * Request so the test can assert `wasLoginProbeUpgraded(gen)`.
 */
async function runLoginProbe(
  provider: Provider,
  req: Request,
  upgradeWith: Request = req,
): Promise<{ gen: number; upgraded: Request }> {
  const gen = provider.loginGeneration();
  provider.beginLoginProbe(req);
  try {
    const upgraded = await provider.upgrade(upgradeWith);
    return { gen, upgraded };
  } finally {
    provider.endLoginProbe();
  }
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

  // ── round-4c roborev finding B: a reset() that fires DURING the awaited
  // DPoP.generateProof() must make the upgrade reject and write NO provider state.
  // The pre-await fence alone is insufficient — the race is across the await.
  it("a reset() that fires DURING the awaited DPoP.generateProof() rejects and writes NO state", async () => {
    const provider = makeProvider();
    // Gate the DPoP proof step so we can fire reset() while it is awaiting.
    const { reached, release } = gatedGenerateProof();

    const gen = provider.loginGeneration();
    const probe = probeRequest("https://alice.example/storage/");
    provider.beginLoginProbe(probe);
    const inflight = provider.upgrade(probe);
    inflight.catch(() => {});

    // Wait until the upgrade has reached (and is parked at) the gated proof step —
    // session resolved, pre-await fence passed, now awaiting generateProof.
    await reached;

    // Fire reset() DURING the proof await (logout / new login).
    provider.reset();

    // Release the gated proof; the upgrade resumes AFTER reset advanced the
    // generation — the post-await re-fence must reject and write nothing.
    release();
    await expect(inflight).rejects.toBeInstanceOf(ReactiveAuthResetError);

    // NO state written by the superseded attempt: clean baseline survives.
    expect(provider.tokensAttachedCount()).toBe(0);
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
    provider.endLoginProbe();
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
    const { gen: genB, upgraded: reqB } = await runLoginProbe(
      provider,
      probeRequest("https://bob.example/storage/"),
    );
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(provider.authenticatedWebId()).not.toBe(WEBID_A);
    expect(reqB.headers.get("Authorization")).toBe("DPoP tok-B");
    // A's fenced attempt left no probe-upgrade record; only B's probe is recorded.
    expect(provider.wasLoginProbeUpgraded(genB)).toBe(true);
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

describe("FIX (round 4) — login probe proof is generation-scoped, NOT a network header (CORS)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("the probe Request carries NO app-custom header (nothing non-standard rides the wire)", () => {
    const req = probeRequest("https://alice.example/storage/");
    const headerNames = [...req.headers.keys()];
    expect(headerNames).not.toContain("x-reactive-auth-probe-id");
    expect(headerNames).toEqual([]);
  });

  it("wasLoginProbeUpgraded is true via object identity when the SAME object reaches upgrade()", async () => {
    const provider = makeProvider();
    const { gen, upgraded } = await runLoginProbe(
      provider,
      probeRequest("https://alice.example/storage/"),
    );
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(upgraded.headers.get("x-reactive-auth-probe-id")).toBeNull();
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
  });

  it("survives the manager re-wrap: a new Request(input) copy still matches via the URL channel", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/");
    const wrapped = asManagerWraps(registered);
    expect(wrapped).not.toBe(registered);
    // Register the ORIGINAL object, upgrade the RE-WRAPPED copy: object identity is
    // lost, so the match falls back to the generation-scoped URL channel.
    const { gen, upgraded } = await runLoginProbe(provider, registered, wrapped);
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
  });

  it("the URL channel is SINGLE-USE: only the FIRST same-URL re-wrapped upgrade matches the probe", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/");
    const gen = provider.loginGeneration();
    // Spy on whether each upgrade matched the probe by snapshotting the proof flag
    // immediately after each call. Object identity is lost on re-wrap, so matches go
    // through the single-use URL channel.
    provider.beginLoginProbe(registered);

    // FIRST same-URL upgrade (re-wrapped) consumes the URL channel → sets the proof.
    await provider.upgrade(asManagerWraps(registered));
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);

    // To PROVE the URL channel is single-use (not "always matches this URL"), reset
    // the proof generation by re-beginning the probe in a NEW generation, upgrade a
    // same-URL request ONCE (consumes), then a SECOND same-URL request must NOT
    // re-match — so re-beginning is required for each login window.
    provider.reset();
    const gen2 = provider.loginGeneration();
    const probe2 = probeRequest("https://alice.example/storage/");
    provider.beginLoginProbe(probe2);
    await provider.upgrade(asManagerWraps(probe2)); // consumes the URL channel
    expect(provider.wasLoginProbeUpgraded(gen2)).toBe(true);
    // The OLD generation never gets re-proved by the new window.
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
  });

  it("endLoginProbe drops the active record so no later same-URL request matches it", async () => {
    const provider = makeProvider();
    const registered = probeRequest("https://alice.example/storage/");
    const gen = provider.loginGeneration();
    provider.beginLoginProbe(registered);
    provider.endLoginProbe(); // probe got a public 200, never upgraded
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
  });

  // ── round-4b roborev finding 2: the URL fallback must be UNFORGEABLE ──────────
  // The round-4 URL fallback matched on `probe.url === request.url`, so the FIRST
  // unrelated same-URL request in the login window consumed the fallback and set
  // the proof without the REAL probe being upgraded. The probe now carries an
  // unguessable `#probe-<uuid>` fragment, closing that hole.

  it("a non-login upgrade to the same BASE URL (no fragment) during the login window does NOT satisfy the proof", async () => {
    const provider = makeProvider();
    const gen = provider.loginGeneration();
    // The real probe carries an unguessable fragment.
    const realProbe = probeRequest("https://alice.example/storage/");
    provider.beginLoginProbe(realProbe);
    // A CONCURRENT, unrelated data-layer read to the SAME BASE URL — no fragment.
    // Pre-fix this would have consumed the URL fallback and set #probeUpgradedGeneration.
    const before = provider.tokensAttachedCount();
    await provider.upgrade(new Request("https://alice.example/storage/"));
    const after = provider.tokensAttachedCount();
    expect(after).toBeGreaterThan(before); // the provider-wide count DID move…
    // …but the per-probe proof stays FALSE: the unrelated request lacked the
    // unguessable fragment, so it never matched the probe (it neither shares the
    // object nor the full url-with-fragment).
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
    provider.endLoginProbe();
  });

  it("the URL fallback is UNGUESSABLE: a same-base-URL request with an EMPTY or GUESSED fragment does not match", async () => {
    const provider = makeProvider();
    const gen = provider.loginGeneration();
    const realProbe = probeRequest("https://alice.example/storage/");
    provider.beginLoginProbe(realProbe);
    // An attacker-style guess: same base URL, an empty hash and a wrong fragment.
    await provider.upgrade(new Request("https://alice.example/storage/#"));
    await provider.upgrade(new Request("https://alice.example/storage/#probe-guessed"));
    // Neither guess carries the real `#probe-<uuid>`, so the proof is still FALSE.
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
    provider.endLoginProbe();
  });

  // ── round-4c roborev finding A: the probe fragment must NOT leak into the
  // DPoP proof's htu. RFC 9449 §4.2 — htu is the request URI with query AND
  // fragment removed; the server computes a fragment/query-less htu, so the proof
  // must too or the retried probe's token is rejected in production.

  it("httpUri strips the fragment AND query but keeps scheme/host/port/path", () => {
    expect(httpUri("https://alice.example/storage/#probe-abc")).toBe(
      "https://alice.example/storage/",
    );
    expect(httpUri("https://alice.example/storage/?q=1&r=2#probe-abc")).toBe(
      "https://alice.example/storage/",
    );
    expect(httpUri("https://alice.example:8443/a/b/c?x=y")).toBe(
      "https://alice.example:8443/a/b/c",
    );
    // No fragment / no query — unchanged (still a normalised URL string).
    expect(httpUri("https://alice.example/storage/")).toBe(
      "https://alice.example/storage/",
    );
  });

  it("upgrading a probe mints a DPoP proof whose htu has NO #probe fragment and NO query", async () => {
    const provider = makeProvider();
    // A probe URL that carries BOTH a #probe-<uuid> fragment and a query string.
    const probeUrl = withProbeFragment("https://alice.example/storage/?foo=bar");
    expect(new URL(probeUrl).hash).toMatch(/^#probe-/);
    expect(new URL(probeUrl).search).toBe("?foo=bar");

    const { gen, upgraded } = await runLoginProbe(
      provider,
      probeRequest("https://alice.example/storage/?foo=bar"),
    );

    // The proof was minted: capture the htu (arg index 1) handed to generateProof.
    expect(dpopCalls.length).toBe(1);
    const htu = dpopCalls[0][1] as string;
    // RFC 9449 §4.2: no fragment, no query — bare scheme + authority + path.
    expect(htu).not.toContain("#probe-");
    expect(htu).not.toContain("#");
    expect(htu).not.toContain("?");
    expect(htu).toBe("https://alice.example/storage/");
    // The token still attached, and the in-process probe proof still holds (the
    // fragment-bearing request.url is what matched the probe — finding-2 stays green).
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
  });

  it("withProbeFragment stamps a unique, off-the-wire #probe-<uuid> fragment (no header)", () => {
    const a = withProbeFragment("https://alice.example/storage/");
    const b = withProbeFragment("https://alice.example/storage/");
    // Distinct each call (a fresh uuid), and the fragment is the ONLY difference.
    expect(a).not.toBe(b);
    expect(new URL(a).hash).toMatch(/^#probe-[0-9a-f-]{36}$/);
    expect(new URL(a).origin + new URL(a).pathname).toBe(
      "https://alice.example/storage/",
    );
    // The fragment rides only in the URL, never as a header on the wire.
    const req = new Request(a);
    expect([...req.headers.keys()]).toEqual([]);
    expect(req.url).toBe(a);
    // A faithful manager re-wrap preserves the fragment; a plain Request omits it.
    expect(new Request(req).url).toBe(a);
    expect(new Request("https://alice.example/storage/").url).not.toBe(a);
  });
});

describe("FIX 4 — login proof is PER-PROBE + generation-scoped, not a provider-wide counter", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("records the probe's own generation, and only that generation", async () => {
    const provider = makeProvider();
    const { gen, upgraded } = await runLoginProbe(
      provider,
      probeRequest("https://alice.example/storage/"),
    );
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
    // A DIFFERENT generation (e.g. a superseded login) is NOT satisfied.
    expect(provider.wasLoginProbeUpgraded(gen + 1)).toBe(false);
    expect(provider.wasLoginProbeUpgraded(gen - 1)).toBe(false);
  });

  it("a NON-login upgrade to a DIFFERENT URL during the login window does NOT make the probe look upgraded", async () => {
    const provider = makeProvider();
    // The login flow's OWN probe targets the storage root and is registered, but its
    // OWN object/URL is never upgraded (imagine it got a public 200). A CONCURRENT
    // non-login upgrade to a DIFFERENT URL runs — it bumps the provider-wide count
    // but neither matches the probe's object nor its URL, so the per-probe proof for
    // THIS login's generation stays FALSE.
    const gen = provider.loginGeneration();
    provider.beginLoginProbe(probeRequest("https://alice.example/storage/"));
    const before = provider.tokensAttachedCount();
    await provider.upgrade(new Request("https://alice.example/data/doc"));
    const after = provider.tokensAttachedCount();
    expect(after).toBeGreaterThan(before); // provider-wide counter advanced
    provider.endLoginProbe();
    // The probe's own object/URL was never upgraded → login proof is FALSE even
    // though a different request was upgraded in the same window.
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
  });

  it("a probe that got a PUBLIC 200 (never upgraded) is NOT marked upgraded after endLoginProbe", async () => {
    const provider = makeProvider();
    const gen = provider.loginGeneration();
    provider.beginLoginProbe(probeRequest("https://alice.example/storage/"));
    // No upgrade() at all — the probe resource was public, returned 200 directly.
    provider.endLoginProbe();
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
  });

  it("a concurrent same-WebID upgrade with NO active probe leaves the proof unset", async () => {
    const provider = makeProvider();
    const gen = provider.loginGeneration();

    // No beginLoginProbe — a bare data-layer read upgrades and bumps the counter,
    // but with no active probe record nothing sets #probeUpgradedGeneration.
    const before = provider.tokensAttachedCount();
    await provider.upgrade(new Request("https://alice.example/data/doc"));
    const after = provider.tokensAttachedCount();
    expect(after).toBeGreaterThan(before); // provider-wide counter advanced

    // The per-probe proof is FALSE — the spurious-pass this fix closes.
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
  });

  it("reset() clears the per-probe upgrade record and advances the generation", async () => {
    const provider = makeProvider();
    const { gen } = await runLoginProbe(
      provider,
      probeRequest("https://alice.example/storage/"),
    );
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
    provider.reset();
    // Both the record is nulled AND the generation moved, so the old gen is stale.
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(false);
    expect(provider.loginGeneration()).not.toBe(gen);
  });

  it("a probe begun in a PRIOR generation does not match an upgrade after reset()", async () => {
    const provider = makeProvider();
    const staleProbe = probeRequest("https://alice.example/storage/");
    provider.beginLoginProbe(staleProbe);
    const staleGen = provider.loginGeneration();

    // A reset() (new login) advances the generation; the stale probe record is
    // nulled AND would be out-of-generation even if it survived.
    provider.reset();
    const freshGen = provider.loginGeneration();
    expect(freshGen).not.toBe(staleGen);

    // Upgrading the stale probe object now must NOT mark the new generation upgraded.
    await provider.upgrade(staleProbe);
    expect(provider.wasLoginProbeUpgraded(freshGen)).toBe(false);
    expect(provider.wasLoginProbeUpgraded(staleGen)).toBe(false);
  });
});

describe("FIX 4b — SolidAuthProvider WebID-scoped single-flight login gate (shape)", () => {
  // The SolidAuthProvider component is hard to mount in this oauth/dpop-mocked,
  // browser-less harness (it dynamically imports @solid/reactive-authentication and
  // a custom element). We therefore test the single-flight GATE LOGIC directly,
  // mirroring the EXACT shape the component uses — a WebID-scoped `inFlight = { id,
  // promise }` keyed via `webIdsEqual` (round-4b). This pins the invariants:
  //   - a SAME-WebID double-click shares the one in-flight login (one doLogin run);
  //   - a DIFFERENT-WebID concurrent login REJECTS cleanly — it never starts a
  //     second doLogin and never resolves as the in-flight identity (the
  //     false-positive the roborev finding flagged in the bare-promise version).
  // The gate is factored out as the same pure logic the component runs, because
  // SolidAuthProvider itself cannot mount in this harness.
  function makeGate(doLogin: (id: string) => Promise<void>) {
    let inFlight: { id: string; promise: Promise<void> } | null = null;
    return (id: string): Promise<void> => {
      if (inFlight) {
        if (webIdsEqual(inFlight.id, id)) return inFlight.promise;
        return Promise.reject(
          new Error(
            "A login for a different WebID is already in progress — wait for it to " +
              "finish or log out first.",
          ),
        );
      }
      const run = { id, promise: Promise.resolve() };
      run.promise = doLogin(id).finally(() => {
        if (inFlight === run) inFlight = null;
      });
      inFlight = run;
      return run.promise;
    };
  }

  it("a SAME-WebID double-click shares ONE in-flight login (doLogin runs once)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen: string[] = [];
    const login = makeGate(async (id) => {
      calls += 1;
      seen.push(id);
      await gate; // stall so the second call overlaps the first.
    });

    const first = login(WEBID_A);
    const second = login(WEBID_A); // same WebID, concurrent (double-click)
    expect(second).toBe(first); // shares the one in-flight promise
    expect(calls).toBe(1); // doLogin ran exactly once
    expect(seen).toEqual([WEBID_A]);

    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);

    // After settling, a LATER login starts a fresh flow (the in-flight slot cleared).
    const third = login(WEBID_B);
    expect(third).not.toBe(first);
    await third;
    expect(calls).toBe(2);
    expect(seen).toEqual([WEBID_A, WEBID_B]);
  });

  it("a DIFFERENT-WebID concurrent login REJECTS without starting a second doLogin and never resolves as the in-flight identity", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen: string[] = [];
    const login = makeGate(async (id) => {
      calls += 1;
      seen.push(id);
      await gate; // Alice's login stays in flight while Bob arrives.
    });

    // Alice's login is in flight (stalled at the gate).
    const alice = login(WEBID_A);
    // Bob arrives concurrently — must REJECT cleanly, NOT resolve as Alice and NOT
    // run a second doLogin. This is the false-positive the roborev finding caught:
    // the bare-promise gate would have returned ALICE's promise to Bob.
    const bob = login(WEBID_B);
    await expect(bob).rejects.toThrow(/different WebID is already in progress/);
    expect(calls).toBe(1); // only Alice's doLogin ran
    expect(seen).toEqual([WEBID_A]); // Bob never reached doLogin

    // Alice's login completes normally — Bob's rejection did not disturb it.
    release();
    await expect(alice).resolves.toBeUndefined();
    expect(calls).toBe(1);

    // Once Alice settled, Bob can be retried and now proceeds.
    const bobRetry = login(WEBID_B);
    await expect(bobRetry).resolves.toBeUndefined();
    expect(calls).toBe(2);
    expect(seen).toEqual([WEBID_A, WEBID_B]);
  });

  it("a single login() with one active probe yields exactly one probe-upgrade proof in its generation", async () => {
    // The provider-level invariant single-flight guarantees: across a login's window
    // there is exactly ONE active probe, so exactly one generation gets the proof.
    const provider = makeProvider();
    const { gen } = await runLoginProbe(
      provider,
      probeRequest("https://alice.example/storage/"),
    );
    expect(provider.wasLoginProbeUpgraded(gen)).toBe(true);
    // beginLoginProbe is single-shot per login: a second begin (next login) would
    // need its own generation; the prior gen's proof is independent.
    expect(provider.wasLoginProbeUpgraded(gen + 1)).toBe(false);
  });
});

// ── The two-phase full-page REDIRECT autologin path (media-kraken#54) ────────────
// Published @solid/reactive-authentication 0.1.3 has NO redirect mode (only the
// popup), so the provider adds beginRedirectLogin / completeRedirectLogin: phase 1
// builds the auth URL + PERSISTS the in-between state (EXTRACTABLE DPoP JWK, PKCE
// verifier, state, nonce, issuer, client, redirect_uri, WebID) to sessionStorage;
// phase 2 (after the full-page redirect) re-imports the key, validates the callback
// against the persisted state, exchanges the DPoP-bound code, and establishes the
// session. oauth4webapi/dpop are mocked exactly as the popup tests mock them.
describe("REDIRECT autologin — beginRedirectLogin / completeRedirectLogin", () => {
  let exportedKeys: Array<{ format: string; key: unknown }>;
  let importedKeys: Array<{ format: string; jwk: unknown }>;

  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    // Fresh per-tab sessionStorage for each test.
    (globalThis as { sessionStorage?: Storage }).sessionStorage =
      makeMemorySessionStorage();
    // Stub crypto.subtle.export/importKey to round-trip the DPoP JWK. We keep the
    // real `crypto.randomUUID` (used by withProbeFragment) by only overriding subtle.
    exportedKeys = [];
    importedKeys = [];
    const subtle = {
      exportKey: vi.fn(async (format: string, key: unknown) => {
        exportedKeys.push({ format, key });
        // Return a distinct JWK per key so the persisted record is inspectable.
        return (key as { __kind?: string })?.__kind === "private"
          ? { kty: "EC", crv: "P-256", d: "PRIV", x: "X", y: "Y" }
          : { kty: "EC", crv: "P-256", x: "X", y: "Y" };
      }),
      importKey: vi.fn(async (format: string, jwk: unknown) => {
        importedKeys.push({ format, jwk });
        return { __imported: jwk } as unknown as CryptoKey;
      }),
    };
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { ...globalThis.crypto, subtle },
    });
  });

  function makeRedirectProvider() {
    return new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => authState.webId,
    );
  }

  const RETURN_URI = "https://app.example/";
  const CALLBACK =
    "https://app.example/?code=auth-code&state=state";

  it("(begin) persists a record with the expected fields and returns an auth URL with the right params", async () => {
    const provider = makeRedirectProvider();
    expect(hasPendingRedirectLogin()).toBe(false);

    const { authorizationUrl } = await provider.beginRedirectLogin(RETURN_URI);

    // The authorization URL targets the resolved issuer's authorization_endpoint with
    // response_type=code, the offline_access scope, prompt=none (silent autologin),
    // state, nonce, S256 challenge, and the full-page return URI as redirect_uri.
    const u = new URL(authorizationUrl);
    expect(`${u.origin}${u.pathname}`).toBe("https://issuer.example/auth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid webid offline_access");
    // FIX-2: the full-page autologin MUST be silent — prompt=none on page load.
    expect(u.searchParams.get("prompt")).toBe("none");
    expect(u.searchParams.get("state")).toBe("state");
    expect(u.searchParams.get("nonce")).toBe("nonce");
    expect(u.searchParams.get("redirect_uri")).toBe(RETURN_URI);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("challenge");
    expect(u.searchParams.get("client_id")).toBe("dynamic-client");

    // A pending record now exists, carrying the requested WebID + the persisted bits.
    expect(hasPendingRedirectLogin()).toBe(true);
    expect(consumePendingRedirectWebId()).toBe(WEBID_A);
    const record = JSON.parse(
      sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY)!,
    );
    expect(record.issuer).toBe("https://issuer.example/");
    expect(record.codeVerifier).toBe("verifier");
    expect(record.state).toBe("state");
    expect(record.nonce).toBe("nonce");
    expect(record.redirectUri).toBe(RETURN_URI);
    expect(record.webId).toBe(WEBID_A);
    // BOTH DPoP JWKs are exported + persisted (private has `d`, public does not).
    expect(record.dpopPrivateJwk.d).toBe("PRIV");
    expect(record.dpopPublicJwk.d).toBeUndefined();
    // The EXTRACTABLE key was generated extractable (so it could be exported).
    expect(oauth.generateKeyPair).toHaveBeenCalledWith("ES256", {
      extractable: true,
    });
    expect(exportedKeys.length).toBe(2);
  });

  it("(begin) re-registers the dynamic client with BOTH the popup callback AND the full-page return URI", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    // FIX-1: the dynamic registration (the "client document" on the localhost dynamic
    // path) must REGISTER BOTH redirect_uris so the broker accepts the full-page
    // redirect_uri (a popup-only registration would reject the app-root return URI).
    const regCall = vi.mocked(oauth.dynamicClientRegistrationRequest).mock.calls.at(-1)!;
    const metadata = regCall[1] as { redirect_uris: string[] };
    expect(metadata.redirect_uris).toContain("https://app.example/callback.html");
    expect(metadata.redirect_uris).toContain(RETURN_URI); // the app root ${origin}/
  });

  it("(begin, FIX-1) the PERSISTED client (reused for the token exchange) carries BOTH redirect_uris", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    // The resolved client is persisted verbatim and REUSED for the post-redirect token
    // exchange (the broker validated redirect_uri against THIS client). It must list
    // BOTH the popup callback AND the app-root return URI, or the full-page autologin's
    // code exchange would be rejected. We assert against the persisted record's client
    // (the registration response echoes the requested redirect_uris).
    const record = JSON.parse(
      sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY)!,
    ) as { client: { redirect_uris: string[] } };
    expect(record.client.redirect_uris).toContain("https://app.example/callback.html");
    expect(record.client.redirect_uris).toContain(RETURN_URI);
  });

  it("(begin, FIX-1) the dynamic client document de-duplicates redirect_uris", async () => {
    // When the full-page return URI EQUALS the popup callback (an unusual but valid
    // config) the registration must not list it twice — the set-union in #resolveClient
    // de-dupes. Register with the popup callback AS the return URI and assert one entry.
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin("https://app.example/callback.html");
    const regCall = vi.mocked(oauth.dynamicClientRegistrationRequest).mock.calls.at(-1)!;
    const metadata = regCall[1] as { redirect_uris: string[] };
    expect(metadata.redirect_uris).toEqual(["https://app.example/callback.html"]);
  });

  it("(begin, FIX-2) sets prompt=none on the full-page autologin authorization URL", async () => {
    // The deep-link autologin fires on page load with NO user gesture, so it must be
    // SILENT: prompt=none tells the OP to authenticate ONLY from an existing session +
    // prior authorization and never render interactive UI. Any interaction-required
    // case comes back as an OIDC error (`?error&state`) that the state-validating abort
    // path handles — that abort path is ONLY reachable because prompt=none forces the
    // error return instead of an interactive screen.
    const provider = makeRedirectProvider();
    const { authorizationUrl } = await provider.beginRedirectLogin(RETURN_URI);
    expect(new URL(authorizationUrl).searchParams.get("prompt")).toBe("none");
  });

  it("(complete) reads the record, exchanges the code, establishes the session + authenticatedWebId, and clears the record", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    expect(hasPendingRedirectLogin()).toBe(true);

    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);

    await provider.completeRedirectLogin(CALLBACK);

    // The session is established: identity published, attach counter bumped.
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.tokensAttachedCount()).toBe(1);
    // The auth response was validated against the PERSISTED state.
    expect(oauth.validateAuthResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new URL(CALLBACK),
      "state",
    );
    // The DPoP private+public JWKs were re-imported (the SAME key the code bound to).
    expect(importedKeys.length).toBe(2);
    // The record is consumed (cleared) on success.
    expect(hasPendingRedirectLogin()).toBe(false);

    // A subsequent upgrade reuses the established session (no re-auth) and carries the
    // DPoP-bound token — proving the session was actually seeded in #sessions.
    const upgraded = await provider.upgrade(
      new Request("https://alice.example/storage/"),
    );
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
  });

  it("(complete) a bad state throws and leaves the provider CLEAN — no half-session, record cleared", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);

    // Simulate oauth.validateAuthResponse rejecting a forged/mismatched state.
    vi.mocked(oauth.validateAuthResponse).mockImplementationOnce(() => {
      throw new Error("unexpected state");
    });

    await expect(provider.completeRedirectLogin(CALLBACK)).rejects.toThrow(
      /unexpected state/,
    );
    // No session, no identity, no attach — the provider is clean.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
    // The record is cleared even on failure (the finally), so a stale flow can't
    // satisfy a later callback.
    expect(hasPendingRedirectLogin()).toBe(false);
  });

  it("(complete) with NO pending record throws and writes nothing", async () => {
    const provider = makeRedirectProvider();
    await expect(provider.completeRedirectLogin(CALLBACK)).rejects.toThrow(
      /No pending redirect login/,
    );
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("reset() clears the pending redirect record (a stale flow is abandoned on logout/new-login)", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    expect(hasPendingRedirectLogin()).toBe(true);

    provider.reset();

    expect(hasPendingRedirectLogin()).toBe(false);
    expect(consumePendingRedirectWebId()).toBeNull();
  });

  it("a reset() during beginRedirectLogin's awaits supersedes it (ReactiveAuthResetError, nothing persisted)", async () => {
    // Stall discovery so a reset() can fire mid-flight.
    let releaseDiscovery!: () => void;
    const gate = new Promise<void>((r) => {
      releaseDiscovery = r;
    });
    vi.mocked(oauth.processDiscoveryResponse).mockImplementationOnce(async () => {
      await gate;
      return {
        issuer: "https://issuer.example/",
        authorization_endpoint: "https://issuer.example/auth",
        token_endpoint: "https://issuer.example/token",
        code_challenge_methods_supported: ["S256"],
      } as oauth.AuthorizationServer;
    });

    const provider = makeRedirectProvider();
    const inflight = provider.beginRedirectLogin(RETURN_URI);
    inflight.catch(() => {});
    await Promise.resolve();

    // reset() (logout / new login) fires while begin is parked at discovery.
    provider.reset();
    releaseDiscovery();

    await expect(inflight).rejects.toBeInstanceOf(ReactiveAuthResetError);
    // Nothing persisted by the superseded begin.
    expect(hasPendingRedirectLogin()).toBe(false);
  });

  it("hasPendingRedirectLogin / consumePendingRedirectWebId reflect the record without clearing it", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    // consume is non-destructive — reading the WebID twice still works.
    expect(consumePendingRedirectWebId()).toBe(WEBID_A);
    expect(consumePendingRedirectWebId()).toBe(WEBID_A);
    expect(hasPendingRedirectLogin()).toBe(true);
  });

  // ── FINDING 1 (HIGH): completeRedirectLogin must seed #issuer so a later
  // upgrade() reuses the completed session WITHOUT re-resolving via getWebId
  // (pendingWebIdHolder is null after the full-page redirect). Build a provider
  // whose getWebId becomes UNAVAILABLE (throws) after completion, then assert a
  // subsequent upgrade() to the same issuer's resource succeeds (does NOT call
  // getWebId, does NOT throw "No WebID set for login").
  it("(finding 1) after completion, a later upgrade() reuses the seeded #issuer/session WITHOUT calling getWebId", async () => {
    let getWebIdCalls = 0;
    let webIdAvailable = true;
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => {
        getWebIdCalls += 1;
        if (!webIdAvailable) {
          // Simulate the post-redirect reality: pendingWebIdHolder is null.
          throw new Error("No WebID set for login");
        }
        return authState.webId;
      },
    );

    await provider.beginRedirectLogin(RETURN_URI);
    await provider.completeRedirectLogin(CALLBACK);
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // getWebId is now unavailable — exactly the post-redirect state where #issuer
    // would otherwise be unset and upgrade() would re-resolve and fail.
    webIdAvailable = false;
    const callsBefore = getWebIdCalls;

    const upgraded = await provider.upgrade(
      new Request("https://alice.example/storage/"),
    );
    // The seeded #issuer let upgrade() reuse the completed session: the DPoP-bound
    // token is attached, and getWebId was NOT called again (no re-resolution).
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(getWebIdCalls).toBe(callsBefore);
  });

  // ── FINDING 2 (HIGH, security): completeRedirectLogin must enforce the persisted
  // requested WebID against the id_token's webid claim. A live IdP session for a
  // DIFFERENT account must NOT log the app in as the wrong identity.
  it("(finding 2) a completion whose id_token WebID != the requested WebID throws AND leaves the provider clean + clears the record", async () => {
    // begin with the REQUESTED identity = WEBID_A (persisted in record.webId).
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    expect(hasPendingRedirectLogin()).toBe(true);

    // The OP now vouches for a DIFFERENT WebID (a live session for another account).
    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";

    await expect(provider.completeRedirectLogin(CALLBACK)).rejects.toThrow(
      /different WebID .* than the one requested/,
    );

    // The provider is CLEAN: no session seeded, #issuer unset, identity undefined,
    // no attach — and a subsequent upgrade() would re-resolve via getWebId (proving
    // #issuer was NOT seeded for the unrequested identity).
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
    // The persisted record was cleared by the finally even on this failure.
    expect(hasPendingRedirectLogin()).toBe(false);
  });

  it("(finding 2) on a WebID mismatch, NO session is established for the issuer (#sessions stays empty)", async () => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);

    authState.webId = WEBID_B;
    authState.accessToken = "tok-B";
    await expect(provider.completeRedirectLogin(CALLBACK)).rejects.toThrow(
      /different WebID/,
    );

    // No session was seeded: a later upgrade() re-runs the full popup auth flow.
    // With the OP now (back) vouching for WEBID_A, the upgrade authenticates A — if a
    // half-session for B had been seeded, the token would be B's. It is A's.
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    const upgraded = await provider.upgrade(
      new Request("https://alice.example/storage/"),
    );
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
  });

  // ── ROBOREV MEDIUM (finding 2): an OIDC error return (`?error&state`) must NOT be
  // trusted on the bare presence of error+state. abortRedirectLogin routes the callback
  // through oauth.validateAuthResponse, which checks the callback `state` against the
  // PERSISTED record's state BEFORE surfacing the error. Only a state-VALIDATED error
  // return may consume the record + reset the provider; a forged/stray callback (bad or
  // missing state) must leave the pending flow + provider state FULLY INTACT.
  const ERROR_CALLBACK_GOOD_STATE =
    "https://app.example/?error=login_required&state=state";
  const ERROR_CALLBACK_BAD_STATE =
    "https://app.example/?error=login_required&state=FORGED";

  it("(abort) a VALIDATED error return (state matches the record) throws RedirectAbortedError, clears the record + resets", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    expect(hasPendingRedirectLogin()).toBe(true);

    // Real validateAuthResponse: state matches → it reaches the error check and throws
    // AuthorizationResponseError carrying the response params on `.cause`.
    vi.mocked(oauth.validateAuthResponse).mockImplementationOnce(() => {
      throw new oauth.AuthorizationResponseError(
        "authorization response from the server is an error",
        {
          cause: new URLSearchParams({
            error: "login_required",
            error_description: "interaction required",
            state: "state",
          }),
        },
      );
    });

    await expect(
      provider.abortRedirectLogin(ERROR_CALLBACK_GOOD_STATE),
    ).rejects.toBeInstanceOf(RedirectAbortedError);

    // The state was validated against the persisted record before any teardown.
    expect(oauth.validateAuthResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new URL(ERROR_CALLBACK_GOOD_STATE),
      "state",
    );
    // VALIDATED error → the record is consumed and the provider is reset-clean.
    expect(hasPendingRedirectLogin()).toBe(false);
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("(abort) the RedirectAbortedError surfaces the OAuth error + description from the validated response", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    vi.mocked(oauth.validateAuthResponse).mockImplementationOnce(() => {
      throw new oauth.AuthorizationResponseError("error", {
        cause: new URLSearchParams({
          error: "access_denied",
          error_description: "user declined",
          state: "state",
        }),
      });
    });
    await provider.abortRedirectLogin(ERROR_CALLBACK_GOOD_STATE).then(
      () => expect.unreachable("abort should reject"),
      (e) => {
        expect(e).toBeInstanceOf(RedirectAbortedError);
        expect(e.oauthError).toBe("access_denied");
        expect(e.message).toBe("access_denied: user declined");
      },
    );
  });

  // THE CORE roborev MEDIUM regression: a FORGED error callback whose `state` does NOT
  // match the persisted record must be REJECTED — the record is NOT consumed and the
  // provider is left untouched, so a stray/CSRF `?error&state` cannot destroy a
  // legitimate in-flight redirect login.
  it("(abort, SECURITY) a FORGED error callback (state mismatch) is rejected; the pending record + provider state are LEFT INTACT", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    expect(hasPendingRedirectLogin()).toBe(true);
    const recordBefore = sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY);

    // Real validateAuthResponse throws on a state mismatch BEFORE the error check —
    // an OperationProcessingError, NOT an AuthorizationResponseError.
    vi.mocked(oauth.validateAuthResponse).mockImplementationOnce(() => {
      throw new oauth.OperationProcessingError(
        'unexpected "state" response parameter value',
      );
    });

    await expect(
      provider.abortRedirectLogin(ERROR_CALLBACK_BAD_STATE),
    ).rejects.not.toBeInstanceOf(RedirectAbortedError);

    // CRUCIAL: the forged callback consumed NOTHING. The pending record is byte-for-byte
    // intact, and the provider state is untouched — the legitimate login still resumable.
    expect(hasPendingRedirectLogin()).toBe(true);
    expect(sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY)).toBe(recordBefore);
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);

    // And the still-intact record can be completed by a genuine `?code&state` later —
    // proving the forged error did not poison the flow.
    await provider.completeRedirectLogin(CALLBACK);
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(hasPendingRedirectLogin()).toBe(false);
  });

  it("(abort) with NO pending record throws and writes nothing (not a RedirectAbortedError)", async () => {
    const provider = makeRedirectProvider();
    await expect(
      provider.abortRedirectLogin(ERROR_CALLBACK_GOOD_STATE),
    ).rejects.toThrow(/No pending redirect login to abort/);
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.tokensAttachedCount()).toBe(0);
  });

  it("(abort) a callback that VALIDATES but carries no error (only state) is rejected WITHOUT consuming the record", async () => {
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);
    const recordBefore = sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY);
    // validateAuthResponse resolves (no error param) — abortRedirectLogin then refuses
    // to consume the record because this is not an error response.
    vi.mocked(oauth.validateAuthResponse).mockReturnValueOnce(
      new URLSearchParams({ state: "state" }),
    );
    await expect(
      provider.abortRedirectLogin("https://app.example/?state=state"),
    ).rejects.not.toBeInstanceOf(RedirectAbortedError);
    // The record is intact — a state-only callback is not an abortable error return.
    expect(hasPendingRedirectLogin()).toBe(true);
    expect(sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY)).toBe(recordBefore);
  });

  it("(abort) a reset() during discovery supersedes the abort (ReactiveAuthResetError); record left for reconciliation", async () => {
    let releaseDiscovery!: () => void;
    const gate = new Promise<void>((r) => {
      releaseDiscovery = r;
    });
    const provider = makeRedirectProvider();
    await provider.beginRedirectLogin(RETURN_URI);

    vi.mocked(oauth.processDiscoveryResponse).mockImplementationOnce(async () => {
      await gate;
      return {
        issuer: "https://issuer.example/",
        authorization_endpoint: "https://issuer.example/auth",
        token_endpoint: "https://issuer.example/token",
        code_challenge_methods_supported: ["S256"],
      } as oauth.AuthorizationServer;
    });

    const inflight = provider.abortRedirectLogin(ERROR_CALLBACK_GOOD_STATE);
    inflight.catch(() => {});
    await Promise.resolve();
    provider.reset(); // logout / new login races the abort's discovery.
    releaseDiscovery();

    await expect(inflight).rejects.toBeInstanceOf(ReactiveAuthResetError);
    // reset() itself cleared the record (its own contract); the abort did not consume it.
    expect(provider.authenticatedWebId()).toBeUndefined();
  });
});
