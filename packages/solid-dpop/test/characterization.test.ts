// AUTHORED-BY Claude Opus 4.8
/**
 * GOLDEN-MASTER / CHARACTERIZATION tests for the security-critical crypto + proof outputs.
 *
 * These pin the EXACT observable bytes a consumer (and a Solid resource server) sees, so that any
 * structural refactor of this library is proven to change SHAPE, not BEHAVIOUR. They deliberately
 * sit alongside the existing RFC-structural suite (dpop.test.ts) and assert concrete golden values
 * rather than shapes:
 *
 *   - a FIXED ES256 DPoP keypair (a committed private JWK) is imported so the embedded `jwk`
 *     header and the `jkt` thumbprint are byte-stable across runs;
 *   - `node:crypto.randomUUID` is mocked so the per-proof `jti` is deterministic (the only
 *     random claim) WITHOUT touching the real `createHash` used for `ath`, or jose's own crypto;
 *   - the ECDSA signature itself is non-deterministic (a random `k` per RFC 6979-free signing), so
 *     it is verified-under-the-key rather than byte-pinned, and the `iat` (sourced inside jose, not
 *     from a mockable `Date.now`) is asserted structurally as a fresh integer second.
 *
 * Everything else — the protected header, every payload claim, the `ath` digest, the PKCE S256
 * challenge, and the `htu` canonicalisation — is asserted against a literal golden value. If a
 * refactor flips any of these, this file goes red. NEVER `--update` a snapshot here to make it pass;
 * a diff is a behaviour change in the suite's most security-critical library and is stop-the-line.
 */

import { describe, expect, it, vi } from "vitest";

// Mock node:crypto so `randomUUID` (the proof's `jti`) is deterministic, while EVERY other export
// (notably `createHash`, used for the `ath` digest and PKCE) remains the real implementation.
let nextUuid = "00000000-0000-4000-8000-000000000000";
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: (() => nextUuid) as () => `${string}-${string}-${string}-${string}-${string}`,
  };
});

import { decodeJwt, decodeProtectedHeader, importJWK, type JWK, jwtVerify } from "jose";
import {
  accessTokenHash,
  canonicalHtu,
  createDpopProof,
  DPOP_ALG,
  type DpopKeyPair,
  importDpopKeyPairJwk,
  pkceChallengeS256,
} from "../src/index.js";

/**
 * A FIXED ES256 (P-256) private JWK used purely so the test's embedded public `jwk` header and the
 * derived `jkt` thumbprint are byte-stable. This is a throwaway test key — NOT a real credential.
 */
const FIXED_PRIVATE_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  d: "jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI",
} as const;

/** The golden public JWK as embedded in the proof header (private `d` stripped, no `alg`). */
const GOLDEN_PUBLIC_JWK = {
  kty: "EC",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  crv: "P-256",
} as const;

/** The golden `jkt` (RFC 7638 thumbprint of GOLDEN_PUBLIC_JWK) the token binds to. */
const GOLDEN_JKT = "oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U";

const FIXED_JTI = "11111111-1111-4111-8111-111111111111";

async function fixedKeyPair(): Promise<DpopKeyPair> {
  return importDpopKeyPairJwk(FIXED_PRIVATE_JWK as JWK);
}

describe("GOLDEN: fixed-key keypair import is byte-stable", () => {
  it("imports the fixed JWK to the golden public JWK + jkt thumbprint", async () => {
    const kp = await fixedKeyPair();
    expect(kp.thumbprint).toBe(GOLDEN_JKT);
    expect(kp.publicJwk).toEqual(GOLDEN_PUBLIC_JWK);
    // The embedded public JWK must NOT carry the private scalar.
    expect((kp.publicJwk as Record<string, unknown>).d).toBeUndefined();
  });
});

describe("GOLDEN: createDpopProof — exact header + claims (jti pinned, iat structural)", () => {
  it("resource proof with an access token: full header + every claim is byte-exact", async () => {
    nextUuid = FIXED_JTI;
    const kp = await fixedKeyPair();
    const before = Math.floor(Date.now() / 1000);
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "get", // lowercased input -> uppercased claim
      htu: "https://pod.example/data/x?q=1#frag", // query + fragment stripped
      accessToken: "header.payload.sig",
      nonce: "n-0S6_WzA2Mj",
    });
    const after = Math.floor(Date.now() / 1000);

    // EXACT protected header.
    const header = decodeProtectedHeader(proof);
    expect(header).toEqual({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: GOLDEN_PUBLIC_JWK,
    });

    // EXACT payload claims (iat asserted as a fresh integer second; jti pinned via the mock).
    const payload = decodeJwt(proof);
    const { iat, ...rest } = payload;
    expect(rest).toEqual({
      htm: "GET",
      htu: "https://pod.example/data/x",
      jti: FIXED_JTI,
      ath: "fNGk-G76ixU7me4BhhMZePSVVyfEbhodaSiBnFBJJ14", // base64url(sha256("header.payload.sig"))
      nonce: "n-0S6_WzA2Mj",
    });
    expect(typeof iat).toBe("number");
    expect(Number.isInteger(iat)).toBe(true);
    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(after);

    // The signature is real ECDSA: it MUST verify under the embedded key.
    const pub = await importJWK(GOLDEN_PUBLIC_JWK as JWK, "ES256");
    await expect(jwtVerify(proof, pub, { typ: "dpop+jwt" })).resolves.toBeTruthy();
  });

  it("token-less proof: no ath, no nonce; claims are exactly htm/htu/jti/iat", async () => {
    nextUuid = FIXED_JTI;
    const kp = await fixedKeyPair();
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "POST",
      htu: "https://idp.example/token",
    });
    const payload = decodeJwt(proof);
    const { iat, ...rest } = payload;
    expect(rest).toEqual({
      htm: "POST",
      htu: "https://idp.example/token",
      jti: FIXED_JTI,
    });
    expect(typeof iat).toBe("number");
  });

  it("claim insertion order is htm, htu, jti, ath, nonce (JWS payload byte order)", async () => {
    nextUuid = FIXED_JTI;
    const kp = await fixedKeyPair();
    const proof = await createDpopProof({
      keyPair: kp,
      htm: "PUT",
      htu: "https://pod.example/r",
      accessToken: "tok",
      nonce: "nn",
    });
    const payloadB64 = proof.split(".")[1] as string;
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    // iat is appended by jose's setIssuedAt() after the params object's own keys.
    expect(keys).toEqual(["htm", "htu", "jti", "ath", "nonce", "iat"]);
  });
});

describe("GOLDEN: accessTokenHash (ath) vectors", () => {
  it("matches base64url(SHA-256(ascii(token))) for known tokens, unpadded url-safe", () => {
    expect(accessTokenHash("header.payload.sig")).toBe(
      "fNGk-G76ixU7me4BhhMZePSVVyfEbhodaSiBnFBJJ14",
    );
    expect(accessTokenHash("at-123")).toBe("pZOyhFN0Z9eQivPyniH1Gg1OzUpcjUffjr7n0FzCLck");
    const empty = accessTokenHash("");
    // SHA-256 of the empty string, base64url.
    expect(empty).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });
});

describe("GOLDEN: canonicalHtu (RFC 9449 §4.2) vectors", () => {
  it("strips query + fragment, preserves trailing slash, normalises host/default-port", () => {
    expect(canonicalHtu("https://pod.example/data/x?q=1#frag")).toBe("https://pod.example/data/x");
    expect(canonicalHtu("https://pod.example/c/")).toBe("https://pod.example/c/");
    // URL parser lowercases the host and drops the explicit default port.
    expect(canonicalHtu("HTTPS://Pod.Example:443/a")).toBe("https://pod.example/a");
  });
});

describe("GOLDEN: pkceChallengeS256 (RFC 7636 Appendix B vector)", () => {
  it("derives the canonical Appendix-B challenge from its verifier", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("GOLDEN: asymmetric-only signing invariant", () => {
  it("DPOP_ALG is the asymmetric ES256 — never a symmetric (HS*) alg", () => {
    expect(DPOP_ALG).toBe("ES256");
    expect(DPOP_ALG).not.toMatch(/^HS/);
  });
});
