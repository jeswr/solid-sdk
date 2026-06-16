// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Exhaustive, security-critical tests for SILENT SESSION RESTORE in the
// WebIdDPoPTokenProvider — the DPoP-bound refresh-token persistence at login plus
// the thin `restoreIssuer` wrapper over the audited `@jeswr/solid-session-restore`
// `restoreSession` that lets a CLOSED-TAB REOPEN re-establish the session with NO
// popup/iframe.
//
// What is pinned here (pod-money's half of the adversarial matrix — the package owns
// the grant + the invalid_grant-vs-transient classification, exhaustively tested
// upstream; here we pin the PROVIDER WIRING around it):
//   • a successful popup login REQUESTS `offline_access` (so a refresh token is
//     issued) where the server supports it AND a store is wired;
//   • a successful popup login PERSISTS the rotated refresh token + DPoP key,
//     WebID-scoped (keyed by issuer, carrying the authenticated WebID);
//   • the persisted record NEVER contains the access token (only the long-lived,
//     key-bound credential), and the DPoP key is non-extractable;
//   • restoreIssuer pins the rebuilt session + issuer on success (so a later 401
//     upgrade reuses it without re-prompting), and returns the authenticated WebID;
//   • restoreIssuer obeys the generation fence: a reset() racing the grant discards
//     the rebuilt session (it belongs to a superseded load);
//   • a TRANSIENT failure PRESERVES the persisted credential; a DEFINITIVE
//     invalid_grant thrown to the wrapper CLEARS it (defence-in-depth — the package
//     also clears, but the wrapper must not preserve a known-dead token);
//   • forgetPersisted (logout) drops the durable credential; hasPersisted is a
//     faithful tri-state.
//
// The package's restore grant is MOCKED so this is a focused unit of pod-money's
// wiring; the OAuth/DPoP/profile-fetch stack is mocked for the login-persistence
// tests so they run with no browser + no network.
import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Control the package's restore grant + lifecycle from each test ───────────
const restoreMock = vi.hoisted(() => ({
  // The RestoredSession the next restoreSession() resolves to (undefined = nothing).
  result: undefined as
    | { webId: string; accessToken: string; refreshToken: string; issuer: string }
    | undefined,
  // When set, the next restoreSession() REJECTS (an unexpected wiring error).
  reject: null as Error | null,
  // Set true by the test to make isInvalidGrantError treat `reject` as definitive.
  rejectIsInvalidGrant: false,
  // A hook the test installs to fire DURING the grant await (to race a reset()).
  onEnter: null as (() => void) | null,
  // Issuers forgetPersisted was called for (asserts the dead-token/logout cleanup).
  forgotten: [] as string[],
  // The options each restoreSession() received (asserts clientId / loopback wiring).
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@jeswr/solid-session-restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/solid-session-restore")>();
  return {
    ...actual,
    restoreSession: vi.fn(async (opts: Record<string, unknown>) => {
      restoreMock.calls.push(opts);
      restoreMock.onEnter?.();
      if (restoreMock.reject) throw restoreMock.reject;
      const r = restoreMock.result;
      return r === undefined
        ? undefined
        : {
            webId: r.webId,
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
            dpopKey: { privateKey: {}, publicKey: {} } as unknown as CryptoKeyPair,
            dpopHandle: {} as never,
            expiresAt: undefined,
            issuer: r.issuer,
          };
    }),
    forgetPersisted: vi.fn(async (_store: SessionStore, issuer: URL) => {
      restoreMock.forgotten.push(issuer.href);
    }),
    isInvalidGrantError: vi.fn(() => restoreMock.rejectIsInvalidGrant),
  };
});

// ── Mock the OAuth/DPoP/profile stack so #authenticate is controllable ───────
// `webId` is the REQUESTED WebID (what getWebId returns); `authenticatedWebId` is
// the WebID the OP's id_token vouches for. They are equal for a normal login and
// DIFFER for the cross-identity (WebID-mismatch) test.
const authState = {
  webId: "https://alice.example/profile/card#me",
  authenticatedWebId: null as string | null,
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

// Capture the authorization-URL scope each login built, so a test can assert
// `offline_access` is requested (the precondition for a refresh token).
// `refreshByAttempt`, when set, returns a per-exchange-attempt refresh token (index 0
// = first/`prompt=none` attempt, 1 = the consent retry); else `authState.refreshToken`.
// `attempt` counts processAuthorizationCodeResponse calls so a test can assert the
// consent retry actually ran.
const oauthMock = vi.hoisted(() => ({
  scopes: [] as string[],
  keyExtractable: [] as boolean[],
  refreshByAttempt: null as (string | undefined)[] | null,
  attempt: 0,
  // The 0-based authorization round-trip indices (validateAuthResponse calls) that
  // should THROW an interaction error (e.g. [0] = the silent prompt=none attempt).
  validateAttempt: 0,
}));
// Which authorization round-trips throw consent_required (a separate holder so the
// hoisted mock factory can read it; `throwOnAttempt` is a list of 0-based indices).
const oauthErrors = vi.hoisted(() => ({ throwOnAttempt: [] as number[] }));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  class AuthorizationResponseError extends Error {
    error: string;
    constructor(code: string) {
      super(code);
      this.error = code;
    }
  }
  return {
    allowInsecureRequests,
    AuthorizationResponseError,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    nopkce: Symbol("nopkce"),
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: "https://issuer.example/",
      authorization_endpoint: "https://issuer.example/auth",
      token_endpoint: "https://issuer.example/token",
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "webid", "offline_access"],
    })),
    DPoP: vi.fn(() => ({ __dpop: true })),
    isDPoPNonceError: () => false,
    dynamicClientRegistrationRequest: vi.fn(),
    processDynamicClientRegistrationResponse: vi.fn(),
    generateKeyPair: vi.fn(async (_alg: string, opts?: { extractable?: boolean }) => {
      oauthMock.keyExtractable.push(opts?.extractable ?? true);
      return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ]);
    }),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    validateAuthResponse: vi.fn(() => {
      const i = oauthMock.validateAttempt;
      oauthMock.validateAttempt += 1;
      if (oauthErrors.throwOnAttempt.includes(i)) {
        throw new AuthorizationResponseError("consent_required");
      }
      return new URLSearchParams({ code: "abc" });
    }),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => {
      const i = oauthMock.attempt;
      oauthMock.attempt += 1;
      const refresh_token = oauthMock.refreshByAttempt
        ? oauthMock.refreshByAttempt[i]
        : authState.refreshToken;
      return { access_token: authState.accessToken, refresh_token, expires_in: 3600 };
    }),
    getValidatedIdTokenClaims: vi.fn(() => ({
      webid: authState.authenticatedWebId ?? authState.webId,
    })),
    expectNoNonce: Symbol("expectNoNonce"),
  };
});

// Capture the scope built into the authorization URL (the auth endpoint is mocked,
// so the provider hands the URL to getCode — we read it there).
const capturedScopes: string[] = [];
const getCode = vi.fn(async (url: URL) => {
  capturedScopes.push(new URL(url).searchParams.get("scope") ?? "");
  return "https://app.example/callback?code=abc&state=state";
});

// Import AFTER the mocks are registered.
const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");

/** A real in-memory SessionStore double — exercises store.put/get/delete directly. */
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

const ISSUER = "https://issuer.example/";
const ALICE = "https://alice.example/profile/card#me";

// A hook fired on each getWebId() call (with the 0-based call index) so a test can
// race a reset() into the persist window (getWebId is called again there). Set per test.
let onGetWebId: ((callIndex: number) => void) | null = null;
let getWebIdCalls = 0;

function makeProvider(store?: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback",
    getCode,
    async () => {
      onGetWebId?.(getWebIdCalls);
      getWebIdCalls += 1;
      return authState.webId;
    },
    {
      clientId: "https://app.example/clientid.jsonld",
      allowInsecureLoopback: false,
      profileFetch: vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      sessionStore: store,
    },
  );
}

/** Drive a popup login to completion via an upgrade() of a 401-ish request. */
async function loginViaUpgrade(provider: InstanceType<typeof WebIdDPoPTokenProvider>) {
  const req = new Request("https://alice.example/private");
  await provider.upgrade(req);
}

beforeEach(() => {
  restoreMock.result = undefined;
  restoreMock.reject = null;
  restoreMock.rejectIsInvalidGrant = false;
  restoreMock.onEnter = null;
  restoreMock.forgotten = [];
  restoreMock.calls = [];
  authState.webId = ALICE;
  authState.authenticatedWebId = null;
  authState.accessToken = "tok-A";
  authState.refreshToken = "rt-A";
  oauthMock.scopes = [];
  oauthMock.keyExtractable = [];
  oauthMock.refreshByAttempt = null;
  oauthMock.attempt = 0;
  oauthMock.validateAttempt = 0;
  oauthErrors.throwOnAttempt = [];
  onGetWebId = null;
  getWebIdCalls = 0;
  capturedScopes.length = 0;
  getCode.mockClear();
});

describe("WebIdDPoPTokenProvider — silent-restore persistence (login side)", () => {
  it("requests offline_access when the server supports it AND a store is wired", async () => {
    const provider = makeProvider(makeStore());
    await loginViaUpgrade(provider);
    expect(capturedScopes.some((s) => s.includes("offline_access"))).toBe(true);
  });

  it("does NOT request offline_access when no store is wired (in-memory-only)", async () => {
    const provider = makeProvider(undefined);
    await loginViaUpgrade(provider);
    expect(capturedScopes.every((s) => !s.includes("offline_access"))).toBe(true);
  });

  it("persists the rotated refresh token + key (WebID-scoped) — never the access token", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    const persisted = store.map.get(ISSUER);
    expect(persisted).toBeDefined();
    expect(persisted?.webId).toBe(ALICE);
    expect(persisted?.refreshToken).toBe("rt-A");
    expect(persisted?.clientId).toBe("https://app.example/clientid.jsonld");
    // The ACCESS token is NEVER written to the durable store.
    expect(JSON.stringify(persisted)).not.toContain("tok-A");
    expect((persisted as unknown as { accessToken?: string }).accessToken).toBeUndefined();
  });

  it("generates a NON-extractable DPoP key for the persisted credential", async () => {
    const provider = makeProvider(makeStore());
    await loginViaUpgrade(provider);
    // The popup login's key (the one persisted) must be non-extractable.
    expect(oauthMock.keyExtractable).toContain(false);
    expect(oauthMock.keyExtractable.every((e) => e === false)).toBe(true);
  });

  it("does NOT persist when the server issued no refresh token", async () => {
    authState.refreshToken = undefined;
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    expect(store.map.get(ISSUER)).toBeUndefined();
  });

  it("retries with consent when prompt=none SUCCEEDS but drops the refresh token, then persists it", async () => {
    // The OP silently grants login (no interaction error) but omits the refresh token
    // because offline_access needs consent. The provider must retry ONCE interactively
    // (prompt=consent) to obtain the refresh token, then persist it — otherwise silent
    // restore would never work for this user. (roborev finding)
    oauthMock.refreshByAttempt = [undefined, "rt-after-consent"]; // none, then granted
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    // The consent retry ran (two token exchanges) and obtained + persisted the token.
    expect(oauthMock.attempt).toBe(2);
    expect(store.map.get(ISSUER)?.refreshToken).toBe("rt-after-consent");
    // The retry URL carried prompt=consent (the second authorization URL built).
    expect(capturedScopes.length).toBe(2);
  });

  it("BEST-EFFORT consent retry: a DECLINED offline-consent retry still yields a (in-memory) login", async () => {
    // The silent prompt=none attempt SUCCEEDS but returns no refresh token; the
    // consent retry is then DECLINED (the 2nd authorization round-trip throws). The
    // login must NOT fail — keep the valid silent access token (in-memory session),
    // just with no durable credential / silent restore. (roborev finding)
    oauthMock.refreshByAttempt = [undefined, "would-be"]; // silent: none; retry: never processed
    oauthErrors.throwOnAttempt = [1]; // the consent retry's authorization is declined
    const store = makeStore();
    const provider = makeProvider(store);
    // The login resolves (does NOT throw) even though offline consent was declined —
    // a rejection here would fail the test. The upgraded Request proves the login ran.
    const upgraded = await provider.upgrade(new Request("https://alice.example/private"));
    expect(upgraded).toBeInstanceOf(Request);
    // The session authenticated AS the user (in-memory), but nothing durable persisted.
    expect(provider.authenticatedWebId()).toBe(ALICE);
    expect(store.map.size).toBe(0);
  });

  it("does NOT fire a SECOND consent prompt when the interactive attempt still returns no refresh token", async () => {
    // The silent prompt=none attempt THROWS consent_required → the catch runs ONE
    // interactive exchange, which still returns no refresh token (the OP never grants
    // offline_access). The no-refresh retry must NOT fire again — at most ONE
    // interactive consent prompt total. (roborev finding)
    oauthErrors.throwOnAttempt = [0]; // first exchange throws consent_required
    oauthMock.refreshByAttempt = [undefined, undefined, "would-be-third"]; // never reached
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    // Exactly TWO exchanges: the (thrown) silent attempt's processAuth never ran, so
    // attempt counts the interactive one only — and crucially NO third exchange fired.
    expect(oauthMock.attempt).toBeLessThanOrEqual(1 + 1);
    // getCode (one per authorization round-trip) was called at most twice — never a
    // second consent prompt after the interactive attempt.
    expect(getCode.mock.calls.length).toBeLessThanOrEqual(2);
    // No refresh token was ever granted → nothing durable persisted (in-memory only).
    expect(store.map.size).toBe(0);
  });

  it("SECURITY: does NOT persist a durable credential when the OP authenticated a DIFFERENT WebID", async () => {
    // The user requested ALICE, but the OP's id_token vouches for MALLORY (a live IdP
    // session for another account). The popup login is rejected one layer up — but a
    // durable refresh token for the WRONG identity must NEVER be written (it would let
    // a silent restore revive the wrong account). The provider's WebID-binding guard
    // in #persist (fail-closed) is what prevents it. (roborev High finding)
    const MALLORY = "https://mallory.evil/profile/card#me";
    authState.webId = ALICE; // requested
    authState.authenticatedWebId = MALLORY; // what the OP returned
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    // The mismatched identity left NO durable credential, under EITHER issuer key.
    expect(store.map.size).toBe(0);
  });
});

describe("WebIdDPoPTokenProvider.restoreIssuer — the thin restore wrapper", () => {
  it("returns undefined with no store (silent restore unavailable)", async () => {
    const provider = makeProvider(undefined);
    await expect(provider.restoreIssuer(new URL(ISSUER))).resolves.toBeUndefined();
  });

  it("pins the rebuilt session + issuer on a successful grant", async () => {
    restoreMock.result = {
      webId: ALICE,
      accessToken: "fresh",
      refreshToken: "rt-B",
      issuer: ISSUER,
    };
    const provider = makeProvider(makeStore());
    const out = await provider.restoreIssuer(new URL(ISSUER));
    expect(out).toEqual({ webId: ALICE });
    // The issuer is pinned + the authenticated WebID published, so a later upgrade
    // reuses the restored session without re-prompting.
    expect(provider.resolvedIssuer()).toBe(ISSUER);
    expect(provider.authenticatedWebId()).toBe(ALICE);
    // The restore was DPoP-bound + ran as the static client (the README contract).
    expect(restoreMock.calls[0]?.clientId).toBe("https://app.example/clientid.jsonld");
  });

  it("returns undefined when the grant yields nothing (dead/absent token)", async () => {
    restoreMock.result = undefined;
    const provider = makeProvider(makeStore());
    await expect(provider.restoreIssuer(new URL(ISSUER))).resolves.toBeUndefined();
    // Nothing pinned — the caller falls back to login.
    expect(provider.authenticatedWebId()).toBeUndefined();
  });

  it("FENCE: a reset() racing the grant discards the rebuilt session", async () => {
    restoreMock.result = {
      webId: ALICE,
      accessToken: "fresh",
      refreshToken: "rt-B",
      issuer: ISSUER,
    };
    const provider = makeProvider(makeStore());
    // Fire reset() the instant the grant is entered — it advances the generation, so
    // the restore that resolves AFTER it must NOT pin a superseded identity.
    restoreMock.onEnter = () => provider.reset();
    const out = await provider.restoreIssuer(new URL(ISSUER));
    expect(out).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.resolvedIssuer()).toBeUndefined();
  });

  it("PRESERVES the credential on a TRANSIENT failure (no forget)", async () => {
    restoreMock.reject = new Error("network blip");
    restoreMock.rejectIsInvalidGrant = false;
    const provider = makeProvider(makeStore());
    await expect(provider.restoreIssuer(new URL(ISSUER))).resolves.toBeUndefined();
    // A transient blip must NOT erase an otherwise-valid credential.
    expect(restoreMock.forgotten).toEqual([]);
  });

  it("CLEARS the credential on a definitive invalid_grant thrown to the wrapper", async () => {
    restoreMock.reject = Object.assign(new Error("dead"), { error: "invalid_grant" });
    restoreMock.rejectIsInvalidGrant = true;
    const provider = makeProvider(makeStore());
    await expect(provider.restoreIssuer(new URL(ISSUER))).resolves.toBeUndefined();
    // A definitively-dead token is forgotten so a doomed restore is not retried.
    expect(restoreMock.forgotten).toEqual([ISSUER]);
  });
});

describe("WebIdDPoPTokenProvider — durable lifecycle (logout / presence)", () => {
  it("forgetPersisted drops the durable credential", async () => {
    const provider = makeProvider(makeStore());
    await provider.forgetPersisted(new URL(ISSUER));
    expect(restoreMock.forgotten).toEqual([ISSUER]);
  });

  it("hasPersisted is a faithful tri-state", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await expect(provider.hasPersisted(new URL(ISSUER))).resolves.toBe("absent");
    store.map.set(ISSUER, {
      issuer: ISSUER,
      webId: ALICE,
      refreshToken: "rt",
      dpopKey: {} as CryptoKeyPair,
    });
    await expect(provider.hasPersisted(new URL(ISSUER))).resolves.toBe("present");
    // A store read FAILURE → "unknown" (never "absent" → never orphans a credential).
    const flaky = makeProvider({
      get: async () => {
        throw new Error("idb error");
      },
      put: async () => {},
      delete: async () => {},
    });
    await expect(flaky.hasPersisted(new URL(ISSUER))).resolves.toBe("unknown");
  });

  it("hasPersistedForWebId is WebID-scoped: 'present' only when the stored record matches", async () => {
    const MALLORY = "https://mallory.evil/profile/card#me";
    const store = makeStore();
    const provider = makeProvider(store);
    // No record yet → absent for any WebID.
    await expect(provider.hasPersistedForWebId(new URL(ISSUER), ALICE)).resolves.toBe("absent");
    // A credential left by ALICE under this issuer.
    store.map.set(ISSUER, {
      issuer: ISSUER,
      webId: ALICE,
      refreshToken: "rt",
      dpopKey: {} as CryptoKeyPair,
    });
    // Present for ALICE...
    await expect(provider.hasPersistedForWebId(new URL(ISSUER), ALICE)).resolves.toBe("present");
    // ...but ABSENT for MALLORY (a prior account's credential on the SAME issuer must
    // NEVER be mis-claimed for a different WebID — the cross-account pointer bug).
    await expect(provider.hasPersistedForWebId(new URL(ISSUER), MALLORY)).resolves.toBe("absent");
    // A store read FAILURE → "unknown" (never "absent" → never orphans a pointer).
    const flaky = makeProvider({
      get: async () => {
        throw new Error("idb error");
      },
      put: async () => {},
      delete: async () => {},
    });
    await expect(flaky.hasPersistedForWebId(new URL(ISSUER), ALICE)).resolves.toBe("unknown");
  });

  it("reset() does NOT wipe the durable store (a re-login need not re-prompt)", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await loginViaUpgrade(provider);
    expect(store.map.get(ISSUER)).toBeDefined();
    provider.reset();
    // reset() is IN-MEMORY only — the durable credential survives a re-login.
    expect(store.map.get(ISSUER)).toBeDefined();
  });

  it("POST-WRITE FENCE: a reset() racing the persist window rolls back the superseded write", async () => {
    // A reset()/logout fires DURING the persist window (the getWebId() awaited just
    // before #persist). The credential written for the now-SUPERSEDED identity must
    // NOT survive — the post-write fence deletes it so a later silent restore can't
    // revive a logged-out account. (roborev finding)
    const store = makeStore();
    const provider = makeProvider(store);
    // Fire reset() on the SECOND getWebId() call (the persist window; the first is
    // issuer resolution), so the generation advances before #persist's post-fence.
    onGetWebId = (callIndex) => {
      if (callIndex === 1) provider.reset();
    };
    // upgrade() itself rejects (ReactiveAuthResetError) when a reset races it — that
    // is EXPECTED; we only care that the durable write was rolled back. The persist
    // `.then` (where the rollback runs) is part of the awaited session chain, so it
    // has settled by the time the rejection surfaces.
    await expect(loginViaUpgrade(provider)).rejects.toThrow();
    // The superseded write was rolled back — no durable credential remains.
    expect(store.map.get(ISSUER)).toBeUndefined();
  });
});
