// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @vitest-environment node
//
// roborev findings 1 + 2 on the POPUP login path (#authenticate via upgrade()):
//
//  FINDING 1 (HIGH — cross-account credential persistence before WebID-match):
//    the popup persist (#persistSession) used to write the issued refresh credential
//    keyed by issuer with webId = the OP-AUTHENTICATED WebID — BEFORE the caller
//    proves it matches the REQUESTED WebID. If the OP has a live session for a
//    DIFFERENT account it returns THAT account's tokens; the React login then fails
//    closed + calls reset(), but reset() deliberately does NOT clear the durable
//    store — so the WRONG account's refresh credential is LEFT PERSISTED. The fix:
//    #persistSession persists ONLY when webIdsEqual(authenticated, requested). This
//    test drives a popup login where the OP authenticates a DIFFERENT WebID than
//    requested and asserts the store has NO entry afterward — and proves
//    ADVERSARIALLY that without the gate the credential WOULD leak.
//
//  FINDING 2 (Medium — offline_access → invalid_scope regression): #authenticate now
//    requests `openid webid offline_access`. An OP that rejects unknown scopes with
//    `invalid_scope` would fail a login that previously worked with `openid webid`.
//    The fix: on `invalid_scope`, retry ONCE without offline_access — login SUCCEEDS,
//    just with no refresh token / no silent restore. This test stubs an OP that
//    rejects the offline request but succeeds for `openid webid` and asserts login
//    succeeds (no throw) with NOTHING persisted.
//
// The heavy oauth/DPoP/fetch-rdf stack is mocked exactly as webid-token-provider.test.ts
// does, so this runs with no browser/network. A module-level `authState` switch lets
// each test choose the requested vs authenticated WebID and whether the OP rejects the
// offline_access scope.
import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";
const ISSUER = "https://issuer.example/";
const CLIENT_ID = "https://app.example/clientid.jsonld";
const REDIRECT_OK = "https://app.example/callback.html?code=auth-code&state=state";

// The requested WebID (what getWebId / the user asks for), the OP-authenticated WebID
// (the id_token claim), the access/refresh tokens, and whether the OP rejects the
// offline_access scope with `invalid_scope`. Each test sets these in its own setup.
const authState = {
  requestedWebId: WEBID_A,
  authenticatedWebId: WEBID_A,
  accessToken: "tok-A",
  refreshToken: "rt-A" as string | undefined,
  // When true, the FIRST authorization response (the one carrying offline_access)
  // fails with `invalid_scope`; the retry without offline_access succeeds.
  rejectOfflineScope: false,
};

// Records the scope of the most recent authorization URL getCode was handed, so the
// validateAuthResponse mock can decide whether THIS round requested offline_access.
const lastAuthScope = { value: "" };

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));

vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => [ISSUER],
}));

vi.mock("dpop", () => ({
  generateProof: vi.fn(async () => "dpop-proof"),
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  // A minimal AuthorizationResponseError stand-in carrying `.error` — matched
  // structurally by the provider's isInvalidScopeError / interaction-retry helpers.
  class AuthorizationResponseError extends Error {
    error: string;
    constructor(error: string) {
      super(error);
      this.error = error;
    }
  }
  return {
    allowInsecureRequests,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    expectNoNonce: Symbol("expectNoNonce"),
    nopkce: Symbol("nopkce"),
    DPoP: () => ({}),
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}auth`,
      token_endpoint: `${ISSUER}token`,
      code_challenge_methods_supported: ["S256"],
    })),
    dynamicClientRegistrationRequest: vi.fn(),
    processDynamicClientRegistrationResponse: vi.fn(),
    generateKeyPair: vi.fn(async (_alg: string, opts?: { extractable?: boolean }) =>
      crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        opts?.extractable ?? false,
        ["sign", "verify"],
      ),
    ),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    // Throw `invalid_scope` for the round that requested offline_access when the test
    // asked the OP to reject it; otherwise return a normal code params object.
    validateAuthResponse: vi.fn(() => {
      if (authState.rejectOfflineScope && lastAuthScope.value.includes("offline_access")) {
        throw new AuthorizationResponseError("invalid_scope");
      }
      return new URLSearchParams({ code: "auth-code" });
    }),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => ({
      access_token: authState.accessToken,
      // A refresh token is issued ONLY when offline_access was honoured (the round
      // that succeeded requested it). The no-offline retry returns none.
      ...(lastAuthScope.value.includes("offline_access") && authState.refreshToken
        ? { refresh_token: authState.refreshToken }
        : {}),
      expires_in: 3600,
    })),
    getValidatedIdTokenClaims: vi.fn(() => ({
      iss: ISSUER,
      sub: authState.authenticatedWebId,
      webid: authState.authenticatedWebId,
      aud: "client",
      iat: 0,
      exp: 0,
    })),
    AuthorizationResponseError,
  };
});

const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");

class MemorySessionStore implements SessionStore {
  readonly map = new Map<string, PersistedSession>();
  async get(issuer: string) {
    return this.map.get(issuer);
  }
  async put(s: PersistedSession) {
    this.map.set(s.issuer, s);
  }
  async delete(issuer: string) {
    this.map.delete(issuer);
  }
}

/**
 * getCode records the scope of the authorization URL it is handed (so
 * validateAuthResponse / the token grant can branch on offline_access) and returns the
 * canned success redirect.
 */
const getCode = vi.fn(async (uri: URL) => {
  lastAuthScope.value = uri.searchParams.get("scope") ?? "";
  return REDIRECT_OK;
});

function makeProvider(store: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    getCode,
    async () => authState.requestedWebId,
    { clientId: CLIENT_ID, sessionStore: store },
  );
}

beforeEach(() => {
  authState.requestedWebId = WEBID_A;
  authState.authenticatedWebId = WEBID_A;
  authState.accessToken = "tok-A";
  authState.refreshToken = "rt-A";
  authState.rejectOfflineScope = false;
  lastAuthScope.value = "";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FINDING 1 — popup persist is gated on the OP-authenticated WebID matching the requested one", () => {
  it("persists the refresh credential when the OP authenticates the SAME WebID that was requested", async () => {
    // Baseline / control: requested == authenticated → the credential IS persisted (so
    // the mismatch test below is meaningful — it proves the gate, not a broken persist).
    authState.requestedWebId = WEBID_A;
    authState.authenticatedWebId = WEBID_A;
    const store = new MemorySessionStore();
    const provider = makeProvider(store);

    const req = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(req.headers.get("Authorization")).toBe("DPoP tok-A");
    // The matching login persisted the credential for restore.
    const persisted = await store.get(ISSUER);
    expect(persisted).toBeDefined();
    expect(persisted?.webId).toBe(WEBID_A);
    expect(persisted?.refreshToken).toBe("rt-A");
  });

  it("does NOT persist when the OP authenticates a DIFFERENT WebID than requested (the leak does not happen)", async () => {
    // The user asks to log in as alice, but the OP has a live session for bob and
    // returns BOB's tokens. The popup upgrade still attaches a token (the React login
    // will then fail closed on the WebID-mismatch and reset()), but the durable store
    // must be LEFT EMPTY — reset() does not clear it, so persisting here would leak
    // bob's refresh credential for a later silent restore.
    authState.requestedWebId = WEBID_A;
    authState.authenticatedWebId = WEBID_B;
    const store = new MemorySessionStore();
    const provider = makeProvider(store);

    await provider.upgrade(new Request("https://alice.example/storage/"));

    // THE ASSERTION: no entry for the issuer — the wrong account's credential did NOT leak.
    expect(await store.get(ISSUER)).toBeUndefined();
    expect(store.map.size).toBe(0);
  });

  // ADVERSARIAL: prove the assertion above is load-bearing. Re-implement EXACTLY the
  // persist body WITHOUT the webIdsEqual gate and show the wrong account's credential
  // DOES land in the store — i.e. the test would FAIL (store non-empty) if the gate
  // were removed. Then confirm the REAL provider keeps the store empty.
  it("WITHOUT the WebID-match gate, the wrong account's credential LEAKS into the store (the failure the gate prevents)", async () => {
    authState.requestedWebId = WEBID_A;
    authState.authenticatedWebId = WEBID_B;

    // The un-gated persist the provider USED to do: write keyed by issuer with the
    // OP-authenticated (wrong) WebID, regardless of whether it matches the requested one.
    const leaked = new MemorySessionStore();
    const dpopKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    async function ungatedPersist() {
      // MISSING: if (!webIdsEqual(authenticatedWebId, requestedWebId)) return;  ← the gate.
      await leaked.put({
        issuer: ISSUER,
        webId: authState.authenticatedWebId, // bob's WebID — the wrong account.
        refreshToken: "rt-B",
        dpopKey,
        clientId: CLIENT_ID,
      });
    }
    await ungatedPersist();
    // The un-gated path LEAKS: bob's credential is in the store under alice's login.
    expect(await leaked.get(ISSUER)).toBeDefined();
    expect((await leaked.get(ISSUER))?.webId).toBe(WEBID_B);

    // The REAL provider closes it: the same mismatch leaves the store empty.
    const real = new MemorySessionStore();
    const provider = makeProvider(real);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(await real.get(ISSUER)).toBeUndefined(); // gate ran — no leak.
  });
});

describe("FINDING 2 — invalid_scope on offline_access retries once without it (login still succeeds, no restore)", () => {
  it("login SUCCEEDS (token attached) when the OP rejects offline_access, and NOTHING is persisted", async () => {
    authState.requestedWebId = WEBID_A;
    authState.authenticatedWebId = WEBID_A;
    authState.rejectOfflineScope = true; // OP fails the offline round with invalid_scope.
    const store = new MemorySessionStore();
    const provider = makeProvider(store);

    // No throw — the upgrade attaches the access token via the reduced-scope retry.
    const req = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(req.headers.get("Authorization")).toBe("DPoP tok-A");

    // getCode was called TWICE: once with offline_access (rejected), once without (ok).
    expect(getCode).toHaveBeenCalledTimes(2);
    const scopes = getCode.mock.calls.map((c) => (c[0] as URL).searchParams.get("scope"));
    expect(scopes[0]).toBe("openid webid offline_access");
    expect(scopes[1]).toBe("openid webid");

    // No refresh token was issued on the reduced scope → NOTHING persisted (no restore).
    expect(await store.get(ISSUER)).toBeUndefined();
  });

  it("an UNKNOWN authorization error (not invalid_scope) is NOT swallowed — it still throws", async () => {
    // Guard against the fallback over-catching: a non-invalid_scope error must propagate.
    authState.requestedWebId = WEBID_A;
    authState.authenticatedWebId = WEBID_A;
    const oauth = await import("oauth4webapi");
    // The mocked AuthorizationResponseError takes `(error)` (see the vi.mock factory);
    // cast around the real class's wider constructor signature — runtime uses the mock.
    const AuthResponseError = oauth.AuthorizationResponseError as unknown as new (
      error: string,
    ) => Error;
    vi.mocked(oauth.validateAuthResponse).mockImplementationOnce(() => {
      throw new AuthResponseError("server_error");
    });
    const store = new MemorySessionStore();
    const provider = makeProvider(store);
    await expect(provider.upgrade(new Request("https://alice.example/storage/"))).rejects.toThrow();
  });
});
