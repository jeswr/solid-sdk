// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the REAL `WebIdDPoPTokenProvider.restoreIssuer` wiring: after a silent restore
// rebuilds a session from the durable store, the restored session is PINNED in the
// provider's in-memory state so a SUBSEQUENT private read upgrades WITHOUT re-prompting
// (no popup / getCode call). The package's `restoreSession` (the refresh-token grant)
// is mocked to return a RestoredSession — its own exhaustive tests cover the grant; this
// proves pod-drive's pin-the-restored-session contribution keeps upgrade() working.
//
// The heavy oauth/DPoP/fetch-rdf stack is mocked exactly as webid-token-provider.test.ts
// does, so this runs with no browser/network.
import type { PersistedSession, SessionStore } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = { webId: "https://alice.example/profile/card#me", accessToken: "tok-A" };
const ISSUER = "https://issuer.example/";
const WEBID_A = "https://alice.example/profile/card#me";

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));
vi.mock("./login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => [ISSUER],
}));
vi.mock("dpop", () => ({
  // The proof carries the access token (last arg) so a test can assert WHICH token was
  // attached — the restored one, with no popup.
  generateProof: vi.fn(async (..._args: unknown[]) => "proof"),
}));

// Mock ONLY restoreSession (the refresh grant) while keeping the rest of the package
// real — the provider also pulls forgetPersisted/hasPersisted/types from here.
const restoreState = {
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
};
vi.mock("@jeswr/solid-session-restore", async (importActual) => {
  const actual = await importActual<typeof import("@jeswr/solid-session-restore")>();
  return { ...actual, restoreSession: vi.fn(async () => restoreState.result) };
});

const oauthMock = vi.hoisted(() => ({}));
vi.mock("oauth4webapi", async (importActual) => {
  const actual = await importActual<typeof import("oauth4webapi")>();
  void oauthMock;
  return {
    ...actual,
    allowInsecureRequests: Symbol.for("allowInsecureRequests"),
    None: () => () => {},
    DPoP: () => ({}),
    // The popup path (used only to PROVE no popup happens on the restore path).
    discoveryRequest: vi.fn(async () => ({})),
    processDiscoveryResponse: vi.fn(async () => ({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}auth`,
      token_endpoint: `${ISSUER}token`,
      code_challenge_methods_supported: ["S256"],
    })),
    generateKeyPair: vi.fn(async () =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
    ),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code" })),
    authorizationCodeGrantRequest: vi.fn(async () => ({})),
    processAuthorizationCodeResponse: vi.fn(async () => ({ access_token: authState.accessToken })),
    getValidatedIdTokenClaims: vi.fn(() => ({ sub: authState.webId, webid: authState.webId })),
    AuthorizationResponseError: class extends Error {},
  };
});

const { WebIdDPoPTokenProvider } = await import("./webid-token-provider");
const { restoreSession } = await import("@jeswr/solid-session-restore");

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

describe("WebIdDPoPTokenProvider.restoreIssuer — pins the restored session", () => {
  beforeEach(() => {
    restoreState.result = undefined;
    vi.clearAllMocks();
    authState.webId = WEBID_A;
    authState.accessToken = "tok-A";
  });

  it("returns the WebID, pins it, and a subsequent upgrade() attaches the RESTORED token with NO popup", async () => {
    const store = new MemorySessionStore();
    const dpopKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    restoreState.result = {
      webId: WEBID_A,
      accessToken: "restored-token",
      refreshToken: "rt-rotated",
      dpopKey,
      dpopHandle: {},
      expiresAt: undefined,
      issuer: ISSUER,
    };
    // A popup that MUST NOT be called on the restore path — fail loudly if it is.
    const getCode = vi.fn(async () => {
      throw new Error("popup getCode must not be called on a silent restore");
    });
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      getCode,
      async () => {
        throw new Error("getWebId must not be called on a silent restore");
      },
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );

    const result = await provider.restoreIssuer(new URL(ISSUER));
    expect(result).toEqual({ webId: WEBID_A });
    expect(restoreSession).toHaveBeenCalledTimes(1);
    // The session is pinned: authenticatedWebId + currentIssuer report the restored ids.
    expect(provider.authenticatedWebId()).toBe(WEBID_A);
    expect(provider.currentIssuer()).toBe(ISSUER);

    // A subsequent private read upgrades using the PINNED restored session — no popup,
    // no getWebId, the RESTORED access token attached.
    const upgraded = await provider.upgrade(new Request("https://alice.example/storage/"));
    expect(upgraded.headers.get("Authorization")).toBe("DPoP restored-token");
    expect(getCode).not.toHaveBeenCalled();
  });

  it("returns undefined (pins nothing) when restoreSession finds nothing to restore", async () => {
    const store = new MemorySessionStore();
    restoreState.result = undefined; // dead/absent token.
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      vi.fn(),
      async () => WEBID_A,
      { clientId: "https://app.example/clientid.jsonld", sessionStore: store },
    );
    const result = await provider.restoreIssuer(new URL(ISSUER));
    expect(result).toBeUndefined();
    expect(provider.authenticatedWebId()).toBeUndefined();
    expect(provider.currentIssuer()).toBeUndefined();
  });

  it("returns undefined when NO sessionStore is configured (memory-only mode)", async () => {
    const provider = new WebIdDPoPTokenProvider(
      "https://app.example/callback.html",
      vi.fn(),
      async () => WEBID_A,
      { clientId: "https://app.example/clientid.jsonld" }, // no sessionStore.
    );
    const result = await provider.restoreIssuer(new URL(ISSUER));
    expect(result).toBeUndefined();
    expect(restoreSession).not.toHaveBeenCalled();
  });
});
