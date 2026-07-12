// @vitest-environment node
// AUTHORED-BY Claude Opus 4.8
/**
 * harness.ts — a small in-test token/proof harness for the extraction-specific tests
 * (verify-request / next / env). It mints jose access tokens + DPoP proofs against a local
 * (no-network) JWKS, exactly like the ported adversarial suite, so the framework-free
 * `verifyRequest` entry, the `./next` adapter, and the env wiring can be exercised end-to-end
 * without a live server. The verbatim adversarial suite in `api-auth.test.ts` stays
 * self-contained on purpose (it is the spec); this harness serves only the new-surface tests.
 */
import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { DpopApiVerifier, type DpopApiVerifierOptions } from "../src/index.js";

export const ISSUER = "https://issuer.example";
export const OWNER = "https://owner.example/profile/card#me";
export const APP_URL = "https://app.example/api/scan";

interface Keys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwk: JWK;
  jkt: string;
}

async function makeKeys(kid?: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "ES256";
  if (kid) {
    jwk.kid = kid;
  }
  const jkt = await calculateJwkThumbprint(jwk, "sha256");
  return { privateKey, publicKey, jwk, jkt };
}

const nowSec = () => Math.floor(Date.now() / 1000);

export interface Harness {
  makeVerifier(overrides?: Partial<DpopApiVerifierOptions>): DpopApiVerifier;
  mintAccessToken(opts?: { webid?: string; sub?: string }): Promise<string>;
  mintProof(opts: {
    accessToken: string;
    htu?: string;
    htm?: string;
    jti?: string;
  }): Promise<string>;
  mkRequest(opts?: {
    authorization?: string;
    dpop?: string;
    method?: string;
    url?: string;
    origin?: string;
  }): Request;
}

/** Build a fresh harness with its own issuer + proof keypairs. */
export async function createHarness(): Promise<Harness> {
  const issuerKeys = await makeKeys("issuer-key-1");
  const proofKeys = await makeKeys();
  const jwks = createLocalJWKSet({ keys: [{ ...issuerKeys.jwk, kid: "issuer-key-1" }] });

  const makeVerifier = (overrides: Partial<DpopApiVerifierOptions> = {}): DpopApiVerifier =>
    new DpopApiVerifier({
      trustedIssuers: [ISSUER],
      ownerWebId: OWNER,
      webidClaim: "webid",
      bidirectionalMode: "off",
      resolveIssuer: () => ({ jwks }),
      ...overrides,
    });

  const mintAccessToken = async (opts: { webid?: string; sub?: string } = {}): Promise<string> => {
    const iat = nowSec();
    return new SignJWT({
      iss: ISSUER,
      sub: opts.sub ?? "user-subject-1",
      client_id: "https://app.example/client",
      webid: opts.webid ?? OWNER,
      cnf: { jkt: proofKeys.jkt },
    })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "issuer-key-1" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .sign(issuerKeys.privateKey);
  };

  const mintProof = async (opts: {
    accessToken: string;
    htu?: string;
    htm?: string;
    jti?: string;
  }): Promise<string> => {
    return new SignJWT({
      htu: opts.htu ?? APP_URL,
      htm: opts.htm ?? "POST",
      jti: opts.jti ?? `jti-${Math.random().toString(36).slice(2)}`,
      ath: createHash("sha256").update(opts.accessToken).digest("base64url"),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: proofKeys.jwk })
      .setIssuedAt(nowSec())
      .sign(proofKeys.privateKey);
  };

  const mkRequest = (
    opts: {
      authorization?: string;
      dpop?: string;
      method?: string;
      url?: string;
      origin?: string;
    } = {},
  ): Request => {
    const headers = new Headers();
    if (opts.authorization !== undefined) headers.set("authorization", opts.authorization);
    if (opts.dpop !== undefined) headers.set("dpop", opts.dpop);
    if (opts.origin !== undefined) headers.set("origin", opts.origin);
    return new Request(opts.url ?? APP_URL, { method: opts.method ?? "POST", headers });
  };

  return { makeVerifier, mintAccessToken, mintProof, mkRequest };
}
