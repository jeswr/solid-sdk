// AUTHORED-BY Codex GPT-6
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from "jose";
import { expect, test, vi } from "vitest";
import { epoch } from "../test/fixtures.js";
import {
  issuer,
  mobileClientId,
  profile,
  publicUrl,
  resourceFixture,
  target,
  webid,
} from "../test/resource-fixtures.js";
import {
  createResourceTokenVerifier,
  mobileClientPolicy,
  webhookSenderPolicy,
} from "./resource-auth.js";

test("verifies a Solid token and DPoP proof, parses RDF, and caches all public discovery for ten minutes", async () => {
  const f = await resourceFixture();
  expect(await f.verify(await f.request())).toEqual({
    webid,
    clientId: mobileClientId,
    issuer,
    expiresAt: epoch + 3_600_000,
  });
  await f.verify(await f.request({ ...f.claims, aud: "solid" }));
  f.time(epoch + 599_999);
  await f.verify(await f.request());
  expect(f.outboundFetch).toHaveBeenCalledTimes(3);
  f.time(epoch + 600_000);
  await f.verify(await f.request());
  expect(f.outboundFetch).toHaveBeenCalledTimes(6);
  for (const [, init] of f.outboundFetch.mock.calls) {
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("dpop")).toBe(false);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
  }
});

test("requires a DPoP scheme and one proof, never accepts bearer ID tokens", async () => {
  const f = await resourceFixture();
  const request = await f.request();
  for (const headers of [
    {},
    { authorization: "Bearer id-token", dpop: "proof" },
    { authorization: request.headers.get("authorization") as string },
    { dpop: "proof" },
    { authorization: "DPoP malformed", dpop: "malformed" },
  ])
    await expect(f.verify(new Request(target, { headers }))).rejects.toThrow();
  expect(f.outboundFetch).not.toHaveBeenCalled();
});

test("rejects bad access claims, expirations, signatures and asymmetric algorithm violations", async () => {
  const f = await resourceFixture();
  for (const change of [
    { aud: "other" },
    { aud: ["other"] },
    { aud: undefined },
    { exp: undefined },
    { exp: epoch / 1000 },
    { exp: "bad" },
    { nbf: epoch / 1000 + 1 },
    { webid: undefined },
    { webid: "" },
    { webid: "http://person.example/profile#me" },
    { webid: "https://u:p@person.example/" },
    { cnf: undefined },
    { cnf: {} },
    { cnf: { jkt: "wrong" } },
    { iss: undefined },
    { iss: "http://issuer.example" },
    { iss: `${issuer}?x=1` },
    { iss: `${issuer}#fragment` },
  ])
    await expect(f.verify(await f.request({ ...f.claims, ...change }))).rejects.toThrow();
  const other = await generateKeyPair("ES256");
  const forged = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "ES256" })
    .sign(other.privateKey);
  const symmetric = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(32));
  for (const accessToken of [forged, symmetric, new UnsecuredJWT(f.claims).encode()])
    await expect(
      f.verify(
        new Request(target, {
          headers: { authorization: `DPoP ${accessToken}`, dpop: await f.proof(accessToken) },
        }),
      ),
    ).rejects.toThrow();
});

test("rejects metadata issuer mismatch, invalid JWKS locations, discovery failures and bad keys", async () => {
  for (const response of [
    Response.json({ issuer: "foreign" }),
    Response.json(null),
    Response.json({ issuer, jwks_uri: "http://issuer.example/jwks" }),
    Response.json({ issuer, jwks_uri: `${issuer}/jwks#key` }),
    new Response(null, { status: 500 }),
    new Response("bad json"),
  ]) {
    const f = await resourceFixture();
    f.outboundFetch.mockResolvedValueOnce(response);
    await expect(f.verify(await f.request())).rejects.toThrow();
  }
  for (const keys of [
    null,
    { keys: [] },
    { keys: [await exportJWK((await generateKeyPair("ES256")).publicKey)] },
  ]) {
    const f = await resourceFixture();
    f.outboundFetch
      .mockResolvedValueOnce(Response.json({ issuer, jwks_uri: `${issuer}/jwks` }))
      .mockResolvedValueOnce(Response.json(keys));
    await expect(f.verify(await f.request())).rejects.toThrow();
  }
});

test("rejects every DPoP claim mismatch, missing claims, stale and future iat", async () => {
  const f = await resourceFixture();
  for (const change of [
    { htu: "https://attacker.example/push/installations" },
    { htu: `${target}?x=1` },
    { htu: `${target}#f` },
    { htm: "GET" },
    { htm: "post" },
    { iat: epoch / 1000 - 61 },
    { iat: epoch / 1000 + 61 },
    { iat: "bad" },
    { ath: undefined },
    { ath: "wrong" },
    { jti: "" },
    { jti: 42 },
    ...["htm", "htu", "iat", "jti"].map((key) => ({ [key]: undefined })),
  ])
    await expect(f.verify(await f.request(f.claims, change))).rejects.toThrow();
  for (const iat of [epoch / 1000 - 60, epoch / 1000 + 60])
    await f.verify(await f.request(f.claims, { iat }));
});

test("ignores request query/fragment and forwarded headers, derives htu only from configured origin", async () => {
  const f = await resourceFixture();
  const request = await f.request(f.claims, {}, `${target}?x=1#fragment`);
  request.headers.set("forwarded", "proto=http;host=evil.example");
  request.headers.set("x-forwarded-host", "evil.example");
  await f.verify(request);
  const internalRequest = await f.request(f.claims, {}, "http://internal:3000/push/installations");
  await f.verify(internalRequest);
});

test("requires typ and an embedded asymmetric public JWK, verifies the proof signature", async () => {
  const f = await resourceFixture();
  const token = await f.token();
  for (const header of [
    { alg: "ES256", jwk: f.deviceJwk },
    { alg: "ES256", typ: "JWT", jwk: f.deviceJwk },
    { alg: "ES256", typ: "dpop+jwt" },
    { alg: "ES256", typ: "dpop+jwt", jwk: { ...f.deviceJwk, d: "private" } },
    { alg: "ES256", typ: "dpop+jwt", jwk: f.jwk },
  ]) {
    const proof = await f.proof(token, {}, header);
    await expect(
      f.verify(new Request(target, { headers: { authorization: `DPoP ${token}`, dpop: proof } })),
    ).rejects.toThrow();
  }
  for (const dpop of [
    "malformed",
    new UnsecuredJWT({}).encode(),
    await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "dpop+jwt", jwk: { kty: "oct", k: "secret" } })
      .sign(new Uint8Array(32)),
  ])
    await expect(
      f.verify(new Request(target, { headers: { authorization: `DPoP ${token}`, dpop } })),
    ).rejects.toThrow();
});

test("trusts only issuer NamedNodes on the claimed WebID, never comments, strings or other subjects", async () => {
  for (const turtle of [
    "",
    `# ${profile}`,
    `<https://someone.example/#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`,
    `<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> "${issuer}" .`,
    `<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://other.example/> .`,
    `<${webid}> <https://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`,
  ]) {
    const f = await resourceFixture();
    f.outboundFetch
      .mockImplementationOnce(async () => Response.json({ issuer, jwks_uri: `${issuer}/jwks` }))
      .mockImplementationOnce(async () => Response.json({ keys: [f.jwk] }))
      .mockImplementationOnce(
        async () => new Response(turtle, { headers: { "content-type": "text/turtle" } }),
      );
    await expect(f.verify(await f.request())).rejects.toThrow("endorsed");
  }
});

test("fails closed on unreadable profiles, malformed RDF and remote JSON-LD contexts", async () => {
  for (const response of [
    new Response(null, { status: 403 }),
    new Response("<bad turtle", { headers: { "content-type": "text/turtle" } }),
    Response.json(
      { "@context": "https://attacker.example/context", "@id": webid },
      { headers: { "content-type": "application/ld+json" } },
    ),
  ]) {
    const f = await resourceFixture();
    f.outboundFetch
      .mockResolvedValueOnce(Response.json({ issuer, jwks_uri: `${issuer}/jwks` }))
      .mockResolvedValueOnce(Response.json({ keys: [f.jwk] }))
      .mockResolvedValueOnce(response);
    await expect(f.verify(await f.request())).rejects.toThrow();
    expect(f.outboundFetch).toHaveBeenCalledTimes(3);
  }
});

test("accepts expanded JSON-LD without remote contexts and exact route policies", async () => {
  const f = await resourceFixture();
  f.outboundFetch
    .mockResolvedValueOnce(Response.json({ issuer, jwks_uri: `${issuer}/jwks` }))
    .mockResolvedValueOnce(Response.json({ keys: [f.jwk] }))
    .mockResolvedValueOnce(
      Response.json(
        { "@id": webid, "http://www.w3.org/ns/solid/terms#oidcIssuer": { "@id": issuer } },
        { headers: { "content-type": "application/ld+json" } },
      ),
    );
  const identity = await f.verify(await f.request());
  expect(mobileClientPolicy(mobileClientId)(identity)).toBe(true);
  expect(
    mobileClientPolicy(mobileClientId)({ ...identity, clientId: `${mobileClientId}/foreign` }),
  ).toBe(false);
  expect(webhookSenderPolicy(webid)({ ...identity, clientId: undefined })).toBe(true);
  expect(webhookSenderPolicy("https://other.example/#me")(identity)).toBe(false);
});

test("fails closed when the shared replay store is unavailable and uses system time by default", async () => {
  const f = await resourceFixture({
    insertIfAbsent: async () => {
      throw new Error("store unavailable");
    },
  });
  await expect(f.verify(await f.request())).rejects.toThrow("store unavailable");
  expect(f.outboundFetch).toHaveBeenCalledTimes(2);
  const store = { insertIfAbsent: vi.fn(async () => true) };
  const g = await resourceFixture(store);
  vi.spyOn(Date, "now").mockReturnValue(epoch);
  try {
    await createResourceTokenVerifier({ ...g.options, now: undefined })(await g.request());
    expect(store.insertIfAbsent).toHaveBeenCalledWith(
      expect.stringMatching(/^dpop:[a-f0-9]{64}$/u),
      300_000,
    );
  } finally {
    vi.restoreAllMocks();
  }
  expect(() =>
    createResourceTokenVerifier({ ...g.options, publicUrl: `${publicUrl}/prefix` }),
  ).toThrow("origin");
  expect(() =>
    createResourceTokenVerifier({ ...g.options, publicUrl: `${publicUrl}?x=1` }),
  ).toThrow("origin");
  expect(() => createResourceTokenVerifier({ ...g.options, publicUrl: `${publicUrl}#f` })).toThrow(
    "origin",
  );
});
