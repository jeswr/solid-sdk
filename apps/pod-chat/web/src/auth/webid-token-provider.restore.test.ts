// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Security-critical tests for the SILENT SESSION RESTORE wiring on the
// WebIdDPoPTokenProvider — the DPoP-bound refresh-token persistence + the thin
// restoreIssuer wrapper that lets a CLOSED-TAB REOPEN re-establish the session with
// NO popup/iframe.
//
// What is pinned here (the provider half of the task's matrix):
//   • a successful popup login PERSISTS the rotated refresh token + DPoP key,
//     WebID-scoped (keyed by issuer, carrying the authenticated WebID) — via the
//     explicit persistSession(issuer, webId) the SessionProvider calls after the
//     WebID-binding check;
//   • the persisted record NEVER contains the access token;
//   • the authorization request opts into `offline_access` (so a refresh token is
//     issued);
//   • restoreIssuer pins the restored session in-memory (so a later 401 upgrade
//     reuses it without re-prompting), under the generation fence (a reset() during
//     the grant supersedes it → pins NOTHING);
//   • forgetIssuer (logout) drops the durable credential; hasPersistedFor reports
//     the tri-state presence;
//   • WebID SCOPING: persistSession refuses to write a credential for a WebID that
//     does not match the session's authenticated WebID.
//
// The package's restoreSession is MOCKED here so the provider's pin/fence/persist
// logic is tested in isolation; the REAL restoreSession (invalid_grant-clears vs
// transient-preserves) is exercised against a stubbed fetch in
// session-restore-wiring.test.ts. The whole OAuth/DPoP stack is mocked so this runs
// with no browser + no network.
import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock the package's restoreSession so the provider's PIN logic is the unit under
// test (the real grant is exercised against a stubbed fetch in the wiring test). A
// module-level switch lets each test choose what the next restore returns.
const restoreState = vi.hoisted(() => ({
  result: undefined as
    | undefined
    | {
        webId: string;
        accessToken: string;
        refreshToken: string;
        dpopKey: CryptoKeyPair;
        dpopHandle: unknown;
        expiresAt: number | undefined;
        issuer: string;
      },
  // When set, restoreSession awaits this gate before resolving (to race a reset()).
  gate: null as Promise<void> | null,
}));
vi.mock("@jeswr/solid-session-restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/solid-session-restore")>();
  return {
    ...actual,
    restoreSession: vi.fn(async () => {
      if (restoreState.gate) await restoreState.gate;
      return restoreState.result;
    }),
  };
});

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

async function es256Key(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

beforeEach(() => {
  authState.webId = WEBID_A;
  authState.accessToken = "tok-A";
  authState.refreshToken = "rt-A";
  restoreState.result = undefined;
  restoreState.gate = null;
});

describe("offline_access on the popup login (so a refresh token is issued)", () => {
  it("requests `openid webid offline_access` in the authorization URL", async () => {
    const getCode = vi.fn(async () => REDIRECT);
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      getCode,
      async () => authState.webId,
      { clientId: "https://app.example/clientid.jsonld", sessionStore: makeStore() },
    );
    await provider.upgrade(new Request("https://alice.example/storage/"));
    const authUrl = new URL((getCode.mock.calls[0] as unknown[])[0] as URL);
    expect(authUrl.searchParams.get("scope")).toBe("openid webid offline_access");
  });
});

describe("persistSession — the explicit, WebID-checked credential write", () => {
  it("PERSISTS the DPoP-bound refresh token + key (WebID-scoped) after a confirmed login", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    // A login establishes the in-memory session for the issuer.
    await provider.upgrade(new Request("https://alice.example/storage/"));
    // The SessionProvider calls persistSession AFTER proving the authenticated WebID.
    await provider.persistSession(ISSUER, WEBID_A);

    const persisted = store.map.get(ISSUER.href);
    expect(persisted).toBeDefined();
    expect(persisted?.issuer).toBe(ISSUER.href);
    expect(persisted?.webId).toBe(WEBID_A);
    expect(persisted?.refreshToken).toBe("rt-A");
    expect(persisted?.dpopKey).toBeDefined();
    // The static Client Identifier Document URL is persisted (the refresh grant must
    // run as the same client — a refresh token is client-bound).
    expect(persisted?.clientId).toBe("https://app.example/clientid.jsonld");
  });

  it("NEVER persists the access token (only the long-lived key-bound credential)", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await provider.persistSession(ISSUER, WEBID_A);
    const persisted = store.map.get(ISSUER.href) as unknown as Record<string, unknown>;
    expect(persisted.accessToken).toBeUndefined();
    expect(JSON.stringify({ ...persisted, dpopKey: undefined })).not.toContain("tok-A");
  });

  it("does NOT persist when the server issued NO refresh token (nothing restorable)", async () => {
    authState.refreshToken = undefined;
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await provider.persistSession(ISSUER, WEBID_A);
    expect(store.map.size).toBe(0);
  });

  it("REFUSES to persist a credential for a WebID that does not match the session's identity (defence-in-depth)", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/")); // session is A's
    // A caller wrongly asks to persist under B — the store write must be refused.
    await provider.persistSession(ISSUER, WEBID_B);
    expect(store.map.size).toBe(0);
  });

  it("is a no-op when no session store is wired (restore opted out)", async () => {
    const provider = makeProvider(); // no store
    await provider.upgrade(new Request("https://alice.example/storage/"));
    // Resolves without throwing; nothing to assert beyond no crash.
    await expect(provider.persistSession(ISSUER, WEBID_A)).resolves.toBeUndefined();
  });
});

describe("restoreIssuer — pins the restored session (so a later upgrade reuses it)", () => {
  it("pins the restored identity + session in-memory and reports the WebID", async () => {
    const store = makeStore();
    restoreState.result = {
      webId: WEBID_A,
      accessToken: "tok-restored",
      refreshToken: "rt-rotated",
      dpopKey: await es256Key(),
      dpopHandle: {},
      expiresAt: undefined,
      issuer: ISSUER.href,
    };
    const provider = makeProvider(store);

    const result = await provider.restoreIssuer(ISSUER);
    expect(result).toEqual({ webId: WEBID_A });
    // The provider PINNED the restored identity.
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    // A later upgrade reuses the pinned session (the restored access token), with NO
    // re-prompt (getWebId is never consulted again — the issuer is pinned).
    const upgraded = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-restored");
  });

  it("returns undefined when the package reports nothing to restore (dead/transient/no entry)", async () => {
    restoreState.result = undefined;
    const provider = makeProvider(makeStore());
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
  });

  it("is a no-op (undefined) when no session store is wired", async () => {
    const provider = makeProvider(); // no store
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
  });

  it("a reset() racing the grant SUPERSEDES the restore — pins NOTHING (generation fence)", async () => {
    let releaseGrant!: () => void;
    restoreState.gate = new Promise<void>((resolve) => {
      releaseGrant = resolve;
    });
    restoreState.result = {
      webId: WEBID_A,
      accessToken: "tok-restored",
      refreshToken: "rt-rotated",
      dpopKey: await es256Key(),
      dpopHandle: {},
      expiresAt: undefined,
      issuer: ISSUER.href,
    };
    const provider = makeProvider(makeStore());

    const p = provider.restoreIssuer(ISSUER);
    // A logout / new login fires WHILE the grant is parked.
    provider.reset();
    releaseGrant();
    const result = await p;

    // The superseded restore must NOT pin an identity onto the fresh generation.
    expect(result).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
  });
});

describe("resolvedIssuer — the live issuer logout forgets (roborev finding: missing-pointer logout)", () => {
  it("returns the issuer after a login, so logout can forget the live session's credential even if the pointer is gone", async () => {
    const provider = makeProvider(makeStore());
    // No issuer resolved yet.
    expect(await provider.resolvedIssuer()).toBeUndefined();
    // A login resolves + pins the issuer.
    await provider.upgrade(new Request("https://alice.example/storage/"));
    const issuer = await provider.resolvedIssuer();
    expect(issuer?.href).toBe(ISSUER.href);
    // This is exactly what logout reads (BEFORE reset()) to forget the durable
    // credential when the remembered localStorage pointer is missing / stale.
  });

  it("returns undefined after reset() (so a logged-out provider exposes no issuer to forget)", async () => {
    const provider = makeProvider(makeStore());
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect((await provider.resolvedIssuer())?.href).toBe(ISSUER.href);
    provider.reset();
    expect(await provider.resolvedIssuer()).toBeUndefined();
  });
});

describe("redirect/autologin path persists a NON-extractable DPoP key (roborev finding)", () => {
  /** In-memory sessionStorage for the two-phase redirect flow record. */
  function installSessionStorage(): Map<string, string> {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    return store;
  }

  it("the redirect-completed session's persisted DPoP private key is extractable:false", async () => {
    installSessionStorage();
    const store = makeStore();
    const provider = makeProvider(store);
    const RETURN_URI = "https://app.example/";

    // beginRedirectLogin EXPORTS the key to JWK (extractable, to survive the redirect);
    // completeRedirectLogin RE-IMPORTS it. The fix re-imports it NON-extractable, so the
    // credential persisted for silent restore is bound to a non-exportable key.
    await provider.beginRedirectLogin(RETURN_URI);
    await provider.completeRedirectLogin(`${RETURN_URI}?code=auth-code&state=state`);
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // Persist the redirect-completed session, then assert the stored private key is
    // NON-extractable — the package's invariant (a stolen refresh token is useless
    // without a key whose raw bytes never leave the browser).
    await provider.persistSession(ISSUER, WEBID_A);
    const persisted = store.map.get(ISSUER.href);
    expect(persisted?.dpopKey).toBeDefined();
    expect(persisted?.dpopKey.privateKey.extractable).toBe(false);
  });

  // #85 / FIX-1 regression: the redirect path re-imports the DPoP PUBLIC key, and
  // `dpop`/oauth4webapi serialise that public key into the DPoP proof-header JWK
  // (RFC 9449 §4.2), which requires `publicKey.extractable === true`. Before the fix
  // the public key was re-imported `extractable: false`, so `exportKey("jwk", …)`
  // REJECTED → redirect-path DPoP proof generation (and thus silent restore on the
  // redirect path) was broken. Mirrors the FIX-1 test pod-mail/pod-photos added.
  it("the redirect-completed session's persisted DPoP PUBLIC key exports to a JWK (extractable:true)", async () => {
    installSessionStorage();
    const store = makeStore();
    const provider = makeProvider(store);
    const RETURN_URI = "https://app.example/";

    await provider.beginRedirectLogin(RETURN_URI);
    await provider.completeRedirectLogin(`${RETURN_URI}?code=auth-code&state=state`);
    await provider.persistSession(ISSUER, WEBID_A);

    const persisted = store.map.get(ISSUER.href);
    expect(persisted?.dpopKey).toBeDefined();
    const dpopKey = persisted?.dpopKey as CryptoKeyPair;
    expect(dpopKey.publicKey).toBeDefined();

    // The load-bearing assertion: exporting the PUBLIC key to JWK SUCCEEDS. With the
    // pre-fix `extractable: false` import this throws ("key is not extractable") — so
    // this test genuinely FAILS without the one-flag fix, then passes with it.
    const jwk = await crypto.subtle.exportKey("jwk", dpopKey.publicKey);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });

    // Defence-in-depth: the fix must NOT weaken the PRIVATE key — it stays non-extractable.
    expect(dpopKey.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", dpopKey.privateKey)).rejects.toThrow();
  });
});

describe("forgetIssuer / hasPersistedFor — logout + the tri-state presence read", () => {
  it("forgetIssuer drops the durable credential for the issuer (logout side)", async () => {
    const store = makeStore();
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt",
      dpopKey: await es256Key(),
    });
    const provider = makeProvider(store);
    await provider.forgetIssuer(ISSUER);
    expect(store.map.has(ISSUER.href)).toBe(false);
  });

  it("hasPersistedFor reports present / absent / unknown (the keep-drop pointer signal)", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    // absent — empty store.
    expect(await provider.hasPersistedFor(ISSUER)).toBe("absent");
    // present — after a credential is stored.
    store.map.set(ISSUER.href, {
      issuer: ISSUER.href,
      webId: WEBID_A,
      refreshToken: "rt",
      dpopKey: await es256Key(),
    });
    expect(await provider.hasPersistedFor(ISSUER)).toBe("present");
    // absent — when no store is wired (nothing to keep a pointer for).
    expect(await makeProvider().hasPersistedFor(ISSUER)).toBe("absent");
    // unknown — a store whose read throws (a transient IndexedDB error).
    const throwingStore: SessionStore = {
      async get() {
        throw new Error("idb read failed");
      },
      async put() {},
      async delete() {},
    };
    expect(await makeProvider(throwingStore).hasPersistedFor(ISSUER)).toBe("unknown");
  });
});
