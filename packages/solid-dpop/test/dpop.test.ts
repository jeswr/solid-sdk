/**
 * RFC 9449 DPoP proof STRUCTURE verification — we verify the SDK's proofs against the
 * spec ourselves (header typ/alg/jwk, payload htm/htu/jti/iat/ath, signature) rather than
 * trusting that "it signed something". These assertions are the spec, restated as tests.
 *
 * Ported from integrations/dpop-bridge/test/dpop.test.ts (the most thorough of the six copies:
 * it verifies the signature, thumbprint==jkt, and cross-key binding) plus n8n-solid's
 * generateDpopKeyPair-named cases. This is the canonical home for these tests now.
 */

import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JWK,
  jwtVerify,
} from "jose";
import { describe, expect, it } from "vitest";
import {
  accessTokenHash,
  canonicalHtu,
  createDpopProof,
  generateDpopKeyPair,
  generateSessionKeyPair,
} from "../src/index.js";

describe("canonicalHtu (RFC 9449 §4.2)", () => {
  it("strips query and fragment, keeps scheme+authority+path", () => {
    expect(canonicalHtu("https://pod.example/a/b?x=1#frag")).toBe("https://pod.example/a/b");
  });
  it("preserves trailing slash (container vs resource)", () => {
    expect(canonicalHtu("https://pod.example/c/")).toBe("https://pod.example/c/");
  });
});

describe("accessTokenHash (ath, RFC 9449 §4.2)", () => {
  it("is base64url(SHA-256(ascii(token))) with no padding", () => {
    const token = "abc.def.ghi";
    const expected = createHash("sha256").update(token, "ascii").digest("base64url");
    expect(accessTokenHash(token)).toBe(expected);
    expect(accessTokenHash(token)).not.toContain("=");
    expect(accessTokenHash(token)).not.toMatch(/[+/]/);
  });
});

describe("generateSessionKeyPair is an alias of generateDpopKeyPair", () => {
  it("both produce a usable ES256 keypair with a thumbprint", async () => {
    const a = await generateDpopKeyPair();
    const b = await generateSessionKeyPair();
    expect(a.thumbprint).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b.thumbprint).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.publicJwk.kty).toBe("EC");
    expect(b.publicJwk.crv).toBe("P-256");
    // distinct keys per call
    expect(a.thumbprint).not.toBe(b.thumbprint);
  });
});

describe("createDpopProof — header (RFC 9449 §4.2)", () => {
  it("has typ=dpop+jwt, alg=ES256, and an embedded public JWK (no private fields)", async () => {
    const kp = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair: kp, htm: "GET", htu: "https://pod.example/r" });
    const header = decodeProtectedHeader(proof);
    expect(header.typ).toBe("dpop+jwt");
    expect(header.alg).toBe("ES256");
    const jwk = header.jwk as JWK | undefined;
    expect(jwk).toBeDefined();
    expect(jwk?.kty).toBe("EC");
    expect(jwk?.crv).toBe("P-256");
    // The embedded JWK MUST be the PUBLIC key only — no private `d`.
    expect((jwk as Record<string, unknown>).d).toBeUndefined();
  });

  it("embedded jwk thumbprint equals the keypair thumbprint (this is the jkt)", async () => {
    const kp = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair: kp, htm: "GET", htu: "https://pod.example/r" });
    const header = decodeProtectedHeader(proof);
    const jkt = await calculateJwkThumbprint(header.jwk as JWK);
    expect(jkt).toBe(kp.thumbprint);
  });
});

describe("createDpopProof — payload + signature", () => {
  it("verifies under the embedded key and carries htm/htu/jti/iat", async () => {
    const kp = await generateDpopKeyPair();
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "put",
      htu: "https://pod.example/data/x?ignored=1",
    });
    const header = decodeProtectedHeader(proof);
    const pub = await importJWK(header.jwk as JWK, "ES256");
    const { payload } = await jwtVerify(proof, pub, { typ: "dpop+jwt" });
    expect(payload.htm).toBe("PUT"); // method uppercased
    expect(payload.htu).toBe("https://pod.example/data/x"); // query stripped
    expect(typeof payload.jti).toBe("string");
    expect(typeof payload.iat).toBe("number");
    expect(payload.ath).toBeUndefined(); // no token => no ath
  });

  it("includes ath when an access token is supplied, matching the token hash", async () => {
    const kp = await generateDpopKeyPair();
    const token = "header.payload.sig";
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "GET",
      htu: "https://pod.example/r",
      accessToken: token,
    });
    const header = decodeProtectedHeader(proof);
    const pub = await importJWK(header.jwk as JWK, "ES256");
    const { payload } = await jwtVerify(proof, pub, { typ: "dpop+jwt" });
    expect(payload.ath).toBe(accessTokenHash(token));
  });

  it("includes the server nonce when supplied (RFC 9449 §8)", async () => {
    const kp = await generateDpopKeyPair();
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "POST",
      htu: "https://idp.example/token",
      nonce: "n-0S6_WzA2Mj",
    });
    const header = decodeProtectedHeader(proof);
    const pub = await importJWK(header.jwk as JWK, "ES256");
    const { payload } = await jwtVerify(proof, pub, { typ: "dpop+jwt" });
    expect(payload.nonce).toBe("n-0S6_WzA2Mj");
  });

  it("omits ath when no token is supplied (decodeJwt convenience check)", async () => {
    const kp = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair: kp, htm: "get", htu: "https://pod/x?q=2#f" });
    const payload = decodeJwt(proof);
    expect(payload.htm).toBe("GET");
    expect(payload.htu).toBe("https://pod/x");
    expect(payload.ath).toBeUndefined();
  });

  it("generates a unique jti per proof (single-use)", async () => {
    const kp = await generateDpopKeyPair();
    const a = await createDpopProof({ keyPair: kp, htm: "GET", htu: "https://pod.example/r" });
    const b = await createDpopProof({ keyPair: kp, htm: "GET", htu: "https://pod.example/r" });
    const pub = await importJWK(decodeProtectedHeader(a).jwk as JWK, "ES256");
    const { payload: payA } = await jwtVerify(a, pub, { typ: "dpop+jwt" });
    const { payload: payB } = await jwtVerify(b, pub, { typ: "dpop+jwt" });
    expect(payA.jti).not.toBe(payB.jti);
  });

  it("a proof signed by key A does NOT verify under key B (binding integrity)", async () => {
    const a = await generateDpopKeyPair();
    const b = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair: a, htm: "GET", htu: "https://pod.example/r" });
    const pubB = await importJWK(b.publicJwk, "ES256");
    await expect(jwtVerify(proof, pubB, { typ: "dpop+jwt" })).rejects.toThrow();
  });
});
