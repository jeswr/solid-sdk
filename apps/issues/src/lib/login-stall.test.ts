// @vitest-environment node
//
// node (not jsdom): oauth4webapi + the dpop package need a same-realm
// WebCrypto + fetch (jsdom's cross-realm typed arrays break
// `Uint8Array.prototype.toBase64`/DPoP — the same reason
// webid-token-provider.test.ts pins node). @solid/reactive-authentication's
// package root ("mod.js", the only export — there is no narrower subpath)
// re-exports AuthorizationCodeFlow.ts, a custom element declared as
// `class AuthorizationCodeFlow extends HTMLElement`, which needs `HTMLElement`
// to exist as a value at class-DEFINITION time (module load), even though
// this test never instantiates or registers the element. A minimal stub
// class satisfies that without pulling in jsdom (installed below, via a
// dynamic import so it runs before the package loads — see the comment there).
//
// AUTHORED-BY Claude Sonnet 5
//
// login-stall.test.ts — regression for the interactive-login STALL fixed by
// pinning WebIdDPoPTokenProvider's OWN OIDC hops (discovery / registration /
// token grant) to an out-of-loop ("pristine") fetch.
//
// THE BUG: `#httpOptions` used to return `{ signal }` with no
// `[oauth.customFetch]`, so oauth4webapi fell back to the AMBIENT `fetch`
// identifier — resolved LIVE at call time, i.e. whatever `globalThis.fetch`
// happens to be WHEN the request fires, not a snapshot from construction. This
// app patches `globalThis.fetch` via `@solid/reactive-authentication`'s
// `ReactiveFetchManager` (`registerGlobally()`): on a 401 it calls
// `provider.upgrade(request)`, which single-flights onto `#sessions`. If the
// provider's OWN discovery/registration/token-grant request is routed through
// THAT patched global and its underlying ("before") transport treats it as
// needing an upgrade, `provider.upgrade()` re-enters `#getSession()`, which
// finds the CACHED pending promise for the very `#authenticate()` call that
// issued the original request — a circular await. Interactive login hangs
// forever, after the WebID profile read (already pinned) and before the OIDC
// popup ever opens.
//
// THE FIX under test: every oauth4webapi call is pinned to an out-of-loop
// fetch via `[oauth.customFetch]` (`oauthFetch`, defaulting to `profileFetch`,
// which the app pins to a pristine snapshot taken BEFORE
// `ReactiveFetchManager.registerGlobally()` runs). Because that pin is a
// captured reference, oauth4webapi's calls can never be redirected through
// whatever `globalThis.fetch` is later reassigned to — regardless of what the
// reactive wrapper's own "before" transport does.
//
// This test drives the REAL `ReactiveFetchManager` (not mocked) patched over
// `globalThis.fetch`, a REAL `WebIdDPoPTokenProvider`, and an in-test mock OP
// (no network). Two scenarios:
//
//  (A) "routing invariant" — a WELL-BEHAVED mock OP (discovery/registration/
//      token grant all succeed unauthenticated, as real OPs do; only the pod
//      resource requires auth). This deterministically proves oauth4webapi's
//      own traffic never rides the patched global fetch (only the pristine
//      one) — the core guarantee the fix provides, checkable without a race.
//
//  (B) "deadlock reproduction" — the manager's OWN captured "before" fetch is
//      modelled as a transport that (unlike the explicitly-pinned pristine
//      fetch) gates ANY request to the issuer's origin behind an
//      authenticated app session — e.g. a service-worker-intercepted or BFF-
//      proxied context sitting between "the global fetch identifier" and a
//      genuinely out-of-loop fetch (a real deployment shape: a same-origin
//      credentialed proxy in front of both the app's API and the IdP). This
//      is EXACTLY why the fix must pin an EXPLICIT out-of-loop fetch rather
//      than trust "whatever `globalThis.fetch` resolves to when the manager
//      captured it" — construction-time capture alone is not a strong enough
//      guarantee. Reverting the provider.ts fix (`git stash` the diff) and
//      re-running this test reproduces a genuine, deterministic hang here
//      (proven by tracing `ReactiveFetchManager`'s single-flight `#sessions`
//      map: the pending `#authenticate()` promise is cached BEFORE its own
//      discovery request resolves, so a re-entrant `provider.upgrade()` for
//      the same issuer awaits a promise that can only resolve once THAT
//      re-entrant call itself completes) — caught via a raced deadline with a
//      descriptive error, never a bare timeout.
import { afterEach, describe, expect, it } from "vitest";
import {
  WebIdDPoPTokenProvider,
  type WebIdDPoPTokenProviderOptions,
} from "./webid-token-provider";

// `import` declarations are hoisted and evaluated before ANY of this module's
// own top-level statements — so the HTMLElement stub MUST be installed via a
// dynamic import (real program order), not a static one, or the stub runs too
// late and the package root's HTMLElement reference still throws.
(globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};
const { ReactiveFetchManager } = await import("@solid/reactive-authentication");

const ISSUER = "https://op.example";
const WEBID = "https://pod.example/profile/card#me";
const POD_ROOT = "https://pod.example/";
const APP_ORIGIN = "https://app.example";
const CALLBACK_URI = `${APP_ORIGIN}/callback.html`;
const CLIENT_ID = `${APP_ORIGIN}/clientid.jsonld`;

const PROFILE_TURTLE = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${WEBID}> solid:oidcIssuer <${ISSUER}> ;
  pim:storage <${POD_ROOT}> .
`;

const b64u = (s: string): string => Buffer.from(s).toString("base64url");

/** An UNVERIFIED-signature ES256 id_token (oauth4webapi validates claims only). */
function fakeIdToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "ES256" }));
  const payload = b64u(
    JSON.stringify({
      iss: ISSUER,
      sub: "alice",
      aud: CLIENT_ID,
      exp: now + 3600,
      iat: now,
      nonce,
    }),
  );
  return `${header}.${payload}.${b64u("not-a-real-signature")}`;
}

/** What the mock world records, for the assertions. */
interface Recorded {
  /** Every URL that reached the PRISTINE (pinned, out-of-loop) fetch. */
  baseUrls: string[];
  /** Every URL that went through the PATCHED global fetch wrapper. */
  patchedUrls: string[];
  /** Authorization header seen by the pod-root probe, if any. */
  podAuthorization: string | null;
  /** Every authorization URL handed to getCode (the "popup"). */
  authorizeHops: URL[];
}

/**
 * The mock OP + pod, served by the PRISTINE fetch: WebID profile, OIDC
 * discovery, token endpoint, and the pod-root probe (which requires auth).
 * Any unexpected URL fails loudly (a 500) so a routing regression can't
 * silently pass.
 */
function makeMockWorld(): {
  baseFetch: typeof fetch;
  /**
   * The manager's OWN captured "before" transport, modelling a context that
   * (unlike the pinned pristine fetch) requires an authenticated app session
   * for ANY request to the issuer's origin — see the file header. Used ONLY
   * by scenario (B) to force a genuine deadlock reproduction.
   */
  managerBaseFetch: typeof fetch;
  recorded: Recorded;
  /** Let getCode hand the nonce to the token endpoint's id_token. */
  setNonce: (n: string) => void;
} {
  const recorded: Recorded = {
    baseUrls: [],
    patchedUrls: [],
    podAuthorization: null,
    authorizeHops: [],
  };
  let nonce = "";
  const baseFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    recorded.baseUrls.push(request.url);
    const url = new URL(request.url);
    if (request.url === WEBID.replace(/#.*$/, "") || request.url === WEBID) {
      return new Response(PROFILE_TURTLE, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }
    if (url.origin === ISSUER && url.pathname === "/.well-known/openid-configuration") {
      return new Response(
        JSON.stringify({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/auth`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          code_challenge_methods_supported: ["S256"],
          id_token_signing_alg_values_supported: ["ES256"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.origin === ISSUER && url.pathname === "/token") {
      return new Response(
        JSON.stringify({
          access_token: "at-123",
          token_type: "DPoP",
          expires_in: 3600,
          scope: "openid webid offline_access",
          id_token: fakeIdToken(nonce),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === POD_ROOT) {
      const authorization = request.headers.get("Authorization");
      if (!authorization) return new Response(null, { status: 401 });
      recorded.podAuthorization = authorization;
      return new Response(null, { status: 200 });
    }
    return new Response(`unexpected request in mock world: ${request.url}`, {
      status: 500,
    });
  };
  const managerBaseFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === ISSUER) {
      // Gate ANY unauthenticated hit to the issuer's origin — see the file
      // header for why this is a realistic stand-in, not an arbitrary choice.
      return new Response(null, { status: 401 });
    }
    return baseFetch(request);
  };
  return {
    baseFetch,
    managerBaseFetch,
    recorded,
    setNonce: (n: string) => {
      nonce = n;
    },
  };
}

/**
 * Run the production login wiring end-to-end over a mock world: construct the
 * REAL `ReactiveFetchManager` over `beforeFetch` (its own captured "before"
 * transport, exactly mirroring `new ReactiveFetchManager([provider])` running
 * BEFORE `registerGlobally()` reassigns the global), patch the global with a
 * RECORDING wrapper around `manager.fetch` (what `registerGlobally()` would
 * install), then fire the pod-root probe — exactly `session-context.tsx`'s
 * login sequence. The probe is RACED against a deadline so a deadlock fails
 * fast with a descriptive error instead of a generic test timeout.
 */
async function runLoginFlow(
  beforeFetch: typeof fetch,
  providerOptions: (baseFetch: typeof fetch) => WebIdDPoPTokenProviderOptions,
  baseFetch: typeof fetch,
  recorded: Recorded,
  setNonce: (n: string) => void,
): Promise<Recorded> {
  const realFetch = globalThis.fetch;
  // Mirrors `const pristineFetch = globalThis.fetch.bind(globalThis);` running
  // BEFORE `new ReactiveFetchManager([provider])` — the manager's constructor
  // captures whatever `globalThis.fetch` is AT THAT MOMENT.
  globalThis.fetch = beforeFetch;
  try {
    const getCode = async (authorizationUrl: URL): Promise<string> => {
      recorded.authorizeHops.push(authorizationUrl);
      setNonce(authorizationUrl.searchParams.get("nonce") ?? "");
      const state = authorizationUrl.searchParams.get("state") ?? "";
      return `${CALLBACK_URI}?code=fake-code&state=${encodeURIComponent(state)}`;
    };
    const provider = new WebIdDPoPTokenProvider(
      CALLBACK_URI,
      getCode,
      () => Promise.resolve(WEBID),
      { clientId: CLIENT_ID, allowInsecureLoopback: true, ...providerOptions(baseFetch) },
    );
    const manager = new ReactiveFetchManager([provider]);
    const recordingWrapper: typeof fetch = (input, init) => {
      recorded.patchedUrls.push(new Request(input, init).url);
      return manager.fetch(input, init);
    };
    // Mirrors `manager.registerGlobally()`, plus recording.
    globalThis.fetch = recordingWrapper;

    // The probe — session-context.tsx's post-login pod fetch. Pre-fix (with
    // scenario B's gated `beforeFetch`) this NEVER resolves — the provider's
    // own discovery request re-enters `upgrade()` and deadlocks on the
    // single-flight login.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const probe = globalThis.fetch(POD_ROOT, { method: "HEAD" });
    const response = await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        stallTimer = setTimeout(
          () =>
            reject(
              new Error(
                "LOGIN STALL (login-stall.test.ts regression): the pod-root " +
                  "probe did not complete — the provider's OWN OIDC requests " +
                  "are re-entering the patched global fetch and deadlocking " +
                  "on the single-flight login. Pin them to the pristine " +
                  "fetch (oauthFetch / [oauth.customFetch]).",
              ),
            ),
          4000,
        );
      }),
    ]);
    // Clear the stall timer when the probe wins, so a passing test doesn't
    // leave a 4s timer referenced (roborev Low).
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    expect(response.status).toBe(200);
    return recorded;
  } finally {
    globalThis.fetch = realFetch;
  }
}

afterEach(() => {
  // No global teardown hooks needed — runLoginFlow restores globalThis.fetch
  // itself in a `finally`, and each test builds a fresh mock world.
});

describe("interactive login vs the reactive-authentication patched fetch (login-stall regression)", () => {
  it("(A) never routes the provider's own OIDC traffic through the patched global, even when the OP is well-behaved", async () => {
    const { baseFetch, recorded, setNonce } = makeMockWorld();
    // The manager's captured "before" transport IS the well-behaved baseFetch
    // here — the faithful production shape (both the pin and the manager's
    // capture point at the same still-pristine `globalThis.fetch`).
    const result = await runLoginFlow(
      baseFetch,
      (fetchFn) => ({ profileFetch: fetchFn, oauthFetch: fetchFn }),
      baseFetch,
      recorded,
      setNonce,
    );

    // The "popup" opened exactly once.
    expect(result.authorizeHops).toHaveLength(1);
    expect(
      result.authorizeHops[0].origin + result.authorizeHops[0].pathname,
    ).toBe(`${ISSUER}/auth`);

    // The pod probe went out DPoP-authenticated with the minted token.
    expect(result.podAuthorization).toBe("DPoP at-123");

    // The provider's own OIDC traffic (discovery + token grant) rode the
    // PRISTINE fetch…
    expect(result.baseUrls).toContain(`${ISSUER}/.well-known/openid-configuration`);
    expect(result.baseUrls).toContain(`${ISSUER}/token`);
    // …and NEVER the patched global — the routing bug the fix eliminates.
    const patchedIssuerHits = result.patchedUrls.filter(
      (u) => new URL(u).origin === ISSUER,
    );
    expect(patchedIssuerHits).toEqual([]);
    // The only requests through the patched global are the pod probe itself
    // (unauthenticated attempt, then the DPoP-upgraded retry).
    expect(result.patchedUrls.every((u) => new URL(u).origin === new URL(POD_ROOT).origin)).toBe(
      true,
    );
  });

  it("(A2) defaults oauthFetch to profileFetch, so pinning the profile read pins the OIDC hops too", async () => {
    const { baseFetch, recorded, setNonce } = makeMockWorld();
    const result = await runLoginFlow(
      baseFetch,
      (fetchFn) => ({ profileFetch: fetchFn }), // no explicit oauthFetch
      baseFetch,
      recorded,
      setNonce,
    );
    expect(result.podAuthorization).toBe("DPoP at-123");
    expect(result.patchedUrls.filter((u) => new URL(u).origin === ISSUER)).toEqual([]);
  });

  it("(B) does not deadlock even when the manager's own captured transport gates the issuer's origin", async () => {
    const { baseFetch, managerBaseFetch, recorded, setNonce } = makeMockWorld();
    // The manager captures managerBaseFetch (gates the issuer origin) as its
    // "before" transport, but the provider is explicitly pinned to the
    // well-behaved baseFetch — exactly the fix's guarantee: it does not
    // matter what the reactive wrapper's own captured transport does, because
    // oauth4webapi never touches it.
    const result = await runLoginFlow(
      managerBaseFetch,
      (fetchFn) => ({ profileFetch: fetchFn, oauthFetch: fetchFn }),
      baseFetch,
      recorded,
      setNonce,
    );
    expect(result.podAuthorization).toBe("DPoP at-123");
    expect(result.patchedUrls.filter((u) => new URL(u).origin === ISSUER)).toEqual([]);
  }, 6000);
});
