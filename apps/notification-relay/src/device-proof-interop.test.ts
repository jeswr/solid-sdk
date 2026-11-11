// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "vitest";
import { verifyDeviceProof } from "./device-proof.js";
import { InMemoryRelayStore } from "./store.js";

/**
 * Native interop fixtures. The signing input is asserted byte-for-byte by PushProofTest.java and
 * PushProofTests.swift (fixed jti "interop-fixture-jti"); the Android proof was produced by the
 * Java signer, the iOS proof is an ES256 (r||s, as CryptoKit emits) signature over the same input.
 */
const signingInput =
  "eyJhbGciOiJFUzI1NiIsInR5cCI6Imluc3RhbGxhdGlvbi1wcm9vZitqd3QifQ.eyJib2R5X3NoYTI1NiI6InZha1VuRGhQTVpzLXJMcHZLMml0Zk95OGxFWU12UG13STJvQlNNWWtUeG8iLCJodG0iOiJQT1NUIiwiaHR1IjoiaHR0cHM6Ly9yZWxheS5leGFtcGxlL3B1c2gvaW5zdGFsbGF0aW9ucy9hYmMvYWN0aXZhdGUiLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6ImludGVyb3AtZml4dHVyZS1qdGkifQ";
const proofs = {
  android: `${signingInput}.tOfd1rbdZQ-xiCp-KRoo5Ce5kd8UjDVBp3yo3cyhRUiBp0HLB7PoHt8iEBsvly0Y1jWnt9G6Lfn4-lSn7rfKxw`,
  ios: `${signingInput}.IpDCq5D5zmt8tOZp19opGd8a6y6v3QtmBXyT_e0MwZ8ugD2CGDT9z_IHrWslWB1rQJ58TswN4kftxiFA5rpVvg`,
};
const key = {
  kty: "EC",
  crv: "P-256",
  x: "Y3ZndvQZCuDhuUmxnpNSV4wYlH8TecfvRKsv6puhK4Q",
  y: "z0czLlQuxIXYW5akwaeHQdHJGcN801yeVecvzVcVrPk",
};
const body = Buffer.from('{"nonce":"n"}');
const iat = 1_700_000_000_000;

function verify(proof: string, now = iat, store = new InMemoryRelayStore(() => now)) {
  return verifyDeviceProof({
    request: new Request("https://relay.example/push/installations/abc/activate", {
      method: "POST",
      headers: { "installation-proof": proof },
    }),
    body,
    key,
    publicOrigin: "https://relay.example",
    now,
    store,
  });
}

for (const [platform, proof] of Object.entries(proofs))
  test(`relay accepts the ${platform} native signer's proof once`, async () => {
    const store = new InMemoryRelayStore(() => iat);
    await expect(verify(proof, iat, store)).resolves.toMatch(/^[\w-]{43}$/u);
    // The fixed jti is replay-protected: the same proof is refused the second time.
    await expect(verify(proof, iat, store)).rejects.toThrow();
    await expect(verify(proof, iat + 61_000)).rejects.toThrow();
  });
