// AUTHORED-BY Claude Opus 4.8
//
// Exhaustive tests for the FULL-PAGE-redirect (autologin) login — both the pure
// ./redirect.ts primitives (record read/write/clear, URL/fragment parsing, the pure
// planRedirect decision) AND the engine's credential-redeeming redirect flow
// (beginRedirectLogin / completeRedirectLogin / handleRedirect / hasPendingRedirect),
// with oauth4webapi + the RDF libs MOCKED so the mock-OP redirect round-trip runs
// deterministically with no real OP. The DPoP keypair is generated with REAL WebCrypto
// (extractable), so the export→persist→re-import round-trip is genuinely exercised.
//
// Security invariants pinned here (the securityCritical brief): PKCE S256 mandatory,
// state + nonce validated (mismatch REJECTS), the requested-WebID match enforced
// fail-closed, DPoP token_type enforced, the sessionStorage transient record CLEARED on
// completion AND on error (replay/back-button defeated), redirect_uri reused verbatim.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedSession, SessionStore, SolidAuthConfig } from "../src/index.js";

// ── Pure-module imports (no mocks needed — ./redirect.ts has no runtime imports) ──
import {
  authErrorFrom,
  cleanedUrl,
  clearPersistedRedirectFlow,
  hasAuthCodeParams,
  hasAuthErrorParams,
  type PersistedRedirectFlow,
  parseAutologinFragment,
  planRedirect,
  type RedirectFlowStorage,
  readPersistedRedirectFlow,
  stripAuthCallbackParams,
  writePersistedRedirectFlow,
} from "../src/redirect.js";

// ── Mocks for the engine tests (mirror controller.test.ts) ────────────────────
vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set(), etag: null })),
}));
vi.mock("@solid/object", () => ({
  Agent: class {
    get oidcIssuer() {
      return new Set([agentIssuer]);
    }
  },
}));
vi.mock("n3", () => ({ DataFactory: {} }));
// dpop is only exercised by the provider's upgrade() (not the redirect exchange); a
// trivial proof stub keeps it from touching real crypto if a fetch ever runs.
vi.mock("dpop", () => ({ generateProof: vi.fn(async () => "dpop-proof") }));

const allowInsecureRequests = Symbol("allowInsecureRequests");
const customFetch = Symbol("customFetch");
let agentIssuer = "https://idp.example/";
let webIdClaim = "https://alice.pod.example/profile/card#me";
let loginTokenType = "DPoP";
let loginRefreshToken: string | undefined = "refresh-token";
// Capture what validateAuthResponse was asked to verify the state against.
let lastExpectedState: string | undefined;
// The id_token nonce the mock OP "returns"; the token exchange must validate it against
// the persisted `expectedNonce`. Set to a different value to simulate a tampered nonce.
let idTokenNonce = "nonce";
// Capture the expectedNonce the exchange passed (to assert the PERSISTED nonce is used).
let lastExpectedNonce: string | undefined;

vi.mock("oauth4webapi", () => {
  class AuthorizationResponseError extends Error {
    error: string;
    constructor(error: string) {
      super(error);
      this.error = error;
    }
  }
  class DPoPNonceError extends Error {}
  return {
    AuthorizationResponseError,
    DPoPNonceError,
    allowInsecureRequests,
    customFetch,
    nopkce: Symbol("nopkce"),
    None: () => ({ kind: "none" }),
    ClientSecretBasic: (secret: string) => ({ kind: "client_secret_basic", secret }),
    ClientSecretPost: (secret: string) => ({ kind: "client_secret_post", secret }),
    DPoP: () => ({ calculateThumbprint: async () => "test-dpop-jkt" }),
    // REAL extractable ES256 keys so export/import round-trips genuinely.
    generateKeyPair: vi.fn(async (_alg: string, opts?: { extractable?: boolean }) =>
      globalThis.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        opts?.extractable ?? false,
        ["sign", "verify"],
      ),
    ),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomState: () => "state",
    generateRandomNonce: () => "nonce",
    calculatePKCECodeChallenge: async () => "challenge",
    discoveryRequest: vi.fn(async () => new Response()),
    processDiscoveryResponse: vi.fn(async (issuer: URL) => ({
      issuer: issuer.href,
      authorization_endpoint: `${issuer.href}auth`,
      token_endpoint: `${issuer.href}token`,
      code_challenge_methods_supported: ["S256"],
    })),
    dynamicClientRegistrationRequest: vi.fn(async () => new Response()),
    processDynamicClientRegistrationResponse: vi.fn(async () => ({
      client_id: "dynamic-client-id",
      token_endpoint_auth_method: "none",
    })),
    // Mirror oauth4webapi: throw on `error=`, and — crucially for the CSRF guard —
    // throw when the callback `state` does not match the expected (persisted) state.
    validateAuthResponse: (_as: unknown, _client: unknown, url: URL, expectedState?: string) => {
      const error = url.searchParams.get("error");
      if (error) throw new AuthorizationResponseError(error);
      const state = url.searchParams.get("state");
      lastExpectedState = expectedState;
      if (expectedState !== undefined && state !== expectedState) {
        throw new Error(`state mismatch: expected ${expectedState}, got ${state}`);
      }
      return new URLSearchParams({
        code: url.searchParams.get("code") ?? "authcode",
        state: state ?? "",
      });
    },
    authorizationCodeGrantRequest: vi.fn(async () => new Response()),
    isDPoPNonceError: (e: unknown) => e instanceof DPoPNonceError,
    processAuthorizationCodeResponse: vi.fn(
      async (_as: unknown, _client: unknown, _resp: unknown, opts?: { expectedNonce?: string }) => {
        lastExpectedNonce = opts?.expectedNonce;
        // Mirror oauth4webapi: the id_token nonce is validated against expectedNonce.
        if (opts?.expectedNonce !== undefined && opts.expectedNonce !== idTokenNonce) {
          throw new Error(
            `nonce mismatch: expected ${opts.expectedNonce}, id_token had ${idTokenNonce}`,
          );
        }
        return {
          access_token: "access-token",
          ...(loginRefreshToken !== undefined ? { refresh_token: loginRefreshToken } : {}),
          token_type: loginTokenType,
        };
      },
    ),
    getValidatedIdTokenClaims: () => ({ webid: webIdClaim, sub: webIdClaim }),
  };
});

// Import AFTER the mocks are registered.
const { createSolidAuth } = await import("../src/index.js");

// ── Shared test doubles ──────────────────────────────────────────────────────

/** In-memory Storage mirror (the injected sessionStorage seam). */
class MemStorage implements RedirectFlowStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** A durable SessionStore that records puts (to assert redirect-path persist parity). */
class RecordingStore implements SessionStore {
  readonly map = new Map<string, PersistedSession>();
  puts: string[] = [];
  readonly durable = true as const;
  async get(issuer: string): Promise<PersistedSession | undefined> {
    return this.map.get(issuer);
  }
  async put(s: PersistedSession): Promise<void> {
    this.map.set(s.issuer, s);
    this.puts.push(s.webId);
  }
  async delete(issuer: string): Promise<void> {
    this.map.delete(issuer);
  }
}

const CLIENT_ID = "https://app.example/clientid.jsonld";
const CALLBACK = "https://app.example/";

function makeAuth(overrides: Partial<SolidAuthConfig> = {}): {
  auth: ReturnType<typeof createSolidAuth>;
  storage: RedirectFlowStorage;
  navigated: string[];
} {
  const storage = overrides.redirectFlowStorage ?? new MemStorage();
  const navigated: string[] = [];
  const auth = createSolidAuth({
    callbackUri: CALLBACK,
    clientId: CLIENT_ID,
    redirectFlowStorage: storage,
    navigate: (url: string) => navigated.push(url),
    ...overrides,
  });
  return { auth, storage, navigated };
}

beforeEach(() => {
  agentIssuer = "https://idp.example/";
  webIdClaim = "https://alice.pod.example/profile/card#me";
  loginTokenType = "DPoP";
  loginRefreshToken = "refresh-token";
  lastExpectedState = undefined;
  idTokenNonce = "nonce";
  lastExpectedNonce = undefined;
});
afterEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// PURE MODULE — ./redirect.ts
// ════════════════════════════════════════════════════════════════════════════
describe("redirect.ts pure primitives", () => {
  describe("parseAutologinFragment", () => {
    it("decodes a #autologin/<encoded-webid> fragment", () => {
      const webId = "https://alice.pod.example/profile/card#me";
      expect(parseAutologinFragment(`#autologin/${encodeURIComponent(webId)}`)).toBe(webId);
    });
    it("returns null for a non-autologin hash / empty payload / malformed encoding", () => {
      expect(parseAutologinFragment("#dashboard")).toBeNull();
      expect(parseAutologinFragment("")).toBeNull();
      expect(parseAutologinFragment("#autologin/")).toBeNull();
      expect(parseAutologinFragment("#autologin/%E0%A4%A")).toBeNull(); // bad percent-encoding
    });
  });

  describe("URL query predicates", () => {
    it("hasAuthCodeParams requires BOTH code and state", () => {
      expect(hasAuthCodeParams("?code=x&state=y")).toBe(true);
      expect(hasAuthCodeParams("?code=x")).toBe(false);
      expect(hasAuthCodeParams("?state=y")).toBe(false);
    });
    it("hasAuthErrorParams requires BOTH error and state; authErrorFrom reads error", () => {
      expect(hasAuthErrorParams("?error=login_required&state=y")).toBe(true);
      expect(hasAuthErrorParams("?error=login_required")).toBe(false);
      expect(authErrorFrom("?error=access_denied&state=y")).toBe("access_denied");
      expect(authErrorFrom("?code=x")).toBeNull();
    });
    it("cleanedUrl strips the query AND fragment", () => {
      expect(cleanedUrl("https://app.example/x?code=1&state=2#autologin/z")).toBe(
        "https://app.example/x",
      );
      expect(cleanedUrl("not a url")).toBe("not a url");
    });
    it("stripAuthCallbackParams removes ONLY OAuth params + the autologin fragment, keeping app state", () => {
      // App query (`workspace`) survives; OAuth params + autologin fragment are scrubbed.
      expect(
        stripAuthCallbackParams(
          "https://app.example/dash?workspace=123&code=c&state=s&iss=https%3A%2F%2Fidp#autologin/z",
        ),
      ).toBe("https://app.example/dash?workspace=123");
      // An error return, app state preserved.
      expect(
        stripAuthCallbackParams("https://app.example/?tab=x&error=login_required&state=s"),
      ).toBe("https://app.example/?tab=x");
      // A NON-autologin fragment is preserved.
      expect(stripAuthCallbackParams("https://app.example/?code=c&state=s#section")).toBe(
        "https://app.example/#section",
      );
      expect(stripAuthCallbackParams("not a url")).toBe("not a url");
    });
  });

  describe("persisted-record read/write/clear", () => {
    const flow: PersistedRedirectFlow = {
      dpopPrivateJwk: { kty: "EC" },
      dpopPublicJwk: { kty: "EC" },
      codeVerifier: "verifier",
      state: "state",
      nonce: "nonce",
      issuer: "https://idp.example/",
      client: { client_id: "https://app.example/clientid.jsonld" },
      redirectUri: "https://app.example/",
      webId: "https://alice.pod.example/profile/card#me",
    };
    it("round-trips a valid record", () => {
      const s = new MemStorage();
      writePersistedRedirectFlow(s, "k", flow);
      expect(readPersistedRedirectFlow(s, "k")).toEqual(flow);
    });
    it("returns null for absent / corrupt / structurally-invalid records", () => {
      const s = new MemStorage();
      expect(readPersistedRedirectFlow(s, "k")).toBeNull(); // absent
      s.setItem("k", "{not json");
      expect(readPersistedRedirectFlow(s, "k")).toBeNull(); // corrupt
      s.setItem("k", JSON.stringify({ codeVerifier: "v" })); // missing load-bearing fields
      expect(readPersistedRedirectFlow(s, "k")).toBeNull();
      s.setItem("k", JSON.stringify({ ...flow, client: { no_id: true } })); // client sans client_id
      expect(readPersistedRedirectFlow(s, "k")).toBeNull();
    });
    it("returns null (never throws) when storage is undefined", () => {
      expect(readPersistedRedirectFlow(undefined, "k")).toBeNull();
    });
    it("writePersistedRedirectFlow THROWS when no storage is available", () => {
      expect(() => writePersistedRedirectFlow(undefined, "k", flow)).toThrow(/no sessionStorage/i);
    });
    it("clearPersistedRedirectFlow is idempotent and swallows a missing store", () => {
      const s = new MemStorage();
      writePersistedRedirectFlow(s, "k", flow);
      clearPersistedRedirectFlow(s, "k");
      expect(readPersistedRedirectFlow(s, "k")).toBeNull();
      expect(() => clearPersistedRedirectFlow(s, "k")).not.toThrow(); // already gone
      expect(() => clearPersistedRedirectFlow(undefined, "k")).not.toThrow();
    });
  });

  describe("planRedirect — the pure decision", () => {
    const eq = (a?: string, b?: string) => a === b;
    const base = {
      loggedIn: false,
      hasPendingRedirect: false,
      hasCodeParams: false,
      hasErrorParams: false,
      fragmentWebId: null as string | null,
      sentinel: null as string | null,
      webIdsEqual: eq,
    };
    it("a live session WINS → none", () => {
      expect(
        planRedirect({ ...base, loggedIn: true, hasCodeParams: true, hasPendingRedirect: true })
          .kind,
      ).toBe("none");
    });
    it("pending record + code → complete", () => {
      expect(planRedirect({ ...base, hasPendingRedirect: true, hasCodeParams: true }).kind).toBe(
        "complete",
      );
    });
    it("pending record + error → abort (does not wait forever for a code)", () => {
      expect(planRedirect({ ...base, hasPendingRedirect: true, hasErrorParams: true }).kind).toBe(
        "abort",
      );
    });
    it("fresh #autologin fragment, no pending, no sentinel → begin", () => {
      const plan = planRedirect({ ...base, fragmentWebId: "https://a.example/#me" });
      expect(plan).toEqual({ kind: "begin", webId: "https://a.example/#me" });
    });
    it("fresh #autologin fragment with a STALE pending record (no code/error) → begin (not swallowed)", () => {
      // A lingering abandoned record must NOT swallow a fresh deep-link (the roborev
      // finding); beginRedirectLogin overwrites the stale record.
      const plan = planRedirect({
        ...base,
        fragmentWebId: "https://a.example/#me",
        hasPendingRedirect: true,
      });
      expect(plan).toEqual({ kind: "begin", webId: "https://a.example/#me" });
    });
    it("pending record + code STILL takes precedence over a fragment → complete", () => {
      expect(
        planRedirect({
          ...base,
          hasPendingRedirect: true,
          hasCodeParams: true,
          fragmentWebId: "https://a.example/#me",
        }).kind,
      ).toBe("complete");
    });
    it("fragment with the sentinel set for the SAME WebID → clear-sentinel (loop guard)", () => {
      expect(
        planRedirect({
          ...base,
          fragmentWebId: "https://a.example/#me",
          sentinel: "https://a.example/#me",
        }).kind,
      ).toBe("clear-sentinel");
    });
    it("fragment with a sentinel for a DIFFERENT WebID → begin (not a loop)", () => {
      expect(
        planRedirect({
          ...base,
          fragmentWebId: "https://b.example/#me",
          sentinel: "https://a.example/#me",
        }).kind,
      ).toBe("begin");
    });
    it("nothing relevant → none", () => {
      expect(planRedirect(base).kind).toBe("none");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — beginRedirectLogin
// ════════════════════════════════════════════════════════════════════════════
describe("beginRedirectLogin", () => {
  it("persists the flow, navigates, and builds a compliant authorization URL", async () => {
    const { auth, storage, navigated } = makeAuth();
    const { authorizationUrl } = await auth.beginRedirectLogin({ webId: webIdClaim });
    // Navigated exactly once to the built URL.
    expect(navigated).toEqual([authorizationUrl]);
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://idp.example/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid webid offline_access");
    // PKCE S256 MANDATORY.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    // Direct (user-initiated) redirect defaults to select_account consent.
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    // RFC 9449 §10 DPoP code binding.
    expect(url.searchParams.get("dpop_jkt")).toBe("test-dpop-jkt");
    // The persisted record carries the exportable key JWKs + the exact request params.
    const flow = readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow");
    expect(flow).not.toBeNull();
    expect(flow?.webId).toBe(webIdClaim);
    expect(flow?.issuer).toBe("https://idp.example/");
    expect(flow?.redirectUri).toBe(CALLBACK);
    expect(flow?.client.client_id).toBe(CLIENT_ID);
    expect(flow?.dpopPrivateJwk.kty).toBe("EC");
    expect(auth.hasPendingRedirect()).toBe(true);
  });

  it("prompt:'none' produces a SILENT (prompt=none) authorization request", async () => {
    const { auth } = makeAuth();
    const { authorizationUrl } = await auth.beginRedirectLogin({
      webId: webIdClaim,
      prompt: "none",
    });
    expect(new URL(authorizationUrl).searchParams.get("prompt")).toBe("none");
  });

  it("accepts a bare oidcIssuer (no WebID binding); the persisted record's webId is null", async () => {
    const { auth, storage } = makeAuth();
    await auth.beginRedirectLogin({ oidcIssuer: "https://idp.example/" });
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")?.webId).toBeNull();
  });

  it("honours a custom redirectUri (registered alongside the callback) and clientId override", async () => {
    const { auth, storage } = makeAuth();
    const { authorizationUrl } = await auth.beginRedirectLogin({
      webId: webIdClaim,
      redirectUri: "https://app.example/return",
      clientId: "https://app.example/other-clientid.jsonld",
    });
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/return");
    expect(url.searchParams.get("client_id")).toBe("https://app.example/other-clientid.jsonld");
    const flow = readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow");
    expect(flow?.redirectUri).toBe("https://app.example/return");
  });

  it("rejects a call with neither webId nor oidcIssuer", async () => {
    const { auth } = makeAuth();
    await expect(auth.beginRedirectLogin({})).rejects.toThrow();
  });

  it("rejects a cleartext http issuer (credential-boundary guard)", async () => {
    const { auth } = makeAuth();
    await expect(auth.beginRedirectLogin({ oidcIssuer: "http://evil.example/" })).rejects.toThrow(
      /https/i,
    );
  });

  it("THROWS (does not navigate) when the in-flight state cannot be persisted", async () => {
    // A storage whose write FAILS (quota / disabled) must abort BEFORE navigating — a
    // redirect whose in-between state wasn't saved can never be completed.
    const throwingStorage: RedirectFlowStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const { auth, navigated } = makeAuth({ redirectFlowStorage: throwingStorage });
    await expect(auth.beginRedirectLogin({ webId: webIdClaim })).rejects.toThrow();
    expect(navigated).toEqual([]); // never navigated into an uncompletable flow
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — completeRedirectLogin (the mock-OP round trip + failure/replay/tamper)
// ════════════════════════════════════════════════════════════════════════════
describe("completeRedirectLogin", () => {
  async function begunAuth(store?: RecordingStore) {
    const { auth, storage } = makeAuth(store ? { store } : {});
    await auth.beginRedirectLogin({ webId: webIdClaim });
    return { auth, storage };
  }
  const callback = (state = "state", extra = "") =>
    `${CALLBACK}?code=authcode&state=${state}${extra}`;

  it("completes the round-trip: establishes the session, clears the record, returns the WebID", async () => {
    const { auth, storage } = await begunAuth();
    const result = await auth.completeRedirectLogin(callback());
    expect(result.webId).toBe(webIdClaim);
    expect(auth.webId).toBe(webIdClaim);
    expect(auth.issuer).toBe("https://idp.example/");
    // The state AND nonce were validated against the PERSISTED values.
    expect(lastExpectedState).toBe("state");
    expect(lastExpectedNonce).toBe("nonce");
    // The transient record is CLEARED on success (replay/back-button defeated).
    expect(auth.hasPendingRedirect()).toBe(false);
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")).toBeNull();
  });

  it("REJECTS a nonce mismatch (id_token nonce ≠ persisted nonce) and clears the record", async () => {
    const { auth, storage } = await begunAuth();
    idTokenNonce = "tampered-nonce"; // the OP's id_token nonce differs from the persisted one
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/nonce mismatch/i);
    expect(auth.webId).toBeNull(); // no half-established session
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")).toBeNull();
  });

  it("persists the DPoP-bound refresh credential (silent-restore parity) to a durable store", async () => {
    const store = new RecordingStore();
    const { auth } = await begunAuth(store);
    await auth.completeRedirectLogin(callback());
    expect(store.puts).toContain(webIdClaim);
  });

  it("persists the ACTUAL per-call clientId override (not the controller default) so restore can redeem", async () => {
    const store = new RecordingStore();
    const { auth } = makeAuth({ store });
    const override = "https://app.example/override-clientid.jsonld";
    await auth.beginRedirectLogin({ webId: webIdClaim, clientId: override });
    await auth.completeRedirectLogin(callback());
    // The refresh token is client-bound; the stored record must carry the client the
    // session AUTHENTICATED with (the override), not the controller default CLIENT_ID.
    expect(store.map.get("https://idp.example/")?.clientId).toBe(override);
  });

  it("REJECTS a tampered/mismatched state (CSRF guard) and clears the record", async () => {
    const { auth, storage } = await begunAuth();
    await expect(auth.completeRedirectLogin(callback("WRONG-state"))).rejects.toThrow(
      /state mismatch/i,
    );
    expect(auth.webId).toBeNull(); // no half-established session
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")).toBeNull(); // cleared even on failure
  });

  it("REJECTS when the OP authenticated a DIFFERENT WebID than requested (fail-closed)", async () => {
    const { auth, storage } = await begunAuth();
    webIdClaim = "https://mallory.pod.example/profile/card#me"; // OP returns a different account
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/different WebID/i);
    expect(auth.webId).toBeNull();
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")).toBeNull();
  });

  it("REJECTS a non-DPoP (Bearer) token_type (sender-constraint enforced)", async () => {
    const { auth } = await begunAuth();
    loginTokenType = "Bearer";
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/DPoP-bound token/i);
    expect(auth.webId).toBeNull();
  });

  it("is single-use: a REPLAY after a successful completion throws (record already cleared)", async () => {
    const { auth } = await begunAuth();
    await auth.completeRedirectLogin(callback());
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/No pending redirect/i);
  });

  it("throws when there is no pending redirect at all", async () => {
    const { auth } = makeAuth();
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/No pending redirect/i);
  });

  it("CLEARS a corrupt/unreadable record before failing (no stale DPoP material left behind)", async () => {
    const storage = new MemStorage();
    const { auth } = makeAuth({ redirectFlowStorage: storage });
    storage.setItem("solid-auth-core.redirect-flow", "{corrupt json"); // unreadable record
    await expect(auth.completeRedirectLogin(callback())).rejects.toThrow(/No pending redirect/i);
    // The corrupt key was cleared so it can't linger / block a fresh flow.
    expect(storage.getItem("solid-auth-core.redirect-flow")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — handleRedirect (the one-call lifecycle driver)
// ════════════════════════════════════════════════════════════════════════════
describe("handleRedirect", () => {
  it("reports 'none' for a plain URL with no redirect activity", async () => {
    const { auth } = makeAuth();
    expect(await auth.handleRedirect("https://app.example/dashboard")).toEqual({ outcome: "none" });
  });

  it("BEGINS a silent redirect for a fresh #autologin deep-link, returning to the APP page (not the popup callback)", async () => {
    const { auth, storage, navigated } = makeAuth();
    // A PATHED deep-link so the derived return URI is distinguishable from CALLBACK.
    const deepLink = `https://app.example/home#autologin/${encodeURIComponent(webIdClaim)}`;
    const outcome = await auth.handleRedirect(deepLink);
    expect(outcome).toEqual({ outcome: "redirecting" });
    expect(navigated).toHaveLength(1);
    const url = new URL(navigated[0]);
    expect(url.searchParams.get("prompt")).toBe("none"); // silent SSO
    // The HIGH fix: redirect_uri is the CURRENT app page (origin+path, fragment stripped),
    // NOT the popup callbackUri (which does not run the app).
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/home");
    expect(auth.hasPendingRedirect()).toBe(true);
    expect(storage.getItem("solid-auth-core.redirect-sentinel")).toBe(webIdClaim); // loop guard armed
  });

  it("uses the configured redirectUri as the autologin return URI when set", async () => {
    const { auth, navigated } = makeAuth({ redirectUri: "https://app.example/return" });
    const deepLink = `https://app.example/home#autologin/${encodeURIComponent(webIdClaim)}`;
    await auth.handleRedirect(deepLink);
    expect(new URL(navigated[0]).searchParams.get("redirect_uri")).toBe(
      "https://app.example/return",
    );
  });

  it("does NOT swallow a fresh #autologin deep-link when a STALE pending record lingers", async () => {
    const { auth, navigated } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim }); // leaves a pending record
    navigated.length = 0; // ignore that begin's navigation
    // A fresh deep-link (no code/error) must still BEGIN, overwriting the stale record.
    const outcome = await auth.handleRedirect(
      `https://app.example/home#autologin/${encodeURIComponent(webIdClaim)}`,
    );
    expect(outcome).toEqual({ outcome: "redirecting" });
    expect(navigated).toHaveLength(1);
    expect(new URL(navigated[0]).searchParams.get("prompt")).toBe("none");
  });

  it("COMPLETES a returning redirect (?code&state + a pending record) and clears the sentinel", async () => {
    const { auth, storage } = makeAuth();
    // Arm a pending redirect first (begin), then simulate the broker return.
    await auth.beginRedirectLogin({ webId: webIdClaim });
    storage.setItem("solid-auth-core.redirect-sentinel", webIdClaim);
    const outcome = await auth.handleRedirect(`${CALLBACK}?code=authcode&state=state`);
    expect(outcome).toEqual({ outcome: "completed", webId: webIdClaim });
    expect(auth.webId).toBe(webIdClaim);
    expect(auth.hasPendingRedirect()).toBe(false);
    expect(storage.getItem("solid-auth-core.redirect-sentinel")).toBeNull();
  });

  it("ABORTS a declined return (?error&state) — drops the record + sentinel, surfaces the error", async () => {
    const { auth, storage } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim, prompt: "none" });
    storage.setItem("solid-auth-core.redirect-sentinel", webIdClaim);
    const outcome = await auth.handleRedirect(`${CALLBACK}?error=login_required&state=state`);
    expect(outcome).toEqual({ outcome: "error", error: "login_required" });
    expect(auth.hasPendingRedirect()).toBe(false);
    expect(storage.getItem("solid-auth-core.redirect-sentinel")).toBeNull();
  });

  it("IGNORES a spoofed ?error&state whose state does NOT match the pending flow (login CSRF/DoS guard)", async () => {
    const { auth } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim, prompt: "none" }); // flow.state === "state"
    // An attacker-crafted callback with a foreign state must NOT abort the legit flow.
    const outcome = await auth.handleRedirect(`${CALLBACK}?error=access_denied&state=FORGED`);
    expect(outcome).toEqual({ outcome: "none" });
    expect(auth.hasPendingRedirect()).toBe(true); // pending flow left intact
  });

  it("surfaces an ERROR (not silent none) for a ?code&state return with NO readable pending flow", async () => {
    const { auth } = makeAuth();
    // No begin → no persisted flow; a returning ?code&state cannot be completed.
    const outcome = await auth.handleRedirect(`${CALLBACK}?code=authcode&state=state`);
    expect(outcome.outcome).toBe("error");
  });

  it("LOOP GUARD: a repeat deep-link for the sentinel WebID (bounced back, no record) → none, sentinel cleared", async () => {
    const { auth, storage } = makeAuth();
    storage.setItem("solid-auth-core.redirect-sentinel", webIdClaim); // we already tried this tab
    const deepLink = `https://app.example/#autologin/${encodeURIComponent(webIdClaim)}`;
    const outcome = await auth.handleRedirect(deepLink);
    expect(outcome).toEqual({ outcome: "none" });
    expect(storage.getItem("solid-auth-core.redirect-sentinel")).toBeNull();
  });

  it("stands down (none) when already logged in AND clears any stale pending record", async () => {
    const { auth } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim });
    await auth.completeRedirectLogin(`${CALLBACK}?code=authcode&state=state`); // now logged in
    // Re-arm a pending record + a returning URL; a live session must WIN…
    await auth.beginRedirectLogin({ webId: webIdClaim });
    const outcome = await auth.handleRedirect(`${CALLBACK}?code=authcode&state=state`);
    expect(outcome).toEqual({ outcome: "none" });
    // …and the STALE pending record (exported DPoP key material) is dropped so it can't
    // block a future autologin (the roborev finding).
    expect(auth.hasPendingRedirect()).toBe(false);
  });

  it("clears an ABANDONED pending record on a plain navigation (no code/error, logged out)", async () => {
    const { auth } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim }); // record persisted, then user bailed
    expect(auth.hasPendingRedirect()).toBe(true);
    const outcome = await auth.handleRedirect("https://app.example/dashboard");
    expect(outcome).toEqual({ outcome: "none" });
    expect(auth.hasPendingRedirect()).toBe(false); // orphaned record swept
  });

  it("FAIL-CLOSED: a completion failure resolves to { outcome:'error' } (never throws) + cleans up", async () => {
    const { auth, storage } = makeAuth();
    await auth.beginRedirectLogin({ webId: webIdClaim });
    // Returning with a mismatched state → completeRedirectLogin throws → handleRedirect
    // catches it, cleans up, and reports an error outcome.
    const outcome = await auth.handleRedirect(`${CALLBACK}?code=authcode&state=WRONG`);
    expect(outcome.outcome).toBe("error");
    expect(auth.hasPendingRedirect()).toBe(false);
    expect(readPersistedRedirectFlow(storage, "solid-auth-core.redirect-flow")).toBeNull();
  });

  it("reports 'error' (never throws) for an unparseable currentUrl", async () => {
    const { auth } = makeAuth();
    const outcome = await auth.handleRedirect("::: not a url :::");
    expect(outcome.outcome).toBe("error");
  });

  it("scrubs the OAuth callback params from the address bar on completion (history.replaceState)", async () => {
    const replaceState = vi.fn();
    const g = globalThis as {
      history?: { replaceState: (...a: unknown[]) => void; state: unknown };
    };
    const original = g.history;
    const routerState = { router: "route-state" };
    g.history = { replaceState, state: routerState };
    try {
      const { auth } = makeAuth();
      await auth.beginRedirectLogin({ webId: webIdClaim });
      await auth.handleRedirect(`${CALLBACK}?code=authcode&state=state`);
      // ?code&state stripped, leaving the bare app URL — and the SPA history.state PRESERVED.
      expect(replaceState).toHaveBeenCalledWith(routerState, "", CALLBACK);
    } finally {
      g.history = original;
    }
  });

  it("scrubs the address bar even when the completion FAILS (fail-closed), preserving history.state", async () => {
    const replaceState = vi.fn();
    const g = globalThis as {
      history?: { replaceState: (...a: unknown[]) => void; state: unknown };
    };
    const original = g.history;
    const routerState = { router: "route-state" };
    g.history = { replaceState, state: routerState };
    try {
      const { auth } = makeAuth();
      await auth.beginRedirectLogin({ webId: webIdClaim });
      const outcome = await auth.handleRedirect(`${CALLBACK}?code=authcode&state=WRONG`);
      expect(outcome.outcome).toBe("error");
      // A FAILED completion still scrubs ?code&state from the URL + history (state kept).
      expect(replaceState).toHaveBeenCalledWith(routerState, "", CALLBACK);
    } finally {
      g.history = original;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — construction resilience (storage-access guard)
// ════════════════════════════════════════════════════════════════════════════
describe("createSolidAuth construction", () => {
  it("does NOT throw when merely READING globalThis.sessionStorage throws (blocked storage)", () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is blocked in this context");
      },
    });
    try {
      // No injected redirectFlowStorage → the default resolver reads sessionStorage,
      // which throws — construction must survive it (only a redirect login would fail).
      expect(() => createSolidAuth({ callbackUri: CALLBACK, clientId: CLIENT_ID })).not.toThrow();
    } finally {
      if (desc) Object.defineProperty(globalThis, "sessionStorage", desc);
      else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — hasPendingRedirect
// ════════════════════════════════════════════════════════════════════════════
describe("hasPendingRedirect", () => {
  it("reflects whether a persisted record exists", async () => {
    const { auth } = makeAuth();
    expect(auth.hasPendingRedirect()).toBe(false);
    await auth.beginRedirectLogin({ webId: webIdClaim });
    expect(auth.hasPendingRedirect()).toBe(true);
    await auth.completeRedirectLogin(`${CALLBACK}?code=authcode&state=state`);
    expect(auth.hasPendingRedirect()).toBe(false);
  });
});
