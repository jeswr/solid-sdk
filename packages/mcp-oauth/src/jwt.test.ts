// AUTHORED-BY Codex GPT-6.1-Sol
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture, ISSUER, RESOURCE, SESSION } from "../test/fixtures.js";
import { JwtService } from "./jwt.js";
import type { Grant, SigningKey } from "./types.js";

describe("ES256 validation", () => {
  const f = fixture();
  const jwt = new JwtService(f.key, ISSUER, f.now);
  const grant: Grant = {
    id: "grant",
    session: SESSION,
    resource: RESOURCE,
    clientId: "client",
    scope: "mcp",
    expiresAt: f.now() + 1000,
    revoked: false,
    refreshAllowed: true,
  };
  const claims = {
    iss: ISSUER,
    aud: RESOURCE,
    sub: SESSION.webId,
    client_id: "client",
    sid: "grant",
    jti: "unique",
    scope: "mcp",
    iat: f.now(),
    exp: f.now() + 600,
  };
  const token = (header = {}, payload = {}, key = f.key.privateKey) => {
    const head = Buffer.from(
      JSON.stringify({ alg: "ES256", typ: "at+jwt", kid: f.key.kid, ...header }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify({ ...claims, ...payload })).toString("base64url");
    const input = `${head}.${body}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };

  it("verifies own tokens and valid optional not-before", () => {
    expect(jwt.verify(jwt.issue(grant), RESOURCE)).toMatchObject({
      aud: RESOURCE,
      sub: SESSION.webId,
    });
    expect(jwt.verify(token({}, { nbf: f.now() }), RESOURCE)).toHaveProperty("nbf", f.now());
  });

  it.each([
    { alg: "none" },
    { typ: "JWT" },
    { kid: "other" },
    { crit: ["unsupported"] },
  ])("rejects header %o", (header) => {
    expect(() => jwt.verify(token(header), RESOURCE)).toThrow("invalid_token");
  });

  it.each([
    { iss: "https://other.example/" },
    { aud: "https://pod.example/" },
    { aud: [RESOURCE] },
    { exp: "1800000600" },
    { exp: 1.5 },
    { exp: f.now() },
    { iat: "1800000000" },
    { iat: f.now() + 1 },
    { iat: f.now() - 10, exp: f.now() - 10 },
    { iat: f.now() - 601, exp: f.now() + 1 },
    { nbf: f.now() + 1 },
    { nbf: "tomorrow" },
    { sub: "" },
    { client_id: null },
    { sid: 1 },
    { jti: undefined },
    { scope: [] },
  ])("rejects claims %o", (payload) => {
    expect(() => jwt.verify(token({}, payload), RESOURCE)).toThrow("invalid_token");
  });

  it("rejects malformed encodings, wrong signatures and keys", () => {
    for (const value of [
      "x".repeat(16385),
      "a.b",
      "a.b.c.d",
      "a.!c.d",
      ".a.b",
      "e30.e30.a",
      "bm90LWpzb24.e30.a",
      token().split(".").slice(0, 2).concat("AA").join("."),
    ]) {
      expect(() => jwt.verify(value, RESOURCE)).toThrow("invalid_token");
    }
    const wrong = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(() => jwt.verify(token({}, {}, wrong), RESOURCE)).toThrow("invalid_token");
    const parts = token().split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: "mallory" })).toString("base64url");
    expect(() => jwt.verify(parts.join("."), RESOURCE)).toThrow("invalid_token");
  });

  it("rejects public, non-EC, wrong-curve keys and empty key identifiers", () => {
    const invalid: SigningKey[] = [
      { privateKey: createPublicKey(f.key.privateKey), kid: "x" },
      { privateKey: generateKeyPairSync("ed25519").privateKey, kid: "x" },
      { privateKey: generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey, kid: "x" },
      { privateKey: f.key.privateKey, kid: "" },
    ];
    for (const key of invalid)
      expect(() => new JwtService(key, ISSUER, f.now)).toThrow("ES256 private key");
  });
});
