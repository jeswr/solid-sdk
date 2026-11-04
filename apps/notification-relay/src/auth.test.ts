// AUTHORED-BY Codex GPT-6.1-Sol
import { SignJWT } from "jose";
import { expect, test, vi } from "vitest";
import { epoch, vector } from "../test/fixtures.js";
import { createIdTokenVerifier } from "./auth.js";

async function fixture() {
  const { jwk, keys } = await vector();
  const fetch = vi.fn(async () => Response.json({ keys: [jwk] }));
  const options = { issuer: "https://issuer.example", jwksUri: "https://issuer.example/jwks" };
  const verify = createIdTokenVerifier({
    audience: "https://app.example/clientid",
    issuers: [options],
    fetch,
    now: () => epoch,
  });
  const claims = {
    sub: "alice",
    iss: options.issuer,
    aud: "https://app.example/clientid",
    exp: epoch / 1000 + 600,
    iat: epoch / 1000,
  };
  const token = (payload: Record<string, unknown> = claims, typ: string | undefined = "JWT") =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "EdDSA", ...(typ ? { typ } : {}) })
      .sign(keys.privateKey);
  return { verify, fetch, claims, token, options };
}

test("verifies issuer, audience, signature, expiry and subject of an ID token", async () => {
  const f = await fixture();
  expect(await f.verify(await f.token())).toEqual({ subject: "alice", expiresAt: epoch + 600_000 });
  await f.verify(await f.token(f.claims, "jwt"));
  await f.verify(await f.token(f.claims, ""));
  await f.verify(await f.token({ ...f.claims, aud: [f.claims.aud, "other"], azp: f.claims.aud }));
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test("refuses untrusted/missing issuer before network access", async () => {
  const f = await fixture();
  for (const iss of [undefined, "https://attacker.example"]) {
    await expect(f.verify(await f.token({ ...f.claims, iss }))).rejects.toThrow("Untrusted issuer");
  }
  await expect(f.verify("malformed")).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
});

test("rejects invalid claims, other audiences, access tokens, future tokens and forged tokens", async () => {
  const f = await fixture();
  for (const [claim, value] of [
    ["sub", undefined],
    ["sub", ""],
    ["exp", epoch / 1000],
    ["iat", epoch / 1000 + 1],
    ["iat", "bad"],
    ["aud", "other"],
    ["nbf", epoch / 1000 + 60],
    ["exp", undefined],
  ]) {
    await expect(
      f.verify(await f.token({ ...f.claims, [claim as string]: value })),
    ).rejects.toThrow();
  }
  for (const azp of [undefined, "other", 42]) {
    await expect(
      f.verify(await f.token({ ...f.claims, aud: [f.claims.aud, "other"], azp })),
    ).rejects.toThrow();
  }
  await expect(f.verify(await f.token(f.claims, "at+jwt"))).rejects.toThrow();
  const other = await vector();
  await expect(
    f.verify(
      await new SignJWT(f.claims).setProtectedHeader({ alg: "EdDSA" }).sign(other.keys.privateKey),
    ),
  ).rejects.toThrow();
  const symmetric = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(32));
  await expect(f.verify(symmetric)).rejects.toThrow();
});

test("requires explicit trust and supports the system clock", async () => {
  const f = await fixture();
  for (const audience of ["", [], [""]])
    expect(() => createIdTokenVerifier({ audience, issuers: [f.options], fetch: f.fetch })).toThrow(
      "Configure",
    );
  expect(() => createIdTokenVerifier({ audience: "a", issuers: [], fetch: f.fetch })).toThrow();
  for (const jwksUri of ["https://issuer.example/jwks?x=1", "https://issuer.example/jwks#k"])
    expect(() =>
      createIdTokenVerifier({
        audience: "a",
        issuers: [{ ...f.options, jwksUri }],
        fetch: f.fetch,
      }),
    ).toThrow("Invalid JWKS");
  const now = Date.now() / 1000;
  const verify = createIdTokenVerifier({
    audience: f.claims.aud,
    issuers: [f.options],
    fetch: f.fetch,
  });
  await verify(await f.token({ ...f.claims, iat: now - 1, exp: now + 60 }));
});
