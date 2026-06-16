// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Exhaustive, security-critical tests for SILENT SESSION RESTORE in the
// WebIdDPoPTokenProvider — the DPoP-bound refresh-token persistence + the
// refresh_token-grant restore that lets a CLOSED-TAB REOPEN re-establish the
// session with NO popup/iframe.
//
// What is pinned here (the task's adversarial matrix for the provider half):
//   • a successful popup login PERSISTS the rotated refresh token + DPoP key,
//     WebID-scoped (keyed by issuer, carrying the authenticated WebID);
//   • the persisted record NEVER contains the access token, and the refresh token
//     is never logged;
//   • the authorization request opts into `offline_access` (so a refresh token is
//     issued) where the server supports it;
//   • restoreIssuer rebuilds the session via a refresh_token grant (a fetch) and
//     pins the issuer so a later upgrade reuses it without re-prompting;
//   • the refresh grant is DPoP-bound (a DPoP handle is passed) and signed by the
//     SAME persisted key the original token was bound to;
//   • a DEAD refresh token (grant rejected) → restoreIssuer returns undefined AND
//     CLEARS the dead persisted entry (no popup on restore);
//   • forgetPersisted (logout) drops the durable credential;
//   • reset() does NOT wipe the durable store (a re-login need not), but logout's
//     forgetPersisted does — so a signed-out account is not silently revived;
//   • WebID SCOPING: account A's persisted token (under A's issuer) never restores
//     account B (under B's issuer);
//   • the server-rotated refresh token is re-persisted (the next reload uses the
//     CURRENT credential, not a spent one).
//
// The whole OAuth/DPoP stack is mocked so this runs with no browser + no network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedSession, SessionStore } from "./session-persistence";

// A switch each test sets so the next authentication "returns" a chosen identity.
const authState = {
  webId: "https://alice.example/profile/card#me",
  accessToken: "tok-A",
  refreshToken: "rt-A" as string | undefined,
};

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));

vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => ["https://issuer.example/"],
}));

vi.mock("dpop", () => ({
  generateProof: vi.fn(async () => "dpop-proof"),
}));

// Capture the DPoP handle passed into the refresh grant so a test can assert the
// grant is DPoP-bound (proof-of-possession, not bare Bearer).
const refreshMock = vi.hoisted(() => ({
  grantOpts: [] as Array<{ DPoP?: unknown }>,
  // When set, the next refreshTokenGrantRequest rejects (a dead refresh token).
  reject: null as Error | null,
  // The DPoP handle the provider built for the refresh (asserts key continuity).
  lastDpopHandle: null as unknown,
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  return {
    allowInsecureRequests,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    expectNoNonce: Symbol("expectNoNonce"),
    nopkce: Symbol("nopkce"),
    // DPoP() returns a tagged handle so tests can recognise the SAME handle reused.
    DPoP: vi.fn((_client: unknown, key: unknown) => {
      const handle = { __dpop: true, key };
      refreshMock.lastDpopHandle = handle;
      return handle;
    }),
    isDPoPNonceError: () => false,
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: "https://issuer.example/",
      authorization_endpoint: "https://issuer.example/auth",
      token_endpoint: "https://issuer.example/token",
      code_challenge_methods_supported: ["S256"],
      // The server supports refresh tokens → the provider requests offline_access.
      scopes_supported: ["openid", "webid", "offline_access"],
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
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code" })),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => ({
      access_token: authState.accessToken,
      refresh_token: authState.refreshToken,
      expires_in: 3600,
    })),
    refreshTokenGrantRequest: vi.fn(async (..._args: unknown[]) => {
      // Record the grant options (arg index 4 is the request options carrying DPoP).
      refreshMock.grantOpts.push((_args[4] as { DPoP?: unknown }) ?? {});
      if (refreshMock.reject) throw refreshMock.reject;
      return {};
    }),
    processRefreshTokenResponse: vi.fn(async () => ({
      access_token: "tok-refreshed",
      // The server ROTATES the refresh token on each grant (RFC 9700 §4.14.2).
      refresh_token: "rt-rotated",
      expires_in: 3600,
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

const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";
const ISSUER = new URL("https://issuer.example/");
const REDIRECT = "https://app.example/callback.html?code=auth-code&state=state";

/** A simple in-memory SessionStore double, keyed by issuer (mirrors IndexedDB). */
function makeStore(): SessionStore & { map: Map<string, PersistedSession> } {
  const map = new Map<string, PersistedSession>();
  return {
    map,
    async get(issuer) {
      return map.get(issuer);
    },
    async put(session) {
      map.set(session.issuer, session);
    },
    async delete(issuer) {
      map.delete(issuer);
    },
  };
}

function makeProvider(store?: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => REDIRECT,
    async () => authState.webId,
    { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
  );
}

beforeEach(() => {
  authState.webId = WEBID_A;
  authState.accessToken = "tok-A";
  authState.refreshToken = "rt-A";
  refreshMock.grantOpts.length = 0;
  refreshMock.reject = null;
  refreshMock.lastDpopHandle = null;
});

describe("persistence on login", () => {
  it("PERSISTS the DPoP-bound refresh token + key (WebID-scoped) on a successful login", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    // A login (an upgrade that mints + attaches a token) establishes the session.
    await provider.upgrade(new Request("https://alice.example/storage/"));
    // Persistence is awaited inside #getSession; let the microtask settle.
    await Promise.resolve();

    const persisted = store.map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    expect(persisted?.issuer).toBe(ISSUER.href);
    expect(persisted?.webId).toBe(WEBID_A); // WebID-scoped
    expect(persisted?.refreshToken).toBe("rt-A");
    expect(persisted?.dpopKey).toBeDefined();
  });

  it("NEVER persists the access token (only the long-lived key-bound credential)", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();
    const persisted = store.map.get(ISSUER.href) as unknown as Record<string, unknown>;
    expect(persisted).toBeDefined();
    expect(persisted.accessToken).toBeUndefined();
    expect(JSON.stringify({ ...persisted, dpopKey: undefined })).not.toContain("tok-A");
  });

  it("does NOT persist when the server issued NO refresh token (in-memory only)", async () => {
    authState.refreshToken = undefined; // server issued no refresh token
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();
    expect(store.map.size).toBe(0); // nothing to restore from → not persisted
  });

  it("requests offline_access in the authorization URL where the server supports it", async () => {
    const store = makeStore();
    const getCode = vi.fn(async () => REDIRECT);
    const p2 = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      getCode,
      async () => authState.webId,
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );
    await p2.upgrade(new Request("https://alice.example/storage/"));
    const authUrl = new URL((getCode.mock.calls[0] as unknown[])[0] as URL);
    expect(authUrl.searchParams.get("scope")).toBe("openid webid offline_access");
  });
});

describe("restoreIssuer — silent refresh-token-grant restore (no popup)", () => {
  it("rebuilds the session from a persisted refresh token and reports the WebID", async () => {
    const store = makeStore();
    // Seed a persisted session as a prior login would have.
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });

    const provider = makeProvider(store);
    const oauth = await import("oauth4webapi");
    const before = (oauth.refreshTokenGrantRequest as ReturnType<typeof vi.fn>).mock.calls.length;
    const restored = await provider.restoreIssuer(ISSUER);
    expect(restored).toEqual({ webId: WEBID_A });
    // The refresh grant ran exactly once (a fetch) — NO getCode/popup was invoked.
    const after = (oauth.refreshTokenGrantRequest as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before + 1);
  });

  it("the restore is DPoP-BOUND (a DPoP handle is passed to the refresh grant — not bare Bearer)", async () => {
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });

    const provider = makeProvider(store);
    await provider.restoreIssuer(ISSUER);

    // The grant carried a DPoP handle, and it is the SAME handle the provider built
    // around the PERSISTED key (key continuity — RFC 9449 §4.3 sender-constraining).
    expect(refreshMock.grantOpts).toHaveLength(1);
    expect(refreshMock.grantOpts[0].DPoP).toBeDefined();
    expect(refreshMock.grantOpts[0].DPoP).toBe(refreshMock.lastDpopHandle);
    expect((refreshMock.lastDpopHandle as { key: unknown }).key).toBe(dpopKey);
  });

  it("pins the issuer so a SUBSEQUENT upgrade reuses the restored session (no re-prompt)", async () => {
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });

    // getWebId THROWS — proving the post-restore upgrade resolves from the pinned
    // issuer + cached session, never by re-prompting for a WebID.
    let getWebIdCalls = 0;
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => {
        getWebIdCalls += 1;
        throw new Error("No WebID set for login");
      },
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );
    await provider.restoreIssuer(ISSUER);
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.resolvedIssuer()).toBe(ISSUER.href);

    const upgraded = await provider.upgrade(new Request("https://alice.example/storage/"));
    // The refreshed access token is attached — and getWebId was never consulted.
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-refreshed");
    expect(getWebIdCalls).toBe(0);
  });

  it("re-persists the ROTATED refresh token (the next reload uses the current credential)", async () => {
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });

    const provider = makeProvider(store);
    await provider.restoreIssuer(ISSUER);
    // processRefreshTokenResponse rotated the token to "rt-rotated"; it must be the
    // persisted credential now (a spent "rt-A" would be rejected on the next load).
    expect(store.map.get(ISSUER.href)?.refreshToken).toBe("rt-rotated");
  });

  it("returns undefined + does NOT attempt a refresh grant when there is NO persisted session", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    const oauth = await import("oauth4webapi");
    // Snapshot the (suite-accumulated) call count, then prove restore added none.
    const before = (oauth.refreshTokenGrantRequest as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
    const after = (oauth.refreshTokenGrantRequest as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before); // no grant attempted (nothing to restore)
  });

  it("a DEAD refresh token (invalid_grant) → undefined AND the dead entry is CLEARED (no popup on restore)", async () => {
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });
    // oauth4webapi surfaces a token-endpoint OAuth error as a ResponseBodyError-shape
    // carrying `.error` — invalid_grant = expired / revoked / rotation-reuse.
    refreshMock.reject = Object.assign(new Error("invalid_grant"), { error: "invalid_grant" });

    const provider = makeProvider(store);
    const restored = await provider.restoreIssuer(ISSUER);
    expect(restored).toBeUndefined();
    // The dead entry was cleared so a doomed restore is not re-attempted next load.
    expect(store.map.has(ISSUER.href)).toBe(false);
  });

  it("a TRANSIENT failure (NOT invalid_grant) → undefined but PRESERVES the credential (finding 2)", async () => {
    // A network/discovery/5xx blip on load must NOT erase an otherwise-valid refresh
    // token — that would force a needless re-login. The entry survives for a retry;
    // THIS load just falls back to login (silently — no popup on restore).
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });
    refreshMock.reject = new Error("network timeout"); // transient, no OAuth error field

    const provider = makeProvider(store);
    const restored = await provider.restoreIssuer(ISSUER);
    expect(restored).toBeUndefined();
    // The credential is PRESERVED — a transient error did not wipe a valid token.
    expect(store.map.get(ISSUER.href)?.refreshToken).toBe("rt-A");
  });

  it("returns undefined (in-memory-only) when the provider has NO session store", async () => {
    const provider = makeProvider(); // no store
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
  });
});

describe("logout clears the durable credential; reset() does not", () => {
  it("forgetPersisted drops the persisted refresh token + key for the issuer", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();
    expect(store.map.has(ISSUER.href)).toBe(true);

    await provider.forgetPersisted(ISSUER);
    expect(store.map.has(ISSUER.href)).toBe(false);
  });

  it("reset() (a re-login's identity-change) does NOT wipe the durable store", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();
    expect(store.map.has(ISSUER.href)).toBe(true);

    // reset() clears IN-MEMORY state only — the durable credential survives so a
    // re-login need not re-mint it. Logout is the path that calls forgetPersisted.
    provider.reset();
    expect(store.map.has(ISSUER.href)).toBe(true);
    expect(provider.authenticatedWebId()).toBeUndefined(); // in-memory cleared
    expect(provider.resolvedIssuer()).toBeUndefined();
  });
});

describe("WebID scoping — account A's persisted token never restores account B", () => {
  it("a restore for B's issuer rebuilds B's session, leaving A's persisted entry untouched", async () => {
    const store = makeStore();
    const issuerB = new URL("https://issuer-b.example/");
    const keyA = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const keyB = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    // Two accounts, each under its OWN issuer key.
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey: keyA,
    });
    store.map.set(issuerB.href, {
      issuer: issuerB.href,
      webId: WEBID_B,
      refreshToken: "rt-B",
      dpopKey: keyB,
    });

    // Restoring B's issuer authenticates AS B (the id_token claims read authState).
    authState.webId = WEBID_B;
    const provider = makeProvider(store);
    const restored = await provider.restoreIssuer(issuerB);
    expect(restored).toEqual({ webId: WEBID_B });
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
    expect(provider.authenticatedWebId()).not.toBe(WEBID_A);
    // A's persisted credential (under A's issuer key) is wholly untouched.
    expect(store.map.get(ISSUER.href)?.webId).toBe(WEBID_A);
    expect(store.map.get(ISSUER.href)?.refreshToken).toBe("rt-A");
  });

  it("the refresh grant for an issuer redeems THAT issuer's token only (per-issuer credential)", async () => {
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });

    const provider = makeProvider(store);
    await provider.restoreIssuer(ISSUER);
    const oauth = await import("oauth4webapi");
    // arg index 3 of refreshTokenGrantRequest is the refresh token redeemed.
    const grantCall = (oauth.refreshTokenGrantRequest as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    );
    expect(grantCall?.[3]).toBe("rt-A"); // A's token — never some other account's
  });
});
