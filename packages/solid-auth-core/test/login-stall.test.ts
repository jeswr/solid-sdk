// @vitest-environment node
//
// oauth4webapi + the dpop package need a same-realm WebCrypto + fetch primitives;
// jsdom's cross-realm typed arrays break them — so this runs in node.
/**
 * login-stall.test.ts — THE FLAGSHIP REGRESSION for this package's reason to
 * exist (bead suite-tracker-8575; ported from the AccessRadar
 * `product-login-stall` reproduction and adapted to `createSolidAuth`).
 *
 * AUTHORED-BY Claude Fable 5
 *
 * THE BUG CLASS (present in 9+ of the 21 hand-forked app providers): the app's
 * proactive authed-fetch wrapper patches the GLOBAL `fetch` with a credential
 * boundary that deliberately includes the ISSUER's origin. A token provider
 * whose own OIDC hops (discovery / registration / token grant) default to the
 * global then re-enters the patched fetch → `provider.upgrade(discoveryRequest)`
 * → which single-flights onto the very pending login promise that ISSUED the
 * discovery request. A circular await: login hangs forever AFTER the WebID
 * profile read and BEFORE the OIDC popup ever opens.
 *
 * WHAT createSolidAuth GUARANTEES (under test here): every OIDC hop is pinned
 * to the construction-time pristine fetch via `[oauth.customFetch]` /
 * restoreSession's `fetch` — there is NO oauthFetch knob, no live-global
 * fallback, and this package's own wrappers are BRAND-unwrappable — so the
 * deadlock cannot be wired up at all:
 *   1. Login completes even with a RE-ENTRANT patched global (a provider that
 *      awaits the in-flight login — the exact circular shape) covering the
 *      issuer origin. Pre-fix topologies deadlock here; we race a deadline so
 *      a regression fails loudly, not as a silent test timeout.
 *   2. The OIDC hops ride ONLY the pristine base fetch — never the patched
 *      global; the pod probe is the only request that rides the patch.
 *   3. `patchGlobalFetch: true` installs a BRANDED wrapper whose pristine base
 *      is recoverable, and a config mistake that passes the patched global back
 *      in as `publicFetch` is UNWRAPPED to the true pristine fetch.
 *   4. `profileFetch` (the one remaining fetch seam) cannot poison the OIDC
 *      hops — they ride the pristine fetch regardless.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetProactiveFetchForTests,
  createSolidAuth,
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  type ProactiveFetchInstall,
  type ProactiveTokenProvider,
  resolvePristineFetch,
} from "../src/index.js";

const ISSUER = "https://op.example";
const WEBID = "https://pod.example/profile/card#me";
const PROFILE_DOC = "https://pod.example/profile/card";
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
      sub: WEBID,
      webid: WEBID,
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
  /** Every URL that reached the PRISTINE (base) fetch. */
  baseUrls: string[];
  /** Every URL that went through the PATCHED global fetch wrapper. */
  patchedUrls: string[];
  /** Authorization header seen by the pod-root probe, if any. */
  podAuthorization: string | null;
  /** Every authorization URL handed to getCode (the "popup"). */
  authorizeHops: URL[];
}

/**
 * The mock OP + pod, served ENTIRELY by the pristine fetch stub: WebID profile,
 * OIDC discovery, token endpoint, and the pod-root probe. Any unexpected URL
 * fails loudly (a 500) so a routing regression can't silently pass.
 */
function makeMockWorld(): {
  baseFetch: typeof fetch;
  recorded: Recorded;
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
    const request = new Request(input as RequestInfo, init);
    recorded.baseUrls.push(request.url);
    const url = new URL(request.url);
    if (request.url === PROFILE_DOC || request.url === WEBID) {
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
          refresh_token: "rt-123",
          scope: "openid webid offline_access",
          id_token: fakeIdToken(nonce),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === POD_ROOT) {
      recorded.podAuthorization = request.headers.get("Authorization");
      return new Response(null, { status: 200 });
    }
    return new Response(`unexpected request in mock world: ${request.url}`, { status: 500 });
  };
  return {
    baseFetch,
    recorded,
    setNonce: (n: string) => {
      nonce = n;
    },
  };
}

/** getCode driver: record the "popup" hop and answer with a valid callback URL. */
function makeGetCode(recorded: Recorded, setNonce: (n: string) => void) {
  return async (authorizationUrl: URL): Promise<string> => {
    recorded.authorizeHops.push(authorizationUrl);
    setNonce(authorizationUrl.searchParams.get("nonce") ?? "");
    const state = authorizationUrl.searchParams.get("state") ?? "";
    return `${CALLBACK_URI}?code=fake-code&state=${encodeURIComponent(state)}`;
  };
}

/** Race a promise against the stall deadline so a deadlock fails DESCRIPTIVELY. */
function raceStall<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "LOGIN STALL (suite-tracker-8575 regression): login did not complete — " +
                "the engine's OIDC requests are re-entering the patched global fetch " +
                "and deadlocking on the single-flight login.",
            ),
          ),
        4000,
      ),
    ),
  ]);
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetProactiveFetchForTests();
});

describe("interactive login vs a proactive-patched global fetch (suite-tracker-8575)", () => {
  it("completes login with a RE-ENTRANT patched global covering the issuer origin — the OIDC hops never ride the patch", async () => {
    const { baseFetch, recorded, setNonce } = makeMockWorld();

    // The production topology that deadlocked the 21 hand-forked providers:
    // the proactive wrapper is installed and PATCHED OVER the global BEFORE any
    // login, with a credential boundary that INCLUDES the issuer's origin, and
    // armed with a provider whose upgrade() AWAITS the in-flight login — the
    // exact circular-await shape (upgrade → pending login → which issued the
    // request being upgraded). If ANY of the engine's OIDC hops rode the
    // patched global, this test would deadlock (caught by raceStall).
    let inFlightLogin: Promise<unknown> | undefined;
    const reEntrantProvider: ProactiveTokenProvider = {
      upgrade: async (request: Request): Promise<Request> => {
        if (inFlightLogin) await inFlightLogin; // the single-flight circular await
        return request;
      },
    };
    const install: ProactiveFetchInstall = installProactiveAuthFetch({
      patchGlobal: false, // we patch a RECORDING wrapper ourselves (never leaks past afterEach)
      pristineFetch: baseFetch,
      initial: {
        provider: reEntrantProvider,
        allowedOrigins: deriveProactiveAllowedOrigins({
          podRoot: POD_ROOT,
          webId: WEBID,
          issuer: ISSUER, // ← the issuer IS in the boundary (the stall precondition)
          extraOrigins: [APP_ORIGIN],
        }),
      },
    });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      recorded.patchedUrls.push(new Request(input as RequestInfo, init).url);
      return install.fetch(input, init);
    }) as typeof fetch;

    // Construct AFTER the global was patched (the worst-case order) — the mock
    // pristine fetch is injected via the documented publicFetch seam; there is
    // no oauthFetch knob to mis-wire.
    const auth = createSolidAuth({
      callbackUri: CALLBACK_URI,
      clientId: CLIENT_ID,
      authFlow: { getCode: makeGetCode(recorded, setNonce) },
      publicFetch: baseFetch,
    });

    inFlightLogin = auth.login(WEBID);
    const result = await raceStall(inFlightLogin as Promise<{ webId: string }>);
    inFlightLogin = undefined;
    expect(result.webId).toBe(WEBID);

    // The "popup" opened exactly once — pre-fix the stall happened BEFORE the
    // popup, so a deadlock would have left authorizeHops empty.
    expect(recorded.authorizeHops).toHaveLength(1);
    const hop = recorded.authorizeHops[0];
    expect(hop.origin + hop.pathname).toBe(`${ISSUER}/auth`);

    // The engine's own OIDC traffic (discovery + token grant) rode the PRISTINE
    // fetch…
    expect(recorded.baseUrls).toContain(`${ISSUER}/.well-known/openid-configuration`);
    expect(recorded.baseUrls).toContain(`${ISSUER}/token`);
    // …and NEVER the patched global — the re-entrancy that caused the deadlock.
    const patchedIssuerHits = recorded.patchedUrls.filter((u) => new URL(u).origin === ISSUER);
    expect(patchedIssuerHits).toEqual([]);
    // Nothing during login rode the patched global at all.
    expect(recorded.patchedUrls).toEqual([]);

    // A pod probe through the patched global is the ONLY request that rides it.
    const probe = await raceStall(globalThis.fetch(POD_ROOT, { method: "HEAD" }));
    expect(probe.status).toBe(200);
    expect(recorded.patchedUrls).toEqual([POD_ROOT]);
  });

  it("patchGlobalFetch: true — the pod probe rides the (branded) engine wrapper with the DPoP token; OIDC hops rode only the pristine base", async () => {
    const { baseFetch, recorded, setNonce } = makeMockWorld();
    const auth = createSolidAuth({
      callbackUri: CALLBACK_URI,
      clientId: CLIENT_ID,
      authFlow: { getCode: makeGetCode(recorded, setNonce) },
      publicFetch: baseFetch,
      patchGlobalFetch: true,
    });

    const result = await raceStall(auth.login(WEBID));
    expect(result.webId).toBe(WEBID);

    // The engine patched the global with ITS OWN wrapper — which is BRANDED, so
    // the true pristine base is recoverable from it (the unrepresentability
    // mechanism: nothing that captures this wrapper later can anchor on it).
    expect(globalThis.fetch).not.toBe(baseFetch);
    expect(resolvePristineFetch(globalThis.fetch)).toBe(baseFetch);

    // A bare global fetch of the pod root goes out DPoP-authenticated.
    const probe = await raceStall(globalThis.fetch(POD_ROOT, { method: "HEAD" }));
    expect(probe.status).toBe(200);
    expect(recorded.podAuthorization).toBe("DPoP at-123");

    // And the OIDC endpoints were only ever reached via the pristine base
    // (every request in this world funnels to baseFetch — the discovery/token
    // hops appear exactly once each, i.e. they never looped through upgrade()).
    expect(recorded.baseUrls.filter((u) => u === `${ISSUER}/token`)).toHaveLength(1);
    expect(
      recorded.baseUrls.filter((u) => u === `${ISSUER}/.well-known/openid-configuration`),
    ).toHaveLength(1);
  });

  it("a config mistake passing the patched global back in as publicFetch is UNWRAPPED to the true pristine fetch", async () => {
    const { baseFetch } = makeMockWorld();
    // Our own wrapper patches the global (the standalone installer, branded).
    const install = installProactiveAuthFetch({ pristineFetch: baseFetch });
    expect(install.patchedGlobal).toBe(true);
    expect(globalThis.fetch).toBe(install.fetch);

    // The residual-risk shape the shared-logic review flagged: a caller wires
    // `publicFetch: globalThis.fetch` (the PATCHED global) into the engine.
    // Pre-auth-core this re-introduced the deadlock; here the brand chain is
    // unwrapped at construction, so the engine anchors on the TRUE pristine.
    const auth = createSolidAuth({
      callbackUri: CALLBACK_URI,
      clientId: CLIENT_ID,
      publicFetch: globalThis.fetch,
    });
    expect(auth.publicFetch).toBe(baseFetch);
  });

  it("profileFetch (the remaining fetch seam) cannot poison the OIDC hops — they ride the pristine fetch regardless", async () => {
    const { baseFetch, recorded, setNonce } = makeMockWorld();
    // A "poisoned" profile fetch that records everything routed through it.
    const profileUrls: string[] = [];
    const poisonedProfileFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      profileUrls.push(new Request(input as RequestInfo, init).url);
      return baseFetch(input, init);
    }) as typeof fetch;

    const auth = createSolidAuth({
      callbackUri: CALLBACK_URI,
      clientId: CLIENT_ID,
      authFlow: { getCode: makeGetCode(recorded, setNonce) },
      publicFetch: baseFetch,
      profileFetch: poisonedProfileFetch,
    });
    const result = await raceStall(auth.login(WEBID));
    expect(result.webId).toBe(WEBID);

    // The profile read used the seam (fetch-rdf may keep the WebID's fragment
    // on the Request; both name the same profile document)…
    expect(
      profileUrls.some((u) => u === PROFILE_DOC || u === WEBID),
      `profile read did not use the seam: ${JSON.stringify(profileUrls)}`,
    ).toBe(true);
    // …but NO OIDC hop did — there is no configuration that routes the engine's
    // own token traffic anywhere but the pristine publicFetch.
    const oidcThroughProfileSeam = profileUrls.filter((u) => new URL(u).origin === ISSUER);
    expect(oidcThroughProfileSeam).toEqual([]);
  });
});
