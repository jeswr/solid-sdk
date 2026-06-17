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
import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    // The oauth4webapi `customFetch` request-option symbol (task #123 re-entrancy guard):
    // `#httpOptions` pins every OIDC request's fetch to the provider's pristine fetch via
    // `[oauth.customFetch]`. The mock must export the symbol so that option key is real.
    customFetch: Symbol("customFetch"),
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
    dynamicClientRegistrationRequest: vi.fn(async () => ({})),
    // A server-assigned dynamic client (the no-static-clientId fallback path).
    processDynamicClientRegistrationResponse: vi.fn(async () => ({
      client_id: "dyn-client-id",
      token_endpoint_auth_method: "none",
    })),
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

const { WebIdDPoPTokenProvider, ReactiveAuthResetError } = await import("./webid-token-provider");

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

  it("a restore's rotated put is SERIALISED + fenced: it cannot revive a signed-out account (roborev HIGH)", async () => {
    // restoreSession re-persists the ROTATED credential. That write now goes through the
    // provider's #serializedStore adapter, so it (a) runs on #storeOps — strictly after
    // a logout's queued delete (FIFO), never racing ahead — and (b) is generation-fenced
    // on the restore's captured generation. The realistic revival bug: a logout enqueues
    // a (slow) delete AND advances the generation (reset), then a restore in flight tries
    // to re-persist the rotated token. Serialization makes the put run AFTER the delete
    // (so it would otherwise REVIVE the just-deleted account); the generation fence is
    // what saves it — by the time the queued put op runs, the generation has advanced, so
    // it is SKIPPED. Prove both: no revival.
    const map = new Map<string, PersistedSession>();
    const order: string[] = [];
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteParked = false;
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const store: SessionStore = {
      async get(issuer) {
        return map.get(issuer);
      },
      async put(session) {
        order.push("put");
        map.set(session.issuer, session);
      },
      async delete(issuer) {
        deleteParked = true;
        await deleteGate; // the logout delete parks, holding the queue.
        deleteParked = false;
        order.push("delete");
        map.delete(issuer);
      },
    };
    map.set(ISSUER.href, { issuer: ISSUER.href, webId: WEBID_A, refreshToken: "rt-A", dpopKey });

    const provider = makeProvider(store);
    // Start a restore (captures the current generation; its rotated put will queue).
    const restoring = provider.restoreIssuer(ISSUER);
    restoring.catch(() => {});
    // A logout: enqueue a SLOW delete (parks, holding #storeOps) then reset() (advances
    // the generation), exactly as the SessionProvider's logout does.
    const forgetting = provider.forgetPersisted(ISSUER);
    forgetting.catch(() => {});
    for (let i = 0; i < 5 && !deleteParked; i++) await new Promise((r) => setTimeout(r, 0));
    expect(deleteParked).toBe(true);
    provider.reset(); // logout advances the generation while the restore's put is queued.

    // Drain: the delete completes; the restore's rotated put — now queued AFTER it and
    // SUPERSEDED — must be skipped by the adapter's generation fence.
    releaseDelete();
    await Promise.allSettled([restoring, forgetting]);
    await new Promise((r) => setTimeout(r, 0));

    // FENCED: the rotated put was SKIPPED (generation advanced), so the signed-out
    // account was NOT revived — the delete is the last word.
    expect(order).not.toContain("put");
    expect(map.has(ISSUER.href)).toBe(false);
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

  it("NO-STATIC-CLIENT dynamic fallback registers with the provider's callbackUri redirect_uri (parity)", async () => {
    // A provider WITHOUT a static Client Identifier Document (dynamic-registration
    // dev path) restoring a record that ALSO has no persisted clientId: the helper
    // performs a fresh dynamic registration, which MUST carry this provider's callback
    // URI as the redirect_uri — exactly as the pre-package #resolveClient always did.
    // The restore wrapper now passes `callbackUri: this.#callbackUri` to preserve that.
    const store = makeStore();
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    // No `clientId` in the persisted record → the dynamic-registration fallback.
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt-A",
      dpopKey,
    });
    // A provider with NO static clientId (dynamic-registration path).
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => authState.webId,
      { sessionStore: store }, // no clientId
    );
    const oauth = await import("oauth4webapi");
    const restored = await provider.restoreIssuer(ISSUER);
    expect(restored).toEqual({ webId: WEBID_A });
    // The dynamic registration ran and carried the callback URI as the redirect_uri.
    const regCall = (
      oauth.dynamicClientRegistrationRequest as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1);
    expect((regCall?.[1] as { redirect_uris?: string[] })?.redirect_uris).toEqual([
      "https://app.example/callback.html",
    ]);
  });
});

describe("hasPersisted — tri-state lets the caller keep the pointer under uncertainty", () => {
  it("'present' after a transient restore failure preserved the credential, 'absent' after a dead-token clear", async () => {
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

    // Transient failure — restoreIssuer preserves the credential.
    refreshMock.reject = new Error("network timeout");
    let provider = makeProvider(store);
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
    // 'present' → the SessionProvider KEEPS the remembered pointer.
    expect(await provider.hasPersisted(ISSUER)).toBe("present");

    // Now a definitive invalid_grant clears the credential.
    refreshMock.reject = Object.assign(new Error("invalid_grant"), { error: "invalid_grant" });
    provider = makeProvider(store);
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
    // 'absent' → the SessionProvider clears the pointer (no doomed retry).
    expect(await provider.hasPersisted(ISSUER)).toBe("absent");
  });

  it("'absent' when there is no store / no entry, 'unknown' when the store read throws", async () => {
    expect(await makeProvider().hasPersisted(ISSUER)).toBe("absent"); // no store
    expect(await makeProvider(makeStore()).hasPersisted(ISSUER)).toBe("absent"); // empty store
    // A store whose get() THROWS → 'unknown' (do not treat as absent → keep pointer).
    const throwingStore: SessionStore = {
      get: async () => {
        throw new Error("IndexedDB read failed");
      },
      put: async () => {},
      delete: async () => {},
    };
    expect(await makeProvider(throwingStore).hasPersisted(ISSUER)).toBe("unknown");
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

  it("WEBID-MISMATCH cleanup: forgetPersisted + reset fully tears down a wrongly-restored session", async () => {
    // The SECURITY primitive the SessionProvider relies on when decideSilentRestore
    // returns webid-mismatch (restoreIssuer ALREADY pinned + persisted a session for
    // the wrong WebID one layer down): forgetPersisted(issuer) drops the orphaned
    // durable credential AND reset() drops the pinned in-memory session, so the
    // provider is NOT left authenticated as the wrong identity (roborev finding).
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
    // restoreIssuer succeeds + pins + re-persists the rotated credential.
    const provider = makeProvider(store);
    expect(await provider.restoreIssuer(ISSUER)).toEqual({ webId: WEBID_A });
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(store.map.has(ISSUER.href)).toBe(true);

    // The mismatch-cleanup the SessionProvider performs, in order: reset()
    // SYNCHRONOUSLY first (drops the pinned in-memory session immediately, closing
    // the wrong-WebID upgrade window), THEN forget the durable credential.
    provider.reset();
    expect(provider.authenticatedWebId()).toBeUndefined(); // dropped before the async delete
    expect(provider.resolvedIssuer()).toBeUndefined();
    await provider.forgetPersisted(ISSUER);

    // Durable credential gone AND in-memory session torn down — fully fail-closed.
    expect(store.map.has(ISSUER.href)).toBe(false);
    expect(provider.authenticatedWebId()).toBeUndefined();
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

// ── CONVERGE FIXES (1-4): harden pod-mail's persistence to the clean siblings ──

/**
 * A minimal in-memory sessionStorage stand-in for the node (DOM-less) vitest
 * environment — the redirect-login FIX-1 test persists/reads a JSON record under one
 * key. Installed on `globalThis`; the test clears it in its own setup.
 */
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const stub: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
  (globalThis as { sessionStorage?: unknown }).sessionStorage = stub;
  return store;
}

describe("FIX 1 — the redirect-restored DPoP PUBLIC key is EXTRACTABLE (exports to JWK)", () => {
  const RETURN_URI = "https://app.example/";
  let storage: Map<string, string>;

  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    authState.refreshToken = "rt-A";
    storage = installSessionStorage();
  });

  it("after completeRedirectLogin, the persisted dpopKey's PUBLIC half exports to a JWK", async () => {
    // `dpop` (RFC 9449 §4.2) embeds the PUBLIC key as the proof-header JWK, so it must
    // be able to `exportKey("jwk", publicKey)`. The redirect path re-imports the
    // persisted public JWK; before FIX 1 it was imported `extractable: false`, so this
    // export REJECTS. The store + refresh-token mock here make the re-imported key
    // observable via the persisted record (#persist writes session.dpopKey).
    const store = makeStore();
    const provider = makeProvider(store);

    await provider.beginRedirectLogin(RETURN_URI);
    expect(storage.size).toBeGreaterThan(0);
    await provider.completeRedirectLogin(`${RETURN_URI}?code=auth-code&state=state`);

    const persisted = store.map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    const dpopKey = persisted?.dpopKey as CryptoKeyPair;
    expect(dpopKey?.publicKey).toBeDefined();

    // The load-bearing assertion: exporting the PUBLIC key to JWK SUCCEEDS. With the
    // pre-FIX-1 `extractable: false` import this throws ("key is not extractable").
    const jwk = await crypto.subtle.exportKey("jwk", dpopKey.publicKey);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });

    // Defence-in-depth: the PRIVATE key stays NON-extractable (FIX 1 must not weaken it).
    expect(dpopKey.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", dpopKey.privateKey)).rejects.toThrow();
  });
});

describe("FIX 2 — the persisted clientId is the BOUND client (static or dynamic)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    authState.refreshToken = "rt-A";
  });

  it("a DYNAMIC-registration login persists the server-ASSIGNED client_id", async () => {
    // No static clientId → #resolveClient runs dynamic registration, whose mock
    // returns client_id "dyn-client-id" on the IssuerSession.clientRegistration. FIX 2
    // persists `this.#clientId ?? session.clientRegistration?.client_id`, so the bound
    // dynamic id lands in the record (a refresh grant on the next load reuses it —
    // RFC 6749 §6). Before FIX 2 the record's clientId was `this.#clientId` = undefined.
    const store = makeStore();
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => authState.webId,
      { sessionStore: store }, // NO static clientId → dynamic registration
    );
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();

    const persisted = store.map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    expect(persisted?.clientId).toBe("dyn-client-id");
  });

  it("a STATIC-clientId login persists the static Client Identifier Document URL", async () => {
    const store = makeStore();
    const provider = makeProvider(store); // clientId: "https://app.example/clientid.jsonld"
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();

    const persisted = store.map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    expect(persisted?.clientId).toBe("https://app.example/clientid.jsonld");
  });
});

describe("FIX 3 — popup persist is FAIL-CLOSED on a WebID mismatch (no cross-account leak)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    authState.refreshToken = "rt-A";
  });

  it("an OP that authenticates a DIFFERENT WebID than requested persists NOTHING", async () => {
    // The user REQUESTS WEBID_B (getWebId), but the OP authenticates AS WEBID_A (the
    // id_token claims read authState.webId) — e.g. a live IdP session for another
    // account satisfied the login. FIX 3 gates #persist on
    // webIdsEqual(authenticatedWebId, requestedWebId); a mismatch must write NO durable
    // credential (else WEBID_A's refresh token leaks into the store under the
    // wrong-account request). Without the gate this test goes RED (store.map.size===1).
    const store = makeStore();
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => WEBID_B, // REQUESTED identity (differs from the OP-vouched WEBID_A)
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );

    // The upgrade itself still completes (the OP returned a usable token for WEBID_A);
    // the SessionProvider's own webIdsEqual gate rejects the login one layer up. The
    // provider-level invariant under test is: the DURABLE store stays EMPTY.
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve(); // let the persist microtask settle.

    expect(store.map.size).toBe(0); // FAIL-CLOSED: nothing persisted on a mismatch.
  });

  it("a MATCHING WebID still persists (the gate does not break the happy path)", async () => {
    // Control: requested === authenticated (both WEBID_A) → the credential IS persisted.
    const store = makeStore();
    const provider = makeProvider(store); // getWebId → authState.webId === WEBID_A
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();
    expect(store.map.size).toBe(1);
    expect(store.map.get(ISSUER.href)?.webId).toBe(WEBID_A);
  });

  it("binds to the WebID captured at RESOLUTION, not a post-auth re-read of the mutable holder (roborev HIGH)", async () => {
    // roborev HIGH: the popup persist gate must compare the OP-authenticated WebID to the
    // WebID THIS flow resolved its issuer from — NOT a value re-read from #getWebId() after
    // auth. #getWebId reads a MUTABLE module-level holder; a racing login can overwrite it
    // mid-flow. Model that: getWebId returns WEBID_A on the FIRST call (issuer resolution),
    // then MUTATES to WEBID_B for any later call. The OP authenticates WEBID_A (authState).
    //   • FIXED (capture at resolution): the gate compares authenticated WEBID_A to the
    //     captured WEBID_A → MATCH → the credential is persisted (under WEBID_A). Crucially,
    //     getWebId is consulted exactly ONCE (resolution), never re-read post-auth.
    //   • UNFIXED (post-auth re-read): the gate would read the MUTATED WEBID_B → MISMATCH →
    //     a legitimate same-identity login would WRONGLY fail to persist (and, worse, the
    //     re-read could bind a credential to whatever the holder now says).
    const store = makeStore();
    let getWebIdCalls = 0;
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      async () => REDIRECT,
      async () => {
        getWebIdCalls += 1;
        return getWebIdCalls === 1 ? WEBID_A : WEBID_B; // mutates AFTER resolution
      },
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );
    // OP vouches for WEBID_A (the originally requested identity).
    authState.webId = WEBID_A;
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await Promise.resolve();

    // The credential IS persisted, bound to WEBID_A (the resolution-captured identity) —
    // and getWebId was consulted ONLY at resolution (one call), never re-read at persist.
    expect(store.map.size).toBe(1);
    expect(store.map.get(ISSUER.href)?.webId).toBe(WEBID_A);
    expect(getWebIdCalls).toBe(1);
  });
});

describe("FIX 4 — durable-store mutations are SERIALISED (a slow delete cannot erase a re-login)", () => {
  beforeEach(() => {
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
    authState.refreshToken = "rt-A";
  });

  /** Advance the REAL event loop (a macrotask) so an unchained re-login put would run. */
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("a SLOW logout delete enqueued before a re-login put leaves the credential PRESENT (FIFO)", async () => {
    // The roborev MEDIUM: logout fires a delete; the user immediately logs back in and
    // persists; if the (slow) delete runs AFTER the (fast) put, it wipes the fresh
    // credential. FIX 4 chains both through #storeOps so they run strictly FIFO — the
    // delete (enqueued first) completes BEFORE the put, so the put's record survives.
    //
    // Determinism: the delete PARKS on a gate. We advance the REAL event loop (tick())
    // far enough that an UNCHAINED re-login put would have reached store.put, then assert
    // whether the put ran WHILE the delete was still parked:
    //   • FIXED (FIFO chain): the put is chained behind the parked delete, so it is NOT
    //     invoked until the delete is released → `putWhileParked` stays false; on release
    //     the order is delete→put and the fresh record survives.
    //   • UNFIXED (no chain): the put fires as soon as #persist reaches store.put — while
    //     the delete is parked → `putWhileParked` becomes true, and the late delete then
    //     WIPES the record. This is the exact bug FIX 4 closes.
    const map = new Map<string, PersistedSession>();
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteParked = false;
    let putWhileParked = false;
    const order: string[] = [];
    const store: SessionStore = {
      async get(issuer) {
        return map.get(issuer);
      },
      async put(session) {
        if (deleteParked) putWhileParked = true; // put ran while the delete was parked = UNORDERED.
        order.push("put");
        map.set(session.issuer, session);
      },
      async delete(issuer) {
        deleteParked = true;
        await deleteGate; // the slow logout delete parks here until released.
        deleteParked = false;
        order.push("delete");
        map.delete(issuer);
      },
    };
    // Seed an existing credential (as a prior login would have).
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    map.set(ISSUER.href, { issuer: ISSUER.href, webId: WEBID_A, refreshToken: "rt-old", dpopKey });

    const provider = makeProvider(store);

    // Logout enqueues the SLOW delete first (it parks at deleteGate, NOT awaited here).
    const forgetting = provider.forgetPersisted(ISSUER);
    forgetting.catch(() => {});
    // Re-login enqueues a put. Under FIX 4 it is chained behind the parked delete.
    const relogin = provider.upgrade(new Request("https://alice.example/storage/"));
    relogin.catch(() => {});

    // Advance the real event loop so the re-login reaches store.put IF it were unordered.
    await tick();
    await tick();
    // FIXED: the put has NOT run while the delete is parked (it is chained behind it).
    expect(deleteParked).toBe(true);
    expect(putWhileParked).toBe(false);
    expect(order).not.toContain("put");

    // Release the parked delete; the chain drains: delete THEN put.
    releaseDelete();
    await Promise.all([forgetting, relogin]);
    await tick();

    // FIFO: delete completed BEFORE the put ran, so the re-login's credential SURVIVES.
    expect(order).toEqual(["delete", "put"]);
    const persisted = map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    expect(persisted?.refreshToken).toBe("rt-A"); // the FRESH re-login credential, not erased.
  });

  it("#storeOps SURVIVES reset(): a put after a logout(reset+delete) is still ordered after the delete", async () => {
    // CRITICAL invariant: logout does reset() THEN forgetPersisted(delete); the next
    // login does reset() THEN persist(put). If reset() cleared #storeOps, the put could
    // jump ahead of the in-flight delete. Prove the chain spans reset(): enqueue a slow
    // delete, call reset(), then a put — the put must still land AFTER the delete.
    const map = new Map<string, PersistedSession>();
    const order: string[] = [];
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteParked = false;
    const store: SessionStore = {
      async get(issuer) {
        return map.get(issuer);
      },
      async put(session) {
        order.push("put");
        map.set(session.issuer, session);
      },
      async delete(issuer) {
        deleteParked = true;
        order.push("delete-start");
        await deleteGate;
        deleteParked = false;
        order.push("delete-done");
        map.delete(issuer);
      },
    };
    const dpopKey = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    map.set(ISSUER.href, { issuer: ISSUER.href, webId: WEBID_A, refreshToken: "rt-old", dpopKey });

    const provider = makeProvider(store);

    // Logout: the slow delete is enqueued onto #storeOps...
    const forgetting = provider.forgetPersisted(ISSUER);
    forgetting.catch(() => {});
    // ...then reset() runs (logout / a new login). #storeOps must NOT be cleared by it.
    provider.reset();
    // The next login persists (put) — chained behind the still-parked delete.
    const relogin = provider.upgrade(new Request("https://alice.example/storage/"));
    relogin.catch(() => {});

    // Advance the real event loop; under FIX 4 the put is chained behind the parked
    // delete (which survived reset()), so it must NOT have run yet.
    await tick();
    await tick();
    expect(deleteParked).toBe(true);
    expect(order).not.toContain("put"); // chain held ACROSS reset(): put waits for delete.

    releaseDelete();
    await Promise.all([forgetting, relogin]);
    await tick();

    // FIFO held ACROSS reset(): delete completed before the put ran.
    expect(order).toEqual(["delete-start", "delete-done", "put"]);
    expect(map.get(ISSUER.href)?.refreshToken).toBe("rt-A");
  });

  it("a persist PARKED in the queue does NOT write after a reset() supersedes it (generation fence)", async () => {
    // roborev HIGH (delayed-write-after-reset): because #storeOps SURVIVES reset(), a
    // put enqueued by a login in generation N can sit behind an earlier (parked) store
    // op while a reset() (logout / new login) advances the generation — then write the
    // SUPERSEDED identity's refresh token. The in-queue generation fence must skip that
    // stale put entirely.
    //
    //   • UNFIXED (no in-queue fence): when the parked op is released, the stale put
    //     runs and writes "rt-A" → the superseded credential leaks.
    //   • FIXED: the stale put is skipped (generation ≠ current), so the store stays
    //     untouched by the superseded login.
    const map = new Map<string, PersistedSession>();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstParked = false;
    const store: SessionStore = {
      async get(issuer) {
        return map.get(issuer);
      },
      async put(session) {
        order.push("put");
        map.set(session.issuer, session);
      },
      // The FIRST store op parks here, holding the queue so the login's persist (the
      // SECOND op) is enqueued behind it and cannot run until release.
      async delete(_issuer) {
        firstParked = true;
        order.push("delete-start");
        await firstGate;
        firstParked = false;
        order.push("delete-done");
      },
    };

    const provider = makeProvider(store);
    // Occupy the queue with a parked op (a prior logout's delete, say).
    const parked = provider.forgetPersisted(ISSUER);
    parked.catch(() => {});
    // A login in the CURRENT generation enqueues its persist behind the parked op.
    const relogin = provider.upgrade(new Request("https://alice.example/storage/"));
    relogin.catch(() => {});
    await tick();
    await tick();
    expect(firstParked).toBe(true);
    expect(order).not.toContain("put"); // the persist is parked behind the first op.

    // A reset() (logout / new login) fires WHILE the persist waits in the queue —
    // superseding the login that enqueued it. The queued persist is dropped by the
    // generation fence, AND the in-flight upgrade rejects (its own post-proof fence) —
    // both arms of the defence.
    provider.reset();

    // Drain the queue: the parked op completes; the (now-superseded) persist, if it
    // ever reaches store.put, is fenced out. Releasing the gate unblocks #getSession,
    // so the parked upgrade resumes and rejects.
    releaseFirst();
    await parked;
    // The superseded upgrade rejects — expected; assert it so it is not unhandled.
    await expect(relogin).rejects.toThrow(ReactiveAuthResetError);
    await tick();

    // FIXED: the superseded persist wrote NOTHING (skipped before/inside the queue by
    // the generation fence) — store.put never ran, so no stale credential leaked.
    expect(order).toEqual(["delete-start", "delete-done"]);
    expect(map.has(ISSUER.href)).toBe(false);
  });
});
