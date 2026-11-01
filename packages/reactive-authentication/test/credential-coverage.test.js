// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { decodeJwt, jwtVerify } from "jose";
import { afterEach, test, vi } from "vitest";
import {
  DidKeySource,
  didKeyFromPublicKey,
  SamlAssertionSource,
  SelfIssuedJwtSource,
} from "../src/mod.js";

afterEach(() => vi.restoreAllMocks());
const request = () => ({
  authorizationServer: new URL("https://as.example/"),
  resource: new URL("https://pod.example/"),
  signal: new AbortController().signal,
});

test("SAML credentials reject empty and oversized assertions and allow an unknown expiry", async () => {
  for (const xml of ["", "<Assertion>too large</Assertion>"]) {
    const source = new SamlAssertionSource({
      id: "test",
      maxBytes: 1,
      obtainAssertion: async () => ({ xml, clientId: "client" }),
    });
    await assert.rejects(source.getCredential(request()), /empty or too large/);
  }
  const source = new SamlAssertionSource({
    id: "test",
    obtainAssertion: async () => ({ xml: "<Assertion />", clientId: "client" }),
  });
  const credential = await source.getCredential(request());
  assert.equal(Buffer.from(credential.token, "base64url").toString(), "<Assertion />");
  assert.equal("expiresAt" in credential, false);
  const expiring = new SamlAssertionSource({
    id: "expiring",
    obtainAssertion: async () => ({ xml: "<Assertion />", clientId: "client", expiresAt: 12345 }),
  });
  assert.equal((await expiring.getCredential(request())).expiresAt, 12345);
  assert.throws(() => new SelfIssuedJwtSource({ algorithm: "none" }), /must be signed/);
});

test("did:key refuses unsupported algorithms and malformed platform key exports", async () => {
  const unsupported = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  await assert.rejects(didKeyFromPublicKey(unsupported.publicKey), /not ECDH/);
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const exportKey = vi.spyOn(crypto.subtle, "exportKey");
  exportKey.mockResolvedValueOnce(new Uint8Array(4).buffer);
  await assert.rejects(didKeyFromPublicKey(key.publicKey), /uncompressed/);
  exportKey.mockResolvedValueOnce(new Uint8Array(65).buffer);
  await assert.rejects(didKeyFromPublicKey(key.publicKey), /uncompressed/);
  exportKey.mockRestore();
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  await assert.rejects(
    DidKeySource.fromKeyPair({ publicKey: key.publicKey, privateKey: other.privateKey }),
    /does not correspond/,
  );
});

test("both P-256 point parities produce did:key identifiers and explicit lifetimes sign real credentials", async () => {
  const x = "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
  const y = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
  const prime = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  const identifiers = [];
  for (const coordinate of [y, prime - y]) {
    const bytes = Buffer.from(`04${x}${coordinate.toString(16).padStart(64, "0")}`, "hex");
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    identifiers.push(await didKeyFromPublicKey(key));
  }
  assert.notEqual(identifiers[0], identifiers[1]);
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const source = await DidKeySource.fromKeyPair(keys, 60);
  const credential = await source.getCredential(request());
  const { payload } = await jwtVerify(credential.token, keys.publicKey, {
    audience: "https://as.example/",
    issuer: source.did,
  });
  assert.equal(payload.exp - payload.iat, 60);
  assert.equal(decodeJwt(credential.token).sub, source.did);
});
