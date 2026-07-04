// AUTHORED-BY Claude Fable 5
// (Ported from @jeswr/solid-elements test/auth-controller.test.ts — the exhaustive
// adversarial suite guarding the engine's roborev-hardened invariants; only the
// import paths + factory name changed in the port.)
//
// Adapter-level regression tests for createSolidAuth, with
// oauth4webapi + the RDF libs MOCKED so the login flow runs deterministically
// without a real OP. These pin the roborev-flagged fixes:
//   • the login generation FENCE (a slow earlier login must not clobber a later
//     one's session / persisted credential / remembered pointer); and
//   • dynamic client registration advertises the refresh_token grant (so silent
//     restore actually gets a refresh token for dynamically-registered clients).

import type { SessionStore } from "@jeswr/solid-session-restore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SolidAuthController as LoginController } from "../src/types.js";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Issuer resolution: the WebID profile always advertises one issuer. A test can gate
// the profile fetch (issuerResolveDelay) to hold a login in its PRE-POPUP phase.
vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => {
    if (issuerResolveDelay) await issuerResolveDelay();
    return { dataset: new Set(), etag: null };
  }),
}));
vi.mock("@solid/object", () => ({
  Agent: class {
    get oidcIssuer() {
      // agentIssuers (plural) overrides for the multi-issuer chooser path; else the
      // single agentIssuer.
      return new Set(agentIssuers ?? [agentIssuer]);
    }
  },
}));
vi.mock("n3", () => ({ DataFactory: {} }));
// Capture the `htu` + the KEY the provider passes (to assert query/fragment stripping
// and that the DPoP proof is signed with the token's bound key after a refresh).
let lastDpopHtu: string | undefined;
let lastDpopKey: unknown;
// The resource-server DPoP `nonce` (RFC 9449 §8, 4th generateProof arg) the provider
// embedded in the most recent proof — to assert the nonce is echoed back.
let lastDpopNonce: string | undefined;
vi.mock("dpop", () => ({
  generateProof: vi.fn(async (key: unknown, htu: string, _htm: string, nonce?: string) => {
    lastDpopKey = key;
    lastDpopHtu = htu;
    lastDpopNonce = nonce;
    return "dpop-proof";
  }),
}));

// Partial-mock @jeswr/solid-session-restore: keep the REAL pure decision +
// RememberedAccount + store, but stub the network `restoreSession` (the installed
// dist's own `oauth4webapi` import can't be reliably re-mocked from here, so we mock
// the package boundary instead). The stub mimics a successful refresh-token grant:
// it re-persists a ROTATED refresh token + a fresh access token, exactly as the real
// helper does, so the controller's refresh + restore wiring is exercised end-to-end.
vi.mock("@jeswr/solid-session-restore", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jeswr/solid-session-restore")>();
  return {
    ...real,
    restoreSession: vi.fn(
      async (opts: { store: SessionStore; issuer: URL; signal?: AbortSignal }) => {
        const stored = await opts.store.get(opts.issuer.href);
        if (!stored?.refreshToken) return undefined; // nothing to restore
        refreshGrantCalls++;
        // A test hook to gate the grant (between read and the rotation write), to race
        // a logout/login against an in-flight restore. The REAL restoreSession aborts its
        // fetch on the signal, so the gate RACES the abort: an aborted grant unblocks
        // promptly (mirroring a cancelled token-endpoint request) and then throws below.
        if (restoreDelay) {
          await Promise.race([
            restoreDelay(),
            new Promise<void>((res) => {
              if (opts.signal) {
                if (opts.signal.aborted) res();
                else opts.signal.addEventListener("abort", () => res());
              }
            }),
          ]);
        }
        // HONOUR ABORT: the real restoreSession passes `signal` into its fetches, so an
        // aborted grant rejects BEFORE redeeming/rotating the token. Mirror that — if the
        // controller aborted us (a superseding login/logout), throw WITHOUT spending the
        // token (no rotation put), exactly as a cancelled token-endpoint request would.
        if (opts.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        restoreRotationsAttempted++; // reached the point where the token is redeemed + rotated
        // Simulate a DEAD refresh token (invalid_grant): the real restoreSession clears
        // the persisted entry via the (guarded) store and returns undefined.
        if (restoreInvalidGrant) {
          await opts.store.delete(opts.issuer.href);
          return undefined;
        }
        const rotated = {
          ...stored,
          refreshToken: "rotated-refresh-token",
          expiresAt: Date.now() + 3_600_000,
        };
        // The REAL restoreSession persists the rotated credential BEST-EFFORT and still
        // returns the live token even if that durable write FAILED — exactly the scenario
        // where the store keeps the old (spent) refresh token while a fresh access token is
        // handed back. Mirror that by swallowing the put rejection so the controller's
        // store↔memory consistency guard (rotationPersisted) is what must protect us.
        try {
          await opts.store.put(rotated);
        } catch {
          // swallowed — restoreSession still returns the refreshed token below
        }
        return {
          // refreshWebId overrides the restored WebID (to test the cross-account guard).
          webId: refreshWebId ?? stored.webId,
          accessToken: refreshAccessToken,
          refreshToken: "rotated-refresh-token",
          // refreshDpopKey overrides the restored key (to test the token↔key adoption).
          dpopKey: refreshDpopKey ?? stored.dpopKey,
          dpopHandle: {},
          expiresAt: rotated.expiresAt,
          issuer: opts.issuer.href,
        };
      },
    ),
  };
});

// NOTE: the controller's authenticated fetch (both `.authenticatedFetch` AND the opt-in
// `patchGlobalFetch` global wrapper) is the controller's OWN wrapper over the pristine
// publicFetch — it no longer uses @solid/reactive-authentication's ReactiveFetchManager,
// so there is nothing to mock from that package here (the source imports only TYPES from
// it, which are erased at compile time).

// A controllable oauth4webapi stub. The token response carries the WebID via the
// id_token claims and a refresh token. dynamicClientRegistrationRequest captures
// the metadata it was called with so a test can assert grant_types.
const allowInsecureRequests = Symbol("allowInsecureRequests");
const customFetch = Symbol("customFetch");
let lastRegistrationMetadata: Record<string, unknown> | undefined;
let webIdClaim = "https://alice.pod.example/profile/card#me";
// The issuer the mocked WebID profile advertises (drives session.issuer per login).
let agentIssuer = "https://idp.example/";
// Override for the multi-issuer chooser path (when set, the profile advertises these).
let agentIssuers: string[] | undefined;
// A hook a test can set to delay the token exchange (to race two logins).
let tokenDelay: (() => Promise<void>) | undefined;
// A hook to delay PROFILE/issuer resolution (the pre-popup phase), to hold a login
// before it would open the popup.
let issuerResolveDelay: (() => Promise<void>) | undefined;
// The DPoP key thumbprint the mocked DPoP handle returns (for the `dpop_jkt` auth param).
let dpopThumbprint = "test-dpop-jkt";
// How many times the mocked restoreSession REACHED the token-redeem+rotate step (i.e. was
// NOT aborted before it) — to assert a superseded grant was cancelled before spending.
let restoreRotationsAttempted = 0;
// The access token the login auth-code grant returns, and its lifetime (seconds).
let loginAccessToken = "access-token";
let loginExpiresIn: number | undefined;
// The refresh token the login auth-code grant returns (varied to test persist race).
let loginRefreshToken = "refresh-token";
// The token_type the login grant returns (DPoP unless a test forces Bearer).
let loginTokenType = "DPoP";
// The access token a REFRESH grant returns (to prove refresh swapped it in).
let refreshAccessToken = "refreshed-access-token";
let refreshGrantCalls = 0;
// A hook to gate the mocked restoreSession grant (to race logout vs restore).
let restoreDelay: (() => Promise<void>) | undefined;
// When true, the mocked restoreSession simulates invalid_grant: it DELETEs the
// persisted entry (via the guarded store) and returns undefined.
let restoreInvalidGrant = false;
// When set, the mocked restoreSession returns THIS as the restored WebID (to test
// the cross-account refresh guard).
let refreshWebId: string | undefined;
// When set, the mocked restoreSession returns THIS as the restored DPoP key (to test
// that a refresh adopts the token's bound key).
let refreshDpopKey: unknown;
// When true, discovery OMITS code_challenge_methods_supported (to prove PKCE S256 is
// still sent regardless — the security downgrade fix).
let discoveryNoPkceMetadata = false;
// When true, the FIRST authorizationCodeGrantRequest throws a DPoP-nonce error (the
// retry then succeeds). `grantCalls` counts the attempts.
let dpopNonceOnFirstGrant = false;
let grantCalls = 0;

vi.mock("oauth4webapi", () => {
  // A named error class so the throw in validateAuthResponse and the `instanceof`
  // check in the adapter's needsInteraction agree (same class identity).
  class AuthorizationResponseError extends Error {
    error: string;
    constructor(error: string) {
      super(error);
      this.error = error;
    }
  }
  // The DPoP-nonce error class isDPoPNonceError recognises (same identity).
  class DPoPNonceError extends Error {}
  return {
    AuthorizationResponseError,
    DPoPNonceError,
    allowInsecureRequests,
    customFetch,
    nopkce: Symbol("nopkce"),
    None: () => () => {},
    // The DPoP handle exposes calculateThumbprint() — the source uses it for the
    // `dpop_jkt` authorization-request parameter (RFC 9449 §10 code binding).
    DPoP: () => ({ calculateThumbprint: async () => dpopThumbprint }),
    generateKeyPair: vi.fn(async () => ({
      publicKey: {} as CryptoKey,
      privateKey: {} as CryptoKey,
    })),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomState: () => "state",
    generateRandomNonce: () => "nonce",
    calculatePKCECodeChallenge: async () => "challenge",
    discoveryRequest: vi.fn(async () => new Response()),
    processDiscoveryResponse: vi.fn(async (issuer: URL) => ({
      issuer: issuer.href,
      authorization_endpoint: `${issuer.href}auth`,
      token_endpoint: `${issuer.href}token`,
      // Omitted when discoveryNoPkceMetadata is set (to prove we still send S256).
      ...(discoveryNoPkceMetadata ? {} : { code_challenge_methods_supported: ["S256"] }),
    })),
    dynamicClientRegistrationRequest: vi.fn(async (_as, metadata) => {
      lastRegistrationMetadata = metadata as Record<string, unknown>;
      return new Response();
    }),
    processDynamicClientRegistrationResponse: vi.fn(async () => ({
      client_id: "dynamic-client-id",
      token_endpoint_auth_method: "none",
    })),
    validateAuthResponse: (_as: unknown, _client: unknown, url: URL) => {
      // Mirror oauth4webapi: a callback URL carrying `error=...` throws an
      // AuthorizationResponseError with that error (so needsInteraction can react).
      const error = url.searchParams.get("error");
      if (error) throw new AuthorizationResponseError(error);
      return new URLSearchParams({ code: "authcode", state: "state" });
    },
    authorizationCodeGrantRequest: vi.fn(async () => {
      if (tokenDelay) await tokenDelay();
      // First call throws a DPoP-nonce error when the test asks; the retry succeeds.
      if (dpopNonceOnFirstGrant && grantCalls === 0) {
        grantCalls++;
        throw new DPoPNonceError();
      }
      grantCalls++;
      return new Response();
    }),
    isDPoPNonceError: (e: unknown) => e instanceof DPoPNonceError,
    processAuthorizationCodeResponse: vi.fn(async () => ({
      access_token: loginAccessToken,
      refresh_token: loginRefreshToken,
      token_type: loginTokenType,
      ...(loginExpiresIn !== undefined ? { expires_in: loginExpiresIn } : {}),
    })),
    getValidatedIdTokenClaims: () => ({ webid: webIdClaim, sub: webIdClaim }),
  };
});

// Import AFTER the mocks are registered.
const { createSolidAuth, MissingAuthFlowError, isUseDpopNonceChallenge } = await import(
  "../src/index.js"
);

/** A simple in-memory SessionStore that records puts. */
class RecordingStore implements SessionStore {
  readonly map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
  puts: string[] = [];
  async get(issuer: string) {
    return this.map.get(issuer);
  }
  async put(s: import("@jeswr/solid-session-restore").PersistedSession) {
    this.map.set(s.issuer, s);
    this.puts.push(s.webId);
  }
  async delete(issuer: string) {
    this.map.delete(issuer);
  }
}

// Captures the authorization URL getCode was handed (to assert PKCE params).
let lastAuthUrl: URL | undefined;
const authFlow = {
  getCode: async (url: URL) => {
    lastAuthUrl = url;
    return "https://app.example/callback?code=authcode&state=state";
  },
};

beforeEach(() => {
  lastRegistrationMetadata = undefined;
  webIdClaim = "https://alice.pod.example/profile/card#me";
  agentIssuer = "https://idp.example/";
  agentIssuers = undefined;
  tokenDelay = undefined;
  issuerResolveDelay = undefined;
  dpopThumbprint = "test-dpop-jkt";
  restoreRotationsAttempted = 0;
  loginAccessToken = "access-token";
  loginExpiresIn = undefined;
  loginRefreshToken = "refresh-token";
  loginTokenType = "DPoP";
  refreshAccessToken = "refreshed-access-token";
  refreshGrantCalls = 0;
  restoreDelay = undefined;
  restoreInvalidGrant = false;
  refreshWebId = undefined;
  refreshDpopKey = undefined;
  discoveryNoPkceMetadata = false;
  dpopNonceOnFirstGrant = false;
  grantCalls = 0;
  lastDpopHtu = undefined;
  lastDpopKey = undefined;
  lastDpopNonce = undefined;
  lastAuthUrl = undefined;
  recordedAuthHeader = null;
});

// The base fetch a controller's authenticatedFetch runs over: the FIRST call to
// any URL 401s (to trigger the refresh-on-401 retry path), the SECOND (re-upgraded)
// call records its Authorization header. With proactive auth, the first call is
// already token-bearing, so this also exercises the 401-retry-with-refresh path.
let recordedAuthHeader: string | null = null;
function recordingBaseFetch(): typeof fetch {
  let seen = false;
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input as RequestInfo);
    if (!seen) {
      seen = true;
      return new Response("unauth", { status: 401 });
    }
    recordedAuthHeader = req.headers.get("Authorization");
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
}

// A base fetch that ALWAYS returns 200 and records EVERY call's Authorization header —
// to prove `.fetch` attaches the token PROACTIVELY (on the very first request), not
// only after a 401.
function ok200RecordingFetch(): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input as RequestInfo);
    recordedAuthHeader = req.headers.get("Authorization");
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
}

/**
 * Drive `controller.authenticatedFetch(url)` over a recording base fetch and return
 * the Authorization header the controller attached on the upgraded retry — or null
 * when no token was attached (foreign origin / no session).
 */
async function authdHeader(controller: LoginController, url: string): Promise<string | null> {
  recordedAuthHeader = null;
  await controller.authenticatedFetch(url);
  return recordedAuthHeader;
}
afterEach(() => {
  vi.clearAllTimers();
});

describe("createSolidAuth — dynamic registration metadata (Medium fix)", () => {
  it("requests the refresh_token grant so silent restore gets a refresh token", async () => {
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      store, // no clientId → dynamic registration path
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(lastRegistrationMetadata).toBeDefined();
    expect(lastRegistrationMetadata?.grant_types).toEqual(["authorization_code", "refresh_token"]);
    // And the refresh token was persisted for next-load restore.
    expect(store.puts).toEqual(["https://alice.pod.example/profile/card#me"]);
  });

  it("persists the DYNAMIC client_id so a refresh-token grant can run as that client (High fix)", async () => {
    // Refresh tokens are client-bound; the default (no static clientId) path MUST
    // persist the server-assigned dynamic client id, or silent restore re-registers
    // a new client that cannot redeem the old token.
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      store, // no clientId → dynamic registration → client_id "dynamic-client-id"
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(store.map.get("https://idp.example/")?.clientId).toBe("dynamic-client-id");
  });

  it("treats an EMPTY-STRING clientId as dynamic and persists the DYNAMIC client_id (Low fix)", async () => {
    // The roborev finding: `clientId: ""` must be normalized to "no static clientId" — a
    // `??` fallback would otherwise persist "" instead of the server-assigned dynamic id,
    // breaking later silent restore (the refresh token is client-bound).
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "", // empty string → must behave exactly like undefined (dynamic)
      store,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    // The dynamic registration path ran (empty clientId == no static client).
    expect(lastRegistrationMetadata).toBeDefined();
    // The persisted client_id is the DYNAMIC one, NOT the empty string.
    expect(store.map.get("https://idp.example/")?.clientId).toBe("dynamic-client-id");
    expect(store.map.get("https://idp.example/")?.clientId).not.toBe("");
  });

  it("persists the STATIC clientId when one is configured", async () => {
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(store.map.get("https://idp.example/")?.clientId).toBe(
      "https://app.example/clientid.jsonld",
    );
  });

  it("ALWAYS sends an S256 PKCE challenge — even when discovery omits the metadata (Medium fix)", async () => {
    discoveryNoPkceMetadata = true; // OP does not advertise code_challenge_methods_supported
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(lastAuthUrl).toBeDefined();
    expect(lastAuthUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(lastAuthUrl?.searchParams.get("code_challenge")).toBe("challenge");
    // Never the `plain` downgrade.
    expect(lastAuthUrl?.searchParams.get("code_challenge_method")).not.toBe("plain");
  });

  it("BINDS the auth code to the DPoP key via dpop_jkt on the authorization request (Medium fix)", async () => {
    // RFC 9449 §10 / Solid-OIDC DPoP authorization-code binding: the auth request must
    // carry `dpop_jkt` = the DPoP key's JWK thumbprint, or strict providers reject the
    // login / issue a token not bound to our key.
    dpopThumbprint = "alice-key-jkt";
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(lastAuthUrl?.searchParams.get("dpop_jkt")).toBe("alice-key-jkt");
  });

  it("OMITS dpop_jkt (does not block login) when the DPoP handle can't compute a thumbprint", async () => {
    // Best-effort: a handle whose calculateThumbprint throws must not fail the login — the
    // token-endpoint DPoP proof still binds the token; dpop_jkt is just omitted.
    dpopThumbprint = ""; // sentinel; we make the handle THROW via the mock below
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    // Force calculateThumbprint to throw for this test only.
    const oauthMod = (await import("oauth4webapi")) as unknown as {
      DPoP: () => { calculateThumbprint: () => Promise<string> };
    };
    const origDPoP = oauthMod.DPoP;
    (oauthMod as { DPoP: unknown }).DPoP = () => ({
      calculateThumbprint: async () => {
        throw new Error("no thumbprint");
      },
    });
    try {
      const result = await controller.login("https://alice.pod.example/profile/card#me");
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me"); // login STILL succeeds
      expect(lastAuthUrl?.searchParams.has("dpop_jkt")).toBe(false); // just omitted
    } finally {
      (oauthMod as { DPoP: unknown }).DPoP = origDPoP;
    }
  });

  it("RETRIES the auth-code token exchange once on a server DPoP-nonce challenge (Medium fix)", async () => {
    dpopNonceOnFirstGrant = true; // the first token request gets use_dpop_nonce
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    const result = await controller.login("https://alice.pod.example/profile/card#me");
    // The grant was attempted twice (first → nonce error, retry → success).
    expect(grantCalls).toBe(2);
    expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
  });

  it("REJECTS a chooseIssuer result that the profile did not advertise (High fix)", async () => {
    // The profile advertises two issuers (so the chooser runs). A chooser returning an
    // UNLISTED OP must be rejected — it would bypass the Solid issuer↔WebID binding.
    agentIssuers = ["https://real-idp.example/", "https://other-idp.example/"];
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      chooseIssuer: async () => "https://evil-idp.example/", // NOT advertised
    });
    await expect(controller.login("https://alice.pod.example/profile/card#me")).rejects.toThrow(
      /does not advertise/,
    );
  });

  it("ACCEPTS a chooseIssuer result that IS advertised", async () => {
    agentIssuers = ["https://real-idp.example/", "https://other-idp.example/"];
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      chooseIssuer: async () => "https://other-idp.example/", // one of the advertised
    });
    const result = await controller.login("https://alice.pod.example/profile/card#me");
    expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
  });

  it("REJECTS a non-DPoP (Bearer) token response — DPoP-only controller (Medium fix)", async () => {
    loginTokenType = "Bearer"; // the OP returned a bearer token, not DPoP-bound
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    await expect(controller.login("https://alice.pod.example/profile/card#me")).rejects.toThrow(
      /DPoP/,
    );
    // No bearer credential was persisted as if DPoP-bound, and no session was pinned.
    expect(store.puts).toEqual([]);
    expect(controller.webId).toBeNull();
  });

  it("retries INTERACTIVELY when the silent (prompt=none) leg returns a DIFFERENT WebID — account switch (Medium fix)", async () => {
    // The user is asking to log in as Alice, but an existing IdP cookie on the same
    // issuer silently authenticates Bob (prompt=none). The login must NOT hard-fail —
    // it retries with an interactive prompt so the user selects Alice.
    let leg = 0;
    const switchingAuthFlow = {
      getCode: async (url: URL) => {
        leg++;
        lastAuthUrl = url; // capture for the prompt assertion
        // First leg = prompt=none → Bob; second (interactive, prompt!=none) → Alice.
        webIdClaim =
          url.searchParams.get("prompt") === "none"
            ? "https://bob.pod.example/profile/card#me"
            : "https://alice.pod.example/profile/card#me";
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: switchingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    const result = await controller.login("https://alice.pod.example/profile/card#me");
    expect(leg).toBe(2); // silent leg (Bob) then interactive retry (Alice)
    expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    // The interactive retry forced an ACCOUNT CHOOSER (select_account), not just
    // consent — otherwise the IdP could keep returning the existing account.
    expect(lastAuthUrl?.searchParams.get("prompt")).toContain("select_account");
  });

  it("does NOT run a SECOND interactive leg if the mismatch-retry itself needs interaction (Low fix)", async () => {
    // The roborev follow-up: silent leg returns the WRONG WebID → ONE interactive retry. If
    // THAT interactive leg itself throws an interaction-required error, it must PROPAGATE
    // (login fails) — NOT be re-treated as a silent-leg failure and trigger a THIRD leg.
    let leg = 0;
    const flow = {
      getCode: async (url: URL) => {
        leg++;
        if (url.searchParams.get("prompt") === "none") {
          // Silent leg → a DIFFERENT WebID (Bob), triggering the interactive mismatch retry.
          webIdClaim = "https://bob.pod.example/profile/card#me";
          return "https://app.example/callback?code=authcode&state=state";
        }
        // Interactive leg → returns a callback carrying an interaction-required error, so
        // validateAuthResponse throws an AuthorizationResponseError (needsInteraction).
        return "https://app.example/callback?error=account_selection_required&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: flow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    await expect(controller.login("https://alice.pod.example/profile/card#me")).rejects.toThrow();
    // EXACTLY two legs: silent (Bob) + ONE interactive retry. No third leg.
    expect(leg).toBe(2);
    expect(controller.webId).toBeNull();
  });

  it("falls back to the interactive prompt on account_selection_required (needsInteraction fix)", async () => {
    let leg = 0;
    const selectAuthFlow = {
      getCode: async (url: URL) => {
        leg++;
        // The silent leg's response is account_selection_required (interaction needed).
        if (url.searchParams.get("prompt") === "none") {
          return "https://app.example/callback?error=account_selection_required&state=state";
        }
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: selectAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    const result = await controller.login("https://alice.pod.example/profile/card#me");
    expect(leg).toBe(2); // silent → account_selection_required → interactive retry
    expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
  });
});

describe("createSolidAuth — login generation fence (Medium fix)", () => {
  it("does NOT open the popup for a login superseded DURING its pre-popup phase (Medium fix)", async () => {
    // The roborev follow-up: a login awaits issuer resolution / discovery / client metadata
    // BEFORE opening the popup. If a logout / newer login advances #generation during that
    // window, the stale attempt must NOT drive getCode (open/block the popup) — it should
    // bail with AbortError first.
    let getCodeCalls = 0;
    const countingAuthFlow = {
      getCode: async () => {
        getCodeCalls++;
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: countingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    // Gate the profile fetch so the login hangs in its PRE-POPUP (issuer-resolution) phase.
    let releaseResolve!: () => void;
    issuerResolveDelay = () =>
      new Promise<void>((res) => {
        releaseResolve = res;
      });
    const login = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated profile fetch

    // A logout lands during the pre-popup window (advances #generation).
    issuerResolveDelay = undefined;
    await controller.logout();

    // Release the profile fetch so the stale login proceeds — it must BAIL before getCode.
    releaseResolve();
    await expect(login).rejects.toThrow();
    expect(getCodeCalls).toBe(0); // the popup was NEVER opened for the superseded attempt
    expect(controller.webId).toBeNull();
  });

  it("does NOT redeem the auth code when superseded WHILE the popup (getCode) is pending (Medium fix)", async () => {
    // The roborev follow-up: getCode is a LONG await (the user interacts). If a logout /
    // newer login advances #generation during it, the stale attempt must NOT proceed to
    // redeem the authorization code (validateAuthResponse + the token grant) — it should
    // bail right after getCode returns, so no token is needlessly minted at the OP.
    let releaseCode!: () => void;
    const gatedAuthFlow = {
      getCode: async (_url: URL, signal?: AbortSignal) => {
        await new Promise<void>((res) => {
          releaseCode = res;
          // also resolve if the controller aborts the popup
          signal?.addEventListener("abort", () => res());
        });
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: gatedAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    grantCalls = 0; // the auth-code token grant attempt counter (oauth mock)
    const login = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated getCode (popup open)

    // A logout lands WHILE the popup is pending (advances #generation).
    await controller.logout();

    // Release the popup → the stale attempt must BAIL before redeeming the code.
    releaseCode();
    await expect(login).rejects.toThrow();
    // The authorization-code grant was NEVER attempted (no token minted for the stale login).
    expect(grantCalls).toBe(0);
    expect(controller.webId).toBeNull();
  });

  it("a STALE login (resolving issuer late) does NOT overwrite a NEWER login's active popup-abort handle (Medium fix)", async () => {
    // The roborev follow-up: #authenticate assigns #activeLoginAbort only AFTER awaiting
    // issuer resolution. A STALE login A (resolving slowly) must NOT then register ITS abort
    // controller over a NEWER login B's — else a later logout would abort A's (dead) handle,
    // leaving B's popup un-cancelled. ONE capturing authFlow records each getCode call's
    // signal so we can tell which attempt owns the active handle a logout aborts.
    const signals: AbortSignal[] = [];
    const capturingAuthFlow = {
      getCode: (_url: URL, signal?: AbortSignal) =>
        new Promise<string>((res) => {
          if (signal) signals.push(signal);
          signal?.addEventListener("abort", () =>
            res("https://app.example/callback?code=x&state=state"),
          );
        }),
    };
    const controller = createSolidAuth({
      authFlow: capturingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    // Login A: gate its profile fetch so it stays in PRE-POPUP (its #activeLoginAbort
    // assignment hasn't happened yet — it's behind the awaited #resolveIssuer).
    let releaseAResolve!: () => void;
    issuerResolveDelay = () =>
      new Promise<void>((res) => {
        releaseAResolve = res;
      });
    const a = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // A reaches the gated profile fetch

    // Login B (newer generation): NOT gated → B resolves, reaches getCode, registers B's
    // abort handle as #activeLoginAbort. Capture B's popup signal (signals[0]).
    issuerResolveDelay = undefined;
    const b = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // B opens its popup
    expect(signals.length).toBe(1); // only B reached getCode so far
    const bSignal = signals[0];
    expect(bSignal.aborted).toBe(false);

    // NOW release A's profile fetch. A is STALE (B superseded it). A's #authenticate must
    // NOT register A's abort handle over B's. (A then bails at its post-resolve gen check.)
    releaseAResolve();
    await expect(a).rejects.toThrow(); // A discarded

    // A logout supersedes B → it must abort B's popup (the still-active one), NOT a stale A.
    await controller.logout();
    expect(bSignal.aborted).toBe(true); // B's popup was cancelled
    await expect(b).rejects.toThrow();
    expect(controller.webId).toBeNull();
  });

  it("a prior pre-popup login resuming during a newer login's drain window is discarded; no stale popup wins (Medium fix)", async () => {
    // The roborev follow-up: login() awaits #drainActiveGrants() BEFORE bumping, a yield
    // window in which a prior pre-popup login can resume, register its handle + open a popup
    // while still seeing the OLD generation. The newer login RE-ABORTS after bumping. The
    // robust, interleaving-independent invariant: exactly ONE login wins (the newer B),
    // the prior A is discarded, NO popup signal is left un-aborted, and the controller ends
    // on B's session. (The exact microtask order varies; we assert the outcome, not it.)
    const signals: AbortSignal[] = [];
    let leg = 0;
    const capturingAuthFlow = {
      getCode: (_url: URL, signal?: AbortSignal) => {
        const myLeg = ++leg;
        return new Promise<string>((res) => {
          if (signal) signals.push(signal);
          // A popup resolves on abort (cancelled) OR — for the WINNER that is never aborted —
          // immediately, so the winning login can complete. Tag the code with the leg so we
          // never confuse identities (all map to the same WebID via webIdClaim).
          signal?.addEventListener("abort", () =>
            res(`https://app.example/callback?code=x${myLeg}&state=state`),
          );
          // Resolve on the next macrotask if NOT aborted (the winner's popup completes).
          setTimeout(() => res(`https://app.example/callback?code=x${myLeg}&state=state`), 5);
        });
      },
    };
    const controller = createSolidAuth({
      authFlow: capturingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    // Login A gated at issuer resolution (pre-popup).
    let releaseAResolve!: () => void;
    issuerResolveDelay = () =>
      new Promise<void>((res) => {
        releaseAResolve = res;
      });
    const a = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // A reaches the gated profile fetch

    // Release A so it resumes during B's drain window, then start B in the same tick.
    issuerResolveDelay = undefined;
    releaseAResolve();
    const b = controller.login("https://alice.pod.example/profile/card#me");

    // A is discarded (superseded); B wins; controller ends on B's session.
    await expect(a).rejects.toThrow();
    const bRes = await b;
    expect(bRes.webId).toBe("https://alice.pod.example/profile/card#me");
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    // Exactly one live session, and no superseded attempt left a stale popup that "won".
    // (A bailed at a generation checkpoint; its popup, if opened, was aborted.)
    expect(controller.webId).not.toBeNull();
  });

  it("IMMEDIATELY aborts the in-flight popup signal when a logout/newer login supersedes it (Medium fix)", async () => {
    // The roborev follow-up: a superseding logout/login must abort the open popup's signal
    // RIGHT AWAY (so the popup driver can cancel), not only after getCode returns.
    let capturedSignal: AbortSignal | undefined;
    const gatedAuthFlow = {
      getCode: (_url: URL, signal?: AbortSignal) =>
        new Promise<string>((res) => {
          capturedSignal = signal;
          signal?.addEventListener("abort", () =>
            res("https://app.example/callback?code=authcode&state=state"),
          );
        }),
    };
    const controller = createSolidAuth({
      authFlow: gatedAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    const login = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the open popup
    expect(capturedSignal?.aborted).toBe(false); // not yet aborted

    // A logout supersedes the in-flight login → the popup signal aborts IMMEDIATELY.
    await controller.logout();
    expect(capturedSignal?.aborted).toBe(true); // aborted by logout, without getCode returning first

    await expect(login).rejects.toThrow(); // the stale login bails
    expect(controller.webId).toBeNull();
  });

  it("a LATER login supersedes a slower EARLIER one — earlier is discarded (AbortError)", async () => {
    // Same WebID for both attempts so the WebID-match check never confounds the
    // generation fence we are isolating. The property under test: the slower
    // EARLIER attempt, finishing after a LATER one started, must REJECT (superseded)
    // and must NOT re-persist/overwrite — exactly the stale-clobber roborev flagged.
    const store = new RecordingStore();
    webIdClaim = "https://alice.pod.example/profile/card#me";
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });

    // First login is SLOW (its token exchange waits on a gate we control).
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((res) => {
      releaseFirst = res;
    });
    tokenDelay = () => firstGate;
    const first = controller.login("https://alice.pod.example/profile/card#me");

    // Second login starts AFTER (later generation) and completes FAST.
    tokenDelay = undefined;
    const second = await controller.login("https://alice.pod.example/profile/card#me");
    expect(second.webId).toBe("https://alice.pod.example/profile/card#me");
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    const putsAfterSecond = store.puts.length;

    // Now let the EARLIER login finish — it must be discarded (superseded by the
    // later generation), NOT re-persist or overwrite the winning session.
    releaseFirst();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    // The superseded attempt did NOT add another persist after the winner.
    expect(store.puts.length).toBe(putsAfterSecond);
  });

  it("a superseded login's STORE WRITE cannot land after the winner's (persist race)", async () => {
    // The roborev persist-race: an earlier login that has already STARTED persisting
    // must not have its store write land last and overwrite a later login's
    // credential. We gate the FIRST put so the earlier write is still pending when a
    // later login starts + persists; on release the earlier write must be SKIPPED.
    let releasePut!: () => void;
    const putGate = new Promise<void>((res) => {
      releasePut = res;
    });
    let putCount = 0;
    const writes: string[] = [];
    const gatedMap = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const gatedStore: SessionStore = {
      get: async (issuer) => gatedMap.get(issuer),
      put: async (s) => {
        putCount++;
        if (putCount === 1) await putGate; // hold the FIRST write open
        writes.push(s.refreshToken);
        gatedMap.set(s.issuer, s);
      },
      delete: async (issuer) => {
        gatedMap.delete(issuer);
      },
    };

    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: gatedStore,
    });

    // First login: distinct refresh token; its persist will hang on the gate.
    loginRefreshToken = "refresh-FIRST";
    const first = controller.login("https://alice.pod.example/profile/card#me");
    // Yield so the first login reaches its (gated) persist.
    await new Promise((r) => setTimeout(r, 0));

    // Second (later) login: distinct refresh token; its persist is CHAINED after
    // the first's, so even though the first write is in flight, the second's write
    // is guaranteed to land LAST (serialized) — the winner's credential stands.
    loginRefreshToken = "refresh-SECOND";
    const second = controller.login("https://alice.pod.example/profile/card#me");
    // Release the gated first write so the chain can drain.
    releasePut();
    await second;
    await first.catch(() => {}); // first is superseded → may reject; ignore

    // The WINNER (second) credential is the one persisted (the serialized chain made
    // the later login's write land last — a stale earlier write cannot win).
    expect(gatedMap.get("https://idp.example/")?.refreshToken).toBe("refresh-SECOND");
    // And the second write came strictly after the first in the serialized chain.
    expect(writes.at(-1)).toBe("refresh-SECOND");
  });

  it("a superseded login ROLLS BACK its persist if the winner fails before writing (race)", async () => {
    // The remaining race: an earlier login persists (gated), a NEWER login supersedes
    // it but then FAILS before writing its own credential. The earlier (superseded)
    // write must be ROLLED BACK so no stale credential lingers — durable state matches
    // the logged-out in-memory state.
    let releasePut!: () => void;
    const putGate = new Promise<void>((res) => {
      releasePut = res;
    });
    let putCount = 0;
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        putCount++;
        if (putCount === 1) await putGate; // hold the FIRST (earlier login's) write
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    // The SECOND login's getCode rejects (it fails before persisting).
    let codeCalls = 0;
    const failingAuthFlow = {
      getCode: async () => {
        codeCalls++;
        if (codeCalls === 2) throw new Error("second login failed at the popup");
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: failingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });

    loginRefreshToken = "refresh-FIRST";
    const first = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated first persist

    // The newer login supersedes (bumps generation) then FAILS at getCode.
    const second = controller.login("https://alice.pod.example/profile/card#me");
    await expect(second).rejects.toThrow(/second login failed/);

    // Release the earlier login's gated put — it completes, then DETECTS it was
    // superseded and rolls its write back.
    releasePut();
    await first.catch(() => {});

    // No stale credential remains (the superseded write was rolled back), and the
    // controller is logged out (both logins ended unsuccessfully).
    expect(map.get("https://idp.example/")).toBeUndefined();
    expect(controller.webId).toBeNull();
  });

  it("a superseded login's rollback RESTORES the prior account's credential, not deletes it (High fix)", async () => {
    // The roborev follow-up: a value-aware rollback. A PRIOR account A already has a stored
    // credential for the issuer. A login B (same issuer) overwrites it, then is superseded
    // mid-put and rolls back. The rollback must RESTORE A's credential (snapshot-and-restore)
    // — NOT blindly delete it — so A's still-live session can still refresh.
    let releasePut!: () => void;
    const putGate = new Promise<void>((res) => {
      releasePut = res;
    });
    let putCount = 0;
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    // Pre-seed account A's credential for the issuer (a prior live session).
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "A-PRIOR-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        putCount++;
        // Hold B's (the first NEW login's) put so a newer login can supersede it mid-put.
        if (putCount === 1) await putGate;
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    let codeCalls = 0;
    const failingAuthFlow = {
      getCode: async () => {
        codeCalls++;
        if (codeCalls === 2) throw new Error("superseding login failed at the popup");
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: failingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    // Login B writes a DIFFERENT refresh token for the same issuer; its put is gated.
    loginRefreshToken = "B-refresh";
    const b = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach B's gated put

    // A newer login C supersedes B (bumps generation) then FAILS before writing.
    const c = controller.login("https://alice.pod.example/profile/card#me");
    await expect(c).rejects.toThrow(/superseding login failed/);

    // Release B's gated put → B completes, detects supersession, and ROLLS BACK by
    // RESTORING the snapshot (A's credential), not deleting.
    releasePut();
    await b.catch(() => {});

    // A's ORIGINAL credential is intact (restored), NOT destroyed — A can still refresh.
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-PRIOR-refresh");
  });
});

describe("createSolidAuth — logout is fail-closed (High fixes)", () => {
  it("a logout during a PENDING persist leaves NO credential (delete serialized after the write)", async () => {
    // High #1: a logout during an in-flight store write must not let a stale
    // credential survive. logout's durable delete is chained AFTER the pending
    // persist, so the final durable state is DELETED.
    let releasePut!: () => void;
    const putGate = new Promise<void>((res) => {
      releasePut = res;
    });
    let putCount = 0;
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        putCount++;
        if (putCount === 1) await putGate; // hold the login's persist open
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    const login = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated persist
    // Log out while the persist is still pending; its delete is chained after.
    const logout = controller.logout();
    releasePut();
    await login.catch(() => {});
    await logout;
    // The credential was written by the login then DELETED by the chained logout.
    expect(map.get("https://idp.example/")).toBeUndefined();
    expect(controller.webId).toBeNull();
  });

  it("clears the remembered pointer + goes logged-out locally, but REJECTS to surface a durable delete failure (Medium fix)", async () => {
    // High #2: a failing durable delete must not leave the remembered pointer, or the next
    // load would silently restore a "logged-out" session. The local teardown (pointer
    // cleared, webId null, pristine fetch) is fail-closed regardless. BUT logout() now
    // REJECTS when the durable delete fails — so a consumer learns the persisted credential
    // may LINGER (the roborev finding), instead of logout silently reporting fully complete.
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    // A localStorage shim the RememberedAccount reads/writes.
    const ls = {
      getItem: (_k: string) => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: (_k: string) => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const store: SessionStore = {
        get: async () => undefined,
        put: async () => {},
        delete: async () => {
          throw new Error("store delete failed");
        },
      };
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // logout REJECTS (surfacing the durable delete failure) …
      await expect(controller.logout()).rejects.toThrow(/durable storage|could not be deleted/i);
      // … but the LOCAL teardown still happened (fail-closed): pointer cleared, logged out.
      expect(remembered.value).toBeNull(); // pointer cleared despite the delete throw
      expect(controller.webId).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a logout during an in-flight RESTORE is not undone by the restore's rotation write (High fix)", async () => {
    // restoreSession internally re-persists a ROTATED refresh token. If logout races
    // an in-flight restore, that internal write must NOT re-create the credential
    // after logout deleted it. The guarded store skips the write once superseded.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    // Seed a persisted session + remembered pointer so restore has something to do.
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // Gate the restore grant so logout can race in between read and rotation write.
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      const restoring = controller.restore();
      await new Promise((r) => setTimeout(r, 0)); // reach the gated grant

      // Log out WHILE the restore is mid-grant. logout deletes the credential.
      await controller.logout();
      expect(map.get("https://idp.example/")).toBeUndefined();

      // Now let the restore's rotation write proceed — it must be SKIPPED (superseded).
      releaseRestore();
      await restoring;
      expect(map.get("https://idp.example/")).toBeUndefined(); // NOT re-created
      expect(controller.webId).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a logout ABORTS an in-flight restore grant — the token is NOT redeemed/rotated under a stale generation (High fix)", async () => {
    // The roborev follow-up: the grant ITSELF (not just its store write) is fenced. A
    // logout that supersedes an in-flight restore aborts the grant's signal, so the mock
    // (mirroring the real restoreSession's signal-aware fetches) rejects BEFORE rotating —
    // the refresh token is never spent under a stale generation, so the stored credential
    // is left exactly as logout left it (deleted here), never re-created by a rotation.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // Gate the restore grant AFTER the read, so logout can land + abort while mid-grant.
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      restoreRotationsAttempted = 0;
      const restoring = controller.restore();
      await new Promise((r) => setTimeout(r, 0)); // reach the gated grant

      // Logout supersedes + ABORTS the grant signal, and deletes the credential.
      await controller.logout();

      // Release the gated grant: it sees the aborted signal and throws WITHOUT rotating —
      // it does NOT spend the token nor re-persist a rotated one.
      releaseRestore();
      await restoring;
      // The grant was ABORTED before redeeming/rotating the token (the key new behavior):
      // it never reached the token-redeem step, so the refresh token was not spent.
      expect(restoreRotationsAttempted).toBe(0);
      // No rotated credential was written either.
      expect(map.get("https://idp.example/")).toBeUndefined();
      expect(controller.webId).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("authenticatedFetch returns the pristine publicFetch again after logout", async () => {
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(controller.authenticatedFetch).not.toBe(controller.publicFetch); // logged in
    await controller.logout();
    expect(controller.authenticatedFetch).toBe(controller.publicFetch); // logged out
  });

  it("a stale restore's invalid_grant DELETE cannot remove a newer login's credential (High fix)", async () => {
    // A restore is mid-grant and will hit invalid_grant (→ delete). Meanwhile a NEWER
    // login persists a fresh credential for the same issuer. The stale restore's
    // guarded delete must be SKIPPED (generation advanced), so the new credential
    // survives. Guards the store DELETE, not just put.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "old-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // The restore will hit invalid_grant → delete; gate it so a login can land first.
      restoreInvalidGrant = true;
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      const restoring = controller.restore();
      await new Promise((r) => setTimeout(r, 0)); // reach the gated grant

      // A NEWER login lands a fresh credential while the restore is mid-grant.
      restoreDelay = undefined;
      loginRefreshToken = "fresh-refresh";
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(map.get("https://idp.example/")?.refreshToken).toBe("fresh-refresh");

      // Let the stale restore proceed to its delete — it must be SKIPPED (superseded).
      releaseRestore();
      await restoring;
      expect(map.get("https://idp.example/")?.refreshToken).toBe("fresh-refresh"); // NOT deleted
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a restore that yields a cleartext http WebID is rejected + forgotten (High fix)", async () => {
    // A persisted http: (non-loopback) WebID must NOT restore a session (it would join
    // allowedOrigins and let the token ride over cleartext). Restore → login + forget.
    const httpWebId = "http://alice.pod.example/profile/card#me";
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: httpWebId,
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({ webId: httpWebId, issuer: "https://idp.example/" }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      const outcome = await controller.restore();
      expect(outcome).toEqual({ outcome: "login" }); // NOT restored
      expect(controller.webId).toBeNull(); // no session pinned
      expect(map.get("https://idp.example/")).toBeUndefined(); // credential forgotten
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a remembered-pointer WRITE failure does not reject login / hide the live session (High fix)", async () => {
    // localStorage.setItem throws (quota / private mode). The login must STILL succeed
    // with a live session — a non-credential pointer write failure cannot make a
    // successful login report logged-out.
    const ls = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: new RecordingStore(),
      });
      const result = await controller.login("https://alice.pod.example/profile/card#me");
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // The session is live (authenticatedFetch is the own wrapper, not pristine).
      expect(controller.authenticatedFetch).not.toBe(controller.publicFetch);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("recentAccounts NORMALISES corrupt/older records (non-string displayName) so render can't throw (Low fix)", async () => {
    // A stored record with a non-string displayName + avatarUrl must be normalised, not
    // passed through (it would reach initialsOf() and throw, blocking the prompt).
    const stored = JSON.stringify([
      { webId: "https://ada.example/me", displayName: 42, avatarUrl: { not: "a string" } },
      { webId: "https://bob.example/me" }, // no displayName
      { displayName: "no webid" }, // invalid — dropped
    ]);
    const ls = {
      getItem: (k: string) => (k.includes("recent-accounts") ? stored : null),
      setItem: () => {},
      removeItem: () => {},
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: new RecordingStore(),
      });
      const accounts = controller.recentAccounts();
      expect(accounts).toEqual([
        // displayName defaulted to the webId; the non-string avatarUrl dropped.
        { webId: "https://ada.example/me", displayName: "https://ada.example/me" },
        { webId: "https://bob.example/me", displayName: "https://bob.example/me" },
      ]);
      // Every displayName is a string (safe for initialsOf / render).
      for (const a of accounts) expect(typeof a.displayName).toBe("string");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("an account switch to a DIFFERENT issuer deletes the OLD issuer's persisted credential (High fix)", async () => {
    // Login A (issuer A), then login B (issuer B): the old issuer A's credential must
    // be deleted so it doesn't linger in the store forever (logout only clears the
    // active issuer).
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    // First login → issuer A (the WebID profile advertises agentIssuer).
    agentIssuer = "https://idp-a.example/";
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(map.has("https://idp-a.example/")).toBe(true);

    // Switch account → issuer B. The OLD issuer A's credential is deleted.
    agentIssuer = "https://idp-b.example/";
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(map.has("https://idp-b.example/")).toBe(true);
    expect(map.has("https://idp-a.example/")).toBe(false); // old credential cleaned up
  });

  it("a login SUPERSEDED during its account-switch cleanup does NOT report a stale success (Medium fix)", async () => {
    // The roborev follow-up: login() rechecks supersession after #persist, but the
    // account-switch cleanup (#forget the old issuer's credential) is an awaited store op.
    // If a LOGOUT advances #generation WHILE that delete is in flight, the login must NOT
    // resolve a success for an account the controller no longer holds — it must throw.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    let releaseDelete!: () => void;
    let gateDelete = false;
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        if (gateDelete) {
          gateDelete = false; // one-shot: only the FIRST delete (the switch cleanup) hangs
          await new Promise<void>((res) => {
            releaseDelete = res;
          });
        }
        map.delete(i);
      },
    };
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    // First login → issuer A.
    agentIssuer = "https://idp-a.example/";
    await controller.login("https://alice.pod.example/profile/card#me");

    // Switch login → issuer B; gate the cleanup DELETE of issuer A so it hangs in #forget.
    agentIssuer = "https://idp-b.example/";
    gateDelete = true;
    const switching = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated #forget(A)

    // A logout lands WHILE the switch login's cleanup is in flight (supersedes it).
    const loggingOut = controller.logout();
    // Release the gated delete so the switch login proceeds past #forget.
    releaseDelete();
    // The superseded switch login must THROW (not resolve a stale success for B) …
    await expect(switching).rejects.toThrow();
    await loggingOut;
    // … and the controller reflects the LOGOUT (logged out), not B.
    expect(controller.webId).toBeNull();
  });

  it("recentAccounts SURVIVES logout (it is the returning-user affordance, Medium fix)", async () => {
    const remembered: { value: string | null } = { value: null };
    const recent: { value: string | null } = { value: null };
    const ls = {
      getItem: (k: string) => (k.includes("recent-accounts") ? recent.value : remembered.value),
      setItem: (k: string, v: string) => {
        if (k.includes("recent-accounts")) recent.value = v;
        else remembered.value = v;
      },
      removeItem: (k: string) => {
        if (k.includes("recent-accounts")) recent.value = null;
        else remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: new RecordingStore(),
        rememberedAccountsKey: "my-app.remembered-account",
        recentAccountsKey: "my-app.recent-accounts",
      });
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(controller.recentAccounts().map((a) => a.webId)).toEqual([
        "https://alice.pod.example/profile/card#me",
      ]);
      await controller.logout();
      // The session + the silent-restore pointer are cleared, but the recent-accounts
      // list SURVIVES (the returning-user affordance).
      expect(controller.webId).toBeNull();
      expect(remembered.value).toBeNull(); // restore pointer cleared
      expect(controller.recentAccounts().map((a) => a.webId)).toEqual([
        "https://alice.pod.example/profile/card#me",
      ]);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a restore whose WebID differs from the remembered one NEVER pins a session (High fix)", async () => {
    // The persisted credential at the remembered issuer authenticates a DIFFERENT
    // WebID than the remembered one (corrupt/misfiled store). The controller must NOT
    // pin that session even transiently — controller.webId stays null and the bad
    // pointer + credential are torn down (webid-mismatch).
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://mallory.pod.example/profile/card#me", // NOT the remembered WebID
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me", // remembered = Alice
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // restoreSession returns Mallory's WebID (the stored entry's), != remembered Alice.
      refreshWebId = "https://mallory.pod.example/profile/card#me";
      const outcome = await controller.restore();
      expect(outcome).toEqual({ outcome: "login" }); // mismatch → login, never restored
      expect(controller.webId).toBeNull(); // the mismatched session was NEVER pinned
      // Fail-closed teardown: the known-bad credential + pointer are cleared.
      expect(map.get("https://idp.example/")).toBeUndefined();
      expect(remembered.value).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a restore SUPERSEDED by a logout reports its CURRENT state (login), not a stale 'restored' (Medium fix)", async () => {
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // Gate the restore grant; log out while it is in flight (supersedes it).
      refreshWebId = "https://alice.pod.example/profile/card#me";
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      const restoring = controller.restore();
      await new Promise((r) => setTimeout(r, 0));
      await controller.logout(); // supersedes the restore + clears the session
      releaseRestore();
      // The restore reports its CURRENT state — login (logged out), NOT a stale restored.
      await expect(restoring).resolves.toEqual({ outcome: "login" });
      expect(controller.webId).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a FAILED account-switch login leaves the existing session still REFRESHABLE (Medium fix)", async () => {
    // Login A succeeds (expired token so a later request triggers a refresh). A second
    // login attempt FAILS (popup cancelled). The bump-at-start must not strand A's
    // session — A must still refresh on its next 401.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    let codeCalls = 0;
    const flakyAuthFlow = {
      getCode: async () => {
        codeCalls++;
        // The SECOND login (any prompt) is cancelled.
        if (codeCalls >= 2) throw new DOMException("cancelled", "AbortError");
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: flakyAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      // 200-recording base: the EXPIRED token is refreshed PROACTIVELY (expiry passed),
      // no spurious 401 needed — so exactly ONE refresh proves A is still refreshable.
      publicFetch: ok200RecordingFetch(),
    });
    loginExpiresIn = 0; // A's token is already expired
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");

    // A second login attempt fails (cancelled at the popup) — A's session stays live.
    await expect(controller.login("https://alice.pod.example/profile/card#me")).rejects.toThrow();
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");

    // A's session must STILL refresh (its generation was re-synced, not left stale by the
    // failed attempt's generation bump). The expired token is refreshed proactively.
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(1);
    expect(recordedAuthHeader).toBe("DPoP refreshed-access-token");
  });

  it("no-arg login() falls back to the most-recent account AFTER logout cleared the pointer (Medium fix)", async () => {
    const remembered: { value: string | null } = { value: null };
    const recent: { value: string | null } = { value: null };
    const ls = {
      getItem: (k: string) => (k.includes("recent-accounts") ? recent.value : remembered.value),
      setItem: (k: string, v: string) => {
        if (k.includes("recent-accounts")) recent.value = v;
        else remembered.value = v;
      },
      removeItem: (k: string) => {
        if (k.includes("recent-accounts")) recent.value = null;
        else remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: new RecordingStore(),
        rememberedAccountsKey: "app.remembered",
        recentAccountsKey: "app.recent-accounts",
      });
      await controller.login("https://alice.pod.example/profile/card#me");
      await controller.logout(); // clears the remembered pointer; recent list survives
      expect(remembered.value).toBeNull();
      // No-arg login must re-login the most-recent account (from the surviving list).
      const result = await controller.login();
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("a stale restore does NOT clear the remembered pointer a newer login wrote (Medium fix)", async () => {
    // A restore that ends in "login" would normally drop the pointer. If a NEWER login
    // succeeds + writes a pointer while the restore is mid-grant, the stale restore
    // must NOT clear it afterward (the generation re-check).
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    // Seed a persisted credential so restore has something to attempt; the restore will
    // be gated then return a DEAD token (invalid_grant) → "login" → would drop pointer.
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "old-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      // Gate the restore so a login can land during it; the restore yields invalid_grant.
      restoreInvalidGrant = true;
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      const restoring = controller.restore();
      await new Promise((r) => setTimeout(r, 0)); // reach the gated grant

      // A NEWER login succeeds + writes the remembered pointer.
      restoreDelay = undefined;
      loginRefreshToken = "fresh-refresh";
      await controller.login("https://alice.pod.example/profile/card#me");
      const pointerAfterLogin = remembered.value;
      expect(pointerAfterLogin).not.toBeNull();

      // The stale restore now resolves to "login" — it must NOT clear the pointer.
      releaseRestore();
      await restoring;
      expect(remembered.value).toBe(pointerAfterLogin); // pointer preserved
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });
});

describe("createSolidAuth — silent-restore pointer gated on a durable credential (Medium fix)", () => {
  // A Map-backed localStorage so a test can inspect the silent-restore pointer and the
  // recent-accounts list SEPARATELY (they live under distinct keys). Returns the keys.
  function installKeyedLocalStorage(): {
    map: Map<string, string>;
    restore: () => void;
  } {
    const map = new Map<string, string>();
    const ls = {
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    return {
      map,
      restore: () =>
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig }),
    };
  }

  const REMEMBERED_KEY = "test-app.remembered-account"; // the silent-restore pointer
  const RECENT_KEY = "test-app.recent-accounts"; // the logout-surviving returning-user list

  it("does NOT write the silent-restore pointer when the OP issued NO refresh_token, but DOES remember the recent account", async () => {
    // The roborev finding: login wrote the silent-restore pointer even when persist
    // stored nothing durable (no refresh_token). That pointer would drive an auto-restore
    // attempt next load that can only fall back — despite login claiming restorability.
    loginRefreshToken = undefined as unknown as string; // OP omits the refresh token
    const store = new RecordingStore();
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      const result = await controller.login("https://alice.pod.example/profile/card#me");
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me"); // live session
      // Nothing durable was persisted (no refresh token).
      expect(store.puts).toEqual([]);
      // The SILENT-RESTORE pointer was NOT written — a next-load auto-restore would only
      // fall back, so we must not claim the account is restorable.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
      // But the RECENT-ACCOUNT entry IS remembered (the logout-surviving affordance is
      // fine without a restorable credential — it just powers the picker / no-arg login).
      expect(controller.recentAccounts()).toEqual([
        {
          webId: "https://alice.pod.example/profile/card#me",
          displayName: "https://alice.pod.example/profile/card#me",
        },
      ]);
      expect(ls.map.get(RECENT_KEY)).toBeDefined();
    } finally {
      ls.restore();
    }
  });

  it("does NOT write the silent-restore pointer when the durable store WRITE THROWS, but DOES remember the recent account", async () => {
    // Same invariant via the other failure mode: a refresh_token WAS issued, but the
    // store.put throws (private mode / quota) so nothing is durably stored. The pointer
    // must still not be written; the recent account is still remembered.
    loginRefreshToken = "refresh-token"; // OP DID issue one
    const throwingStore: SessionStore = {
      get: async () => undefined,
      put: async () => {
        throw new Error("QuotaExceededError");
      },
      delete: async () => {},
    };
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: throwingStore,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      const result = await controller.login("https://alice.pod.example/profile/card#me");
      // Login still SUCCEEDS with a live session (a durable-write failure is non-fatal).
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // The store write failed → nothing restorable → NO silent-restore pointer.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
      // Recent account still remembered.
      expect(ls.map.get(RECENT_KEY)).toBeDefined();
      expect(controller.recentAccounts()[0]?.webId).toBe(
        "https://alice.pod.example/profile/card#me",
      );
    } finally {
      ls.restore();
    }
  });

  it("DOES write the silent-restore pointer on a normal login (a refresh credential was durably stored)", async () => {
    // The positive control: the happy path must STILL write the pointer so auto-restore
    // works — the gating only suppresses pointers to non-restorable sessions.
    loginRefreshToken = "refresh-token";
    const store = new RecordingStore();
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      await controller.login("https://alice.pod.example/profile/card#me");
      // A credential was durably stored …
      expect(store.map.get("https://idp.example/")?.refreshToken).toBe("refresh-token");
      // … so the silent-restore pointer IS written (next-load auto-restore is valid).
      const pointer = JSON.parse(ls.map.get(REMEMBERED_KEY) as string);
      expect(pointer).toEqual({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      });
    } finally {
      ls.restore();
    }
  });

  it("CLEARS a pre-existing silent-restore pointer when a successful login is NOT restorable (High fix)", async () => {
    // The roborev follow-up: gating the pointer WRITE is not enough. If a PREVIOUS,
    // restorable session left a pointer (e.g. to account B), a later successful login
    // that stores NO credential (no refresh_token) must CLEAR that stale pointer — else
    // the next load silently restores the WRONG (old) account instead of falling back to
    // login for the current, non-restorable session.
    loginRefreshToken = undefined as unknown as string; // this login yields no refresh token
    const store = new RecordingStore();
    const ls = installKeyedLocalStorage();
    // Pre-seed a pointer to a DIFFERENT account (bob) on the same issuer, as a prior
    // restorable login would have left.
    ls.map.set(
      REMEMBERED_KEY,
      JSON.stringify({
        webId: "https://bob.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    );
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      // Login resolves to alice (webIdClaim default) but the OP issues no refresh_token.
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me"); // live
      // The STALE pointer (to bob) is GONE — next load will fall back to login, NOT
      // silently restore bob.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
    } finally {
      ls.restore();
    }
  });

  it("DELETES the previous SAME-ISSUER account's stored credential when the new login stores none (High fix)", async () => {
    // Same-issuer account switch where the new login persists nothing: the store still
    // holds the PREVIOUS account's credential for this issuer. It must be deleted so a
    // later restore can't redeem the wrong account's refresh token for this issuer.
    loginRefreshToken = undefined as unknown as string; // new login yields no refresh token
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    // Pre-seed account B's credential for the issuer (a prior login on the same issuer).
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://bob.pod.example/profile/card#me",
      refreshToken: "bob-stale-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const ls = installKeyedLocalStorage();
    // The pointer also points at bob (the prior restorable account).
    ls.map.set(
      REMEMBERED_KEY,
      JSON.stringify({
        webId: "https://bob.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    );
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      // Login resolves to alice on the SAME issuer, but issues no refresh_token.
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // Bob's stale credential for this issuer is GONE (not left to be redeemed).
      expect(map.get("https://idp.example/")).toBeUndefined();
      // And the stale pointer is cleared too.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
    } finally {
      ls.restore();
    }
  });

  it("KEEPS the SAME-WebID credential on a re-login that writes none (no spurious delete) (Medium fix)", async () => {
    // The roborev follow-up: the same-issuer cleanup must fire ONLY for an account SWITCH
    // (different WebID). A plain SAME-WebID re-login that writes no new credential (e.g. the
    // OP didn't re-issue a refresh_token on this leg) must NOT delete the still-valid stored
    // credential for that same account — that would make the live session non-restorable.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      // First login (alice) WITH a refresh token → persists alice's credential.
      loginRefreshToken = "alice-refresh";
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(map.get("https://idp.example/")?.refreshToken).toBe("alice-refresh");
      // SAME-WebID re-login (alice again, same issuer) that yields NO refresh_token.
      loginRefreshToken = undefined as unknown as string;
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // The SAME account's credential is KEPT (not deleted) — it is still valid + restorable.
      expect(map.get("https://idp.example/")?.refreshToken).toBe("alice-refresh");
    } finally {
      ls.restore();
    }
  });

  it("does NOT write the silent-restore pointer with the NON-DURABLE in-memory fallback store (Low fix)", async () => {
    // The roborev follow-up: when IndexedDB is unavailable the controller falls back to a
    // MemorySessionStore. A put there "succeeds" but does NOT survive a reload — so the
    // silent-restore pointer must NOT be written (it would drive a doomed restore attempt
    // next load). NO `store` is injected here, so the in-memory fallback is used (this
    // jsdom env has no global indexedDB). A refresh token IS issued — the only reason the
    // session is non-restorable is the store's non-durability.
    loginRefreshToken = "refresh-token";
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        // no `store` → in-memory MemorySessionStore fallback (non-durable)
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      const result = await controller.login("https://alice.pod.example/profile/card#me");
      expect(result.webId).toBe("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me"); // live this load
      // The silent-restore pointer is NOT written — the in-memory credential won't survive
      // a reload, so next load must fall back to login, not attempt a doomed restore.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
      // The recent account IS still remembered (logout-surviving affordance).
      expect(ls.map.get(RECENT_KEY)).toBeDefined();
    } finally {
      ls.restore();
    }
  });

  it("restore() FAILS CLOSED to login AND CLEARS a CORRUPT remembered silent-restore pointer (#119)", async () => {
    // #119 regression: a CORRUPT (non-JSON / unparseable) silent-restore pointer must not
    // crash restore and must not be re-attempted next load. restore() must (a) return the
    // fail-closed `{ outcome: "login" }` (the bad pointer can't drive a restore) AND (b)
    // CLEAR the bad pointer so a later load doesn't keep tripping over it.
    //
    // The pointer is unparseable, so RememberedAccount.read() yields null → restore() has
    // no last-active WebID → decideSilentRestore short-circuits to "no-account" → login,
    // and the keep/drop matrix DROPS the (no-account) pointer. A store seeded with a
    // credential confirms the credential is NOT redeemed: the corrupt pointer never names
    // an issuer to restore, so the restore-grant path (restoreSession) is never entered.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    // The module-level restoreSession mock increments refreshGrantCalls when it actually
    // redeems a token; a corrupt pointer must drive ZERO such grants.
    refreshGrantCalls = 0;
    const ls = installKeyedLocalStorage();
    // Seed a CORRUPT (unparseable) value under the silent-restore pointer key.
    ls.map.set(REMEMBERED_KEY, "{not-valid-json:::");
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      const outcome = await controller.restore();
      // (a) FAIL CLOSED: no session is pinned; the outcome is login.
      expect(outcome).toEqual({ outcome: "login" });
      expect(controller.webId).toBeNull();
      // No restore grant was attempted (the corrupt pointer yields no issuer/WebID).
      expect(refreshGrantCalls).toBe(0);
      // (b) The CORRUPT pointer is CLEARED so the next load won't re-attempt it.
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
    } finally {
      ls.restore();
    }
  });

  it("KEEPS the in-memory-written credential so the live session can STILL refresh after a SAME-ISSUER re-login (Medium fix)", async () => {
    // The roborev follow-up: with the in-memory fallback, a login's put is REAL for the
    // page lifetime (so `wrote`=true) even though it is non-durable (`durable`=false). The
    // same-issuer cleanup branch must therefore be gated on `!wrote` (NOT `!durable`) —
    // else a SAME-ISSUER re-login would DELETE the credential it just wrote and break this
    // session's refresh. We exercise the branch by doing a FIRST login (establishes a
    // same-issuer pointer/session) then a SECOND login on the SAME issuer, all on the
    // in-memory fallback store, then prove a refresh still succeeds.
    loginRefreshToken = "in-memory-refresh";
    const ls = installKeyedLocalStorage();
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        // no `store` → in-memory MemorySessionStore fallback (non-durable)
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
        publicFetch: ok200RecordingFetch(),
      });
      // First login (establishes a prior session + previousIssuer for the second).
      loginExpiresIn = 3600;
      await controller.login("https://alice.pod.example/profile/card#me");
      // Second login on the SAME issuer (the same-issuer cleanup branch is reachable now),
      // with an expired token so a later fetch forces a refresh.
      loginExpiresIn = 0;
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // The pointer is suppressed (non-durable), as the Low fix requires …
      expect(ls.map.get(REMEMBERED_KEY)).toBeUndefined();
      // … BUT the in-memory credential was NOT deleted by the same-issuer cleanup: a
      // refresh of the expired token SUCCEEDS (it redeemed the in-memory refresh token).
      refreshGrantCalls = 0;
      recordedAuthHeader = null;
      await controller.authenticatedFetch("https://alice.pod.example/private/note");
      expect(refreshGrantCalls).toBe(1); // redeemed the in-memory credential → refreshed
      expect(recordedAuthHeader).toBe("DPoP refreshed-access-token");
    } finally {
      ls.restore();
    }
  });

  it("restore() is SINGLE-FLIGHT — concurrent calls share ONE restore (no rotating-token race) (Medium fix)", async () => {
    // The roborev follow-up: two callers sharing one controller (e.g. two panels) must not
    // run concurrent refresh-token restores against the same stored credential — with token
    // rotation, the second would invalid_grant + delete the freshly-rotated credential. The
    // controller dedups concurrent restore() calls into a single underlying restore.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const ls = installKeyedLocalStorage();
    ls.map.set(
      REMEMBERED_KEY,
      JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    );
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
        rememberedAccountsKey: REMEMBERED_KEY,
        recentAccountsKey: RECENT_KEY,
      });
      // Gate the restore grant so two concurrent restore() calls would BOTH be in flight if
      // they ran independently.
      refreshWebId = "https://alice.pod.example/profile/card#me";
      refreshGrantCalls = 0;
      let releaseRestore!: () => void;
      restoreDelay = () =>
        new Promise<void>((res) => {
          releaseRestore = res;
        });
      // Two concurrent restore() calls on the SAME controller.
      const a = controller.restore();
      const b = controller.restore();
      await new Promise((r) => setTimeout(r, 0));
      releaseRestore();
      const [ra, rb] = await Promise.all([a, b]);
      // Only ONE underlying restore ran (the second shared the in-flight promise), so the
      // stored (rotated) credential was not double-redeemed / deleted.
      expect(refreshGrantCalls).toBe(1);
      expect(ra).toEqual({
        outcome: "restored",
        webId: "https://alice.pod.example/profile/card#me",
      });
      expect(rb).toEqual(ra);
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
      // The rotated credential survives (not deleted by a racing second restore).
      expect(map.get("https://idp.example/")?.refreshToken).toBe("rotated-refresh-token");
    } finally {
      ls.restore();
    }
  });
});

describe("createSolidAuth — authFlow is OPTIONAL for restore-only usage (Low fix)", () => {
  it("constructs and silently restores WITHOUT an authFlow (restore-only consumer)", async () => {
    // The roborev finding: authFlow was required by the options type even though
    // silent-restore-only usage never drives the popup. A restore-only consumer must be
    // able to construct + restore() with no popup driver.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      // NOTE: no `authFlow` supplied — must compile (optional) and construct fine.
      const controller = createSolidAuth({
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      const outcome = await controller.restore();
      expect(outcome).toEqual({
        outcome: "restored",
        webId: "https://alice.pod.example/profile/card#me",
      });
      expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });

  it("login() WITHOUT an authFlow throws MissingAuthFlowError BEFORE any network (Low fix)", async () => {
    // The roborev follow-up: the authFlow check must happen BEFORE issuer resolution, so a
    // restore-only controller's mistaken login() fails fast with the targeted error and
    // makes NO profile/issuer network request.
    const { fetchRdf } = await import("@jeswr/fetch-rdf");
    const fetchRdfMock = vi.mocked(fetchRdf);
    fetchRdfMock.mockClear();
    const controller = createSolidAuth({
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    await expect(controller.login("https://alice.pod.example/profile/card#me")).rejects.toThrow(
      MissingAuthFlowError,
    );
    // NO profile/issuer fetch was made (failed fast before #resolveIssuer).
    expect(fetchRdfMock).not.toHaveBeenCalled();
    // No session was pinned and no credential was persisted by the failed attempt.
    expect(controller.webId).toBeNull();
  });

  it("restore() does NOT pin a session when the rotation WRITE FAILED (store↔memory consistency, Medium fix)", async () => {
    // The roborev follow-up (restore side): restoreSession returns a live rotated token
    // even if its rotation `put` failed. Pinning a session on that token while the store
    // keeps the old (spent) refresh token would strand it on the next refresh. So when the
    // rotation write did not durably persist, restore() must fall back to login (not pin).
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    map.set("https://idp.example/", {
      issuer: "https://idp.example/",
      webId: "https://alice.pod.example/profile/card#me",
      refreshToken: "stored-refresh",
      dpopKey: { publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair,
    });
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async () => {
        throw new Error("QuotaExceededError"); // the rotation write always fails
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const remembered: { value: string | null } = {
      value: JSON.stringify({
        webId: "https://alice.pod.example/profile/card#me",
        issuer: "https://idp.example/",
      }),
    };
    const ls = {
      getItem: () => remembered.value,
      setItem: (_k: string, v: string) => {
        remembered.value = v;
      },
      removeItem: () => {
        remembered.value = null;
      },
    };
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store,
      });
      const outcome = await controller.restore();
      // The rotation write failed → no durable credential to back the session → fall back
      // to login, do NOT pin a session on a non-persisted (would-be-stranded) token.
      expect(outcome).toEqual({ outcome: "login" });
      expect(controller.webId).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });
});

describe("createSolidAuth — the auth seam", () => {
  it("publicFetch is stable; authenticatedFetch is the controller's own wrapper after login; global NOT patched by default", async () => {
    const store = new RecordingStore();
    const origGlobal = globalThis.fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
    });
    try {
      // Before login: webId null, publicFetch is a stable function.
      expect(controller.webId).toBeNull();
      const publicBefore = controller.publicFetch;
      expect(typeof publicBefore).toBe("function");

      await controller.login("https://alice.pod.example/profile/card#me");

      // After login: publicFetch is UNCHANGED (the pristine snapshot is stable),
      // and authenticatedFetch is the controller's own wrapper — a DIFFERENT function.
      expect(controller.publicFetch).toBe(publicBefore);
      expect(controller.authenticatedFetch).not.toBe(controller.publicFetch);
      // Default: the GLOBAL fetch is NOT patched.
      expect(globalThis.fetch).toBe(origGlobal);
    } finally {
      globalThis.fetch = origGlobal;
    }
  });

  it("patchGlobalFetch: true installs a CONTROLLER-OWNED global wrapper (not ReactiveFetchManager) that authenticates allowed origins over the pristine base", async () => {
    const origGlobal = globalThis.fetch;
    loginExpiresIn = 3600; // valid token → proactive attach, no 401 force-refresh
    // The pristine base the controller is given: always 200s + records every call's auth
    // header, so we observe the PROACTIVE token attach over the pristine base.
    const base = ok200RecordingFetch();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      patchGlobalFetch: true,
      publicFetch: base, // the known-pristine base the global wrapper must anchor on
    });
    try {
      await controller.login("https://alice.pod.example/profile/card#me");
      // The GLOBAL fetch was replaced by the controller's wrapper (not the original).
      expect(globalThis.fetch).not.toBe(origGlobal);
      // A bare global fetch() to an ALLOWED origin is authenticated (token attached
      // proactively over the PRISTINE base — proving the wrapper anchors on publicFetch,
      // with the same boundary/retry as .authenticatedFetch).
      recordedAuthHeader = null;
      await globalThis.fetch("https://alice.pod.example/private/note");
      expect(recordedAuthHeader).toBe("DPoP access-token");
      // A FOREIGN origin via the global wrapper stays unauthenticated (the boundary).
      recordedAuthHeader = null;
      await globalThis.fetch("https://evil.example/steal");
      expect(recordedAuthHeader).toBeNull();
    } finally {
      globalThis.fetch = origGlobal;
    }
  });

  it("the global wrapper anchors on the PRISTINE base, NOT a pre-patched global (no cross-controller credential chain) (High fix)", async () => {
    // The roborev finding: ReactiveFetchManager captured the CURRENT global, so a global
    // already patched by ANOTHER controller would be chained — letting a bare fetch be
    // authenticated by a previous session. Our owned wrapper anchors on the injected
    // pristine base and must NEVER route through the (here, foreign-authenticating) global.
    const origGlobal = globalThis.fetch;
    // Simulate a HOSTILE pre-existing global patch that would attach a foreign token.
    let hostileCalled = false;
    globalThis.fetch = (async () => {
      hostileCalled = true;
      return new Response("HOSTILE", { status: 200 });
    }) as typeof fetch;
    const base = ok200RecordingFetch(); // the pristine base records what WE attach
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      patchGlobalFetch: true,
      publicFetch: base,
    });
    try {
      await controller.login("https://alice.pod.example/profile/card#me");
      recordedAuthHeader = null;
      const res = await globalThis.fetch("https://alice.pod.example/private/note");
      // The request went through OUR pristine base (recorded our token), NOT the hostile
      // pre-patched global — so the hostile fetch was never called.
      expect(hostileCalled).toBe(false);
      expect(await res.text()).toBe("ok");
      expect(recordedAuthHeader).toBe("DPoP access-token");
    } finally {
      globalThis.fetch = origGlobal;
    }
  });

  it("RE-ASSERTS the global wrapper on a later login if another lib overwrote globalThis.fetch (Medium fix)", async () => {
    // The roborev follow-up: the global patch is installed once. If another controller /
    // library overwrites globalThis.fetch afterwards, a SUBSEQUENT session establishment on
    // this controller must RE-INSTALL our wrapper — else bare fetch() silently stops
    // upgrading (the patchGlobalFetch contract lapses).
    const origGlobal = globalThis.fetch;
    loginExpiresIn = 3600;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      patchGlobalFetch: true,
      publicFetch: ok200RecordingFetch(),
    });
    try {
      await controller.login("https://alice.pod.example/profile/card#me");
      const ourWrapper = globalThis.fetch;
      expect(ourWrapper).not.toBe(origGlobal);
      // Another library clobbers the global fetch.
      const hostile = (() => Promise.resolve(new Response("HOSTILE"))) as typeof fetch;
      globalThis.fetch = hostile;
      // A subsequent session establishment (re-login) must RE-ASSERT our wrapper.
      await controller.login("https://alice.pod.example/profile/card#me");
      expect(globalThis.fetch).toBe(ourWrapper);
      expect(globalThis.fetch).not.toBe(hostile);
    } finally {
      globalThis.fetch = origGlobal;
    }
  });

  it("publicFetch uses the INJECTED pristine fetch, not a re-read of a patched global (High fix)", () => {
    // Simulate the global already being patched (e.g. a prior controller's
    // registerGlobally, or another lib). An injected pristine fetch must be used as
    // publicFetch, NOT the patched global.
    const patchedGlobal = (() =>
      Promise.resolve(new Response("PATCHED"))) as unknown as typeof fetch;
    const pristine = (() => Promise.resolve(new Response("PRISTINE"))) as unknown as typeof fetch;
    const orig = globalThis.fetch;
    globalThis.fetch = patchedGlobal;
    try {
      const controller = createSolidAuth({
        authFlow,
        callbackUri: "https://app.example/callback",
        clientId: "https://app.example/clientid.jsonld",
        store: new RecordingStore(),
        publicFetch: pristine,
      });
      expect(controller.publicFetch).toBe(pristine);
      expect(controller.publicFetch).not.toBe(patchedGlobal);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("rejects a cleartext http WebID login by default (cleartext-token boundary)", async () => {
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
    });
    await expect(controller.login("http://alice.pod.example/me")).rejects.toThrow(/https/);
  });
});

describe("createSolidAuth — the token provider (origin gate + refresh)", () => {
  // baseFetch chooses the pristine fetch the controller's authenticatedFetch runs over:
  //  - "401-then-200" (default): recordingBaseFetch — 401s the FIRST call (to exercise
  //    the 401-retry path) then 200s the retry, capturing the retry's auth header.
  //  - "200": ok200RecordingFetch — ALWAYS 200, recording every call's auth header (to
  //    exercise the PROACTIVE attach without any 401 force-refresh).
  async function loggedIn(expiresIn?: number, baseFetch: "401-then-200" | "200" = "401-then-200") {
    loginExpiresIn = expiresIn;
    const store = new RecordingStore();
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      publicFetch: baseFetch === "200" ? ok200RecordingFetch() : recordingBaseFetch(),
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    return { controller, store };
  }

  it("attaches the token for an ALLOWED origin (own pod) and DENIES a foreign origin", async () => {
    // Proactive 200 path (no 401): the valid token is attached as-is, no refresh.
    const { controller } = await loggedIn(3600, "200");
    // Own pod (the WebID's origin) → token attached PROACTIVELY.
    expect(await authdHeader(controller, "https://alice.pod.example/private/note")).toBe(
      "DPoP access-token",
    );
    // Foreign origin → not matched, never authenticated.
    expect(await authdHeader(controller, "https://evil.example/steal")).toBeNull();
  });

  it("refreshes an EXPIRED access token via the refresh-token grant before attaching", async () => {
    // Login with an already-expired token (expires_in 0 → expiresAt in the past). The
    // PROACTIVE attach refreshes it (known-expired), so no 401 is needed.
    const { controller, store } = await loggedIn(0, "200");
    expect(refreshGrantCalls).toBe(0);
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    // The provider redeemed the refresh token and attached the FRESH token.
    expect(refreshGrantCalls).toBe(1);
    expect(auth).toBe("DPoP refreshed-access-token");
    // The rotated refresh token was re-persisted (restoreSession does this).
    expect(store.map.get("https://idp.example/")?.refreshToken).toBe("rotated-refresh-token");
  });

  it("does NOT refresh a still-valid token on a PROACTIVE 200 fetch", async () => {
    const { controller } = await loggedIn(3600, "200"); // valid for an hour, server 200s
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(0);
    expect(auth).toBe("DPoP access-token");
  });

  it("FORCE-REFRESHES a still-future-expiry token when the server 401s it (server is authoritative) (Medium fix)", async () => {
    // The roborev follow-up: a 401 RETRY must force-refresh even when the client thinks
    // the token is still valid (future local expiry) — the server's rejection is proof
    // the token is stale (revoked / clock skew). The OLD logic suppressed the forced
    // refresh for a known-future expiry and would loop on the dead token.
    const { controller } = await loggedIn(3600, "401-then-200"); // valid-looking, but server 401s
    refreshGrantCalls = 0;
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(1); // forced a refresh despite the future expiry
    expect(auth).toBe("DPoP refreshed-access-token");
  });

  it("does NOT refresh a no-`expires_in` token on a PROACTIVE 200 fetch (no refresh-per-fetch) (Medium fix)", async () => {
    loginExpiresIn = undefined; // OP reported no lifetime
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: ok200RecordingFetch(), // server returns 200 (no 401)
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // The EXISTING token was attached; a no-expiry token must NOT trigger a refresh on
    // every proactive fetch (would rotate the token / hit rate limits).
    expect(refreshGrantCalls).toBe(0);
    expect(recordedAuthHeader).toBe("DPoP access-token");
  });

  it("DOES force-refresh a no-`expires_in` token on a 401 retry (the server rejected it)", async () => {
    const { controller } = await loggedIn(undefined); // no expires_in
    refreshGrantCalls = 0;
    // recordingBaseFetch 401s the first (proactive) call → retry forces a refresh.
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(1);
    expect(auth).toBe("DPoP refreshed-access-token");
  });

  it("attaches the token PROACTIVELY on a 200 own-origin request (not only on a 401) (Medium fix)", async () => {
    loginExpiresIn = 3600;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: ok200RecordingFetch(), // server NEVER 401s
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/public/profile");
    // The DPoP token was attached even though the server returned 200 (no 401).
    expect(recordedAuthHeader).toBe("DPoP access-token");
    // A foreign origin stays unauthenticated even via .fetch.
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://evil.example/x");
    expect(recordedAuthHeader).toBeNull();
  });

  it("builds the DPoP htu WITHOUT query/fragment (RFC 9449 §4.2)", async () => {
    const { controller } = await loggedIn(3600);
    await authdHeader(controller, "https://alice.pod.example/private/note?ver=3&x=1#frag");
    expect(lastDpopHtu).toBe("https://alice.pod.example/private/note");
  });

  it("a refresh of the OLD session (while a new login is in flight) cannot overwrite the new credential (Medium fix)", async () => {
    // Generation-binding: a session carries the generation that created it. A newer
    // login bumps the controller generation, so the old session's refresh writes under
    // a STALE generation (skipped by the guarded store) and never clobbers the newer
    // login's persisted credential for the same issuer.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    // Gate the SECOND login at getCode so it is "in flight" while we refresh the old.
    let releaseSecond!: () => void;
    let codeCalls = 0;
    const gatedAuthFlow = {
      getCode: async () => {
        codeCalls++;
        if (codeCalls === 2) {
          await new Promise<void>((res) => {
            releaseSecond = res;
          });
        }
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: gatedAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      publicFetch: recordingBaseFetch(),
    });
    // Login A with an already-expired access token.
    loginExpiresIn = 0;
    loginRefreshToken = "A-refresh";
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-refresh");

    // Start login B (bumps generation, then HANGS at getCode → in flight).
    loginRefreshToken = "B-refresh";
    const second = controller.login("https://alice.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated getCode

    // While B is in flight, an expired-token request refreshes the OLD (A) session.
    // A's refresh uses A's (now-stale) generation → its rotation write is SKIPPED.
    refreshWebId = "https://alice.pod.example/profile/card#me";
    await authdHeader(controller, "https://alice.pod.example/private/note");
    // A's refresh did NOT rotate the stored credential (still A's, not "rotated").
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-refresh");

    // Let B finish — it persists ITS credential, the winner.
    releaseSecond();
    await second;
    expect(map.get("https://idp.example/")?.refreshToken).toBe("B-refresh");
  });

  it("a FAILED in-flight switch does NOT strand the prior session on a spent token — refresh stays ATOMIC (store↔memory consistent) (Medium fix)", async () => {
    // The roborev follow-up: during an in-flight switch, a refresh of the prior session
    // must NOT half-apply — applying the rotated in-memory ACCESS token while the rotated
    // refresh-token WRITE is suppressed (superseded generation) would leave the store with
    // the OLD (now server-spent) refresh token. If the switch then FAILS, the prior session
    // would run on the new access token but, once it expired, could no longer refresh
    // (invalid_grant) → the session dies. The refresh must be ATOMIC: when the rotation
    // write is suppressed, the in-memory token is NOT applied either, so store + memory stay
    // consistent and the prior session keeps working with its still-valid persisted token.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    let releaseSecond!: () => void;
    let codeCalls = 0;
    const gatedFailingAuthFlow = {
      getCode: async () => {
        codeCalls++;
        if (codeCalls === 2) {
          await new Promise<void>((res) => {
            releaseSecond = res;
          });
          // The SECOND (switch) login FAILS after being released (popup cancelled).
          throw new DOMException("cancelled", "AbortError");
        }
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: gatedFailingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      publicFetch: ok200RecordingFetch(),
    });
    // Login A with an already-EXPIRED access token (so a fetch in the switch window WOULD
    // attempt a refresh) and a refresh token persisted.
    loginExpiresIn = 0;
    loginRefreshToken = "A-refresh";
    await controller.login("https://alice.pod.example/profile/card#me");

    // Start switch login B (bumps generation, HANGS at getCode → in flight).
    loginRefreshToken = "B-refresh";
    const second = controller.login("https://bob.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated getCode

    // During B's in-flight window, an authenticated fetch on the still-live (expired) A
    // session must NOT half-apply a rotation: the rotated WRITE is suppressed (superseded
    // generation), so the in-memory rotated token is NOT applied either (atomicity). The
    // fetch falls back to A's existing token, and crucially the store keeps A's ORIGINAL,
    // UNSPENT refresh token — so A is never stranded on a spent credential.
    refreshWebId = "https://alice.pod.example/profile/card#me";
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // The rotated ACCESS token was NOT applied (atomic with the suppressed write).
    expect(recordedAuthHeader).toBe("DPoP access-token");
    expect(recordedAuthHeader).not.toBe("DPoP refreshed-access-token");
    // The store still holds A's ORIGINAL refresh token (no spent-token stranding).
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-refresh");

    // The switch FAILS. A remains the live session, fully refreshable against its intact
    // persisted credential (generation re-synced by login()'s catch path).
    releaseSecond();
    await expect(second).rejects.toThrow();
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    // A can now refresh against its STILL-VALID persisted token (prove not stranded):
    // make the token appear expired by re-logging A is overkill — instead assert the
    // store credential is intact + unspent (a subsequent refresh would redeem A-refresh).
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-refresh");
  });

  it("a superseded prior session does NOT SPEND its refresh token during an in-flight switch, and CAN refresh after the switch FAILS (High fix)", async () => {
    // The roborev follow-up: the refresh GRANT itself redeems (rotates) the refresh token
    // server-side. Running it under a stale (superseded) generation would spend the token
    // while the rotation write is skipped — stranding the prior session on a spent token if
    // the switch fails. The PRE-GRANT fence must skip the grant entirely for a superseded
    // session, leaving the persisted token UNSPENT so the session refreshes after recovery.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    let releaseSecond!: () => void;
    let codeCalls = 0;
    const gatedFailingAuthFlow = {
      getCode: async () => {
        codeCalls++;
        if (codeCalls === 2) {
          await new Promise<void>((res) => {
            releaseSecond = res;
          });
          throw new DOMException("cancelled", "AbortError"); // the switch FAILS
        }
        return "https://app.example/callback?code=authcode&state=state";
      },
    };
    const controller = createSolidAuth({
      authFlow: gatedFailingAuthFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      publicFetch: ok200RecordingFetch(),
    });
    // Login A with an EXPIRED access token (so a fetch wants a refresh).
    loginExpiresIn = 0;
    loginRefreshToken = "A-refresh";
    await controller.login("https://alice.pod.example/profile/card#me");

    // Start switch login B (bumps generation, HANGS at getCode → in flight).
    loginRefreshToken = "B-refresh";
    const second = controller.login("https://bob.pod.example/profile/card#me");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated getCode

    // During B's in-flight window, a fetch on the expired A session must NOT run the
    // refresh grant (it would spend A's refresh token under a stale generation).
    refreshWebId = "https://alice.pod.example/profile/card#me";
    refreshGrantCalls = 0;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(0); // the grant was SKIPPED (token not spent)
    expect(map.get("https://idp.example/")?.refreshToken).toBe("A-refresh"); // unspent

    // The switch FAILS → A is re-synced as the live session.
    releaseSecond();
    await expect(second).rejects.toThrow();
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");

    // NOW A CAN refresh — its token was never spent, so the grant succeeds and rotates.
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    expect(refreshGrantCalls).toBe(1); // refresh succeeded (token was unspent)
    expect(recordedAuthHeader).toBe("DPoP refreshed-access-token");
    expect(map.get("https://idp.example/")?.refreshToken).toBe("rotated-refresh-token");
  });

  it("login() DRAINS an in-flight refresh grant (aborts + awaits it) without deadlocking (High fix)", async () => {
    // The roborev follow-up: a new login DRAINS in-flight refresh grants before advancing
    // the generation — abort them AND AWAIT their settle (so a grant the OP already
    // processed lands its rotation write under its still-valid generation). The drain's
    // await must be BOUNDED by the abort (the grant bails promptly), so login does NOT
    // deadlock on a never-released refresh gate. We GATE the refresh with a gate that does
    // NOT resolve on its own — only the abort (honoured by the mock) can unblock it; if the
    // drain did not abort, login would hang.
    const { controller } = await loggedIn(0, "200"); // logged in, EXPIRED token
    // Gate the refresh grant with a NEVER-resolving manual gate — only the abort unblocks it.
    restoreDelay = () => new Promise<void>(() => {});
    refreshWebId = "https://alice.pod.example/profile/card#me";
    const pendingFetch = controller.authenticatedFetch("https://alice.pod.example/private/note");
    await new Promise((r) => setTimeout(r, 0)); // refresh grant is now in flight (gated)

    // Clear the gate for the NEW login's own flow, then start it. Its #drainActiveGrants
    // ABORTS the in-flight refresh (which honours the abort and unblocks) and AWAITS it —
    // then proceeds. If drain did not abort, this login would hang on the never-resolving
    // gate; reaching resolution proves abort+await drain works.
    restoreDelay = undefined;
    grantCalls = 0;
    await controller.login("https://alice.pod.example/profile/card#me"); // must not deadlock
    // login proceeded to its auth-code grant (no deadlock on the drain).
    expect(grantCalls).toBeGreaterThanOrEqual(1);
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
    // The pending fetch's aborted refresh fell back to the existing token (best-effort).
    await pendingFetch.catch(() => {});
  });

  it("does NOT apply the refreshed in-memory token when the rotation WRITE FAILED (store↔memory consistency, Medium fix)", async () => {
    // The roborev follow-up: restoreSession returns a live (rotated) token even when its
    // internal rotation `put` FAILED (best-effort persist). Applying that new in-memory
    // access token while the store kept the OLD (spent) refresh token would strand the
    // session once the token expired. The controller must apply the refresh ONLY when the
    // rotation durably persisted; here `put` throws, so the refresh must NOT be applied.
    const map = new Map<string, import("@jeswr/solid-session-restore").PersistedSession>();
    let failPut = false;
    const store: SessionStore = {
      get: async (i) => map.get(i),
      put: async (s) => {
        if (failPut) throw new Error("QuotaExceededError");
        map.set(s.issuer, s);
      },
      delete: async (i) => {
        map.delete(i);
      },
    };
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store,
      // 200-recording base: the expired token triggers exactly ONE PROACTIVE refresh (no
      // 401 retry), so the attempt count is deterministic.
      publicFetch: ok200RecordingFetch(),
    });
    loginExpiresIn = 0; // expired → the proactive attach forces a refresh
    loginRefreshToken = "login-refresh"; // the credential login persists
    await controller.login("https://alice.pod.example/profile/card#me");
    expect(map.get("https://idp.example/")?.refreshToken).toBe("login-refresh");
    // Now make the rotation `put` FAIL for the refresh that the next fetch triggers.
    failPut = true;
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // A refresh was attempted (the grant ran) …
    expect(refreshGrantCalls).toBe(1);
    // … but because its rotation write FAILED, the new token was NOT applied — the fetch
    // fell back to the EXISTING (login) token, keeping store + memory consistent.
    expect(recordedAuthHeader).toBe("DPoP access-token");
    expect(recordedAuthHeader).not.toBe("DPoP refreshed-access-token");
    // The store still holds the credential login persisted (the failed rotation put did
    // NOT overwrite it with the rotated token).
    expect(map.get("https://idp.example/")?.refreshToken).toBe("login-refresh");
  });

  it("REFUSES a refresh that returns a DIFFERENT WebID (cross-account guard, Medium fix)", async () => {
    const { controller } = await loggedIn(0); // expired → triggers a refresh
    // The persisted credential now maps to a DIFFERENT account (same issuer).
    refreshWebId = "https://mallory.pod.example/profile/card#me";
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    // The cross-account refreshed token is REJECTED — the original (expired) token is
    // attached as a best effort, NOT mallory's, and the session WebID is unchanged.
    expect(auth).toBe("DPoP access-token");
    expect(auth).not.toBe("DPoP refreshed-access-token");
    expect(controller.webId).toBe("https://alice.pod.example/profile/card#me");
  });

  it("adopts the refreshed token's DPoP KEY so the proof is signed with the matching key (Medium fix)", async () => {
    const { controller } = await loggedIn(0); // expired → triggers a refresh
    // The refresh returns a token bound to a DIFFERENT key (e.g. another tab rotated
    // the persisted credential for the same WebID).
    const newKey = { publicKey: { id: "NEW" }, privateKey: { id: "NEW" } } as unknown;
    refreshDpopKey = newKey;
    const auth = await authdHeader(controller, "https://alice.pod.example/private/note");
    // The refreshed token was attached AND the DPoP proof was signed with the NEW key
    // the token is bound to (not the stale original key → would 401).
    expect(auth).toBe("DPoP refreshed-access-token");
    expect(lastDpopKey).toBe(newKey);
  });

  it("does NOT attach a token if LOGOUT happens during the refresh (High fix)", async () => {
    const { controller } = await loggedIn(0); // expired → triggers a refresh
    // Gate the refresh grant so we can log out while it is in flight.
    let releaseRefresh!: () => void;
    restoreDelay = () =>
      new Promise<void>((res) => {
        releaseRefresh = res;
      });
    // Fire the authenticated request (its 401 triggers upgrade → refresh, which hangs).
    const pending = authdHeader(controller, "https://alice.pod.example/private/note");
    await new Promise((r) => setTimeout(r, 0)); // reach the gated refresh
    // Log out WHILE the refresh is in flight — supersedes the captured session.
    await controller.logout();
    releaseRefresh();
    const auth = await pending;
    // The captured (now-superseded) session's token must NOT be attached after logout.
    expect(auth).toBeNull();
    expect(controller.webId).toBeNull();
  });
});

describe("createSolidAuth — resource-server DPoP nonce (RFC 9449 §8, Medium fix)", () => {
  // A base fetch that answers the FIRST request to a protected resource with a
  // `use_dpop_nonce` 401 + a `DPoP-Nonce` header, then 200s the retry. It records the
  // number of calls + the auth/DPoP headers the RETRY carried.
  function nonceChallengeFetch(opts?: { nonce?: string; alsoOn200?: string }): {
    fetch: typeof fetch;
    calls: () => number;
  } {
    let calls = 0;
    const nonce = opts?.nonce ?? "server-nonce-1";
    const f = (async (input: RequestInfo | URL): Promise<Response> => {
      calls++;
      const req = input instanceof Request ? input : new Request(input as RequestInfo);
      if (calls === 1) {
        // First request: the RS demands a DPoP nonce.
        return new Response("use a nonce", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            "DPoP-Nonce": nonce,
          },
        });
      }
      // Retry: record what the client sent back, return 200 (optionally rotating).
      recordedAuthHeader = req.headers.get("Authorization");
      const headers = opts?.alsoOn200 ? { "DPoP-Nonce": opts.alsoOn200 } : undefined;
      return new Response("ok", { status: 200, headers });
    }) as typeof fetch;
    return { fetch: f, calls: () => calls };
  }

  it("retries with the server-supplied nonce embedded in the DPoP proof — WITHOUT burning a refresh", async () => {
    loginExpiresIn = 3600; // a perfectly valid token: the 401 is about the NONCE, not staleness
    const harness = nonceChallengeFetch({ nonce: "server-nonce-1" });
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: harness.fetch,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    lastDpopNonce = undefined;
    const res = await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // Exactly two calls: the proactive (nonce-less) attempt + the nonce-carrying retry.
    expect(harness.calls()).toBe(2);
    expect(res.status).toBe(200);
    // The retry's proof embedded the server's nonce …
    expect(lastDpopNonce).toBe("server-nonce-1");
    expect(recordedAuthHeader).toBe("DPoP access-token");
    // … and a pure NONCE challenge did NOT force a refresh-token grant (the token was fine).
    expect(refreshGrantCalls).toBe(0);
  });

  it("caches the nonce per origin so the NEXT request to that origin carries it on the first try", async () => {
    loginExpiresIn = 3600;
    // First fetch: challenge + retry establishes the cached nonce. Then a follow-up
    // fetch to the SAME origin must carry the nonce on its very first attempt.
    let calls = 0;
    const f = (async (): Promise<Response> => {
      calls++;
      if (calls === 1) {
        return new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": 'DPoP error="use_dpop_nonce"', "DPoP-Nonce": "n-1" },
        });
      }
      // The nonce the proof on THIS request carried is captured in lastDpopNonce.
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    // First fetch: 401 challenge then nonce-carrying retry (calls 1 + 2).
    await controller.authenticatedFetch("https://alice.pod.example/a");
    // Second fetch to the SAME origin: it must carry the cached nonce on the FIRST try
    // (call 3) — no second challenge needed.
    lastDpopNonce = undefined;
    await controller.authenticatedFetch("https://alice.pod.example/b");
    expect(calls).toBe(3); // challenge + retry + one-shot second request
    // The second request's first (and only) attempt embedded the cached nonce.
    expect(lastDpopNonce).toBe("n-1");
  });

  it("does NOT send one origin's nonce to a DIFFERENT origin (per-origin scoping)", async () => {
    loginExpiresIn = 3600;
    // Each allowed origin issues its OWN nonce on the FIRST request to it (tracked by a
    // per-origin call count), then 200s. The nonce one origin established must never be
    // sent to another origin.
    const callsByOrigin = new Map<string, number>();
    const f = (async (input: RequestInfo | URL): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(input as RequestInfo);
      const origin = new URL(req.url).origin;
      const n = (callsByOrigin.get(origin) ?? 0) + 1;
      callsByOrigin.set(origin, n);
      if (n === 1) {
        // First contact with this origin → challenge with a per-origin nonce.
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            "DPoP-Nonce": `nonce-for-${origin}`,
          },
        });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      allowedOrigins: ["https://pod2.example"], // a second allowed pod origin
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    // Establish origin A's nonce (challenge + retry).
    await controller.authenticatedFetch("https://alice.pod.example/a");
    // A request to origin B: its FIRST attempt must NOT carry A's nonce. We assert the
    // nonce embedded on B's retry is B's own — and B was genuinely challenged (so A's
    // cached nonce was not silently reused to skip B's challenge).
    lastDpopNonce = undefined;
    await controller.authenticatedFetch("https://pod2.example/b");
    expect(lastDpopNonce).toBe("nonce-for-https://pod2.example");
    expect(callsByOrigin.get("https://pod2.example")).toBe(2); // B challenged + retried
  });

  it("does NOT loop forever — a single retry only (a persistent nonce 401 returns the 401)", async () => {
    loginExpiresIn = 3600;
    let calls = 0;
    // The RS ALWAYS 401s with a (rotating) nonce — the client must retry ONCE and then
    // return the 401, never loop.
    const f = (async (): Promise<Response> => {
      calls++;
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": 'DPoP error="use_dpop_nonce"', "DPoP-Nonce": `n-${calls}` },
      });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    const res = await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // Exactly two calls (proactive + one retry), then the 401 is surfaced — no infinite loop.
    expect(calls).toBe(2);
    expect(res.status).toBe(401);
  });

  it("never caches a nonce for a FOREIGN (non-allowed) origin", async () => {
    loginExpiresIn = 3600;
    // A foreign origin is unauthenticated (publicFetch), so even if it returned a
    // DPoP-Nonce it must never be stored/echoed. We assert the request stays
    // unauthenticated (no DPoP/Authorization attached).
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: (async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(input as RequestInfo);
        recordedAuthHeader = req.headers.get("Authorization");
        return new Response(null, { status: 401, headers: { "DPoP-Nonce": "evil-nonce" } });
      }) as typeof fetch,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://evil.example/steal");
    // Foreign origin: never authenticated, so no Authorization header was attached.
    expect(recordedAuthHeader).toBeNull();
  });

  it("FORCE-REFRESHES on a 401 that carries a nonce but a NON-`use_dpop_nonce` error (stale token + rotating nonce) (Medium fix)", async () => {
    // The roborev follow-up: a server may rotate the DPoP-Nonce WHILE rejecting a dead
    // access token (error="invalid_token"). Treating that as a pure nonce challenge would
    // re-send the STALE token (just with the new nonce) and loop. We must force-refresh.
    loginExpiresIn = 3600; // expiry unknown-good; only the server's 401 proves staleness
    let calls = 0;
    const f = (async (input: RequestInfo | URL): Promise<Response> => {
      calls++;
      const req = input instanceof Request ? input : new Request(input as RequestInfo);
      if (calls === 1) {
        // Reject the token AND rotate the nonce in the SAME 401.
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": 'DPoP error="invalid_token", error_description="expired"',
            "DPoP-Nonce": "rotated-nonce",
          },
        });
      }
      recordedAuthHeader = req.headers.get("Authorization");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // The 401's error was NOT `use_dpop_nonce`, so we FORCE-REFRESHED the token …
    expect(refreshGrantCalls).toBe(1);
    // … and the retry carried the FRESH token (with the rotated nonce embedded).
    expect(recordedAuthHeader).toBe("DPoP refreshed-access-token");
    expect(lastDpopNonce).toBe("rotated-nonce");
  });

  it("does NOT force-refresh on a PURE `use_dpop_nonce` 401 (token was fine) (Medium fix)", async () => {
    // The complement: a pure nonce challenge must NOT burn a refresh-token grant — the
    // token was valid, only the nonce was missing.
    loginExpiresIn = 3600;
    let calls = 0;
    const f = (async (input: RequestInfo | URL): Promise<Response> => {
      calls++;
      const req = input instanceof Request ? input : new Request(input as RequestInfo);
      if (calls === 1) {
        return new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            "DPoP-Nonce": "the-nonce",
          },
        });
      }
      recordedAuthHeader = req.headers.get("Authorization");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // Pure nonce challenge → NO refresh, the ORIGINAL token re-sent with the nonce.
    expect(refreshGrantCalls).toBe(0);
    expect(recordedAuthHeader).toBe("DPoP access-token");
    expect(lastDpopNonce).toBe("the-nonce");
  });

  it("classifies MIXED Bearer/DPoP challenges by the DPoP challenge's OWN error (Medium fix)", () => {
    // The roborev follow-up: only the DPoP challenge's params decide it. A Bearer
    // challenge carrying `use_dpop_nonce` must NOT mask a DPoP `invalid_token`.
    const r = (h: string) => new Response(null, { headers: { "WWW-Authenticate": h } });
    // DPoP says invalid_token; Bearer says use_dpop_nonce → NOT a pure nonce challenge.
    expect(
      isUseDpopNonceChallenge(r('Bearer error="use_dpop_nonce", DPoP error="invalid_token"')),
    ).toBe(false);
    expect(
      isUseDpopNonceChallenge(r('DPoP error="invalid_token", Bearer error="use_dpop_nonce"')),
    ).toBe(false);
    // DPoP itself demands a nonce → pure nonce challenge (regardless of other schemes).
    expect(
      isUseDpopNonceChallenge(r('Bearer error="invalid_token", DPoP error="use_dpop_nonce"')),
    ).toBe(true);
    expect(isUseDpopNonceChallenge(r('DPoP error="use_dpop_nonce", algs="ES256"'))).toBe(true);
    // No DPoP challenge at all → false even if a Bearer mentions it.
    expect(isUseDpopNonceChallenge(r('Bearer error="use_dpop_nonce"'))).toBe(false);
    // No error param on the DPoP challenge → false.
    expect(isUseDpopNonceChallenge(r("DPoP"))).toBe(false);
    // QUOTE-AWARE: a quoted value that CONTAINS the literal text `error=use_dpop_nonce`
    // (here inside a `scope` param, surrounded by spaces so a naive whitespace/comma split
    // would isolate `error=use_dpop_nonce` as its own param) must NOT be mistaken for the
    // top-level error — the real DPoP error is invalid_token → false (the roborev
    // quoted-value finding). A quote-blind parser returns true here.
    expect(
      isUseDpopNonceChallenge(r('DPoP error="invalid_token", scope="a error=use_dpop_nonce b"')),
    ).toBe(false);
    // And a DPoP challenge whose top-level error IS use_dpop_nonce, with an unrelated
    // quoted description, is still correctly true.
    expect(
      isUseDpopNonceChallenge(
        r('DPoP error="use_dpop_nonce", error_description="provide a nonce"'),
      ),
    ).toBe(true);
    // MULTIPLE DPoP challenges: nonce-ONLY → true; any non-nonce DPoP error → false even
    // if another DPoP challenge says use_dpop_nonce (the roborev unambiguous-nonce finding).
    expect(
      isUseDpopNonceChallenge(r('DPoP error="use_dpop_nonce", DPoP error="invalid_token"')),
    ).toBe(false);
    expect(
      isUseDpopNonceChallenge(r('DPoP error="invalid_token", DPoP error="use_dpop_nonce"')),
    ).toBe(false);
    // BWS (optional whitespace) around `=` is valid per RFC 9110 — must still parse as a
    // nonce challenge (the roborev BWS finding). A whitespace-splitting parser misses it.
    expect(isUseDpopNonceChallenge(r('DPoP error = "use_dpop_nonce"'))).toBe(true);
    expect(isUseDpopNonceChallenge(r('DPoP error ="invalid_token"'))).toBe(false);
  });

  it("FORCE-REFRESHES when the DPoP challenge's error is invalid_token even though a Bearer says use_dpop_nonce (Medium fix)", async () => {
    loginExpiresIn = 3600;
    let calls = 0;
    const f = (async (input: RequestInfo | URL): Promise<Response> => {
      calls++;
      const req = input instanceof Request ? input : new Request(input as RequestInfo);
      if (calls === 1) {
        return new Response(null, {
          status: 401,
          headers: {
            // DPoP token is invalid; the `use_dpop_nonce` is on the Bearer challenge and
            // a rotated nonce is present — the client must NOT be fooled into skipping
            // the refresh.
            "WWW-Authenticate": 'Bearer error="use_dpop_nonce", DPoP error="invalid_token"',
            "DPoP-Nonce": "rotated",
          },
        });
      }
      recordedAuthHeader = req.headers.get("Authorization");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const controller = createSolidAuth({
      authFlow,
      callbackUri: "https://app.example/callback",
      clientId: "https://app.example/clientid.jsonld",
      store: new RecordingStore(),
      publicFetch: f,
    });
    await controller.login("https://alice.pod.example/profile/card#me");
    refreshGrantCalls = 0;
    recordedAuthHeader = null;
    await controller.authenticatedFetch("https://alice.pod.example/private/note");
    // The DPoP challenge said invalid_token → forced a refresh (not a pure nonce skip).
    expect(refreshGrantCalls).toBe(1);
    expect(recordedAuthHeader).toBe("DPoP refreshed-access-token");
  });
});
