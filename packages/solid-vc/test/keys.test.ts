// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Key generation + JWK export/import. An exported-then-reimported public key must
// still verify a signature made by the original private key (the persistence path).

import { describe, expect, it } from "vitest";
import { issueAgentAuthorization } from "../src/issue.js";
import {
  cryptosuiteForKeyType,
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
} from "../src/keys.js";
import { verifyCredential } from "../src/verify.js";
import { ACL_READ, AGENT, ISSUER, VERIFICATION_METHOD } from "./helpers.js";

const AUTH = { principal: ISSUER, agent: AGENT, action: ACL_READ } as const;

describe("key type → cryptosuite mapping", () => {
  it("maps Ed25519 → eddsa-rdfc-2022 and P-256 → ecdsa-rdfc-2019", () => {
    expect(cryptosuiteForKeyType("Ed25519")).toBe("eddsa-rdfc-2022");
    expect(cryptosuiteForKeyType("P-256")).toBe("ecdsa-rdfc-2019");
  });
});

describe("generateKeyPairForSuite", () => {
  it("produces an Ed25519 OKP public JWK", async () => {
    const key = await generateKeyPairForSuite(VERIFICATION_METHOD, "Ed25519");
    const jwk = await exportPublicJwk(key);
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect((jwk as { d?: string }).d).toBeUndefined(); // public only
  });

  it("produces a P-256 EC public JWK", async () => {
    const key = await generateKeyPairForSuite(VERIFICATION_METHOD, "P-256");
    const jwk = await exportPublicJwk(key);
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
  });
});

describe("JWK round-trip", () => {
  it("a re-imported public JWK still verifies the original signature (Ed25519)", async () => {
    const key = await generateKeyPairForSuite(VERIFICATION_METHOD, "Ed25519");
    const vc = await issueAgentAuthorization(AUTH, key);
    const pubJwk = await exportPublicJwk(key);
    const reimported = await importPublicKey(pubJwk);
    const result = await verifyCredential(vc, {
      resolveKey: (vm) => (vm === VERIFICATION_METHOD ? reimported : undefined),
    });
    expect(result.verified).toBe(true);
  });

  it("a re-imported KEYPAIR (private JWK) can sign a verifiable credential (P-256)", async () => {
    const key = await generateKeyPairForSuite(VERIFICATION_METHOD, "P-256");
    const privJwk = await exportPrivateJwk(key);
    const reimported = await importKeyPair(VERIFICATION_METHOD, privJwk);
    const vc = await issueAgentAuthorization(AUTH, reimported, {
      suite: new (await import("../src/proof.js")).DataIntegritySuite("ecdsa-rdfc-2019"),
    });
    const pub = await importPublicKey(await exportPublicJwk(key));
    const result = await verifyCredential(vc, {
      resolveKey: (vm) => (vm === VERIFICATION_METHOD ? pub : undefined),
    });
    expect(result.verified).toBe(true);
  });

  it("rejects an unsupported JWK on import", async () => {
    await expect(importPublicKey({ kty: "RSA" } as never)).rejects.toThrow(/unsupported JWK/);
  });
});
