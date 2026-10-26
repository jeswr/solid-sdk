// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { decodeJwt } from "jose";
import { afterAll as after, beforeAll as before, test } from "vitest";
import { challengeContext } from "../src/challenge.js";
import {
  CachingClientProvider,
  CredentialBoundary,
  DidKeySource,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  LwsTokenProvider,
  ReactiveFetchManager,
  SessionFence,
  SolidUmaTokenProvider,
  UmaAuthorizationError,
  XASProvider,
} from "../src/mod.js";
import { withMockedDate } from "./helpers/clock.js";
import { insecure, serve, transport } from "./helpers/http.js";
import { automaticCodeProvider, startOpenIdProvider, verifyDPoP } from "./helpers/openid.js";
import { callback } from "./helpers/solid.js";
import { PROFILE, startUma } from "./helpers/uma.js";

let op, uma;
before(async () => {
  op = await startOpenIdProvider({ webId: "https://id.example/alice#me" });
  uma = await startUma(op);
});
after(async () => {
  await uma.close();
  await op.close();
});

function umaClient(server, options = {}) {
  const code = automaticCodeProvider();
  const provider = new SolidUmaTokenProvider(
    callback,
    code,
    new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
    new CachingClientProvider(new DynamicRegistrationClientProvider(insecure)),
    { http: insecure, ...options },
  );
  const manager = new ReactiveFetchManager({
    providers: options.providers?.(provider) ?? [provider],
    boundary: new CredentialBoundary([`${server.url}/uma/`], { allowInsecureHttp: true }),
    fetch: options.fetch ?? transport,
  });
  return { code, provider, manager };
}

test("Solid-OIDC §9 UMA: ticket + DPoP-bound ID token exchanged for an RPT presented with fresh proofs", async () => {
  const { manager, code } = umaClient(uma);
  const response = await manager.fetch(`${uma.url}/uma/a`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello https://id.example/alice#me");
  const exchange = uma.stats.exchanges.at(-1);
  assert.equal(exchange.grant_type, "urn:ietf:params:oauth:grant-type:uma-ticket");
  assert.equal(exchange.claim_token_format, PROFILE);
  assert.ok(exchange.ticket);
  assert.equal(code.calls, 1);

  // Same URL: cached RPT, new proof. Another URL (unverified storage → its own context): new ticket
  // exchange, but the same ID token (no new login).
  const exchanges = uma.stats.exchanges.length;
  assert.equal((await manager.fetch(`${uma.url}/uma/a`, { method: "PUT", body: "x" })).status, 200);
  assert.equal(uma.stats.exchanges.length, exchanges);
  assert.equal((await manager.fetch(`${uma.url}/uma/b`)).status, 200);
  assert.equal(uma.stats.exchanges.length, exchanges + 1);
  assert.equal(code.calls, 1);
});

test("a rejected RPT is exchanged again once with the new ticket; a DPoP nonce is retried once", async () => {
  const { manager } = umaClient(uma);
  assert.equal((await manager.fetch(`${uma.url}/uma/r`)).status, 200);
  uma.revoke(uma.stats.accepted.at(-1).token);
  const exchanges = uma.stats.exchanges.length;
  assert.equal((await manager.fetch(`${uma.url}/uma/r`)).status, 200);
  assert.equal(uma.stats.exchanges.length, exchanges + 1);

  const nonced = await startUma(op, { nonce: true });
  try {
    assert.equal((await umaClient(nonced).manager.fetch(`${nonced.url}/uma/n`)).status, 200);
    assert.equal(nonced.stats.nonceChallenges, 1);
  } finally {
    await nonced.close();
  }
});

test("UMA renews a rejected RPT only in its issuing context when two contexts share its value", async () => {
  const namespace = `uma-reused-${crypto.randomUUID()}`;
  const fence = new SessionFence(namespace, { broadcast: false });
  const rpts = createMemoryStore();
  const writes = [];
  let sharedToken;
  let exchanges = 0;
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const first = `${uma.url}/uma/shared-first`;
  const second = `${uma.url}/uma/shared-second`;
  let paused = false;
  const { manager, provider, code } = umaClient(uma, {
    namespace,
    fence,
    context: (request) => request.url,
    fetch: async (request) => {
      if (request.url === first && request.headers.has("authorization") && !paused) {
        paused = true;
        started.resolve();
        await gate.promise;
      }
      return await transport(request);
    },
    rptStore: {
      ...rpts,
      setItem: async (key, value) => {
        writes.push({ key, value });
        await rpts.setItem(key, value);
      },
    },
    http: {
      ...insecure,
      fetch: async (url, init) => {
        const response = await transport(url, init);
        if (String(url) !== `${uma.url}/token`) return response;
        const body = await response.json();
        if (++exchanges === 1) sharedToken = body.access_token;
        if (exchanges === 2) body.access_token = sharedToken;
        return Response.json(body);
      },
    },
  });
  try {
    const pending = manager.fetch(first);
    await started.promise;
    assert.equal((await manager.fetch(second)).status, 200);
    assert.equal(writes.length, 2);
    assert.notEqual(writes[0].key, writes[1].key);
    assert.equal(writes[0].value.value.accessToken, sharedToken);
    assert.equal(writes[1].value.value.accessToken, sharedToken);
    uma.revoke(sharedToken);
    gate.resolve();

    assert.equal((await pending).status, 200, "the first context renews once");
    assert.equal(exchanges, 3);
    assert.notEqual((await rpts.getItem(writes[0].key)).value.accessToken, sharedToken);
    assert.deepEqual(await rpts.getItem(writes[1].key), writes[1].value);
    assert.equal(code.calls, 1, "RPT renewal reuses the ID-token session");
  } finally {
    gate.resolve();
    await provider.forget();
    fence.close();
  }
});

test("concurrent UMA nonce retries retain their issuing context at the same URL", async () => {
  const nonced = await startUma(op, { resourceNonce: true });
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const attempts = [];
  let paused = false;
  let contexts = 0;
  const { manager, provider, code } = umaClient(nonced, {
    context: (request, challenge) => {
      assert.equal(challenge.challenges[0].scheme, "uma");
      contexts++;
      return request.headers.get("x-context");
    },
    fetch: async (request) => {
      attempts.push(request.clone());
      if (
        request.headers.get("x-context") === "first" &&
        request.headers.has("authorization") &&
        !paused
      ) {
        paused = true;
        started.resolve();
        await gate.promise;
      }
      return await transport(request);
    },
  });
  const url = `${nonced.url}/uma/concurrent-nonce`;
  let pending;
  try {
    pending = manager.fetch(url, {
      method: "PUT",
      headers: { "x-context": "first" },
      body: "first body",
    });
    await started.promise;
    assert.equal(
      (
        await manager.fetch(url, {
          method: "PUT",
          headers: { "x-context": "second" },
          body: "second body",
        })
      ).status,
      200,
    );
    gate.resolve();
    assert.equal((await pending).status, 200);
    const tokens = [];
    const seen = new Set();
    for (const context of ["first", "second"]) {
      const requests = attempts.filter((request) => request.headers.get("x-context") === context);
      assert.equal(requests.length, 3, "anonymous, RPT, then one nonce retry");
      assert.equal(requests[0].headers.has("authorization"), false);
      const [, initial, retried] = requests;
      assert.equal(
        retried.headers.get("authorization"),
        initial.headers.get("authorization"),
        "a nonce retry must retain its own context's RPT",
      );
      const token = initial.headers.get("authorization").slice(5);
      tokens.push(token);
      const jkt = await verifyDPoP(initial.headers.get("dpop"), {
        method: "PUT",
        url,
        accessToken: token,
        seen,
      });
      assert.equal(
        await verifyDPoP(retried.headers.get("dpop"), {
          method: "PUT",
          url,
          accessToken: token,
          nonce: "uma-resource-nonce",
          seen,
        }),
        jkt,
      );
      assert.deepEqual(await Promise.all(requests.map((request) => request.text())), [
        `${context} body`,
        `${context} body`,
        `${context} body`,
      ]);
    }
    assert.notEqual(tokens[0], tokens[1], "the contexts have distinct RPTs");
    assert.equal(nonced.stats.exchanges.length, 2);
    assert.equal(nonced.stats.resourceNonceChallenges, 2);
    assert.equal(contexts, 2, "nonce retries never resolve a new context");
    assert.equal(code.calls, 1, "both contexts reuse the ID-token session");
  } finally {
    gate.resolve();
    await pending?.catch(() => undefined);
    await provider.forget();
    await nonced.close();
  }
});

for (const expiresIn of [1, 10, 300]) {
  test(`UMA retains the verified RPT context for a resource-server nonce retry (${expiresIn}s RPT)`, async () => {
    await withMockedDate(async () => {
      const nonced = await startUma(op, { nonce: true, resourceNonce: true, expiresIn });
      const { manager, provider, code } = umaClient(nonced, {
        context: (_request, challenge) => {
          assert.equal(
            challenge.challenges[0].scheme,
            "uma",
            "nonce retries reuse verified context",
          );
          return "verified-storage";
        },
      });
      try {
        const url = `${nonced.url}/uma/nonce?query=1#fragment`;
        const response = await manager.fetch(url, { method: "PUT", body: "replayed body" });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "hello https://id.example/alice#me");
        assert.equal(code.calls, 1);
        assert.equal(
          nonced.stats.exchanges.length,
          2,
          "one exchange plus its token-endpoint nonce retry",
        );
        assert.equal(nonced.stats.nonceChallenges, 1);
        assert.equal(nonced.stats.resourceNonceChallenges, 1);
        const requests = nonced.server.requests.filter(
          (request) => new URL(request.url).pathname === "/uma/nonce",
        );
        assert.equal(requests.length, 3, "anonymous, RPT, then nonce retry");
        assert.equal(requests[0].headers.has("authorization"), false);
        const [, initial, retried] = requests;
        assert.equal(initial.headers.get("authorization"), retried.headers.get("authorization"));
        const token = retried.headers.get("authorization").slice(5);
        const claims = decodeJwt(token);
        assert.equal(
          claims.exp - claims.iat,
          expiresIn,
          "the signed RPT has the advertised lifetime",
        );
        const seen = new Set();
        const jkt = await verifyDPoP(initial.headers.get("dpop"), {
          method: "PUT",
          url,
          accessToken: token,
          seen,
        });
        assert.equal(
          await verifyDPoP(retried.headers.get("dpop"), {
            method: "PUT",
            url,
            accessToken: token,
            nonce: "uma-resource-nonce",
            seen,
          }),
          jkt,
        );
        assert.equal(decodeJwt(initial.headers.get("dpop")).nonce, undefined);
        assert.equal(seen.size, 2, "fresh proof jti for the retry");
        assert.deepEqual(await Promise.all(requests.map((request) => request.text())), [
          "replayed body",
          "replayed body",
          "replayed body",
        ]);
      } finally {
        await provider.forget();
        await nonced.close();
      }
    });
  });
}

test("UMA nonce retries stay on the verified resource and reject invalidated or forgotten RPTs", async () => {
  const { provider, code } = umaClient(uma);
  const request = new Request(`${uma.url}/uma/nonce-scope`);
  const nonce = challengeContext(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate": 'DPoP error="use_dpop_nonce"',
        "dpop-nonce": "resource-nonce",
      },
    }),
  );
  const exchanges = uma.stats.exchanges.length;
  try {
    const upgraded = await provider.upgrade(request, challengeContext(await transport(request)));
    await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
    nonce.request = upgraded;
    await assert.rejects(
      provider.upgrade(request, { ...nonce, request: upgraded.clone() }),
      /RPT context/,
    );
    const retried = await provider.upgrade(request, nonce);
    assert.equal(retried.headers.get("authorization"), upgraded.headers.get("authorization"));
    assert.equal(decodeJwt(retried.headers.get("dpop")).nonce, "resource-nonce");
    await assert.rejects(
      provider.upgrade(new Request(`${uma.url}/uma/other`), nonce),
      /RPT context/,
    );
    await assert.rejects(
      provider.upgrade(new Request("https://foreign.example/uma/nonce-scope"), nonce),
      /RPT context/,
    );
    const foreign = {
      ...nonce,
      response: Object.defineProperty(nonce.response.clone(), "url", {
        value: "https://foreign.example/",
      }),
    };
    await assert.rejects(provider.upgrade(request, foreign), /nonce.*origin/);
    await provider.invalidate(upgraded);
    await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
    await provider.upgrade(request, challengeContext(await transport(request)));
    await provider.forget();
    await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
    assert.equal(code.calls, 1, "nonce retries never start a login");
    assert.equal(uma.stats.exchanges.length, exchanges + 2, "only UMA challenges acquire RPTs");
  } finally {
    await provider.forget();
  }
});

test("UMA nonce retries accept an RPT until actual expiry and reject it at or after expiry", async () => {
  await withMockedDate(async (advance) => {
    const { provider, code } = umaClient(uma);
    const request = new Request(`${uma.url}/uma/expired-nonce`);
    const exchanges = uma.stats.exchanges.length;
    try {
      const original = await provider.upgrade(request, challengeContext(await transport(request)));
      const nonce = challengeContext(
        new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "nonce" },
        }),
      );
      nonce.request = original;
      advance(299_999);
      const retried = await provider.upgrade(request, nonce);
      assert.equal(retried.headers.get("authorization"), original.headers.get("authorization"));
      assert.equal(decodeJwt(retried.headers.get("dpop")).nonce, "nonce");
      advance(1);
      await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
      advance(1);
      await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
      assert.equal(code.calls, 1);
      assert.equal(uma.stats.exchanges.length, exchanges + 1);
    } finally {
      await provider.forget();
    }
  });
});

test("UMA nonce retries remain fenced when a peer logs out during the RPT read", async () => {
  const namespace = `uma-nonce-${crypto.randomUUID()}`;
  const generations = createMemoryStore();
  const fence = new SessionFence(namespace, { store: generations, broadcast: false });
  const peer = new SessionFence(namespace, { store: generations, broadcast: false });
  const rpts = createMemoryStore();
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  let pauseRead = false;
  const { provider, code } = umaClient(uma, {
    namespace,
    fence,
    rptStore: {
      ...rpts,
      getItem: async (key) => {
        const value = await rpts.getItem(key);
        if (pauseRead) {
          started.resolve();
          await gate.promise;
        }
        return value;
      },
    },
  });
  const request = new Request(`${uma.url}/uma/peer-nonce`);
  try {
    const original = await provider.upgrade(request, challengeContext(await transport(request)));
    const exchanges = uma.stats.exchanges.length;
    const nonce = challengeContext(
      new Response(null, {
        status: 401,
        headers: { "www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "nonce" },
      }),
    );
    nonce.request = original;
    pauseRead = true;
    const pending = provider.upgrade(request, nonce);
    const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
    await started.promise;
    await peer.supersede();
    assert.equal(fence.signal.aborted, false);
    gate.resolve();
    await rejected;
    pauseRead = false;
    await assert.rejects(provider.upgrade(request, nonce), /RPT context/);
    assert.equal(code.calls, 1);
    assert.equal(uma.stats.exchanges.length, exchanges);
  } finally {
    gate.resolve();
    fence.close();
    peer.close();
  }
});

test("need_info fails explicitly with the claims interaction hint, without looping", async () => {
  const gated = await startUma(op, { needInfo: true });
  try {
    await assert.rejects(
      umaClient(gated).manager.fetch(`${gated.url}/uma/x`),
      (e) =>
        e instanceof UmaAuthorizationError &&
        e.error === "need_info" &&
        e.redirectUser?.startsWith(`${gated.url}/claims`) &&
        typeof e.ticket === "string",
    );
    assert.equal(gated.stats.exchanges.length, 1);
  } finally {
    await gated.close();
  }
});

test("an untrusted UMA authorization server is refused before any login or credential use", async () => {
  const evil = await serve(() => new Response(null, { status: 500 }));
  const lured = await startUma(op, { asUri: () => evil.url });
  try {
    const { manager, code } = umaClient(lured);
    const authorizations = op.stats.authorize.length;
    await assert.rejects(manager.fetch(`${lured.url}/uma/x`), /not trusted/);
    assert.equal(code.calls, 0);
    assert.equal(op.stats.authorize.length, authorizations);
    assert.equal(evil.requests.length, 0);
  } finally {
    await lured.close();
    await evil.close();
  }
});

test("logout forgets RPTs and the ID token session", async () => {
  const { manager, code } = umaClient(uma);
  assert.equal((await manager.fetch(`${uma.url}/uma/l`)).status, 200);
  await manager.logout();
  const exchanges = uma.stats.exchanges.length;
  assert.equal((await manager.fetch(`${uma.url}/uma/l`)).status, 200);
  assert.equal(uma.stats.exchanges.length, exchanges + 1);
  assert.equal(code.calls, 2, "logged in again");
});

test("provider selection: UMA challenges go to the UMA provider, never to DPoP or LWS providers", async () => {
  const lwsProvider = new LwsTokenProvider(await DidKeySource.generate(), { http: insecure });
  const { manager } = umaClient(uma, {
    providers: (umaProvider) => [
      lwsProvider,
      new DPoPTokenProvider(
        callback,
        automaticCodeProvider(),
        new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
        new DynamicRegistrationClientProvider(insecure),
        undefined,
        { http: insecure },
      ),
      umaProvider,
    ],
  });
  const challenge = {
    response: new Response(),
    challenges: [{ scheme: "uma", params: { realm: "storage", as_uri: uma.url, ticket: "t" } }],
  };
  assert.equal(await lwsProvider.matches(new Request(uma.url), challenge), false);
  assert.equal((await manager.fetch(`${uma.url}/uma/mixed`)).status, 200);
});

test("supplied credential stores require a shared fence", () => {
  const make = (options) =>
    new SolidUmaTokenProvider(
      callback,
      automaticCodeProvider(),
      { getAuthorizationServer: async () => ({}) },
      { getClient: async () => ({}) },
      options,
    );
  assert.throws(() => make({ namespace: "n", rptStore: createMemoryStore() }), /SessionFence/);
  assert.throws(() => make({ namespace: "n", cache: createMemoryStore() }), /SessionFence/);
});

test("uma-review #1: accounts sharing an RPT store, fence and namespace never share RPTs", async () => {
  const { sharedFences } = await import("./helpers/solid.js");
  const [fence] = sharedFences();
  const shared = { namespace: "app", rptStore: createMemoryStore(), fence };
  const alice = umaClient(uma, { ...shared, account: "alice" });
  const bob = umaClient(uma, { ...shared, account: "bob" });
  try {
    op.setWebId("https://id.example/alice#me");
    assert.equal(
      await (await alice.manager.fetch(`${uma.url}/uma/acct`)).text(),
      "hello https://id.example/alice#me",
    );
    op.setWebId("https://id.example/bob#me");
    const exchanges = uma.stats.exchanges.length;
    assert.equal(
      await (await bob.manager.fetch(`${uma.url}/uma/acct`)).text(),
      "hello https://id.example/bob#me",
    );
    assert.equal(uma.stats.exchanges.length, exchanges + 1, "bob exchanged his own ticket");
    assert.equal(
      await (await alice.manager.fetch(`${uma.url}/uma/acct`)).text(),
      "hello https://id.example/alice#me",
      "alice keeps her RPT",
    );
    assert.equal(uma.stats.exchanges.length, exchanges + 1);
  } finally {
    op.setWebId("https://id.example/alice#me");
    fence.close();
  }
});

test("uma-review #2: forget() while the trust policy is pending aborts that upgrade before login or exchange", async () => {
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { manager, provider, code } = umaClient(uma, {
    trustAuthorizationServer: async () => {
      started.resolve();
      await gate.promise;
      return true;
    },
  });
  const exchanges = uma.stats.exchanges.length;
  const pending = manager.fetch(`${uma.url}/uma/policy`);
  await started.promise;
  await provider.forget();
  gate.resolve();
  await assert.rejects(
    pending,
    (e) => e.name === "SessionSupersededError" || e.name === "AbortError",
  );
  assert.equal(code.calls, 0, "no login");
  assert.equal(uma.stats.exchanges.length, exchanges, "no exchange");
});

test("UMA logout cancels pending storage-context resolution before acquiring credentials", async () => {
  const started = Promise.withResolvers();
  const caller = new AbortController();
  let paused = true;
  let contextRequest;
  const { manager, provider, code } = umaClient(uma, {
    context: async (request) => {
      if (!paused) return "verified-context";
      contextRequest = request;
      request.signal.throwIfAborted();
      started.resolve();
      return await new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), {
          once: true,
        });
      });
    },
  });
  const exchanges = uma.stats.exchanges.length;
  const request = new Request(`${uma.url}/uma/context-logout`, { signal: caller.signal });
  const pending = manager.fetch(request).catch((error) => error);
  try {
    await started.promise;
    await provider.forget();
    assert.equal(request.signal.aborted, false);
    assert.equal(contextRequest.signal.aborted, true, "context discovery observes logout");
    assert.equal((await pending).name, "SessionSupersededError");
    assert.equal(code.calls, 0);
    assert.equal(uma.stats.exchanges.length, exchanges);
    paused = false;
    assert.equal((await manager.fetch(request)).status, 200);
    assert.equal(code.calls, 1, "the next generation can log in");
    assert.equal(uma.stats.exchanges.length, exchanges + 1);
  } finally {
    caller.abort();
    await pending;
    await provider.forget();
  }
});

test("UMA preserves its captured generation when a peer logs out before ID token acquisition", async () => {
  const namespace = `uma-generation-${crypto.randomUUID()}`;
  const generations = createMemoryStore();
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  let pauseRead = false;
  const fence = new SessionFence(namespace, {
    broadcast: false,
    store: {
      ...generations,
      getItem: async (key) => {
        const value = await generations.getItem(key);
        if (pauseRead) {
          pauseRead = false;
          started.resolve();
          await gate.promise; // A pending validation can return its pre-logout value.
        }
        return value;
      },
    },
  });
  const peer = new SessionFence(namespace, { store: generations, broadcast: false });
  const memory = createMemoryStore();
  const durable = createMemoryStore();
  const metadata = createMemoryStore();
  const writes = [];
  const persisted = [];
  const { manager, code } = umaClient(uma, {
    namespace,
    fence,
    cache: {
      ...memory,
      setItem: async (key, value) => {
        writes.push(value);
        await memory.setItem(key, value);
      },
    },
    sessionStore: {
      ...durable,
      setItem: async (key, value) => {
        persisted.push(value);
        await durable.setItem(key, value);
      },
    },
    metadataStore: {
      ...metadata,
      setItem: async (key, value) => {
        await metadata.setItem(key, value);
        pauseRead = true; // Pause the validation immediately before OidcSession.get.
      },
    },
  });
  const exchanges = uma.stats.exchanges.length;
  const grants = op.stats.token.length;
  const pending = manager.fetch(`${uma.url}/uma/peer-logout`);
  const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
  try {
    await started.promise;
    await peer.supersede();
    assert.equal(fence.signal.aborted, false, "no broadcast masks the generation race");
    gate.resolve();
    await rejected;
    assert.deepEqual(
      {
        logins: code.calls,
        grants: op.stats.token.length - grants,
        exchanges: uma.stats.exchanges.length - exchanges,
        cacheGenerations: writes.map((entry) => entry.generation),
        durableGenerations: persisted.map((entry) => entry.generation),
      },
      { logins: 0, grants: 0, exchanges: 0, cacheGenerations: [], durableGenerations: [] },
      "the superseded operation cannot log in, disclose claims or commit credentials",
    );
    assert.equal((await manager.fetch(`${uma.url}/uma/peer-logout`)).status, 200);
    assert.equal(code.calls, 1, "a fresh UMA operation can log in after logout");
    assert.equal(writes.at(-1).generation, 1);
    assert.equal(persisted.at(-1).generation, 1);
  } finally {
    gate.resolve();
    await Promise.allSettled([pending, rejected]);
    fence.close();
    peer.close();
  }
});
