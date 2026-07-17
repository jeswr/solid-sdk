// AUTHORED-BY Claude Fable 5
/**
 * The authenticated-caller pod-route boundary, ported from the reviewed
 * reference implementation's route-security suite against
 * `createPodRouteGuard`. Route-level tests against REAL fixtures: real DPoP-bound Solid-OIDC tokens
 * from loopback dev issuers, real in-memory sparq pods, real profile reads —
 * no mocked verification and no mocked binding decision anywhere.
 *
 * The acceptance criteria, verbatim:
 *   - anonymous ⇒ 401 BEFORE param validation;
 *   - caller-supplied pod/webid parameters ⇒ 400;
 *   - binding failure ⇒ 403 (cross-pod substitution: no pod acknowledgment);
 *   - unconfigured service/issuer ⇒ 503;
 *   - zero-or-multiple allowlisted `pim:storage` claims ⇒ 403 (NEVER pick-first).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type AuthenticatedPodCaller,
  createPodRouteGuard,
  PodAccessError,
  type PodGuardConfig,
  type PodRouteGuard,
  resolveAuthorizedPod,
} from "../src/index.js";
import { type DevOidcIssuer, startDevOidcIssuer } from "./dev-issuer.js";
import { type SolidTestServer, startSolidServer } from "./harness.js";
import { seedPod } from "./seed.js";

const APP_ORIGIN = "http://127.0.0.1";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";

/** The pod-side owner acknowledgment: `<webid> pim:storage <pod>` (L2.3). */
function ackCard(webid: string, podBase: string): string {
  return `<${webid}> <${PIM_STORAGE}> <${podBase}> .\n`;
}

function apiUrl(path: string): string {
  return `${APP_ORIGIN}/api${path}`;
}

/** An authenticated Request: fresh single-use DPoP proof per call. */
async function authedRequest(
  issuer: DevOidcIssuer,
  method: string,
  path: string,
  options: { query?: string; body?: string } = {},
): Promise<Request> {
  // RFC 9449: `htu` binds scheme/authority/path only — never the query.
  const headers: Record<string, string> = await issuer.authHeaders(method, apiUrl(path));
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${apiUrl(path)}${options.query ?? ""}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

/** The guarded app handler: echoes exactly what the pipeline derived. */
async function echoHandler(
  caller: AuthenticatedPodCaller,
  body: Record<string, unknown>,
): Promise<Response> {
  return Response.json({ webid: caller.webid, podBase: caller.podBase, body });
}

let pods: SolidTestServer;
let podBase = "";
let borrower: DevOidcIssuer; // profile claims the borrower pod; pod acknowledges back
let attacker: DevOidcIssuer; // profile claims the borrower pod; pod does NOT acknowledge
let unbound: DevOidcIssuer; // profile claims no storage at all
let config: PodGuardConfig;
let guard: PodRouteGuard;

function configWith(extra: {
  issuers?: readonly string[];
  origins?: readonly string[];
}): PodGuardConfig {
  return {
    ...config,
    trustedOidcIssuers: [...config.trustedOidcIssuers, ...(extra.issuers ?? [])],
    allowedPodOrigins: [...config.allowedPodOrigins, ...(extra.origins ?? [])],
  };
}

beforeAll(async () => {
  pods = await startSolidServer({});
  podBase = `${pods.baseUrl}/`;
  borrower = await startDevOidcIssuer({ storage: podBase });
  attacker = await startDevOidcIssuer({ storage: podBase });
  unbound = await startDevOidcIssuer();

  // The pod-side acknowledgment card (L2.3) names the borrower.
  await seedPod(pods.baseUrl, [{ path: "/profile/card", body: ackCard(borrower.webid, podBase) }]);

  config = {
    trustedOidcIssuers: [borrower.issuer, attacker.issuer, unbound.issuer],
    allowedPodOrigins: [pods.baseUrl],
    allowInsecureLoopback: true,
    trustForwardedHeaders: false,
  };
  guard = createPodRouteGuard({ config });
}, 120_000);

afterAll(async () => {
  await pods?.stop();
  await borrower?.stop();
  await attacker?.stop();
  await unbound?.stop();
});

describe("anonymous callers (L1)", () => {
  test.each([
    ["GET", () => guard.handle(new Request(apiUrl("/pod")), echoHandler)],
    ["POST", () => guard.handle(new Request(apiUrl("/pod"), { method: "POST" }), echoHandler)],
  ])("an anonymous %s is rejected with 401 + WWW-Authenticate", async (_method, run) => {
    const response = await run();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toBeNull();
  });

  test("an unconfigured issuer allowlist fails the rail closed (503)", async () => {
    const unconfigured = createPodRouteGuard({
      config: { ...config, trustedOidcIssuers: [] },
    });
    const response = await unconfigured.handle(new Request(apiUrl("/pod")), echoHandler);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_configured");
  });
});

describe("the fail-closed order is fixed: authenticate BEFORE param validation", () => {
  test("an ANONYMOUS caller with override params is still 401 (identity before validation)", async () => {
    const response = await guard.handle(
      new Request(`${apiUrl("/pod")}?pod=${encodeURIComponent(podBase)}`),
      echoHandler,
    );
    expect(response.status).toBe(401);
  });

  test("an ANONYMOUS caller with a malformed body is still 401", async () => {
    const response = await guard.handle(
      new Request(apiUrl("/pod"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      echoHandler,
    );
    expect(response.status).toBe(401);
  });
});

describe("param overrides are rejected loudly (L2.4)", () => {
  test("a query pod= is rejected 400 even for an authenticated caller", async () => {
    const request = await authedRequest(borrower, "GET", "/pod", {
      query: `?pod=${encodeURIComponent(podBase)}`,
    });
    const response = await guard.handle(request, echoHandler);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("param_rejected");
  });

  test("a query webid= is rejected 400", async () => {
    const request = await authedRequest(borrower, "GET", "/pod", {
      query: `?webid=${encodeURIComponent(borrower.webid)}`,
    });
    const response = await guard.handle(request, echoHandler);
    expect(response.status).toBe(400);
  });

  test("a body pod/webid is rejected 400", async () => {
    const request = await authedRequest(borrower, "POST", "/pod", {
      body: JSON.stringify({ pod: podBase, webid: borrower.webid }),
    });
    const response = await guard.handle(request, echoHandler);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("param_rejected");
  });

  test("query overrides are rejected BEFORE the body is validated", async () => {
    const request = await authedRequest(borrower, "POST", "/pod", {
      query: `?pod=${encodeURIComponent(podBase)}`,
      body: "{not json",
    });
    const response = await guard.handle(request, echoHandler);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe("param_rejected");
    expect(body.detail).toContain("query");
  });

  test.each([
    ["not JSON", "{not json", "body must be JSON"],
    ["a JSON array", "[1,2]", "body must be a JSON object"],
  ])("a malformed body (%s) is 400 BEFORE any pod IO (binding never runs)", async (_label, raw, detail) => {
    let profileFetches = 0;
    const counting = createPodRouteGuard({
      config,
      ownerSeams: {
        profileFetch: (input, init) => {
          profileFetches += 1;
          return fetch(input, { ...init, redirect: "error" });
        },
      },
    });
    const request = await authedRequest(borrower, "POST", "/pod", { body: raw });
    const response = await counting.handle(request, echoHandler);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe("malformed_request");
    expect(body.detail).toBe(detail);
    expect(profileFetches).toBe(0);
  });
});

describe("cross-pod substitution is rejected (L2)", () => {
  test("a WebID whose profile claims SOMEONE ELSE'S pod is refused 403 (no pod acknowledgment)", async () => {
    // The attacker's own profile claims the borrower's pod (the forward claim
    // is attacker-authored), and the pod origin IS allowlisted — only the
    // pod-side acknowledgment stops this.
    const response = await guard.handle(await authedRequest(attacker, "GET", "/pod"), echoHandler);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("does not acknowledge");
  });

  test("a WebID claiming no pim:storage at all is refused 403", async () => {
    const response = await guard.handle(await authedRequest(unbound, "GET", "/pod"), echoHandler);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("no pim:storage");
  });

  test("a claimed pod whose profile card is missing is refused 403", async () => {
    const bare = await pods.provisionAccount();
    const bareBase = `${bare.baseUrl}/`;
    const bareIssuer = await startDevOidcIssuer({ storage: bareBase });
    try {
      const scoped = createPodRouteGuard({
        config: configWith({ issuers: [bareIssuer.issuer], origins: [bare.baseUrl] }),
      });
      const response = await scoped.handle(
        await authedRequest(bareIssuer, "GET", "/pod"),
        echoHandler,
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { detail: string };
      expect(body.detail).toContain("no profile card");
    } finally {
      await bareIssuer.stop();
    }
  }, 60_000);

  test("ZERO allowlisted claims: a claimed pod outside the allowlist is refused 403", async () => {
    const outside = await startDevOidcIssuer({ storage: "https://evil.example/" });
    try {
      const scoped = createPodRouteGuard({
        config: configWith({ issuers: [outside.issuer] }),
      });
      const response = await scoped.handle(
        await authedRequest(outside, "GET", "/pod"),
        echoHandler,
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { detail: string };
      expect(body.detail).toContain(
        "no pim:storage claimed by the caller's WebID is in the pod allowlist",
      );
    } finally {
      await outside.stop();
    }
  });

  test("MULTIPLE allowlisted claims are refused 403 — NEVER pick-first", async () => {
    // Two live, allowlisted pods; the caller's profile claims BOTH. There is no
    // safe way to guess, so the binding fails closed even though either pod on
    // its own would have been a plausible candidate.
    const second = await pods.provisionAccount();
    const secondBase = `${second.baseUrl}/`;
    const greedy = await startDevOidcIssuer({ storage: [podBase, secondBase] });
    try {
      const scoped = createPodRouteGuard({
        config: configWith({ issuers: [greedy.issuer], origins: [second.baseUrl] }),
      });
      const response = await scoped.handle(await authedRequest(greedy, "GET", "/pod"), echoHandler);
      expect(response.status).toBe(403);
      const body = (await response.json()) as { detail: string };
      expect(body.detail).toContain("refusing to guess");
    } finally {
      await greedy.stop();
    }
  }, 60_000);

  test("an unconfigured pod allowlist fails the rail closed (503) even for a verified caller", async () => {
    const scoped = createPodRouteGuard({
      config: { ...config, allowedPodOrigins: [] },
    });
    const response = await scoped.handle(await authedRequest(borrower, "GET", "/pod"), echoHandler);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("allowedPodOrigins");
  });
});

describe("the authenticated happy path derives everything from the token", () => {
  test("GET: 200, webid = token WebID, podBase = the acknowledged pod, empty body passthrough", async () => {
    const response = await guard.handle(await authedRequest(borrower, "GET", "/pod"), echoHandler);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      webid: string;
      podBase: string;
      body: Record<string, unknown>;
    };
    expect(body.webid).toBe(borrower.webid);
    expect(body.podBase).toBe(podBase);
    expect(body.body).toEqual({});
  }, 60_000);

  test("POST: the validated JSON body reaches the handler", async () => {
    const response = await guard.handle(
      await authedRequest(borrower, "POST", "/pod", { body: JSON.stringify({ note: "hi" }) }),
      echoHandler,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { body: Record<string, unknown> };
    expect(body.body).toEqual({ note: "hi" });
  }, 60_000);

  test("a handler PodAccessError is lowered to its status; details never leak on 500", async () => {
    const conflicted = await guard.handle(
      await authedRequest(borrower, "GET", "/pod"),
      async () => {
        throw new PodAccessError(409, "document changed underneath");
      },
    );
    expect(conflicted.status).toBe(409);
    expect(((await conflicted.json()) as { error: string }).error).toBe("pod_access");

    const crashed = await guard.handle(await authedRequest(borrower, "GET", "/pod"), async () => {
      throw new Error("secret internal detail");
    });
    expect(crashed.status).toBe(500);
    const crashBody = (await crashed.json()) as { error: string; detail?: string };
    expect(crashBody.error).toBe("internal_error");
    expect(JSON.stringify(crashBody)).not.toContain("secret internal detail");
  }, 60_000);
});

describe("resolveAuthorizedPod over real pod HTTP (L2)", () => {
  test("pod-rooted WebIDs: the owner-controlled card serves forward claim AND acknowledgment", async () => {
    const account = await pods.provisionAccount();
    const base = `${account.baseUrl}/`;
    const webid = `${base}profile/card#me`;
    await seedPod(account.baseUrl, [{ path: "/profile/card", body: ackCard(webid, base) }]);
    const scoped = configWith({ origins: [account.baseUrl] });
    await expect(resolveAuthorizedPod(webid, scoped)).resolves.toBe(base);
  }, 60_000);

  test("an unreachable WebID profile document is 502 (never an open pass)", async () => {
    await expect(
      resolveAuthorizedPod("http://127.0.0.1:1/profile/card#me", config),
    ).rejects.toMatchObject({ status: 502 });
  });
});
