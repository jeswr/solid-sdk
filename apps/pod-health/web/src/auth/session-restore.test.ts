// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-restore.test.ts — the SILENT SESSION RESTORE wiring around
// @jeswr/solid-session-restore (cross-app UX invariant #1), at the auth seam.
//
// HEALTH-SENSITIVE + SECURITY-CRITICAL. These tests pin the load-bearing
// invariants:
//   1. restore-on-mount: a persisted session for WebID-A + the remembered pointer →
//      restoreIssuer pins the session, decideSilentRestore reports `restored`, the
//      authenticated WebID is A.
//   2. fail-closed WebID-MISMATCH: the durable/remembered pointer says A but the
//      refresh grant authenticates B → the decision is `login`/`webid-mismatch`, and
//      the integrated teardown drops the in-memory session + the durable credential +
//      the pointer; webId stays unauthenticated.
//
//      ADVERSARIAL VERIFICATION (required by the brief): this mismatch test was run
//      with the package's `webIdsEqual` REPLACED by an always-true stub
//      (`() => true`) to simulate the guard being removed/short-circuited. With the
//      guard gone, decideSilentRestore returns `restored` for the WRONG WebID (B),
//      i.e. a wrong-WebID restore SUCCEEDS — the test's `expect(decision.outcome)
//      .toBe("login")` then FAILS, proving the assertion genuinely depends on the
//      guard. The real package guard was then restored; the test below uses it.
//   3. invalid_grant clears vs transient preserves: restoreSession on a definitive
//      `invalid_grant` deletes the durable entry; a transient (network/5xx/abort)
//      failure PRESERVES it.
//   4. NO credential/token in localStorage: after a login-side persist, the durable
//      refresh token + the DPoP key live ONLY in the IndexedDB store double; the
//      localStorage remembered pointer is credential-free; the persisted CryptoKey is
//      `extractable: false`.
//
// The full OAuth/DPoP/profile-fetch stack is mocked so this runs with no browser and
// no network — mirroring webid-token-provider.test.ts. The session store is an
// in-memory `SessionStore` double (the package README's prescribed test seam).
import {
  decideSilentRestore,
  forgetPersisted,
  hasPersisted,
  type PersistedSession,
  webIdsEqual as packageWebIdsEqual,
  restoreSession,
  type SessionStore,
  shouldDropRememberedPointer,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";
const ISSUER = "https://issuer.example/";

// A module-level switch lets each test decide which WebID the refresh grant
// authenticates AS (the id_token claims), and which access token it mints.
const refreshState = { webId: WEBID_A, accessToken: "tok-A", refreshToken: "rt-A2" };

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

// A controllable refresh-grant outcome for the clear-vs-preserve test (#3): a test can
// install a thrown error before the grant runs. Hoisted so the mock factory's closure
// can reference it before the top-level `const` is initialised.
const grantControl = vi.hoisted(() => ({
  throwOnGrant: null as unknown,
  // Optional gate: when set, processRefreshTokenResponse awaits it before resolving, so a
  // test can fire a reset() WHILE the refresh grant is in flight (the restore-race fence).
  gate: null as Promise<void> | null,
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  const customFetch = Symbol("customFetch");
  return {
    allowInsecureRequests,
    customFetch,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    expectNoNonce: Symbol("expectNoNonce"),
    nopkce: Symbol("nopkce"),
    DPoP: () => ({}),
    isDPoPNonceError: () => false,
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: ISSUER,
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
      access_token: refreshState.accessToken,
      refresh_token: refreshState.refreshToken,
      expires_in: 3600,
    })),
    // The refresh-token grant — the heart of restore. A test may force it to throw
    // (the clear-vs-preserve case); otherwise it succeeds.
    refreshTokenGrantRequest: vi.fn(async () => ({})),
    processRefreshTokenResponse: vi.fn(async () => {
      if (grantControl.gate) await grantControl.gate; // park the grant so a test can reset() mid-flight.
      if (grantControl.throwOnGrant) throw grantControl.throwOnGrant;
      return {
        access_token: refreshState.accessToken,
        refresh_token: refreshState.refreshToken,
        expires_in: 3600,
      };
    }),
    getValidatedIdTokenClaims: vi.fn(() => ({
      iss: ISSUER,
      sub: refreshState.webId,
      webid: refreshState.webId,
      aud: "client",
      iat: 0,
      exp: 0,
    })),
    AuthorizationResponseError: class extends Error {},
  };
});

// Import the provider AFTER the mocks are registered.
const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");
// The PURE restore-gate helpers (no DOM) — imported after the mocks so SessionProvider's
// reactive-auth deps resolve against them.
const { isStalePendingRedirect, explicitFlowInProgress } = await import("./SessionProvider");

/**
 * A minimal in-memory `SessionStore` double — the package README's prescribed test
 * seam. Tracks calls so the clear-vs-preserve test can assert delete behaviour.
 */
function makeStore(): SessionStore & {
  map: Map<string, PersistedSession>;
  deletes: string[];
} {
  const map = new Map<string, PersistedSession>();
  const deletes: string[] = [];
  return {
    map,
    deletes,
    async get(issuer) {
      return map.get(issuer);
    },
    async put(session) {
      map.set(session.issuer, session);
    },
    async delete(issuer) {
      deletes.push(issuer);
      map.delete(issuer);
    },
  };
}

/**
 * Install a clean in-memory Storage on `globalThis` for the given property — jsdom's
 * localStorage in this config is partial (no `clear`), so we use a deterministic
 * stand-in. Returns the backing map so a test can inspect every stored key/value.
 */
function installStorage(prop: "localStorage" | "sessionStorage"): Map<string, string> {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  (globalThis as unknown as Record<string, Storage>)[prop] = stub;
  return store;
}

/** A real ES256 keypair generated NON-extractable, as the persisted store requires. */
async function nonExtractableKey(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

/** Build a provider wired to the given store, with the app's static client id. */
function makeProvider(store: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "https://app.example/callback.html?code=auth-code&state=state",
    async () => refreshState.webId,
    { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
  );
}

/** Seed a persisted session for an issuer (a returning user's durable credential). */
async function seedPersisted(
  store: SessionStore,
  webId: string,
  refreshToken = "rt-A1",
): Promise<void> {
  await store.put({
    issuer: ISSUER,
    webId,
    refreshToken,
    dpopKey: await nonExtractableKey(),
    clientId: "https://app.example/clientid.jsonld",
  });
}

let localStore: Map<string, string>;

beforeEach(() => {
  refreshState.webId = WEBID_A;
  refreshState.accessToken = "tok-A";
  refreshState.refreshToken = "rt-A2";
  grantControl.throwOnGrant = null;
  grantControl.gate = null;
  localStore = installStorage("localStorage");
  installStorage("sessionStorage");
});

describe("1. restore-on-mount — a persisted session for WebID-A restores silently", () => {
  it("restoreIssuer redeems the refresh token, pins the session, reports WebID-A", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);

    const result = await provider.restoreIssuer(new URL(ISSUER));

    expect(result).toEqual({ webId: WEBID_A });
    // The session is pinned in-memory: the provider reports A and a token is attached.
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.tokensAttachedCount()).toBe(1);
    // A subsequent read upgrades via the restored session (no re-prompt / re-login).
    const upgraded = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(upgraded.headers.get("Authorization")).toBe("DPoP tok-A");
  });

  it("decideSilentRestore reports `restored` for WebID-A via the provider's restoreIssuer", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);

    const decision = await decideSilentRestore({
      lastActiveWebId: WEBID_A,
      remembered: [{ webId: WEBID_A, issuer: ISSUER }],
      restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual: packageWebIdsEqual,
    });

    expect(decision.outcome).toBe("restored");
    if (decision.outcome === "restored") {
      expect(decision.webId).toBe(WEBID_A);
      expect(decision.issuer).toBe(ISSUER);
    }
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
  });

  it("returns undefined (→ login) when nothing is persisted for the issuer", async () => {
    const store = makeStore(); // empty.
    const provider = makeProvider(store);
    const result = await provider.restoreIssuer(new URL(ISSUER));
    expect(result).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
  });
});

describe("2. FAIL-CLOSED WebID-MISMATCH — A's pointer must never restore B's session", () => {
  // ADVERSARIAL: re-running this `expect(...).toBe("login")` with the injected
  // webIdsEqual replaced by `() => true` makes decideSilentRestore return `restored`
  // for the WRONG WebID (B) — the assertion then FAILS, proving it depends on the
  // fail-closed guard. The real package guard is used below; see the file header.
  it("the durable/remembered pointer says A but the grant authenticates B → `webid-mismatch`", async () => {
    const store = makeStore();
    // The durable credential + remembered pointer are for A...
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);
    // ...but the OP's live session authenticates a DIFFERENT account, B.
    refreshState.webId = WEBID_B;
    refreshState.accessToken = "tok-B";

    const decision = await decideSilentRestore({
      lastActiveWebId: WEBID_A,
      remembered: [{ webId: WEBID_A, issuer: ISSUER }],
      restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual: packageWebIdsEqual,
    });

    // The mismatch is caught: login, with the webid-mismatch reason (NOT `restored`).
    expect(decision.outcome).toBe("login");
    if (decision.outcome === "login") expect(decision.reason).toBe("webid-mismatch");
  });

  it("integrated teardown: provider.reset() → forgetPersisted → pointer cleared; webId unauthenticated", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);
    refreshState.webId = WEBID_B; // the grant authenticates B (the wrong account).
    refreshState.accessToken = "tok-B";

    const decision = await decideSilentRestore({
      lastActiveWebId: WEBID_A,
      remembered: [{ webId: WEBID_A, issuer: ISSUER }],
      restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual: packageWebIdsEqual,
    });
    expect(decision.outcome).toBe("login");

    // restoreIssuer (one layer down) pinned B's session in-memory BEFORE the decision
    // saw the mismatch — exactly why the teardown must reset the provider FIRST.
    expect(provider.authenticatedWebId()).toBe(WEBID_B);

    // The fail-closed teardown, IN ORDER (mirrors runSilentRestore):
    provider.reset(); // 1. drop the in-memory wrong-WebID session FIRST.
    await forgetPersisted(store, new URL(ISSUER)); // 2. drop the durable credential.
    // 3. clear the pointer (modelled by the test's localStorage being credential-free).

    // After teardown: no in-memory identity, and the durable entry is gone.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(store.deletes).toContain(ISSUER);
    expect(await store.get(ISSUER)).toBeUndefined();
  });

  it("ADVERSARIAL CONTROL: with an always-true webIdsEqual the WRONG WebID restores (proves the guard is load-bearing)", async () => {
    // This documents (in-suite) the adversarial check from the file header: injecting a
    // broken equality (`() => true`) makes the mismatch path SUCCEED — i.e. removing the
    // fail-closed guard regresses to a cross-account restore. We assert the BROKEN
    // behaviour here so the contrast with the real-guard test above is explicit and a
    // future regression of the equality is caught.
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);
    refreshState.webId = WEBID_B;
    refreshState.accessToken = "tok-B";

    const brokenDecision = await decideSilentRestore({
      lastActiveWebId: WEBID_A,
      remembered: [{ webId: WEBID_A, issuer: ISSUER }],
      restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual: () => true, // the guard short-circuited — the bug we guard against.
    });
    // With the guard broken, the wrong WebID (B) is wrongly accepted as `restored`.
    expect(brokenDecision.outcome).toBe("restored");
    if (brokenDecision.outcome === "restored") expect(brokenDecision.webId).toBe(WEBID_B);
    // Hence the REAL-guard test above (which expects `login`) genuinely fails without it.
  });
});

describe("3. invalid_grant CLEARS the credential; a transient failure PRESERVES it", () => {
  it("a definitive invalid_grant deletes the durable entry (a dead token is not retried)", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-dead");
    // The token endpoint rejects with a definitive invalid_grant (expired/revoked).
    grantControl.throwOnGrant = { error: "invalid_grant" };

    const restored = await restoreSession({
      store,
      issuer: new URL(ISSUER),
      clientId: "https://app.example/clientid.jsonld",
    });

    expect(restored).toBeUndefined(); // fail-closed → login.
    // The dead entry was CLEARED so a doomed restore is not re-attempted next load.
    expect(store.deletes).toContain(ISSUER);
    expect(await store.get(ISSUER)).toBeUndefined();
    expect(await hasPersisted(store, new URL(ISSUER))).toBe("absent");
  });

  it("a TRANSIENT failure (network/5xx/abort) PRESERVES the credential for a later retry", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-live");
    // A transient network blip — NOT an invalid_grant. The credential must survive.
    grantControl.throwOnGrant = new TypeError("network error");

    const restored = await restoreSession({
      store,
      issuer: new URL(ISSUER),
      clientId: "https://app.example/clientid.jsonld",
    });

    expect(restored).toBeUndefined(); // this load falls back to login...
    // ...but the credential is PRESERVED (never deleted) so the next load can retry.
    expect(store.deletes).not.toContain(ISSUER);
    const still = await store.get(ISSUER);
    expect(still?.refreshToken).toBe("rt-live");
    expect(await hasPersisted(store, new URL(ISSUER))).toBe("present");
  });

  it("the keep/drop matrix matches the clear-vs-preserve behaviour (restore-failed)", () => {
    // present/unknown → KEEP (might still be valid); absent → DROP (definitively gone).
    expect(shouldDropRememberedPointer("restore-failed", "present")).toBe(false);
    expect(shouldDropRememberedPointer("restore-failed", "unknown")).toBe(false);
    expect(shouldDropRememberedPointer("restore-failed", "absent")).toBe(true);
    // A confirmed mismatch is always dropped (known-bad for this pointer).
    expect(shouldDropRememberedPointer("webid-mismatch", "present")).toBe(true);
  });
});

describe("4. NO credential/token in localStorage — durable secrets live ONLY in the IndexedDB store", () => {
  it("after a redirect-login persist: refresh token + dpopKey in the store; localStorage credential-free; key non-extractable", async () => {
    const store = makeStore();
    refreshState.refreshToken = "rt-secret-value";
    refreshState.accessToken = "tok-A";
    const provider = makeProvider(store);

    // Drive the full redirect/autologin login (which requests offline_access → a refresh
    // token) so the provider persists the restorable credential via its login path.
    // (sessionStorage is provided by jsdom.)
    await provider.beginRedirectLogin("https://app.example/");
    await provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state");

    // The durable credential landed in the STORE (IndexedDB stand-in):
    const persisted = await store.get(ISSUER);
    expect(persisted).toBeTruthy();
    expect(persisted?.refreshToken).toBe("rt-secret-value");
    expect(persisted?.dpopKey.privateKey).toBeInstanceOf(CryptoKey);
    // SECURITY: the persisted DPoP PRIVATE key is NON-extractable (raw bytes unreadable).
    expect(persisted?.dpopKey.privateKey.extractable).toBe(false);
    // The PUBLIC key MUST be extractable: on restore, dpop/oauth4webapi serialise it into
    // the DPoP proof JWK header + jkt thumbprint and THROW if it is non-extractable, so a
    // non-extractable public key would break every restored redirect session (roborev
    // HIGH). A public key carries no secret, so this is safe.
    expect(persisted?.dpopKey.publicKey.extractable).toBe(true);
    // The access token is NEVER persisted (only the long-lived key-bound refresh token).
    expect((persisted as unknown as Record<string, unknown>).accessToken).toBeUndefined();

    // SCAN localStorage: no key/value may contain the refresh token or a private JWK.
    // (The remembered POINTER — written by SessionProvider, not the provider — is the
    // only thing the app puts in localStorage, and it is credential-free.)
    const blob = [...localStore.entries()].flat().join(" ");
    expect(blob).not.toContain("rt-secret-value"); // no refresh token in localStorage.
    expect(blob).not.toContain("tok-A"); // no access token in localStorage.
    expect(blob.toLowerCase()).not.toContain('"d"'); // no private-JWK scalar in localStorage.

    // And sessionStorage carries no durable refresh token: the redirect-flow record is
    // cleared after completion (single-use; see completeRedirectLogin's finally).
    expect(sessionStorage.getItem("pss.autologin.flow")).toBeNull();
  });

  it("the persisted public key is USABLE for DPoP (extractable) — restore would not throw (roborev HIGH)", async () => {
    // dpop/oauth4webapi serialise the DPoP public key to a JWK on restore and THROW if it
    // is non-extractable. The redirect persist hardens the PRIVATE key but MUST keep the
    // PUBLIC key extractable, else every restored redirect session breaks. Prove the
    // persisted public key can be exported (what dpop does) while the private cannot.
    const store = makeStore();
    refreshState.refreshToken = "rt-usable";
    const provider = makeProvider(store);
    await provider.beginRedirectLogin("https://app.example/");
    await provider.completeRedirectLogin("https://app.example/?code=auth-code&state=state");

    const persisted = await store.get(ISSUER);
    // The public key exports cleanly (this is exactly the call dpop makes for the proof).
    const pubJwk = await crypto.subtle.exportKey("jwk", persisted?.dpopKey.publicKey as CryptoKey);
    expect(pubJwk.kty).toBe("EC");
    expect(pubJwk.crv).toBe("P-256");
    // The private key, by contrast, is non-extractable — exporting it throws.
    await expect(
      crypto.subtle.exportKey("jwk", persisted?.dpopKey.privateKey as CryptoKey),
    ).rejects.toThrow();
  });

  it("a restored session re-persists the (rotated) token to the store, never localStorage", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-old");
    refreshState.refreshToken = "rt-rotated-secret";
    const provider = makeProvider(store);

    await provider.restoreIssuer(new URL(ISSUER));

    // The rotated token is in the STORE...
    const after = await store.get(ISSUER);
    expect(after?.refreshToken).toBe("rt-rotated-secret");
    expect(after?.dpopKey.privateKey.extractable).toBe(false);

    // ...and NOT in localStorage.
    expect([...localStore.entries()].flat().join(" ")).not.toContain("rt-rotated-secret");
  });
});

describe("5. LOGOUT durable teardown — issuer captured before reset, the delete is AWAITED", () => {
  // roborev finding: logout must (a) capture the issuer BEFORE reset() clears #issuer,
  // and (b) AWAIT the durable delete so a fast tab-close after sign-out cannot leave the
  // refresh credential in IndexedDB. These assert the provider-level invariants the
  // SessionProvider.logout sequence relies on (capture-issuer → reset → await forget).
  it("captures the authenticated issuer BEFORE reset(), so logout can forget the right entry", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-live");
    const provider = makeProvider(store);
    await provider.restoreIssuer(new URL(ISSUER)); // pins the session + #issuer in-memory.

    // The logout ORDER: read the issuer while the session is still live...
    const issuer = await provider.authenticatedIssuer();
    expect(issuer).toBe(ISSUER);
    // ...THEN reset (which clears #issuer). Reading it AFTER reset would lose the key.
    provider.reset();
    expect(await provider.authenticatedIssuer()).toBeUndefined();

    // The captured issuer still lets us forget the durable credential.
    await forgetPersisted(store, new URL(issuer as string));
    expect(store.deletes).toContain(ISSUER);
    expect(await hasPersisted(store, new URL(ISSUER))).toBe("absent");
  });

  it("the AWAITED forget has committed the store delete by the time logout resolves", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-live");
    // Reproduce logout's awaited teardown: capture → clear pointer/reset → AWAIT forget.
    const provider = makeProvider(store);
    await provider.restoreIssuer(new URL(ISSUER));
    const issuer = await provider.authenticatedIssuer();
    provider.reset();
    await forgetPersisted(store, new URL(issuer as string));
    // Synchronously after the await, the credential is GONE (not racing a fire-and-forget).
    expect(store.map.has(ISSUER)).toBe(false);
  });
});

describe("6. RESTORE then PROFILE-READ FAILS — provider is reset so no authenticated fetch lingers, credential KEPT", () => {
  // roborev finding: if restore succeeds but the cosmetic profile read fails, falling
  // back to login WITHOUT reset() leaves the patched global fetch authenticating reads
  // behind a logged-out UI. The fix resets the in-memory provider (dropping the pinned
  // session) but KEEPS the durable credential (the restore itself succeeded — a blip
  // must not force a re-login next load).
  it("reset() drops the pinned in-memory session, but the durable credential survives for next load", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-live");
    refreshState.refreshToken = "rt-rotated";
    const provider = makeProvider(store);

    const result = await provider.restoreIssuer(new URL(ISSUER));
    expect(result?.webId).toBe(WEBID_A); // restore succeeded; session pinned in-memory.
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // SIMULATE the establishSessionFor failure path: reset the provider.
    provider.reset();

    // In-memory session is GONE (no authenticated identity lingering behind logged-out UI).
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(await provider.authenticatedIssuer()).toBeUndefined();

    // The durable credential is PRESERVED (reset() never touches the store) — the rotated
    // token re-persisted during restore is still there, so the next load can restore again.
    expect(store.deletes).not.toContain(ISSUER);
    expect(await hasPersisted(store, new URL(ISSUER))).toBe("present");
    expect((await store.get(ISSUER))?.refreshToken).toBe("rt-rotated");
  });
});

describe("8. PRIMARY (popup) login is ALSO restorable — offline_access + confirm-then-persist", () => {
  // roborev finding: the primary LoginScreen → popup #authenticate path must mint a
  // refresh token (offline_access) and persist it, or silent restore only ever works
  // for the redirect/autologin deep-link path. The popup DPoP key is non-extractable and
  // is persisted DIRECTLY (no JWK export); persistence happens ONLY after the WebID match
  // is confirmed (persistRestorableSessionFor), never at mint time.
  it("a popup login stashes the refresh token, and persistRestorableSessionFor persists it (non-extractable key)", async () => {
    const store = makeStore();
    refreshState.webId = WEBID_A;
    refreshState.accessToken = "tok-popup";
    refreshState.refreshToken = "rt-popup-secret";
    const provider = makeProvider(store);

    // Drive the POPUP login: upgrade() on a protected resource triggers #authenticate
    // (the getCode mock returns the callback URL; the mocked grant issues a refresh token).
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    // NOT persisted yet — the WebID-match guard runs in the SessionProvider AFTER mint.
    expect(await store.get(ISSUER)).toBeUndefined();

    // Confirm-then-persist (what establishSessionFor calls after the match passes):
    await provider.persistRestorableSessionFor(WEBID_A);

    const persisted = await store.get(ISSUER);
    expect(persisted?.refreshToken).toBe("rt-popup-secret");
    // The popup key was already non-extractable and is persisted directly (no JWK export).
    expect(persisted?.dpopKey.privateKey.extractable).toBe(false);
    expect((persisted as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    // And no credential leaked into localStorage.
    expect([...localStore.entries()].flat().join(" ")).not.toContain("rt-popup-secret");
    expect([...localStore.entries()].flat().join(" ")).not.toContain("tok-popup");
  });

  it("FAIL-CLOSED: persistRestorableSessionFor does NOT persist when the confirmed WebID != the authenticated one", async () => {
    const store = makeStore();
    refreshState.webId = WEBID_A; // the OP authenticates A...
    refreshState.refreshToken = "rt-A-secret";
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(provider.authenticatedWebId()).toBe(WEBID_A);

    // ...but a caller (buggy / hostile) asks to persist for B. The provider re-checks the
    // in-memory authenticated identity and REFUSES — no cross-WebID credential is stored.
    await provider.persistRestorableSessionFor(WEBID_B);
    expect(await store.get(ISSUER)).toBeUndefined();
    expect(store.map.size).toBe(0);
  });

  it("idempotent: a second persistRestorableSessionFor (StrictMode) does not double-write", async () => {
    const store = makeStore();
    refreshState.webId = WEBID_A;
    refreshState.refreshToken = "rt-once";
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));

    await provider.persistRestorableSessionFor(WEBID_A);
    const sizeAfterFirst = store.map.size;
    // The stash is cleared after the first write, so a second call is a no-op.
    await provider.persistRestorableSessionFor(WEBID_A);
    expect(store.map.size).toBe(sizeAfterFirst);
    expect((await store.get(ISSUER))?.refreshToken).toBe("rt-once");
  });

  it("LOGOUT-DURING-PERSIST race (roborev HIGH): a reset() mid-persist writes NOTHING to the store", async () => {
    // A store whose put() is GATED so we can observe whether the durable write is ever
    // reached/committed; a logout (reset) fires WHILE persistRestorableSessionFor is in
    // flight. The generation fence (captured at entry, re-checked right before put) must
    // skip the write so a logged-out user's credential is never orphaned in IndexedDB.
    const base = makeStore();
    let putCalledAfterReset = false;
    let resetDone = false;
    const racyStore: SessionStore & { map: Map<string, PersistedSession>; deletes: string[] } = {
      map: base.map,
      deletes: base.deletes,
      get: base.get,
      async put(session) {
        if (resetDone) putCalledAfterReset = true; // a put that slipped past the fence.
        return base.put(session);
      },
      delete: base.delete,
    };
    refreshState.webId = WEBID_A;
    refreshState.refreshToken = "rt-raced";
    const provider = makeProvider(racyStore);
    await provider.upgrade(new Request("https://alice.example/storage/"));

    // Start the persist (its generation is captured synchronously at entry), then fire a
    // logout (reset → generation bump) before its internal awaits resolve. The persist
    // resumes and must bail at the `this.#generation !== expectGeneration` fence before put.
    const persistPromise = provider.persistRestorableSessionFor(WEBID_A);
    provider.reset();
    resetDone = true;
    await persistPromise;

    // NOTHING was written: the raced credential never reached the durable store, and the
    // fence ensured put() was never called after the reset.
    expect(racyStore.map.has(ISSUER)).toBe(false);
    expect(putCalledAfterReset).toBe(false);
    expect([...localStore.entries()].flat().join(" ")).not.toContain("rt-raced");
  });

  it("does NOT store `expiresAt` (the OAuth expires_in is the access-token lifetime, not the credential's)", async () => {
    const store = makeStore();
    refreshState.webId = WEBID_A;
    refreshState.refreshToken = "rt-noexp";
    const provider = makeProvider(store);
    await provider.upgrade(new Request("https://alice.example/storage/"));
    await provider.persistRestorableSessionFor(WEBID_A);
    const persisted = await store.get(ISSUER);
    expect(persisted?.refreshToken).toBe("rt-noexp");
    expect(persisted?.expiresAt).toBeUndefined();
  });
});

describe("10. RESTORE-DURING-LOGOUT race (roborev Medium) — the rotated token is NOT written back after reset", () => {
  // restoreSession rotates the refresh token and `put`s it back to the store ITSELF, mid-
  // grant — before restoreIssuer's post-grant generation fence runs. A logout racing the
  // grant deletes the credential; without the generation-FENCED store wrapper, that internal
  // put would write the rotated token BACK after sign-out, orphaning a credential. The
  // wrapper's `put` must no-op once the generation has advanced.
  it("a reset() during the refresh grant drops the rotated-token write-back (fenced store)", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-old");
    refreshState.webId = WEBID_A;
    refreshState.refreshToken = "rt-rotated-after-logout";
    let releaseGrant: () => void = () => {};
    grantControl.gate = new Promise<void>((r) => {
      releaseGrant = r;
    });
    const provider = makeProvider(store);

    // Start restore; it parks inside the (gated) refresh grant.
    const restorePromise = provider.restoreIssuer(new URL(ISSUER));
    // LOGOUT mid-grant: the durable credential is deleted AND the generation advances.
    await forgetPersisted(store, new URL(ISSUER));
    provider.reset();
    // Release the grant — restoreSession now tries to `put` the rotated token back.
    releaseGrant();
    const result = await restorePromise;

    // The restore is superseded → no in-memory session pinned...
    expect(result).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
    // ...and CRUCIALLY the rotated token was NOT written back: the credential stays deleted,
    // so a logged-out user has nothing restorable left in the store.
    expect(await store.get(ISSUER)).toBeUndefined();
    expect([...localStore.entries()].flat().join(" ")).not.toContain("rt-rotated-after-logout");
  });
});

describe("7. POST-LOGOUT replay is fail-closed — a stale `restored` outcome cannot re-establish on a reset provider", () => {
  // roborev finding: the module-level restore single-flight caches `{ kind: "restored" }`;
  // logout (webId→null) re-runs the restore effect, which would re-await that stale
  // outcome and call establishSessionFor on a now-RESET provider. The SessionProvider
  // invalidates the latch on logout (`restoreInFlight = Promise.resolve({kind:"login"})`),
  // BUT the underlying SECURITY invariant — even a replayed `restored` cannot resurrect a
  // session — is enforced by the provider: after reset(), authenticatedWebId() is undefined,
  // so establishSessionFor's `webIdsEqual(authedWebId, id)` FAILS CLOSED. This pins that
  // defence-in-depth: a stale restored.webId can never equal a reset provider's identity.
  it("after restore then logout (reset), the provider has no identity, so the equality guard fails closed", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A, "rt-live");
    const provider = makeProvider(store);

    const restored = await provider.restoreIssuer(new URL(ISSUER));
    expect(restored?.webId).toBe(WEBID_A); // session pinned.

    // logout → provider.reset(): the in-memory identity is gone.
    provider.reset();

    // A replayed stale `restored` outcome would call establishSessionFor(WEBID_A), which
    // reads provider.authenticatedWebId() (now undefined) and compares it to WEBID_A.
    // packageWebIdsEqual / the provider's webIdsEqual both return false for an undefined
    // side — so NO session is re-established; the guard fails closed.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(packageWebIdsEqual(provider.authenticatedWebId(), WEBID_A)).toBe(false);
  });
});

describe("9. The pure restore-GATE helpers — a stale pending-redirect must not suppress restore", () => {
  // roborev finding: a pending-redirect record left over from an abandoned redirect (the
  // tab was reopened on a plain URL — no ?code/?error) must be CLEARED, or
  // explicitFlowInProgress would return true indefinitely and silently block restore from
  // a valid persisted credential. isStalePendingRedirect identifies that case; the effect
  // clears the record and passes hasPendingRedirect:false so restore PROCEEDS.
  it("isStalePendingRedirect: only a pending record with NO code AND NO error is stale", () => {
    // Stale: a pending record, plain URL (no code, no error) → must be cleared.
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: false,
        hasErrorParams: false,
      }),
    ).toBe(true);
    // A genuine in-flight return (code OR error present) is NOT stale — it owns the load.
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: true,
        hasErrorParams: false,
      }),
    ).toBe(false);
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: false,
        hasErrorParams: true,
      }),
    ).toBe(false);
    // No pending record at all → nothing to clear.
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: false,
        hasCodeParams: false,
        hasErrorParams: false,
      }),
    ).toBe(false);
  });

  it("explicitFlowInProgress: an explicit flow wins; a plain load (or an ORPHANED callback) does not", () => {
    const plain = {
      hasCodeParams: false,
      hasErrorParams: false,
      fragmentWebId: null,
      hasPendingRedirect: false,
    };
    expect(explicitFlowInProgress(plain)).toBe(false); // plain load → silent restore runs.
    expect(explicitFlowInProgress({ ...plain, fragmentWebId: WEBID_A })).toBe(true); // #autologin deep-link.
    expect(explicitFlowInProgress({ ...plain, hasPendingRedirect: true })).toBe(true); // pending redirect flow.
    // OUR redirect return: code/error PAIRED WITH a pending record → explicit (blocks restore).
    expect(
      explicitFlowInProgress({ ...plain, hasCodeParams: true, hasPendingRedirect: true }),
    ).toBe(true);
    expect(
      explicitFlowInProgress({ ...plain, hasErrorParams: true, hasPendingRedirect: true }),
    ).toBe(true);
    // ORPHANED callback (roborev): code/error WITHOUT a pending record is NOT our flow and
    // must NOT suppress restore — otherwise a stray callback URL strands a valid session.
    expect(explicitFlowInProgress({ ...plain, hasCodeParams: true })).toBe(false);
    expect(explicitFlowInProgress({ ...plain, hasErrorParams: true })).toBe(false);
  });

  it("a STALE pending-redirect, once cleared (hasPendingRedirect:false), no longer suppresses restore", () => {
    // The effect's sequence: detect stale → clear → pass hasPendingRedirect:false to the gate.
    const stale = { hasCodeParams: false, hasErrorParams: false, hasPendingRedirect: true };
    expect(isStalePendingRedirect(stale)).toBe(true); // it IS stale...
    // ...so after clearing, the gate sees no explicit flow and restore PROCEEDS.
    expect(
      explicitFlowInProgress({
        hasCodeParams: false,
        hasErrorParams: false,
        fragmentWebId: null,
        hasPendingRedirect: false, // cleared.
      }),
    ).toBe(false);
  });
});
