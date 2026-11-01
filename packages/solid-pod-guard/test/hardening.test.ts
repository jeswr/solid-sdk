// AUTHORED-BY Claude Opus 5.5
/**
 * Regressions for the sst-8xm.9.18 hardening review: storage-root binding, malformed
 * storage claims, bounded owner-card reads, the unconfigured-allowlist 503, the dev
 * loopback flag, forwarded-header configuration and the service identity's issuer and
 * token-type checks. Transport is injected through the package's seams.
 */
import { describe, expect, test } from "vitest";
import {
  configFromEnv,
  createPodRouteGuard,
  createServicePodFetch,
  type PodGuardConfig,
  resolveAuthorizedPod,
} from "../src/index.js";

const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";
const STORAGE_LINK = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';
const HOST = "https://pods.example";
const ALEX = `${HOST}/alex/`;
const SHARED = `${HOST}/alex/shared/`;
const MALLORY = "https://id.example/mallory#me";

const config: PodGuardConfig = {
  trustedOidcIssuers: ["https://issuer.example"],
  allowedPodOrigins: [HOST],
};

function turtle(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}

/** A pod host whose only storage root is `/alex/`; `cards` maps card IRIs to Turtle. */
function podHost(cards: Record<string, string>, rootLink = STORAGE_LINK): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
      return new Response(null, { status: 200, headers: url === ALEX ? { link: rootLink } : {} });
    }
    const card = cards[url];
    return card === undefined ? new Response(null, { status: 404 }) : turtle(card);
  };
}

function profile(body: string): typeof fetch {
  return async () => turtle(body);
}

describe("the pod must be a storage root", () => {
  test("a shared sub-container claimed and 'acknowledged' by a non-owner is refused", async () => {
    const claim = `<${MALLORY}> <${PIM_STORAGE}> <${SHARED}> .`;
    const result = resolveAuthorizedPod(MALLORY, config, {
      profileFetch: profile(claim),
      podFetch: podHost({ [`${SHARED}profile/card`]: claim }),
    });
    await expect(result).rejects.toMatchObject({ status: 403, message: /storage root/ });
  });

  test("a pod-rooted WebID minted inside a shared sub-container is refused too", async () => {
    const webid = `${SHARED}profile/card#me`;
    const card = `<${webid}> <${PIM_STORAGE}> <${SHARED}> .`;
    const result = resolveAuthorizedPod(webid, config, {
      profileFetch: profile(card),
      podFetch: podHost({ [`${SHARED}profile/card`]: card }),
    });
    await expect(result).rejects.toMatchObject({ status: 403, message: /storage root/ });
  });

  test("a storage link anchored at another resource does not make the sub-container a root", async () => {
    const claim = `<${MALLORY}> <${PIM_STORAGE}> <${SHARED}> .`;
    const anchored = async (_input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "HEAD"
        ? new Response(null, { headers: { link: `${STORAGE_LINK}; anchor="${ALEX}"` } })
        : turtle(claim);
    await expect(
      resolveAuthorizedPod(MALLORY, config, { profileFetch: profile(claim), podFetch: anchored }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("the owner of a real storage root is bound", async () => {
    const webid = "https://id.example/alex#me";
    const claim = `<${webid}> <${PIM_STORAGE}> <${ALEX}> .`;
    await expect(
      resolveAuthorizedPod(webid, config, {
        profileFetch: profile(claim),
        podFetch: podHost({ [`${ALEX}profile/card`]: claim }),
      }),
    ).resolves.toBe(ALEX);
  });
});

describe("malformed storage claims", () => {
  const webid = "https://id.example/alex#me";

  test("a literal beside a valid claim is skipped, not a crash", async () => {
    const claims = `<${webid}> <${PIM_STORAGE}> "${ALEX}", <${ALEX}> .`;
    await expect(
      resolveAuthorizedPod(webid, config, {
        profileFetch: profile(claims),
        podFetch: podHost({ [`${ALEX}profile/card`]: claims }),
      }),
    ).resolves.toBe(ALEX);
  });

  test("a literal-only claim reads as no claim (403)", async () => {
    await expect(
      resolveAuthorizedPod(webid, config, {
        profileFetch: profile(`<${webid}> <${PIM_STORAGE}> "${ALEX}" .`),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("bounded pod reads and fail-closed configuration", () => {
  test("an oversized owner card is a 502, not an unbounded read", async () => {
    const webid = "https://id.example/alex#me";
    const claim = `<${webid}> <${PIM_STORAGE}> <${ALEX}> .`;
    const huge = `${claim}\n${"# padding\n".repeat(150_000)}`;
    await expect(
      resolveAuthorizedPod(webid, config, {
        profileFetch: profile(claim),
        podFetch: podHost({ [`${ALEX}profile/card`]: huge }),
      }),
    ).rejects.toMatchObject({ status: 502 });
  });

  test("an unset pod allowlist is 503 before any profile fetch", async () => {
    let fetched = 0;
    const result = resolveAuthorizedPod(
      MALLORY,
      { ...config, allowedPodOrigins: [] },
      {
        profileFetch: async () => {
          fetched += 1;
          return turtle("");
        },
      },
    );
    await expect(result).rejects.toMatchObject({ status: 503 });
    expect(fetched).toBe(0);
  });

  test("the dev loopback flag with a non-loopback trusted issuer fails closed (503)", async () => {
    const guard = createPodRouteGuard({
      config: {
        ...config,
        trustedOidcIssuers: ["http://localhost:4000", "https://issuer.example"],
        allowInsecureLoopback: true,
      },
    });
    const response = await guard.handle(new Request("https://app.example/api/pod"), async () =>
      Response.json({}),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe("not_configured");
  });
});

describe("configFromEnv forwarded-header trust", () => {
  test.each([
    [{ VERCEL: "1" }, true],
    [{ VERCEL: "1", APP_TRUST_FORWARDED_HEADERS: "0" }, false],
    [{ APP_TRUST_FORWARDED_HEADERS: "1" }, true],
    [{}, false],
  ])("%o → %s", (env, expected) => {
    expect(configFromEnv("APP", env).trustForwardedHeaders).toBe(expected);
  });
});

describe("service identity discovery and token checks", () => {
  const issuer = "https://issuer.example";

  function serviceFetch(discovery: object, token: object): typeof fetch {
    return async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/.well-known/openid-configuration")) return Response.json(discovery);
      if (url === `${issuer}/token`) return Response.json(token);
      return new Response("ok");
    };
  }

  test("a discovery document naming another issuer is refused before the secret is sent", async () => {
    let tokenRequests = 0;
    const base = serviceFetch(
      { issuer: "https://evil.example", token_endpoint: `${issuer}/token` },
      { access_token: "t", token_type: "DPoP" },
    );
    const svc = createServicePodFetch({
      issuer,
      clientId: "svc",
      clientSecret: "secret",
      fetch: async (input, init) => {
        if (String(input instanceof Request ? input.url : input).endsWith("/token"))
          tokenRequests += 1;
        return base(input, init);
      },
    });
    await expect(svc(`${HOST}/alex/doc`)).rejects.toThrow(/different issuer/);
    expect(tokenRequests).toBe(0);
  });

  test("a Bearer token is refused rather than sent as a DPoP token", async () => {
    const svc = createServicePodFetch({
      issuer,
      clientId: "svc",
      clientSecret: "secret",
      fetch: serviceFetch(
        { issuer, token_endpoint: `${issuer}/token` },
        { access_token: "t", token_type: "Bearer", expires_in: 300 },
      ),
    });
    await expect(svc(`${HOST}/alex/doc`)).rejects.toThrow(/DPoP-bound/);
  });
});
