// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { decodeJwt, jwtVerify } from "jose";
import { afterAll, afterEach, beforeAll, test, vi } from "vitest";
import { contextKey } from "../src/locks.js";
import {
  accessTokenUsable,
  ClientCredentialsTokenProvider,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  idTokenUsable,
  LwsTokenProvider,
  OidcIdTokenSource,
  OidcSession,
  SelfIssuedJwtSource,
  SessionFence,
  XASProvider,
} from "../src/mod.js";
import { withMockedDate } from "./helpers/clock.js";
import { insecure, transport } from "./helpers/http.js";
import { automaticCodeProvider, startOpenIdProvider, startSolidStorage } from "./helpers/openid.js";
import { callback, solidClient } from "./helpers/solid.js";

let op, rs;
beforeAll(async () => {
  op = await startOpenIdProvider();
  rs = await startSolidStorage(op);
});
afterAll(async () => {
  await rs.close();
  await op.close();
});
afterEach(() => vi.unstubAllGlobals());

test("client credentials without an advertised expiry remain cached and can be invalidated", async () => {
  let issued = 0;
  const provider = new ClientCredentialsTokenProvider(
    {
      getAuthorizationServer: async () => ({
        issuer: "https://issuer.example/",
        token_endpoint: "https://issuer.example/token",
      }),
    },
    "client",
    "secret",
    {
      http: {
        fetch: async () => Response.json({ access_token: `cc-${++issued}`, token_type: "DPoP" }),
      },
    },
  );
  const request = new Request("https://pod.example/a");
  const first = await provider.upgrade(request);
  assert.equal(
    (await provider.upgrade(request)).headers.get("authorization"),
    first.headers.get("authorization"),
  );
  await provider.invalidate(first);
  assert.equal((await provider.upgrade(request)).headers.get("authorization"), "DPoP cc-2");
  await provider.forget();
});

test("DPoP providers ignore foreign resource nonces and bound remembered rejections", async () => {
  const provider = new DPoPTokenProvider(
    callback,
    automaticCodeProvider(),
    new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
    new DynamicRegistrationClientProvider(insecure),
    undefined,
    { context: (request) => request.url, http: insecure, offlineAccess: false },
  );
  const upgraded = [];
  for (let i = 0; i < 101; i++)
    upgraded.push(await provider.upgrade(new Request(`${rs.url}/alice/eviction-${i}`)));
  assert.equal(new Set(upgraded.map((request) => request.headers.get("authorization"))).size, 101);
  const before = op.stats.token.length;
  await provider.invalidate(upgraded[0]);
  await provider.upgrade(new Request(`${rs.url}/alice/eviction-0`));
  assert.equal(op.stats.token.length, before);
  const response = Object.defineProperty(
    new Response(null, { status: 401, headers: { "dpop-nonce": "foreign" } }),
    "url",
    { value: "https://foreign.example/" },
  );
  const proof = await provider.upgrade(new Request(`${rs.url}/alice/eviction-100`), {
    response,
    challenges: [],
  });
  assert.equal(decodeJwt(proof.headers.get("dpop")).nonce, undefined);
  await provider.forget();
});

test("LWS exchanges verify signed subjects, cache tokens without expiry, and bound invalidation history", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const source = new SelfIssuedJwtSource({
    subject: "https://agent.example/id",
    keyId: "https://agent.example/id#key",
    privateKey: keys.privateKey,
    algorithm: "EdDSA",
  });
  let issued = 0;
  vi.stubGlobal("fetch", async (url, init) => {
    if (String(url).includes(".well-known"))
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: "https://pod.example/token",
      });
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
    const { payload } = await jwtVerify(body.get("subject_token"), keys.publicKey, {
      issuer: "https://agent.example/id",
      audience: "https://pod.example/",
    });
    assert.equal(payload.sub, "https://agent.example/id");
    return Response.json({ access_token: `lws-${++issued}`, token_type: "Bearer" });
  });
  const provider = new LwsTokenProvider(source);
  const challenges = (i) => ({
    response: new Response(null, { status: 401 }),
    challenges: [
      {
        scheme: "bearer",
        params: { as_uri: "https://pod.example/", realm: `https://pod.example/r${i}/` },
      },
    ],
  });
  const request = (i) => new Request(`https://pod.example/r${i}/a`);
  const upgraded = [];
  for (let i = 0; i < 101; i++) upgraded.push(await provider.upgrade(request(i), challenges(i)));
  assert.equal(issued, 101);
  await provider.invalidate(upgraded[0]);
  await provider.upgrade(request(0), challenges(0));
  assert.equal(issued, 101);
  await provider.invalidate(upgraded[100]);
  await provider.upgrade(request(100), challenges(100));
  assert.equal(issued, 102);
  await provider.forget();
});

test("sessions with unknown access expiry still expose identity and clear after failed revocation", async () => {
  const http = {
    ...insecure,
    fetch: async (url, init) => {
      const response = await transport(url, init);
      if (new URL(url).pathname === "/token") {
        const body = await response.json();
        delete body.expires_in;
        return Response.json(body, { status: response.status });
      }
      if (new URL(url).pathname === "/revoke")
        return Response.json({ error: "server_error" }, { status: 500 });
      return response;
    },
  };
  const client = solidClient(op, rs, { http, provider: { context: () => "fixed" } });
  const request = new Request(`${rs.url}/alice/session`);
  assert.ok((await client.provider.upgrade(request)).headers.has("dpop"));
  assert.ok(await client.provider.identity(request));
  await assert.rejects(client.provider.forget(), (error) => error instanceof AggregateError);
  assert.equal(await client.provider.identity(request), undefined);
});

test("session inspection handles unstamped legacy records, missing records, and ID tokens without expiry", async () => {
  const cache = createMemoryStore();
  const sessionStore = createMemoryStore();
  const fence = new SessionFence("inspection", { broadcast: false });
  const session = new OidcSession(
    callback,
    {},
    {},
    { namespace: "inspection", cache, sessionStore, fence, revokeOnForget: false },
  );
  const key = await contextKey("oidc", [
    "inspection",
    "default",
    op.issuer,
    callback,
    "openid webid",
    "fixed",
  ]);
  const identity = { issuer: op.issuer, subject: "alice", webIdVerified: false };
  await sessionStore.setItem(key, { generation: 0, identity });
  assert.deepEqual(await session.identity(op.issuer, "fixed"), identity);
  await session.invalidate(op.issuer, "fixed", "unknown");
  await cache.setItem(key, { tokenResult: { access_token: "other" }, generation: 0, identity });
  await session.invalidate(op.issuer, "fixed", "unknown");
  await assert.rejects(session.assertCurrent({}, new AbortController().signal), {
    name: "SessionSupersededError",
  });
  assert.equal(idTokenUsable({ tokenResult: { id_token: "id" } }), false);
  await session.forget();
  assert.equal(await session.identity(op.issuer, "fixed"), undefined);
  fence.close();
  assert.equal(accessTokenUsable({ tokenResult: {} }), true);
});

test("ID-token sources reauthorize when refresh returns no ID token, and reject a missing azp", async () => {
  const uriOp = await startOpenIdProvider({ subject: "https://alice.example/#me" });
  const withoutAzp = await startOpenIdProvider({
    subject: "https://alice.example/#me",
    omitAzp: true,
  });
  try {
    await withMockedDate(async (advance) => {
      const code = automaticCodeProvider();
      const metadata = await (
        await transport(`${uriOp.issuer}.well-known/openid-configuration`)
      ).json();
      const source = new OidcIdTokenSource(
        metadata,
        callback,
        code,
        new DynamicRegistrationClientProvider(insecure),
        { http: insecure },
      );
      const request = {
        authorizationServer: new URL("https://as.example/"),
        resource: new URL("https://pod.example/"),
        signal: new AbortController().signal,
      };
      await source.getCredential(request);
      assert.equal((await source.identity()).subject, "https://alice.example/#me");
      advance(400_000);
      await source.getCredential(request);
      assert.equal(code.calls, 2);
      assert.equal(uriOp.stats.refresh, 1);
      await source.forget();
      const absent = await (
        await transport(`${withoutAzp.issuer}.well-known/openid-configuration`)
      ).json();
      const invalid = new OidcIdTokenSource(
        absent,
        callback,
        automaticCodeProvider(),
        new DynamicRegistrationClientProvider(insecure),
        { http: insecure },
      );
      await assert.rejects(invalid.getCredential(request), /lacks the azp/);
      await invalid.forget();
    });
  } finally {
    await uriOp.close();
    await withoutAzp.close();
  }
});

test("unstamped refresh records use generation zero and missing cache records do not block logout", async () => {
  const cache = createMemoryStore();
  const fence = new SessionFence("legacy", { broadcast: false });
  const session = new OidcSession(
    callback,
    automaticCodeProvider(),
    new DynamicRegistrationClientProvider(insecure),
    { namespace: "legacy", cache, fence, http: insecure },
  );
  const metadata = await (await transport(`${op.issuer}.well-known/openid-configuration`)).json();
  const signal = new AbortController().signal;
  await session.get(metadata, "fixed", signal, accessTokenUsable);
  const key = await contextKey("oidc", [
    "legacy",
    "default",
    op.issuer,
    callback,
    "openid webid",
    "fixed",
  ]);
  const legacy = await cache.getItem(key);
  delete legacy.generation;
  await cache.setItem(key, legacy);
  const before = op.stats.refresh;
  await session.get(metadata, "fixed", signal, accessTokenUsable);
  assert.equal(op.stats.refresh, before + 1);
  await cache.clear();
  await session.forget();
  fence.close();
});
