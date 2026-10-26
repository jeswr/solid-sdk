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
import { callback, deferred, solidClient } from "./helpers/solid.js";

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

for (const method of ["upgrade", "restore"]) {
  for (const stage of ["issuer", "context"]) {
    test(`DPoP ${method} remains fenced across logout during ${stage} resolution`, async () => {
      const gate = deferred();
      const started = deferred();
      let paused = false;
      let discoveryRequest;
      const wait = async (request, at) => {
        if (paused && stage === at) {
          discoveryRequest = request;
          started.resolve();
          await gate.promise; // Deliberately ignores abort, like a late discovery result.
        }
      };
      const as = new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure);
      const code = automaticCodeProvider();
      const provider = new DPoPTokenProvider(
        callback,
        code,
        {
          getAuthorizationServer: async (request, challenge) => {
            await wait(request, "issuer");
            return await as.getAuthorizationServer(request, challenge);
          },
        },
        new DynamicRegistrationClientProvider(insecure),
        undefined,
        {
          http: insecure,
          context: async (request) => {
            await wait(request, "context");
            return "fixed";
          },
        },
      );
      const request = new Request(`${rs.url}/alice/fence`);
      await provider.upgrade(request);
      const tokens = op.stats.token.length;
      const flows = code.calls;
      paused = true;
      const pending = provider[method](request);
      const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
      await started.promise;
      await provider.forget();
      assert.equal(discoveryRequest.signal.aborted, true);
      gate.resolve();
      await rejected;
      paused = false;
      assert.equal(await provider.identity(request), undefined);
      assert.equal(op.stats.token.length, tokens, "late discovery cannot acquire a new token");
      assert.equal(code.calls, flows, "late discovery cannot open a new flow");
      assert.equal(await provider.restore(request), undefined);
      assert.ok((await provider.upgrade(request)).headers.has("dpop"));
      await provider.forget();
    });
  }

  test(`DPoP ${method} preserves its generation when a peer logs out without a broadcast`, async () => {
    const store = createMemoryStore();
    const namespace = `discovery-${crypto.randomUUID()}`;
    const fence = new SessionFence(namespace, { store, broadcast: false });
    const peer = new SessionFence(namespace, { store, broadcast: false });
    const gate = deferred();
    const started = deferred();
    const code = automaticCodeProvider();
    const provider = new DPoPTokenProvider(
      callback,
      code,
      new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
      new DynamicRegistrationClientProvider(insecure),
      undefined,
      {
        http: insecure,
        fence,
        context: async () => {
          started.resolve();
          await gate.promise;
          return "fixed";
        },
      },
    );
    const request = new Request(`${rs.url}/alice/peer-fence`);
    const pending = provider[method](request);
    const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
    await started.promise;
    await peer.supersede();
    assert.equal(fence.signal.aborted, false, "no local abort can mask a lost generation");
    gate.resolve();
    await rejected;
    assert.equal(code.calls, 0);
    assert.equal(await provider.identity(request), undefined);
    fence.close();
    peer.close();
  });
}

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

test("DPoP providers retain outstanding invalidation contexts and ignore foreign nonces", async () => {
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
  const first = new Request(`${rs.url}/alice/eviction-0`);
  await provider.invalidate(upgraded[0]);
  const renewed = await provider.upgrade(first.clone());
  assert.notEqual(renewed.headers.get("authorization"), upgraded[0].headers.get("authorization"));
  assert.equal(op.stats.token.length, before + 1);
  await provider.invalidate(upgraded[0]);
  assert.equal(
    (await provider.upgrade(first.clone())).headers.get("authorization"),
    renewed.headers.get("authorization"),
    "a late rejection leaves the replacement cached",
  );
  await provider.invalidate(new Request(first));
  await provider.invalidate(new Request(first, { headers: { authorization: "DPoP unrelated" } }));
  await provider.invalidate(renewed.clone());
  assert.notEqual(
    (await provider.upgrade(first)).headers.get("authorization"),
    renewed.headers.get("authorization"),
    "recent cloned requests retain the existing invalidation behavior",
  );
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

test("LWS exchanges retain outstanding invalidation contexts after history eviction", async () => {
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
  const renewed = await provider.upgrade(request(0), challenges(0));
  assert.notEqual(renewed.headers.get("authorization"), upgraded[0].headers.get("authorization"));
  assert.equal(issued, 102);
  await provider.invalidate(upgraded[0]);
  assert.equal(
    (await provider.upgrade(request(0), challenges(0))).headers.get("authorization"),
    renewed.headers.get("authorization"),
    "late rejections preserve the replacement",
  );
  assert.equal(issued, 102);
  await provider.invalidate(request(0));
  await provider.invalidate(upgraded[100].clone());
  await provider.upgrade(request(100), challenges(100));
  assert.equal(issued, 103);
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
  const fence = new SessionFence("id-token-sources", { broadcast: false });
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
        { http: insecure, fence },
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
        { http: insecure, fence },
      );
      await assert.rejects(invalid.getCredential(request), /lacks the azp/);
      await invalid.forget();
    });
  } finally {
    fence.close();
    await uriOp.close();
    await withoutAzp.close();
  }
});

for (const failRemoval of [false, true]) {
  test(`reauthorization without a refresh token ${failRemoval ? "fails closed if durable removal fails" : "removes the superseded durable record"}`, async () => {
    await withMockedDate(async (advance) => {
      const namespace = `refresh-removal-${crypto.randomUUID()}`;
      const fence = new SessionFence(namespace, { broadcast: false });
      const cache = createMemoryStore();
      const durable = createMemoryStore();
      const code = automaticCodeProvider();
      let omitRefresh = false;
      let removals = 0;
      let authorizedToken;
      const sessionStore = {
        ...durable,
        removeItem: async (key) => {
          if (++removals === 2 && failRemoval) throw new Error("durable removal failed");
          await durable.removeItem(key);
        },
      };
      const http = {
        ...insecure,
        fetch: async (url, init) => {
          const response = await transport(url, init);
          if (
            omitRefresh &&
            new URL(url).pathname === "/token" &&
            new URLSearchParams(init.body).get("grant_type") === "authorization_code"
          ) {
            const body = await response.json();
            authorizedToken = body.access_token;
            delete body.refresh_token;
            return Response.json(body);
          }
          return response;
        },
      };
      const session = new OidcSession(
        callback,
        code,
        new DynamicRegistrationClientProvider(insecure),
        { namespace, cache, sessionStore, fence, http, revokeOnForget: false },
      );
      const metadata = await (
        await transport(`${op.issuer}.well-known/openid-configuration`)
      ).json();
      const signal = new AbortController().signal;
      const key = await contextKey("oidc", [
        namespace,
        "default",
        op.issuer,
        callback,
        "openid webid",
        "fixed",
      ]);
      try {
        await session.get(metadata, "fixed", signal, idTokenUsable);
        const original = await durable.getItem(key);
        assert.ok(original.refreshToken);
        const refreshes = op.stats.refresh;
        omitRefresh = true;
        advance(400_000);
        // The refresh commits a rotated durable record but has no ID token. A new code grant
        // supplies the ID token without offline credentials and must replace both stores.
        const pending = session.get(metadata, "fixed", signal, idTokenUsable);
        if (failRemoval) {
          await assert.rejects(pending, /durable removal failed/);
          assert.notEqual((await cache.getItem(key)).tokenResult.access_token, authorizedToken);
          assert.equal(idTokenUsable(await cache.getItem(key)), false);
        } else {
          const fresh = await pending;
          assert.equal(fresh.tokenResult.access_token, authorizedToken);
          assert.equal(fresh.tokenResult.refresh_token, undefined);
          assert.equal(await durable.getItem(key), null);
          await cache.clear(); // A reload cannot restore the superseded refresh credentials.
          assert.equal(
            await session.get(metadata, "fixed", signal, idTokenUsable, false),
            undefined,
          );
        }
        assert.equal(removals, 2);
        assert.equal(code.calls, 2);
        assert.equal(op.stats.refresh, refreshes + 1);
      } finally {
        fence.close();
      }
    });
  });
}

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
