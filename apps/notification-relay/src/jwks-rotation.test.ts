// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { createHash, randomUUID } from "node:crypto";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { expect, test, vi } from "vitest";
import { epoch } from "../test/fixtures.js";
import { resourceFixture } from "../test/resource-fixtures.js";
import { createResourceTokenVerifier } from "./resource-auth.js";
import { InMemoryRelayStore } from "./store.js";

const issuer = "https://issuer.example/tenant";
const webid = "https://person.example/profile#me";
const publicUrl = "https://relay.example";
const target = `${publicUrl}/push/installations`;

async function issuerKey(kid: string) {
  const pair = await generateKeyPair("ES256", { extractable: true });
  return { pair, jwk: { ...(await exportJWK(pair.publicKey)), kid } as JWK };
}

test("refetches the JWKS once a minute at most when a token names an unknown key", async () => {
  let clock = epoch;
  const oldKey = await issuerKey("old");
  const newKey = await issuerKey("new");
  let published = [oldKey.jwk];
  const device = await generateKeyPair("ES256", { extractable: true });
  const deviceJwk = await exportJWK(device.publicKey);
  const outboundFetch = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
    if (url === `${issuer}/jwks`) return Response.json({ keys: published });
    return new Response(
      `@prefix solid: <http://www.w3.org/ns/solid/terms#> . <${webid}> solid:oidcIssuer <${issuer}> .`,
      { headers: { "content-type": "text/turtle" } },
    );
  });
  const verify = createResourceTokenVerifier({
    publicUrl,
    outboundFetch,
    store: new InMemoryRelayStore(() => clock),
    now: () => clock,
  });
  const jkt = await calculateJwkThumbprint(deviceJwk);
  async function request(key: Awaited<ReturnType<typeof issuerKey>>) {
    const token = await new SignJWT({
      iss: issuer,
      aud: "solid",
      exp: clock / 1000 + 600,
      webid,
      cnf: { jkt },
    })
      .setProtectedHeader({ alg: "ES256", kid: key.jwk.kid as string })
      .sign(key.pair.privateKey);
    const proof = await new SignJWT({
      jti: randomUUID(),
      htm: "POST",
      htu: target,
      iat: clock / 1000,
      ath: createHash("sha256").update(token).digest("base64url"),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: deviceJwk })
      .sign(device.privateKey);
    return new Request(target, {
      method: "POST",
      headers: { authorization: `DPoP ${token}`, dpop: proof },
    });
  }
  const jwksFetches = () =>
    outboundFetch.mock.calls.filter(([input]) => String(input) === `${issuer}/jwks`).length;

  await expect(verify(await request(oldKey))).resolves.toMatchObject({ webid });
  expect(jwksFetches()).toBe(1);

  // A kid missing from a JWKS fetched under a minute ago fails without a refetch.
  published = [newKey.jwk];
  await expect(verify(await request(newKey))).rejects.toMatchObject({
    code: "ERR_JWKS_NO_MATCHING_KEY",
  });
  expect(jwksFetches()).toBe(1);

  // The issuer rotated: a minute on, the cached JWKS lacks the new kid, so the relay refetches.
  clock += 60_000;
  await expect(verify(await request(newKey))).resolves.toMatchObject({ webid });
  expect(jwksFetches()).toBe(2);

  // An unknown kid within a minute of the last refresh fails without another fetch.
  const unknown = await issuerKey("unknown");
  clock += 30_000;
  await expect(verify(await request(unknown))).rejects.toMatchObject({
    code: "ERR_JWKS_NO_MATCHING_KEY",
  });
  expect(jwksFetches()).toBe(2);

  // After the minute, one more refresh is allowed; it still fails for a key the issuer never published.
  clock += 30_000;
  await expect(verify(await request(unknown))).rejects.toMatchObject({
    code: "ERR_JWKS_NO_MATCHING_KEY",
  });
  expect(jwksFetches()).toBe(3);

  // Other verification errors never trigger a refresh.
  clock += 120_000;
  const forged = await request(newKey);
  forged.headers.set("authorization", `${forged.headers.get("authorization")}x`);
  await expect(verify(forged)).rejects.toThrow();
  expect(jwksFetches()).toBe(3);
});

async function concurrentRefreshFixture() {
  const f = await resourceFixture();
  const rotated = await issuerKey("rotated");
  const token = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "ES256", kid: rotated.jwk.kid as string })
    .sign(rotated.pair.privateKey);
  await f.verify(await f.request());
  f.time(epoch + 60_000);
  f.outboundFetch.mockClear();
  const rotatedRequest = async () =>
    new Request(target, {
      method: "POST",
      headers: { authorization: `DPoP ${token}`, dpop: await f.proof(token) },
    });
  return { ...f, rotated, rotatedRequest };
}

test.each([
  false,
  true,
])("shares one JWKS refresh across 20 concurrent unknown-kid verifications (published=%s)", async (published) => {
  const f = await concurrentRefreshFixture();
  f.outboundFetch.mockImplementation(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return Response.json({ keys: [published ? f.rotated.jwk : f.jwk] });
  });
  const requests = await Promise.all(Array.from({ length: 20 }, () => f.rotatedRequest()));
  const results = await Promise.allSettled(requests.map(f.verify));
  for (const result of results)
    expect(result).toMatchObject(
      published
        ? { status: "fulfilled", value: { webid } }
        : { status: "rejected", reason: { code: "ERR_JWKS_NO_MATCHING_KEY" } },
    );
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  expect(f.outboundFetch).toHaveBeenCalledWith(`${issuer}/jwks`, expect.anything());
});

test("shares a failed JWKS refresh and retries after the throttle window", async () => {
  const f = await concurrentRefreshFixture();
  f.outboundFetch.mockImplementation(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return new Response(null, { status: 503 });
  });
  const requests = await Promise.all(Array.from({ length: 20 }, () => f.rotatedRequest()));
  const results = await Promise.allSettled(requests.map(f.verify));
  for (const result of results)
    expect(result).toMatchObject({
      status: "rejected",
      reason: { message: "Discovery unavailable" },
    });
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  // A failed refresh retains the last working JWKS.
  await expect(f.verify(await f.request())).resolves.toMatchObject({ webid });
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  // A failed refresh still starts the throttle window: no refetch per later request.
  for (let i = 0; i < 3; i++)
    await expect(f.verify(await f.rotatedRequest())).rejects.toMatchObject({
      code: "ERR_JWKS_NO_MATCHING_KEY",
    });
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  f.time(epoch + 120_000);
  f.outboundFetch.mockImplementation(async () => Response.json({ keys: [f.rotated.jwk] }));
  await expect(f.verify(await f.rotatedRequest())).resolves.toMatchObject({ webid });
  expect(f.outboundFetch).toHaveBeenCalledTimes(2);
});
