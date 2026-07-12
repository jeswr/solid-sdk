// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SECURITY-CRITICAL: the SessionProvider's mount-time SILENT-RESTORE wiring, pinned
// against the @jeswr/solid-session-restore package the provider now consumes. This
// is the adversarial half the migration must keep green: the provider's restore
// internals moved into the package's `restoreSession`, but the WIRING that composes
// the package's pure `decideSilentRestore` with the provider's `restoreIssuer` /
// `reset` / `forgetPersisted` / `hasPersisted` is what `runSilentRestore` in
// SessionProvider.tsx performs. We exercise that exact composition here without a
// React render (the host has a jsdom env but the decision is framework-free), so the
// fail-closed WebID-mismatch teardown is unit-tested.
//
// What is pinned:
//   • RESTORE-ON-MOUNT: a persisted session for the remembered issuer is silently
//     restored (refresh-token grant, no popup) and the decision lands `restored`.
//   • FAIL-CLOSED WEBID-MISMATCH TEARDOWN: when the refresh grant authenticates a
//     DIFFERENT WebID than the remembered one, `decideSilentRestore` returns
//     `webid-mismatch`; the wiring then tears down in ORDER — `reset()` FIRST (drops
//     the in-memory session the restore one-layer-down already pinned), THEN
//     `forgetPersisted` (drops the orphaned durable credential) — so the provider is
//     NOT left authenticated as the wrong identity and the durable token is gone.
//   • THE GUARD IS LOAD-BEARING: an adversarial variant that disables the
//     `webIdsEqual` check (`() => true`, i.e. "every identity matches") would silently
//     accept the wrong WebID as `restored` — proving the guard genuinely prevents a
//     cross-identity restore. The guarded path then refuses the same input.
//
// The whole OAuth/DPoP stack is mocked (no browser, no network); the package is
// inlined by vitest.config so `vi.mock("oauth4webapi")` reaches the grant inside
// `restoreSession`.
import {
  decideSilentRestore,
  type PersistedSession,
  type SessionStore,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The identity the next refresh grant authenticates AS (the id_token claims read it).
const authState = {
  webId: "https://alice.example/profile/card#me",
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

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  return {
    allowInsecureRequests,
    customFetch: Symbol("customFetch"),
    None: () => () => {},
    expectNoNonce: Symbol("expectNoNonce"),
    nopkce: Symbol("nopkce"),
    DPoP: vi.fn((_client: unknown, key: unknown) => ({ __dpop: true, key })),
    isDPoPNonceError: () => false,
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: "https://issuer.example/",
      authorization_endpoint: "https://issuer.example/auth",
      token_endpoint: "https://issuer.example/token",
      code_challenge_methods_supported: ["S256"],
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
    refreshTokenGrantRequest: vi.fn(async () => ({})),
    processRefreshTokenResponse: vi.fn(async () => ({
      access_token: "tok-refreshed",
      refresh_token: "rt-rotated",
      expires_in: 3600,
    })),
    // The refresh response authenticates AS authState.webId (which a test can switch
    // to a DIFFERENT WebID than the one remembered, to drive the mismatch path).
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

const { WebIdDPoPTokenProvider, webIdsEqual } = await import("./webid-token-provider");

const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://mallory.example/profile/card#me";
const ISSUER = new URL("https://issuer.example/");

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

function makeProvider(store: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback.html",
    async () => "https://app.example/callback.html?code=auth-code&state=state",
    async () => {
      throw new Error("getWebId must NOT be called during silent restore (no popup)");
    },
    { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
  );
}

async function seedPersisted(store: ReturnType<typeof makeStore>, webId: string) {
  const dpopKey = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  store.map.set(ISSUER.href, { issuer: ISSUER.href, webId, refreshToken: "rt-A", dpopKey });
}

/**
 * The SessionProvider's `runSilentRestore` mismatch wiring, distilled to the
 * security-critical core (no React): decide via the package, and on `webid-mismatch`
 * tear down in the documented order (reset FIRST, then forgetPersisted). The
 * `equal` collaborator is injected so the test can run the GUARDED path and the
 * adversarial guard-DISABLED path against the SAME inputs.
 */
async function runRestoreWiring(
  provider: InstanceType<typeof WebIdDPoPTokenProvider>,
  rememberedWebId: string,
  equal: (a: string | undefined, b: string | undefined) => boolean,
): Promise<{ kind: "restored"; webId: string } | { kind: "login"; reason: string }> {
  const decision = await decideSilentRestore({
    lastActiveWebId: rememberedWebId,
    remembered: [{ webId: rememberedWebId, issuer: ISSUER.href }],
    restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
    webIdsEqual: equal,
  });
  if (decision.outcome === "restored") {
    return { kind: "restored", webId: decision.webId };
  }
  // Fail-closed teardown, in the SessionProvider's exact order.
  if (decision.reason === "webid-mismatch") {
    provider.reset();
    await provider.forgetPersisted(ISSUER);
  }
  return { kind: "login", reason: decision.reason };
}

beforeEach(() => {
  authState.webId = WEBID_A;
});

describe("silent restore on mount — the happy path", () => {
  it("restores a persisted session for the remembered issuer (no popup) and lands 'restored'", async () => {
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    const provider = makeProvider(store);

    const result = await runRestoreWiring(provider, WEBID_A, webIdsEqual);

    expect(result).toEqual({ kind: "restored", webId: WEBID_A });
    // The provider pinned the restored session (a later upgrade reuses it, no prompt).
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.resolvedIssuer()).toBe(ISSUER.href);
    // The rotated credential was re-persisted by the restore for the next reload.
    expect(store.map.get(ISSUER.href)?.refreshToken).toBe("rt-rotated");
  });
});

describe("fail-closed WebID-mismatch teardown — the guard is load-bearing", () => {
  it("GUARDED: a grant authenticating a DIFFERENT WebID tears the session down fully", async () => {
    // Remembered = A, but the refresh grant authenticates AS Mallory (a corrupted /
    // misfiled store, or a hostile issuer). The guard MUST refuse: no 'restored', the
    // in-memory session reset, and the orphaned durable credential forgotten.
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    authState.webId = WEBID_B; // the grant will authenticate AS Mallory
    const provider = makeProvider(store);

    const result = await runRestoreWiring(provider, WEBID_A, webIdsEqual);

    expect(result).toEqual({ kind: "login", reason: "webid-mismatch" });
    // FULLY torn down: not authenticated as ANYONE (esp. not Mallory), issuer dropped,
    // and the durable credential the restore one-layer-down had re-persisted is gone.
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.authenticatedWebId()).not.toBe(WEBID_B);
    expect(provider.resolvedIssuer()).toBeUndefined();
    expect(store.map.has(ISSUER.href)).toBe(false);
  });

  it("ADVERSARIAL — guard DISABLED (every identity 'matches') WOULD silently accept the wrong WebID", async () => {
    // Prove the guard is genuinely load-bearing: with the WebID comparison neutered to
    // `() => true`, the SAME mismatched input is accepted as 'restored' AS MALLORY —
    // exactly the cross-identity restore the fail-closed guard exists to prevent. This
    // assertion FAILS (the bad outcome would not occur) if the guard were somehow still
    // applied, so it locks in that the check is what makes the difference.
    const store = makeStore();
    await seedPersisted(store, WEBID_A);
    authState.webId = WEBID_B;
    const provider = makeProvider(store);

    const result = await runRestoreWiring(provider, WEBID_A, () => true);

    // The neutered guard silently logs the user in as the WRONG WebID — the regression
    // the guarded test above proves is prevented.
    expect(result).toEqual({ kind: "restored", webId: WEBID_B });
    expect(provider.authenticatedWebId()).toBe(WEBID_B);
  });

  it("the GUARDED and ADVERSARIAL paths DIVERGE on the same input (the guard is the cause)", async () => {
    // Same store, same grant-WebID — only the equality collaborator differs. The
    // guarded run refuses (login/webid-mismatch); the neutered run accepts (restored).
    const guardedStore = makeStore();
    await seedPersisted(guardedStore, WEBID_A);
    authState.webId = WEBID_B;
    const guarded = await runRestoreWiring(makeProvider(guardedStore), WEBID_A, webIdsEqual);

    const neuteredStore = makeStore();
    await seedPersisted(neuteredStore, WEBID_A);
    authState.webId = WEBID_B;
    const neutered = await runRestoreWiring(makeProvider(neuteredStore), WEBID_A, () => true);

    expect(guarded.kind).toBe("login");
    expect(neutered.kind).toBe("restored");
    expect(guarded).not.toEqual(neutered);
  });
});
