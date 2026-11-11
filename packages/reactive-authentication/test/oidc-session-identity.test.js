// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { generateKeyPair } from "jose";
import { test, vi } from "vitest";
import { contextKey } from "../src/locks.js";
import {
  accessTokenUsable,
  DPoPTokenProvider,
  OidcSession,
  SessionFence,
  SessionSupersededError,
} from "../src/mod.js";

const callback = "https://app.example/callback";
const context = "https://pod.example/";
const as = { issuer: "https://issuer.example/", token_endpoint: "https://issuer.example/token" };
const identity = {
  issuer: as.issuer,
  subject: "alice",
  webId: "https://alice.example/profile#me",
  webIdVerified: false,
};

/** Snapshot one read, allowing logout to finish before its old value is returned. */
function pauseRead(store) {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const getItem = store.getItem.bind(store);
  let armed = true;
  store.getItem = async (key) => {
    const value = await getItem(key);
    if (armed) {
      armed = false;
      started.resolve();
      await release.promise;
    }
    return value;
  };
  return { started: started.promise, release: release.resolve };
}

async function fixture() {
  const namespace = `identity-${crypto.randomUUID()}`;
  const generations = createMemoryStore();
  const fence = new SessionFence(namespace, { store: generations, broadcast: false });
  const peer = new SessionFence(namespace, { store: generations, broadcast: false });
  const cache = createMemoryStore();
  const sessionStore = createMemoryStore();
  const options = {
    namespace,
    cache,
    sessionStore,
    fence,
    revokeOnForget: false,
    http: { fetch: async () => assert.fail("a stale session must not refresh") },
  };
  const code = { getCode: async () => assert.fail("identity lookup must not authorize") };
  const client = { getClient: async () => assert.fail("identity lookup must not register") };
  const session = new OidcSession(callback, code, client, options);
  const other = new OidcSession(callback, code, client, { ...options, fence: peer });
  const provider = new DPoPTokenProvider(
    callback,
    code,
    { getAuthorizationServer: async () => as },
    client,
    cache,
    { ...options, context: async () => context },
  );
  const key = await contextKey("oidc", [
    namespace,
    "default",
    as.issuer,
    callback,
    "openid webid",
    context,
  ]);
  const entry = {
    created: Date.now(),
    generation: 0,
    identity,
    tokenResult: { access_token: "access", refresh_token: "refresh", token_type: "dpop" },
    dpopKey: await generateKeyPair("ES256", { extractable: false }),
    client: { client_id: "client" },
    authorizationServer: as,
  };
  await cache.setItem(key, entry);
  await sessionStore.setItem(key, {
    created: entry.created,
    generation: entry.generation,
    identity,
    refreshToken: "refresh",
    dpopKey: entry.dpopKey,
    client: entry.client,
    authorizationServer: as,
  });
  return { session, other, provider, fence, peer, cache, sessionStore, generations, key, entry };
}

for (const source of ["cache", "durable", "empty", "stale records"]) {
  test(`identity reports the current session without starting a flow: ${source}`, async () => {
    const f = await fixture();
    try {
      if (source !== "cache") await f.cache.removeItem(f.key);
      if (source === "empty") await f.sessionStore.removeItem(f.key);
      if (source === "stale records") await f.fence.supersede();
      assert.deepEqual(
        await f.session.identity(as.issuer, context),
        source === "empty" || source === "stale records" ? undefined : identity,
      );
    } finally {
      f.fence.close();
      f.peer.close();
    }
  });
}

for (const source of ["cache", "durable"]) {
  for (const origin of ["local", "peer"]) {
    test(`identity discards a slow ${source} read after ${origin} logout`, async () => {
      const f = await fixture();
      if (source === "durable") await f.cache.removeItem(f.key);
      const read = pauseRead(source === "cache" ? f.cache : f.sessionStore);
      const pending = f.session.identity(as.issuer, context);
      try {
        await read.started;
        await (origin === "local" ? f.session : f.other).forget();
        if (origin === "peer")
          assert.equal(f.fence.signal.aborted, false, "no broadcast conceals the durable race");
        read.release();
        assert.equal(await pending, undefined);
      } finally {
        read.release();
        await Promise.allSettled([pending]);
        f.fence.close();
        f.peer.close();
      }
    });

    test(`get rejects a slow ${source} read after ${origin} logout before using credentials`, async () => {
      const f = await fixture();
      if (source === "durable") await f.cache.setItem(f.key, { ...f.entry, expiresAt: 0 });
      const read = pauseRead(source === "cache" ? f.cache : f.sessionStore);
      const removeCache = vi.spyOn(f.cache, "removeItem");
      const removeDurable = vi.spyOn(f.sessionStore, "removeItem");
      const pending = f.session.get(as, context, new AbortController().signal, accessTokenUsable);
      // Attach the rejection handler before logout can abort the operation.
      const rejected = assert.rejects(pending, SessionSupersededError);
      try {
        await read.started;
        await (origin === "local" ? f.session : f.other).forget();
        read.release();
        await rejected;
        assert.equal(removeCache.mock.calls.length, 0, "stale reads must not remove newer data");
        assert.equal(removeDurable.mock.calls.length, 0);
      } finally {
        read.release();
        await Promise.allSettled([pending, rejected]);
        f.fence.close();
        f.peer.close();
      }
    });
  }

  test(`identity propagates ${source} store failures`, async () => {
    const f = await fixture();
    if (source === "durable") await f.cache.removeItem(f.key);
    const failure = new Error("store unavailable");
    (source === "cache" ? f.cache : f.sessionStore).getItem = async () => {
      throw failure;
    };
    try {
      await assert.rejects(f.session.identity(as.issuer, context), (error) => error === failure);
    } finally {
      f.fence.close();
      f.peer.close();
    }
  });
}

test("restore revalidates a delayed cached identity after peer logout", async () => {
  const f = await fixture();
  const read = pauseRead(f.cache);
  const pending = f.provider.restore(new Request(`${context}private`));
  const rejected = assert.rejects(pending, SessionSupersededError);
  try {
    await read.started;
    await f.other.forget();
    read.release();
    await rejected;
  } finally {
    read.release();
    await Promise.allSettled([pending, rejected]);
    f.fence.close();
    f.peer.close();
  }
});
