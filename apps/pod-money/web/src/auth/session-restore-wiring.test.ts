// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Security-critical tests for the SILENT-SESSION-RESTORE DECISION wiring in
// pod-money: the mount-time `decideSilentRestore` (the audited package's pure
// decision) driven by pod-money's `WebIdDPoPTokenProvider.restoreIssuer`, plus the
// fail-closed WebID-binding guard the SessionProvider relies on.
//
// The cross-app invariant: a returning user who only CLOSED the tab is restored
// SILENTLY from their persisted, DPoP-bound refresh token — and account A can NEVER
// be restored as account B. This pins:
//   • RESTORE-ON-MOUNT — a remembered account whose grant authenticates the SAME
//     WebID → outcome `restored` (the app paints the session, no login UI);
//   • FAIL-CLOSED WebID-MISMATCH — a grant that authenticates a DIFFERENT WebID than
//     the remembered/last-active one → `webid-mismatch` (NOT `restored`). The
//     adversarial half: with the guard DISABLED (an always-true equality), the wrong
//     identity is admitted as `restored` — proving the guard is load-bearing — then
//     the real `webIdsEqual` is restored and the mismatch is correctly fail-closed.
//   • invalid_grant CLEARS vs transient PRESERVES — restoreIssuer over the real
//     package `restoreSession` clears the durable credential on a definitive
//     invalid_grant (a dead token), but PRESERVES it on a transient failure (a blip
//     on load must not force a needless re-login).
//
// The OAuth network layer (oauth4webapi) is mocked so the refresh grant is
// deterministic with no browser/network; the SessionStore is a real in-memory double.
import {
  decideSilentRestore,
  type PersistedSession,
  type SessionStore,
  webIdsEqual,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Drive the mocked refresh grant per test ───────────────────────────────────
const grant = vi.hoisted(() => ({
  // The WebID the next refresh grant's id_token authenticates AS.
  webId: "https://alice.example/profile/card#me",
  // When set, the refresh grant REJECTS with this OAuth error code (e.g.
  // "invalid_grant" = dead token; anything else / a network throw = transient).
  errorCode: null as string | null,
  // When true, the grant rejects with a NON-OAuth (transient) error instead.
  transientThrow: false,
}));

vi.mock("oauth4webapi", () => {
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  const customFetch = Symbol("customFetch");
  class ResponseBodyError extends Error {
    error: string;
    constructor(code: string) {
      super(code);
      this.error = code;
    }
  }
  return {
    allowInsecureRequests,
    customFetch,
    None: () => () => {},
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: "https://issuer.example/",
      token_endpoint: "https://issuer.example/token",
    })),
    DPoP: vi.fn(() => ({ __dpop: true })),
    isDPoPNonceError: () => false,
    refreshTokenGrantRequest: vi.fn(async () => {
      if (grant.transientThrow) throw new Error("network blip");
      if (grant.errorCode) throw new ResponseBodyError(grant.errorCode);
      return {};
    }),
    processRefreshTokenResponse: vi.fn(async () => ({
      access_token: "fresh-access",
      refresh_token: "rotated-rt",
      expires_in: 3600,
    })),
    getValidatedIdTokenClaims: vi.fn(() => ({ webid: grant.webId })),
    dynamicClientRegistrationRequest: vi.fn(),
    processDynamicClientRegistrationResponse: vi.fn(),
  };
});

// Mock the heavy deps the provider pulls in for the login path (unused here but
// imported at module-eval) so the module loads with no browser/network.
vi.mock("@jeswr/fetch-rdf", () => ({ fetchRdf: vi.fn(async () => ({ dataset: new Set() })) }));
vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => ["https://issuer.example/"],
}));
vi.mock("dpop", () => ({ generateProof: vi.fn(async () => "dpop-proof") }));

const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");

const ISSUER = "https://issuer.example/";
const ALICE = "https://alice.example/profile/card#me";
const MALLORY = "https://mallory.evil/profile/card#me";

/**
 * A real in-memory SessionStore double. Seeds a persisted credential for ALICE under
 * ISSUER by default; pass `{ seedNone: true }` for an empty store (the no-account
 * path).
 */
function makeStore(opts?: { seedNone?: boolean }): SessionStore & {
  map: Map<string, PersistedSession>;
} {
  const map = new Map<string, PersistedSession>();
  if (!opts?.seedNone) {
    map.set(ISSUER, {
      issuer: ISSUER,
      webId: ALICE,
      refreshToken: "rt-A",
      dpopKey: { privateKey: {}, publicKey: {} } as unknown as CryptoKeyPair,
      clientId: "https://app.example/clientid.jsonld",
    });
  }
  return {
    map,
    get: async (i) => map.get(i),
    put: async (s) => void map.set(s.issuer, s),
    delete: async (i) => void map.delete(i),
  };
}

function makeProvider(store: SessionStore) {
  return new WebIdDPoPTokenProvider(
    "https://app.example/callback",
    vi.fn() as never,
    async () => ALICE,
    {
      clientId: "https://app.example/clientid.jsonld",
      allowInsecureLoopback: false,
      profileFetch: vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      sessionStore: store,
    },
  );
}

/** Run the SAME decision the SessionProvider's runSilentRestore runs. */
function decide(
  provider: InstanceType<typeof WebIdDPoPTokenProvider>,
  remembered: { webId: string; issuer?: string } | null,
  equality: (a: string | undefined, b: string | undefined) => boolean = webIdsEqual,
) {
  return decideSilentRestore({
    lastActiveWebId: remembered?.webId,
    remembered: remembered ? [remembered] : [],
    restoreIssuer: async (issuer) => provider.restoreIssuer(new URL(issuer)),
    webIdsEqual: equality,
  });
}

beforeEach(() => {
  grant.webId = ALICE;
  grant.errorCode = null;
  grant.transientThrow = false;
});

describe("silent restore — restore-on-mount", () => {
  it("restores the session when the remembered account's grant authenticates the SAME WebID", async () => {
    const store = makeStore();
    const provider = makeProvider(store);
    const decision = await decide(provider, { webId: ALICE, issuer: ISSUER });
    expect(decision.outcome).toBe("restored");
    if (decision.outcome === "restored") {
      expect(decision.webId).toBe(ALICE);
      expect(decision.issuer).toBe(ISSUER);
    }
    // The provider pinned the rebuilt session so a later 401 upgrades without prompt.
    expect(provider.authenticatedWebId()).toBe(ALICE);
    expect(provider.resolvedIssuer()).toBe(ISSUER);
    // The rotated refresh token was re-persisted (next reload uses the CURRENT one).
    expect(store.map.get(ISSUER)?.refreshToken).toBe("rotated-rt");
  });

  it("falls back to login (no-account) when nothing is remembered", async () => {
    const provider = makeProvider(makeStore({ seedNone: true }));
    const decision = await decide(provider, null);
    expect(decision).toEqual({ outcome: "login", reason: "no-account" });
  });
});

describe("silent restore — FAIL-CLOSED WebID-mismatch (the binding guard)", () => {
  it("fail-closes to webid-mismatch when the grant authenticates a DIFFERENT WebID", async () => {
    // The remembered/last-active account is ALICE, but the grant comes back as MALLORY.
    grant.webId = MALLORY;
    const store = makeStore();
    const provider = makeProvider(store);
    const decision = await decide(provider, { webId: ALICE, issuer: ISSUER });
    // The guard MUST reject this: a different identity can never be restored as ALICE.
    expect(decision).toEqual({ outcome: "login", reason: "webid-mismatch" });
  });

  it("ADVERSARIAL: with the WebID guard DISABLED the wrong identity is wrongly admitted", async () => {
    // Proves the guard is LOAD-BEARING: an always-true equality (the guard removed)
    // makes decideSilentRestore admit MALLORY's grant as a successful ALICE restore —
    // exactly the cross-user leak the guard prevents.
    grant.webId = MALLORY;
    const provider = makeProvider(makeStore());
    const broken = await decide(provider, { webId: ALICE, issuer: ISSUER }, () => true);
    // WITHOUT the guard: a "restored" outcome for the WRONG identity (the bug).
    expect(broken.outcome).toBe("restored");

    // RESTORE the real guard → the same mismatch is correctly fail-closed.
    grant.webId = MALLORY;
    const provider2 = makeProvider(makeStore());
    const guarded = await decide(provider2, { webId: ALICE, issuer: ISSUER }, webIdsEqual);
    expect(guarded).toEqual({ outcome: "login", reason: "webid-mismatch" });
  });
});

describe("silent restore — invalid_grant CLEARS vs transient PRESERVES", () => {
  it("CLEARS the durable credential on a definitive invalid_grant (dead token)", async () => {
    grant.errorCode = "invalid_grant";
    const store = makeStore();
    const provider = makeProvider(store);
    const decision = await decide(provider, { webId: ALICE, issuer: ISSUER });
    expect(decision).toEqual({ outcome: "login", reason: "restore-failed" });
    // A definitively-dead token is removed so a doomed restore is not retried.
    expect(store.map.get(ISSUER)).toBeUndefined();
  });

  it("PRESERVES the durable credential on a TRANSIENT failure (network blip)", async () => {
    grant.transientThrow = true;
    const store = makeStore();
    const provider = makeProvider(store);
    const decision = await decide(provider, { webId: ALICE, issuer: ISSUER });
    expect(decision).toEqual({ outcome: "login", reason: "restore-failed" });
    // A blip on load must NOT erase an otherwise-valid credential — it survives.
    expect(store.map.get(ISSUER)?.refreshToken).toBe("rt-A");
  });
});
