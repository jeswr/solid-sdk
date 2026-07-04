// AUTHORED-BY Claude Sonnet 5
/**
 * webid-token-provider.login-stall.test.ts — regression for the interactive
 * LOGIN STALL fixed by pinning WebIdDPoPTokenProvider's own OIDC hops (discovery /
 * dynamic client registration / token grant) to an out-of-loop fetch. Ported from
 * the same fix + test pattern already landed in `jeswr/product` (AccessRadar,
 * commit 7a5461a) and `jeswr/solid-pod-manager` (commit 8f4b454) — see those for
 * the canonical write-ups.
 *
 * THE BUG: `#httpOptions()` built oauth4webapi request options WITHOUT
 * `[oauth.customFetch]`, so `oauth.discoveryRequest` / `dynamicClientRegistrationRequest`
 * / `authorizationCodeGrantRequest` fell back to whatever `fetch` is AMBIENT AT CALL
 * TIME. `SolidAuthProvider.tsx` registers `@solid/reactive-authentication`'s
 * `ReactiveFetchManager` globally (`manager.registerGlobally()`), and this provider's
 * `matches()` returns `true` UNCONDITIONALLY — so ANY 401 response, anywhere, while
 * this provider is registered gets escalated to `provider.upgrade(request)`. If ONE
 * of the provider's OWN OIDC hops happens to answer 401 on the shared/ambient fetch
 * pathway the manager captured at construction (a real-world condition: a
 * registration/token endpoint that rejects an unauthenticated request, a proxy
 * hiccup, or simply an ambient `globalThis.fetch` that was patched by something else
 * before this component ran and so is NOT actually the same reference as the
 * explicitly-captured pristine one it was assumed to be), that 401 re-enters
 * `provider.upgrade()` for the OIDC request — which single-flights onto `#sessions`'
 * PENDING entry for this issuer, i.e. the very `#authenticate()` promise that ISSUED
 * the OIDC request in the first place. A circular await: the login never settles,
 * after the WebID profile read succeeds and before the OIDC popup ever opens.
 *
 * THE FIX under test: every oauth4webapi call is threaded `[oauth.customFetch]` via
 * `#httpOptions()` (the new `oauthFetch` option, defaulting to `profileFetch`), and
 * `SolidAuthProvider.tsx` pins BOTH to a pristine fetch captured before
 * `registerGlobally()` runs. This test constructs the REAL `WebIdDPoPTokenProvider`
 * and the REAL `ReactiveFetchManager` (both unmocked) and drives a login through a
 * mock world where the registration endpoint is UNRELIABLE on the ambient pathway the
 * manager captured at construction (`flakyGlobalFetch`) but always succeeds on the
 * dedicated pristine reference (`pristineFetch`) — modelling exactly the footgun the
 * fix closes: an app must not assume its own pristine capture and whatever
 * `globalThis.fetch` the manager happened to snapshot are the same reference. oauth4webapi
 * and the `dpop` package are mocked (as `webid-token-provider.test.ts` already does)
 * so the flow runs deterministically with no real crypto/network, but the mocked
 * oauth4webapi functions genuinely route through `http[oauth.customFetch] ?? fetch`
 * — exactly as the real library does — so the routing assertions are meaningful.
 *
 * Each case is raced against a deadline: pre-fix (revert `#httpOptions`'
 * `[oauth.customFetch]` threading), the registration request rides the ambient
 * pathway, 401s, and deadlocks — this test times out with the descriptive
 * "LOGIN STALL" error instead of a generic Vitest timeout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: vi.fn(async () => ({ dataset: new Set() })),
}));

vi.mock("@/lib/solid/login-ux", () => ({
  validateWebId: (s: string) => s,
  resolveIssuers: () => [ISSUER_HREF],
}));

vi.mock("dpop", () => ({
  generateProof: vi.fn(async () => "dpop-proof"),
}));

vi.mock("oauth4webapi", () => {
  const customFetch = Symbol("customFetch");
  const allowInsecureRequests = Symbol("allowInsecureRequests");
  return {
    customFetch,
    allowInsecureRequests,
    None: () => () => {},
    ClientSecretBasic: () => () => {},
    nopkce: Symbol("nopkce"),
    expectNoNonce: Symbol("expectNoNonce"),
    DPoP: () => ({}),
    generateKeyPair: vi.fn(async () => ({
      publicKey: { __kind: "public" },
      privateKey: { __kind: "private" },
    })),
    generateRandomCodeVerifier: () => "verifier",
    generateRandomNonce: () => "nonce",
    generateRandomState: () => "state",
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    validateAuthResponse: vi.fn(() => new URLSearchParams({ code: "auth-code" })),
    // The three provider-internal OIDC hops under test. Each genuinely routes
    // through `http[customFetch] ?? fetch` — exactly like the real library — so
    // whether the PIN was threaded is what decides which fetch reference carries
    // the request, not a hardcoded stub.
    discoveryRequest: vi.fn(async (issuer: URL, http: Record<PropertyKey, unknown>) => {
      const f = (http[customFetch] as typeof fetch | undefined) ?? fetch;
      const res = await f(new URL(".well-known/openid-configuration", issuer));
      if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
      return res;
    }),
    processDiscoveryResponse: vi.fn(async (_issuer: URL, response: Response) => response.json()),
    dynamicClientRegistrationRequest: vi.fn(
      async (
        as: { registration_endpoint: string },
        metadata: unknown,
        http: Record<PropertyKey, unknown>,
      ) => {
        const f = (http[customFetch] as typeof fetch | undefined) ?? fetch;
        const res = await f(as.registration_endpoint, {
          method: "POST",
          body: JSON.stringify(metadata),
        });
        if (!res.ok) throw new Error(`dynamic client registration failed: ${res.status}`);
        return res;
      },
    ),
    processDynamicClientRegistrationResponse: vi.fn(async (response: Response) => response.json()),
    authorizationCodeGrantRequest: vi.fn(
      async (
        as: { token_endpoint: string },
        _client: unknown,
        _clientAuth: unknown,
        _params: unknown,
        _redirectUri: string,
        _codeVerifier: unknown,
        http: Record<PropertyKey, unknown>,
      ) => {
        const f = (http[customFetch] as typeof fetch | undefined) ?? fetch;
        const res = await f(as.token_endpoint, { method: "POST" });
        if (!res.ok) throw new Error(`token grant failed: ${res.status}`);
        return res;
      },
    ),
    processAuthorizationCodeResponse: vi.fn(async (_as: unknown, _client: unknown, response: Response) =>
      response.json(),
    ),
    getValidatedIdTokenClaims: vi.fn((tokenResult: { __claims: unknown }) => tokenResult.__claims),
    AuthorizationResponseError: class AuthorizationResponseError extends Error {
      cause?: unknown;
      constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "AuthorizationResponseError";
        this.cause = options?.cause;
      }
    },
    OperationProcessingError: class OperationProcessingError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "OperationProcessingError";
      }
    },
  };
});

// `@solid/reactive-authentication`'s barrel (`mod.js`) re-exports the
// `<authorization-code-flow>` CUSTOM ELEMENT alongside `ReactiveFetchManager` — its
// module defines `class AuthorizationCodeFlow extends HTMLElement` and calls
// `customElements.define(...)` at IMPORT time, both of which throw in this
// suite's node environment (no DOM). This test needs only `ReactiveFetchManager`
// (the piece `SolidAuthProvider.tsx` actually uses server-side-safely via a
// browser-only dynamic import), so stub the two browser globals the barrel's
// module-level side effects touch, just long enough to import it.
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = class {} as unknown as typeof HTMLElement;
(globalThis as unknown as { customElements: unknown }).customElements = {
  define: () => {},
} as unknown as CustomElementRegistry;

const { WebIdDPoPTokenProvider } = await import("@/lib/solid/webid-token-provider");
type Provider = InstanceType<typeof WebIdDPoPTokenProvider>;
const { ReactiveFetchManager } = await import("@solid/reactive-authentication");

const ISSUER_HREF = "https://issuer.example/";
const DISCOVERY_URL = "https://issuer.example/.well-known/openid-configuration";
const REGISTRATION_ENDPOINT = "https://issuer.example/register";
const TOKEN_ENDPOINT = "https://issuer.example/token";
const AUTHORIZATION_ENDPOINT = "https://issuer.example/auth";
const WEBID = "https://alice.example/profile/card#me";
const POD_ROOT = "https://alice.example/storage/";
const CALLBACK = "https://app.example/callback.html";
const REDIRECT = `${CALLBACK}?code=auth-code&state=state`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** What the mock world records, for the assertions. */
interface Recorded {
  /** Every URL that reached the PRISTINE (out-of-loop) fetch. */
  baseUrls: string[];
  /** Every URL that went through the PATCHED global fetch. */
  patchedUrls: string[];
  /** Authorization header the pod-root probe eventually carried, if any. */
  podAuthorization: string | null;
}

/**
 * The ground-truth network logic, shared by both the pristine fetch AND the
 * "ambient" reference the manager captures. Discovery / token / the pod always
 * behave correctly; the caller-specific unreliability is layered on TOP of this by
 * `flakyGlobalFetch` below — this function itself never 401s the registration
 * endpoint.
 */
async function trueNetwork(req: Request, recorded: Recorded): Promise<Response> {
  const url = req.url;
  if (url === DISCOVERY_URL) {
    return jsonResponse({
      issuer: ISSUER_HREF,
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
      token_endpoint: TOKEN_ENDPOINT,
      registration_endpoint: REGISTRATION_ENDPOINT,
      code_challenge_methods_supported: ["S256"],
    });
  }
  if (url === REGISTRATION_ENDPOINT) {
    return jsonResponse(
      {
        client_id: "dynamic-client",
        redirect_uris: [CALLBACK],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  }
  if (url === TOKEN_ENDPOINT) {
    return jsonResponse({
      access_token: "at-123",
      token_type: "DPoP",
      __claims: { iss: ISSUER_HREF, sub: WEBID, webid: WEBID, aud: "dynamic-client", iat: 0, exp: 0 },
    });
  }
  if (url === POD_ROOT) {
    const auth = req.headers.get("Authorization");
    recorded.podAuthorization = auth;
    return new Response(null, { status: auth ? 200 : 401 });
  }
  return new Response(`unexpected request in mock world: ${url}`, { status: 500 });
}

/**
 * Build the mock world:
 *  - `pristineFetch` — the dedicated, ALWAYS-reliable reference. Passed to the
 *    provider as `profileFetch`/`oauthFetch`. Records into `recorded.baseUrls`.
 *  - `flakyGlobalFetch` — what `ReactiveFetchManager` captures as its internal
 *    `#globalFetch` AT CONSTRUCTION TIME (i.e. whatever `globalThis.fetch` happens
 *    to be then). Modelled as UNRELIABLE for the registration endpoint — the
 *    footgun the fix protects against: an app must not assume this implicit
 *    capture and its own explicit pristine snapshot are the same reference. Every
 *    other URL behaves identically to `pristineFetch`.
 * The test installs `flakyGlobalFetch` as `globalThis.fetch` BEFORE constructing
 * `ReactiveFetchManager`, then (mirroring `registerGlobally()`) wraps the manager's
 * own `fetch` with a thin recording layer so `recorded.patchedUrls` reflects every
 * URL that rode the PATCHED global — exactly the channel `oauthFetch` must never
 * let a provider-internal OIDC request use.
 */
function makeMockWorld(): { pristineFetch: typeof fetch; flakyGlobalFetch: typeof fetch; recorded: Recorded } {
  const recorded: Recorded = { baseUrls: [], patchedUrls: [], podAuthorization: null };
  const pristineFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    recorded.baseUrls.push(req.url);
    return trueNetwork(req, recorded);
  };
  const flakyGlobalFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.url === REGISTRATION_ENDPOINT) {
      // The one OIDC hop this ambient reference cannot be trusted with. A
      // provider-internal request that rides this pathway (no customFetch pin)
      // always fails here — an unpinned dynamic-client-registration call MUST
      // never depend on this reference succeeding.
      return new Response(null, { status: 401 });
    }
    return trueNetwork(req, recorded);
  };
  return { pristineFetch, flakyGlobalFetch, recorded };
}

const realGlobalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realGlobalFetch;
});

/**
 * Run the production wiring end-to-end: install `flakyGlobalFetch` as the ambient
 * global, construct the REAL `ReactiveFetchManager` over the REAL provider (so its
 * `#globalFetch` snapshot is `flakyGlobalFetch`), `registerGlobally()`, wrap the
 * result with a recording layer, then fire the pod-root probe exactly as
 * `SolidAuthProvider.tsx`'s login flow does. Raced against a deadline so the
 * pre-fix deadlock fails fast with a descriptive error instead of a generic
 * Vitest timeout.
 */
async function runLoginFlow(
  buildOptions: (pristineFetch: typeof fetch) => Record<string, unknown>,
): Promise<{ response: Response; recorded: Recorded }> {
  const { pristineFetch, flakyGlobalFetch, recorded } = makeMockWorld();

  globalThis.fetch = flakyGlobalFetch;
  const provider: Provider = new WebIdDPoPTokenProvider(
    CALLBACK,
    async () => REDIRECT,
    async () => WEBID,
    buildOptions(pristineFetch),
  );
  const manager = new ReactiveFetchManager([provider]);
  manager.registerGlobally(); // captures `flakyGlobalFetch` internally, then patches the global.

  const patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    recorded.patchedUrls.push(new Request(input, init).url);
    return patchedFetch(input, init);
  };

  const probe = new Request(POD_ROOT, { method: "HEAD" });
  const response = await Promise.race([
    globalThis.fetch(probe),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "LOGIN STALL (login-stall regression): the pod-root probe did not " +
                "complete — a provider-internal OIDC request is riding the patched " +
                "global fetch and deadlocking on the single-flight session promise. " +
                "Pin it via oauthFetch / [oauth.customFetch].",
            ),
          ),
        4000,
      ),
    ),
  ]);
  return { response, recorded };
}

describe("interactive login vs the patched global fetch (login-stall)", () => {
  it("completes login + attaches the DPoP token when oauthFetch is explicitly pinned to the pristine fetch", async () => {
    const { response, recorded } = await runLoginFlow((pristineFetch) => ({
      profileFetch: pristineFetch,
      oauthFetch: pristineFetch, // SolidAuthProvider.tsx's wiring
    }));

    expect(response.status).toBe(200);
    expect(recorded.podAuthorization).toBe("DPoP at-123");

    // The provider's own OIDC traffic (discovery + dynamic registration + token
    // grant) rode the PRISTINE fetch…
    expect(recorded.baseUrls).toContain(DISCOVERY_URL);
    expect(recorded.baseUrls).toContain(REGISTRATION_ENDPOINT);
    expect(recorded.baseUrls).toContain(TOKEN_ENDPOINT);
    // …and NEVER the patched global — the only request that ever rode it is the
    // pod-root probe itself (the manager's own retry uses its internal captured
    // reference directly, not a second call to the patched global).
    expect(recorded.patchedUrls).toEqual([POD_ROOT]);
  });

  it("defaults oauthFetch to profileFetch, so pinning the profile read pins the OIDC hops too", async () => {
    // No explicit oauthFetch — the safe default chain (oauthFetch ?? profileFetch)
    // must keep the provider's OIDC traffic off the patched global on its own.
    const { response, recorded } = await runLoginFlow((pristineFetch) => ({
      profileFetch: pristineFetch,
    }));

    expect(response.status).toBe(200);
    expect(recorded.podAuthorization).toBe("DPoP at-123");
    expect(recorded.baseUrls).toContain(REGISTRATION_ENDPOINT);
    expect(recorded.patchedUrls).toEqual([POD_ROOT]);
  });
});
