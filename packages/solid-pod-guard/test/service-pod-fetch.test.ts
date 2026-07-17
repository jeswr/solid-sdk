// AUTHORED-BY Claude Fable 5
/**
 * createServicePodFetch (L4): a client-credentials DPoP service
 * identity against the REAL dev issuer and a REAL WAC-enforcing pod — the pod
 * itself verifies the minted tokens (no mocked verification).
 *
 * Ported from the reviewed reference implementation's suite with the moved
 * module, plus explicit acceptance coverage: redirect refusal, token cache,
 * per-request single-use DPoP proof, and the client secret never being
 * echoed into errors.
 */
import { createServer, type Server } from "node:http";
import { decodeJwt } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServicePodFetch } from "../src/index.js";
import { startDevOidcIssuer } from "./dev-issuer.js";
import { startSolidServer } from "./harness.js";

const CLIENT = { clientId: "svc", clientSecret: "svc-secret" };

let pods: Awaited<ReturnType<typeof startSolidServer>>;
let issuer: Awaited<ReturnType<typeof startDevOidcIssuer>>;
let podBase = "";
let protectedIri = "";

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const owner = pods.accounts[0];
  if (owner === undefined) throw new Error("no owner account");
  issuer = await startDevOidcIssuer({ clientCredentials: CLIENT, webidScheme: "http" });
  podBase = `${pods.baseUrl}/`;
  protectedIri = `${podBase}private/doc`;
  // Owner writes a private resource and grants ONLY the service identity read.
  const doc = await owner.authFetch(protectedIri, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `<${protectedIri}> a <http://example.org/Private> .`,
  });
  expect(doc.ok).toBe(true);
  const acl = await owner.authFetch(`${protectedIri}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner> a acl:Authorization ; acl:accessTo <${protectedIri}> ; acl:agent <${owner.webid}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#svc> a acl:Authorization ; acl:accessTo <${protectedIri}> ; acl:agent <${issuer.webid}> ;
  acl:mode acl:Read .
`,
  });
  expect(acl.ok).toBe(true);
}, 120_000);

afterAll(async () => {
  await pods?.stop();
  await issuer?.stop();
});

/** A loopback server that 302-redirects every request to `target`. */
async function startRedirector(
  target: string,
): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    response.statusCode = 302;
    response.setHeader("location", new URL(request.url ?? "/", target).href);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("redirector bind failed");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

describe("createServicePodFetch", () => {
  test("reads a WAC-protected resource the pod grants to the service WebID", async () => {
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      ...CLIENT,
      allowInsecureLoopback: true,
    });
    // Anonymous is refused; the service identity is not.
    expect((await fetch(protectedIri)).status).toBe(401);
    const first = await serviceFetch(protectedIri);
    expect(first.status).toBe(200);
    // Second call rides the cached token with a FRESH single-use proof.
    expect((await serviceFetch(protectedIri)).status).toBe(200);
  }, 60_000);

  test("a wrong client secret is refused at the token endpoint (fail closed)", async () => {
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      clientId: CLIENT.clientId,
      clientSecret: "wrong",
      allowInsecureLoopback: true,
    });
    await expect(serviceFetch(protectedIri)).rejects.toThrow(/refused \(400\)/);
  }, 60_000);

  test("cleartext and non-loopback endpoints are refused without the dev flag", () => {
    expect(() => createServicePodFetch({ issuer: "http://issuer.example", ...CLIENT })).toThrow(
      /must be https/,
    );
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      ...CLIENT,
      allowInsecureLoopback: true,
    });
    // The credentialed session refuses to touch a non-loopback cleartext resource.
    return expect(serviceFetch("http://pods.example/doc")).rejects.toThrow(/must be https/);
  });

  test("TOKEN CACHE: one token request serves many resource requests; every hop refuses redirects", async () => {
    const recorded: { url: string; method: string; redirect?: RequestRedirect; dpop?: string }[] =
      [];
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      ...CLIENT,
      allowInsecureLoopback: true,
      // Transport OBSERVATION seam: records, then delegates to the real network.
      fetch: (input, init) => {
        const request = new Request(input instanceof Request ? input : String(input), init);
        recorded.push({
          url: request.url,
          method: request.method,
          redirect: init?.redirect ?? (input instanceof Request ? input.redirect : undefined),
          dpop: request.headers.get("dpop") ?? undefined,
        });
        return fetch(input, init);
      },
    });
    expect((await serviceFetch(protectedIri)).status).toBe(200);
    expect((await serviceFetch(protectedIri)).status).toBe(200);
    expect((await serviceFetch(protectedIri)).status).toBe(200);

    const tokenPosts = recorded.filter((entry) => entry.url.endsWith("/token"));
    expect(tokenPosts).toHaveLength(1);
    const resourceGets = recorded.filter((entry) => entry.url === protectedIri);
    expect(resourceGets).toHaveLength(3);
    // Redirect refusal is enforced OUTSIDE the seam on EVERY call (discovery,
    // token, resource): the seam always receives `redirect: "error"`.
    for (const entry of recorded) {
      expect(entry.redirect).toBe("error");
    }
  }, 60_000);

  test("PER-REQUEST PROOF: every resource request mints a fresh single-use DPoP proof", async () => {
    const proofs: string[] = [];
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      ...CLIENT,
      allowInsecureLoopback: true,
      fetch: (input, init) => {
        const request = new Request(input instanceof Request ? input : String(input), init);
        const dpop = request.headers.get("dpop");
        if (request.url === protectedIri && dpop !== null) proofs.push(dpop);
        return fetch(input, init);
      },
    });
    expect((await serviceFetch(protectedIri)).status).toBe(200);
    expect((await serviceFetch(protectedIri)).status).toBe(200);
    expect((await serviceFetch(protectedIri)).status).toBe(200);
    expect(proofs).toHaveLength(3);
    const claims = proofs.map((proof) => decodeJwt(proof));
    const jtis = new Set(claims.map((claim) => claim.jti));
    expect(jtis.size).toBe(3); // single-use: never a repeated jti
    for (const claim of claims) {
      expect(claim.htm).toBe("GET");
      expect(claim.htu).toBe(protectedIri); // scheme/authority/path only
      expect(typeof claim.ath).toBe("string"); // bound to the access token
    }
  }, 60_000);

  test("REDIRECT REFUSAL: a redirecting issuer endpoint aborts the credentialed session", async () => {
    const redirector = await startRedirector(issuer.issuer);
    try {
      const serviceFetch = createServicePodFetch({
        issuer: redirector.origin,
        ...CLIENT,
        allowInsecureLoopback: true,
      });
      // Discovery 302s toward the real issuer — the session must refuse the hop
      // rather than follow a redirect with (future) credentialed requests.
      await expect(serviceFetch(protectedIri)).rejects.toThrow();
    } finally {
      await redirector.close();
    }
  }, 60_000);

  test("REDIRECT REFUSAL: a redirecting resource is refused, never followed", async () => {
    const redirector = await startRedirector(pods.baseUrl);
    try {
      const serviceFetch = createServicePodFetch({
        issuer: issuer.issuer,
        ...CLIENT,
        allowInsecureLoopback: true,
      });
      await expect(serviceFetch(`${redirector.origin}/private/doc`)).rejects.toThrow();
    } finally {
      await redirector.close();
    }
  }, 60_000);

  test("SECRET HYGIENE: the client secret is never echoed into errors", async () => {
    const secret = "super-secret-value-7c1f";
    const serviceFetch = createServicePodFetch({
      issuer: issuer.issuer,
      clientId: CLIENT.clientId,
      clientSecret: secret,
      allowInsecureLoopback: true,
    });
    // The issuer refuses the unknown secret; the surfaced error carries the
    // STATUS only — never the request material the endpoint may echo back.
    let caught: unknown;
    try {
      await serviceFetch(protectedIri);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const rendered = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(rendered).toContain("refused (400)");
    expect(rendered).not.toContain(secret);
  }, 60_000);
});
