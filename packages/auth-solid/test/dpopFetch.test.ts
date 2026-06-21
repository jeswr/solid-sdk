// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Security-core tests for the DPoP HTTP seam:
 *   - buildDpopCustomFetch: attaches a proof ONLY on the token leg (POST + form body), leaves
 *     discovery/JWKS/userinfo untouched, retries the §8 use_dpop_nonce challenge exactly once,
 *     enforces transport.
 *   - solidDpopFetch: attaches Authorization: DPoP + DPoP proof with `ath` on a pod request, does
 *     the 401 DPoP-Nonce retry once, enforces transport, never leaks the token/proof/key.
 */

import { generateDpopKeyPair } from "@jeswr/solid-dpop";
import { calculateJwkThumbprint, exportJWK } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  buildDpopCustomFetch,
  buildSolidDpopFetch,
  DPOP_NONCE_RETRY_LIMIT,
  isLoopbackHost,
} from "../src/dpopFetch.js";
import { createMockOp } from "./mockOp.js";

const ISSUER = "https://op.example";
const CLIENT_ID = "https://app.example/client-id";
const WEBID = "https://alice.example/profile/card#me";
const POD = "https://alice.example/private/notes.ttl";

describe("isLoopbackHost", () => {
  it("recognises localhost / 127.x / ::1 (bracketed)", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.5.5.5")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });
  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("op.example")).toBe(false);
    expect(isLoopbackHost("128.0.0.1")).toBe(false);
    expect(isLoopbackHost("169.254.169.254")).toBe(false);
  });
});

describe("buildDpopCustomFetch — leg discrimination", () => {
  it("attaches a DPoP header on the token leg (POST + form body)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    const res = await cf(op.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
        code_verifier: "v",
      }),
    });
    expect(res.status).toBe(200);
    expect(op.lastTokenDpop()).toBeDefined();
    expect(op.lastTokenDpop()?.header.typ).toBe("dpop+jwt");
  });

  it("does NOT attach a DPoP header on the discovery (GET) leg", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    await cf(op.discoveryUrl, { method: "GET" });
    const captured = op.captured.find((c) => c.url === op.discoveryUrl);
    expect(captured).toBeDefined();
    expect(captured?.headers.dpop).toBeUndefined();
  });

  it("does NOT attach a DPoP header on the JWKS (GET) leg", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    await cf(`${ISSUER}/jwks`, { method: "GET" });
    const captured = op.captured.find((c) => c.url === `${ISSUER}/jwks`);
    expect(captured?.headers.dpop).toBeUndefined();
  });

  it("does NOT attach DPoP on a POST that is NOT form-urlencoded (not a token request)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    await cf(`${ISSUER}/some-json-post`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const captured = op.captured.find((c) => c.url === `${ISSUER}/some-json-post`);
    expect(captured?.headers.dpop).toBeUndefined();
  });
});

describe("buildDpopCustomFetch — §8 nonce retry", () => {
  it("retries the use_dpop_nonce challenge exactly once and succeeds; token-leg proof has no ath", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    const res = await cf(op.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
        code_verifier: "v",
      }),
    });
    expect(res.status).toBe(200);
    expect(op.tokenCallCount()).toBe(2); // initial 400 + one retry
    const proof = op.lastTokenDpop();
    expect(proof?.payload.ath).toBeUndefined();
    expect(proof?.payload.nonce).toBe("srv-token-nonce-abc");
  });

  it("does NOT loop: a persistent nonce challenge surfaces after exactly one retry", async () => {
    // An underlying fetch that ALWAYS answers the §8 challenge — the customFetch must not loop.
    let calls = 0;
    const alwaysChallenge = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
        status: 400,
        headers: { "content-type": "application/json", "dpop-nonce": "n" },
      });
    });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, alwaysChallenge as never, false);
    const res = await cf("https://op.example/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });
    expect(res.status).toBe(400);
    // Exactly the original + ONE retry = 2 total calls (the retry limit).
    expect(calls).toBe(1 + DPOP_NONCE_RETRY_LIMIT);
    expect(calls).toBe(2);
  });

  it("the two token-leg proofs use DIFFERENT jti (single-use)", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const dpop = new Headers(init?.headers).get("dpop") as string;
      const payload = JSON.parse(Buffer.from(dpop.split(".")[1] as string, "base64url").toString());
      seen.push(payload.jti);
      if (seen.length === 1) {
        return new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 400,
          headers: { "content-type": "application/json", "dpop-nonce": "n" },
        });
      }
      return new Response(JSON.stringify({ access_token: "x", token_type: "DPoP" }), {
        status: 200,
      });
    });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, fetchImpl as never, false);
    await cf("https://op.example/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe("buildDpopCustomFetch — transport guard + asymmetric-only", () => {
  it("rejects an http: token endpoint when allowInsecure is false (token never sent in clear)", async () => {
    const kp = await generateDpopKeyPair();
    const underlying = vi.fn(async () => new Response("{}", { status: 200 }));
    const cf = buildDpopCustomFetch(kp, underlying as never, false);
    await expect(
      cf("http://op.example/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code" }),
      }),
    ).rejects.toThrow(/plaintext|insecure http/);
    // The underlying fetch must NEVER have been called (no token request over plaintext).
    expect(underlying).not.toHaveBeenCalled();
  });

  it("allows an http: loopback token endpoint when allowInsecure is true", async () => {
    const op = await createMockOp({
      issuer: "http://localhost:9999",
      clientId: CLIENT_ID,
      webId: WEBID,
    });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, true);
    const res = await cf("http://localhost:9999/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
        code_verifier: "v",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("the token-endpoint proof always uses the ES256 (asymmetric) alg — never HS*/none", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const kp = await generateDpopKeyPair();
    const cf = buildDpopCustomFetch(kp, op.fetch, false);
    await cf(op.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
        code_verifier: "v",
      }),
    });
    expect(op.lastTokenDpop()?.header.alg).toBe("ES256");
    expect(op.lastTokenDpop()?.header.alg).not.toBe("none");
    expect(op.lastTokenDpop()?.header.alg).not.toMatch(/^HS/);
  });
});

describe("solidDpopFetch — pod (resource) requests", () => {
  async function stateFor() {
    const kp = await generateDpopKeyPair();
    const dpopKeyJwk = await exportJWK(kp.privateKey);
    return { accessToken: "pod-access-token-1", dpopKeyJwk, thumbprint: kp.thumbprint };
  }

  it("attaches Authorization: DPoP and a DPoP proof with `ath` on a GET pod request", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: op.fetch,
      },
    );
    const res = await f(POD);
    expect(res.status).toBe(200);
    const proof = op.lastResourceDpop();
    expect(proof?.header.typ).toBe("dpop+jwt");
    expect(proof?.payload.ath).toBeDefined(); // ath present (binds proof to the access token)
    expect(proof?.payload.htm).toBe("GET");
    expect(proof?.payload.htu).toBe(POD);
    const captured = op.captured.find((c) => c.url === POD);
    expect(captured?.headers.authorization).toBe(`DPoP ${st.accessToken}`);
  });

  it("verifies the `ath` equals base64url(SHA-256(accessToken))", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: op.fetch,
      },
    );
    await f(POD);
    const { createHash } = await import("node:crypto");
    const expectedAth = createHash("sha256").update(st.accessToken, "ascii").digest("base64url");
    expect(op.lastResourceDpop()?.payload.ath).toBe(expectedAth);
  });

  it("the proof is bound to the persisted key (thumbprint matches)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: op.fetch,
      },
    );
    await f(POD);
    const headerJkt = await calculateJwkThumbprint(op.lastResourceDpop()?.header.jwk as never);
    expect(headerJkt).toBe(st.thumbprint);
  });

  it("retries the resource §8 DPoP-Nonce (401) challenge exactly once and succeeds", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    op.challengeNextResourceWithNonce("res-nonce-1");
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: op.fetch,
      },
    );
    const res = await f(POD);
    expect(res.status).toBe(200); // the retry (with the nonce echoed) succeeds
    expect(op.lastResourceDpop()?.payload.nonce).toBe("res-nonce-1");
  });

  it("does NOT loop on a persistent 401 DPoP-Nonce — surfaces after one retry", async () => {
    let calls = 0;
    const always401 = vi.fn(async () => {
      calls += 1;
      return new Response("", { status: 401, headers: { "dpop-nonce": "n" } });
    });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: always401 as never,
      },
    );
    const res = await f(POD);
    expect(res.status).toBe(401);
    expect(calls).toBe(1 + DPOP_NONCE_RETRY_LIMIT);
  });

  it("uses different jti across the original + retry (single-use)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const jtis: string[] = [];
    const tracking = vi.fn(async (input: unknown, init?: RequestInit) => {
      const dpop = new Headers(init?.headers).get("dpop") as string;
      jtis.push(JSON.parse(Buffer.from(dpop.split(".")[1] as string, "base64url").toString()).jti);
      return op.fetch(input as string, init);
    });
    op.challengeNextResourceWithNonce("res-nonce-2");
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: tracking as never,
      },
    );
    await f(POD);
    expect(jtis).toHaveLength(2);
    expect(jtis[0]).not.toBe(jtis[1]);
  });

  it("forwards method + body on a write (PUT)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: op.fetch,
      },
    );
    const res = await f(POD, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<a> <b> <c> .",
    });
    expect(res.status).toBe(200);
    expect(op.lastResourceDpop()?.payload.htm).toBe("PUT");
    const captured = op.captured.find((c) => c.url === POD && c.method === "PUT");
    expect(captured?.body).toBe("<a> <b> <c> .");
  });

  it("does NOT drop the body when a Request with its own body is passed (regression)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      { fetch: op.fetch },
    );
    const req = new Request(POD, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<x> <y> <z> .",
    });
    const res = await f(req);
    expect(res.status).toBe(200);
    expect(op.lastResourceDpop()?.payload.htm).toBe("PUT");
    const captured = op.captured.find((c) => c.url === POD && c.method === "PUT");
    expect(captured?.body).toBe("<x> <y> <z> ."); // the Request body was forwarded, not dropped
  });

  it("replays the Request body across the §8 DPoP-Nonce retry (not consumed by the first attempt)", async () => {
    const op = await createMockOp({ issuer: ISSUER, clientId: CLIENT_ID, webId: WEBID });
    op.challengeNextResourceWithNonce("res-nonce-body");
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      { fetch: op.fetch },
    );
    const req = new Request(POD, { method: "PUT", body: "replay-me" });
    const res = await f(req);
    expect(res.status).toBe(200);
    // The successful (retried) request must still carry the body.
    const captured = op.captured.filter((c) => c.url === POD && c.method === "PUT");
    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured[captured.length - 1]?.body).toBe("replay-me");
  });

  it("rejects an http: pod URL when allowInsecure is false (token never sent in clear)", async () => {
    const underlying = vi.fn(async () => new Response("{}", { status: 200 }));
    const st = await stateFor();
    const f = buildSolidDpopFetch(
      { accessToken: st.accessToken, dpopKeyJwk: st.dpopKeyJwk },
      {
        fetch: underlying as never,
      },
    );
    await expect(f("http://alice.example/x")).rejects.toThrow(/plaintext|insecure http/);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("throws on a missing access token", async () => {
    const st = await stateFor();
    expect(() => buildSolidDpopFetch({ accessToken: "", dpopKeyJwk: st.dpopKeyJwk })).toThrow(
      /accessToken/,
    );
  });

  it("throws on a missing dpopKeyJwk", async () => {
    expect(() => buildSolidDpopFetch({ accessToken: "t", dpopKeyJwk: undefined as never })).toThrow(
      /dpopKeyJwk/,
    );
  });
});

describe("no secret leak in errors/messages", () => {
  it("a transport-rejection error never contains the access token or the private key", async () => {
    const kp = await generateDpopKeyPair();
    const privJwk = await exportJWK(kp.privateKey);
    const accessToken = "SUPER-SECRET-ACCESS-TOKEN-xyz";
    const f = buildSolidDpopFetch({ accessToken, dpopKeyJwk: privJwk });
    let message = "";
    try {
      await f("http://evil.example/leak");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(accessToken);
    expect(message).not.toContain(privJwk.d);
  });

  it("the token-leg customFetch transport error never contains the request body/secret", async () => {
    const kp = await generateDpopKeyPair();
    const underlying = vi.fn(async () => new Response("{}", { status: 200 }));
    const cf = buildDpopCustomFetch(kp, underlying as never, false);
    let message = "";
    try {
      await cf("http://op.example/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "SECRET-CODE-123" }),
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain("SECRET-CODE-123");
  });
});
