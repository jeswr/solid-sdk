// @vitest-environment node
// AUTHORED-BY Claude Opus 4.8
/**
 * verify-request.test.ts — the framework-free `verifyRequest(headers, method, url, opts)` entry
 * (the extraction-specific surface): header-shape normalization ({@link HeadersInput}), the
 * `requireOwner` toggle, the optional same-origin CSRF gate, and the rate-limiter seam (429).
 */
import { describe, expect, it } from "vitest";
import {
  ApiAuthError,
  type RateLimiter,
  TokenBucketRateLimiter,
  verifyRequest,
} from "../src/index.js";
import { APP_URL, createHarness, ISSUER, OWNER } from "./harness.js";

async function expectStatus(p: Promise<unknown>, status: number): Promise<ApiAuthError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiAuthError);
    expect((e as ApiAuthError).statusCode).toBe(status);
    return e as ApiAuthError;
  }
  throw new Error(`expected ApiAuthError(${status}) but the promise resolved`);
}

describe("verifyRequest — framework-free entry", () => {
  it("verifies with a plain-object header map (no web Headers/Request needed)", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const creds = await verifyRequest(
      { authorization: `DPoP ${token}`, dpop: proof },
      "POST",
      APP_URL,
      { verifier },
    );
    expect(creds.webId).toBe(OWNER);
    expect(creds.issuer).toBe(ISSUER);
  });

  it("verifies with an iterable of header pairs", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const headers: Array<[string, string]> = [
      ["authorization", `DPoP ${token}`],
      ["dpop", proof],
    ];
    const creds = await verifyRequest(headers, "POST", APP_URL, { verifier });
    expect(creds.webId).toBe(OWNER);
  });

  it("verifies with a real web Headers instance", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const headers = new Headers({ authorization: `DPoP ${token}`, dpop: proof });
    const creds = await verifyRequest(headers, "POST", APP_URL, { verifier });
    expect(creds.webId).toBe(OWNER);
  });

  it("skips undefined header values in a record", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const creds = await verifyRequest(
      { authorization: `DPoP ${token}`, dpop: proof, "x-optional": undefined },
      "POST",
      APP_URL,
      { verifier },
    );
    expect(creds.webId).toBe(OWNER);
  });

  it("requireOwner:false authenticates a non-owner WebID (no 403)", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken({ webid: "https://intruder.example/card#me" });
    const proof = await h.mintProof({ accessToken: token });
    const creds = await verifyRequest(
      { authorization: `DPoP ${token}`, dpop: proof },
      "POST",
      APP_URL,
      { verifier, requireOwner: false },
    );
    expect(creds.webId).toBe("https://intruder.example/card#me");
  });

  it("default (requireOwner unset) enforces the owner gate → 403 for a non-owner", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken({ webid: "https://intruder.example/card#me" });
    const proof = await h.mintProof({ accessToken: token });
    await expectStatus(
      verifyRequest({ authorization: `DPoP ${token}`, dpop: proof }, "POST", APP_URL, {
        verifier,
      }),
      403,
    );
  });

  it("assertSameOrigin:true rejects a cross-origin request (403) BEFORE auth work", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    await expectStatus(
      verifyRequest(
        { authorization: `DPoP ${token}`, dpop: proof, origin: "https://evil.example" },
        "POST",
        APP_URL,
        { verifier, assertSameOrigin: true },
      ),
      403,
    );
  });

  it("assertSameOrigin:true allows a same-origin request", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    const creds = await verifyRequest(
      { authorization: `DPoP ${token}`, dpop: proof, origin: "https://app.example" },
      "POST",
      APP_URL,
      { verifier, assertSameOrigin: true },
    );
    expect(creds.webId).toBe(OWNER);
  });

  it("rate limiter: consumes after auth, keyed by WebID; empty bucket → 429", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const rateLimiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSec: 0, now: () => 0 });
    const token = await h.mintAccessToken();
    // First request consumes the single token.
    const proof1 = await h.mintProof({ accessToken: token, jti: "rl-1" });
    const creds = await verifyRequest(
      { authorization: `DPoP ${token}`, dpop: proof1 },
      "POST",
      APP_URL,
      { verifier, rateLimiter },
    );
    expect(creds.webId).toBe(OWNER);
    // Second (fresh, non-replayed) proof authenticates but the bucket is empty → 429.
    const proof2 = await h.mintProof({ accessToken: token, jti: "rl-2" });
    const err = await expectStatus(
      verifyRequest({ authorization: `DPoP ${token}`, dpop: proof2 }, "POST", APP_URL, {
        verifier,
        rateLimiter,
      }),
      429,
    );
    expect(err.message).toMatch(/rate limit/i);
  });

  it("rate limiter: a custom rateLimitKey is honoured", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    const seen: string[] = [];
    const rateLimiter: RateLimiter = {
      tryRemove(key: string) {
        seen.push(key);
        return true;
      },
    };
    const token = await h.mintAccessToken();
    const proof = await h.mintProof({ accessToken: token });
    await verifyRequest({ authorization: `DPoP ${token}`, dpop: proof }, "POST", APP_URL, {
      verifier,
      rateLimiter,
      rateLimitKey: (c) => `issuer:${c.issuer}`,
    });
    expect(seen).toEqual([`issuer:${ISSUER}`]);
  });

  it("an unauthenticated request never consumes a rate-limit token (limiter runs after auth)", async () => {
    const h = await createHarness();
    const verifier = h.makeVerifier();
    let calls = 0;
    const rateLimiter: RateLimiter = {
      tryRemove() {
        calls++;
        return true;
      },
    };
    await expectStatus(verifyRequest({}, "POST", APP_URL, { verifier, rateLimiter }), 401);
    expect(calls).toBe(0);
  });
});
