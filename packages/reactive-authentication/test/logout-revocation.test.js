// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { generateKeyPair, SignJWT } from "jose";
import { test, vi } from "vitest";
import { contextKey } from "../src/locks.js";
import { accessTokenUsable, OidcSession, SessionFence } from "../src/mod.js";

const callback = "https://app.example/callback";
const op = { issuer: "https://issuer.example/" };
const metadata = {
  issuer: op.issuer,
  authorization_endpoint: `${op.issuer}authorize`,
  token_endpoint: `${op.issuer}token`,
  revocation_endpoint: `${op.issuer}revoke`,
  code_challenge_methods_supported: ["S256"],
  dpop_signing_alg_values_supported: ["ES256"],
};
const deferred = () => Promise.withResolvers();

async function fixture(revoke, options = {}) {
  const namespace = `revocation-${crypto.randomUUID()}`;
  const generations = createMemoryStore();
  const fence = new SessionFence(namespace, { store: generations, broadcast: false });
  const peer = new SessionFence(namespace, { store: generations, broadcast: false });
  const cache = createMemoryStore();
  const sessionStore = createMemoryStore();
  const { privateKey } = await generateKeyPair("ES256");
  let nonce,
    issued = 0;
  const load = () =>
    new OidcSession(
      callback,
      {
        getCode: async (url) => {
          nonce = url.searchParams.get("nonce");
          const redirect = new URL(callback);
          redirect.searchParams.set("code", "code");
          redirect.searchParams.set("state", url.searchParams.get("state"));
          redirect.searchParams.set("iss", op.issuer);
          return { value: redirect.href, [Symbol.dispose]() {} };
        },
      },
      { getClient: async () => ({ client_id: "client", id_token_signed_response_alg: "ES256" }) },
      {
        namespace,
        cache,
        sessionStore,
        fence,
        ...options,
        http: {
          fetch: async (url, init) => {
            if (new URL(url).pathname === "/revoke") return await revoke(init);
            assert.equal(new URL(url).href, metadata.token_endpoint);
            assert.equal(new URLSearchParams(init.body).get("grant_type"), "authorization_code");
            issued++;
            return Response.json({
              access_token: `access-${issued}`,
              refresh_token: `refresh-${issued}`,
              token_type: "DPoP",
              expires_in: 300,
              id_token: await new SignJWT({ nonce })
                .setProtectedHeader({ alg: "ES256" })
                .setIssuer(op.issuer)
                .setAudience("client")
                .setSubject("alice")
                .setIssuedAt()
                .setExpirationTime("5m")
                .sign(privateKey),
            });
          },
        },
      },
    );
  const session = load();
  const get = (context = "first") =>
    session.get(metadata, context, new AbortController().signal, accessTokenUsable);
  const entry = await get();
  assert.equal((await session.identity(op.issuer, "first")).subject, "alice");
  const key = await contextKey("oidc", [
    namespace,
    "default",
    op.issuer,
    callback,
    "openid webid",
    "first",
  ]);
  return { session, fence, peer, cache, sessionStore, get, entry, key, load };
}

for (const catalog of [false, true]) {
  test(`logout after reload clears stored keys before bounded revocation; catalog=${catalog}`, async () => {
    const started = deferred();
    let signal, token;
    const f = await fixture((init) => {
      signal = init.signal;
      token = new URLSearchParams(init.body).get("token");
      started.resolve();
      return new Promise(() => {}); // Deliberately ignores abort.
    });
    // Model stores that require explicit keys, and a fresh instance with no in-memory key catalog.
    delete f.cache.clear;
    delete f.sessionStore.clear;
    const reloaded = f.load();
    const generation = await f.fence.generation();
    const oldSignal = f.fence.signal;
    const keys = catalog
      ? async () => {
          assert.equal(oldSignal.aborted, true, "read the catalog after superseding the session");
          return [f.key];
        }
      : [f.key];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const rejected = assert.rejects(reloaded.forget(keys), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.equal(error.errors[0].name, "TimeoutError");
        return true;
      });
      await started.promise;
      assert.equal(token, f.entry.tokenResult.refresh_token);
      assert.equal(oldSignal.aborted, true);
      assert.equal(await f.cache.getItem(f.key), null);
      assert.equal(await f.sessionStore.getItem(f.key), null);
      assert.equal(await f.peer.commit(generation + 1, async () => "unlocked"), "unlocked");
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      assert.equal(signal.aborted, true);
      assert.equal(vi.getTimerCount(), 0);
    } finally {
      vi.useRealTimers();
      f.fence.close();
      f.peer.close();
    }
  });
}

for (const mode of ["ignores abort", "honours abort", "stalls in the response body"]) {
  test(`logout clears credentials and releases the fence before revocation that ${mode}`, async () => {
    const started = deferred();
    const response = deferred();
    let signal;
    const f = await fixture((init) => {
      signal = init.signal;
      started.resolve();
      if (mode === "honours abort") {
        signal.addEventListener("abort", () => response.reject(signal.reason), { once: true });
      } else if (mode === "stalls in the response body") {
        return new Response(new ReadableStream(), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return response.promise;
    });
    const oldGeneration = await f.fence.generation();
    const oldSignal = f.fence.signal;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const forgetting = f.session.forget();
      const rejected = assert.rejects(forgetting, (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.equal(error.errors[0].name, "TimeoutError");
        return true;
      });
      await started.promise;
      assert.equal(oldSignal.aborted, true);
      assert.equal(await f.session.identity(op.issuer, "first"), undefined);
      assert.equal(await f.cache.getItem(f.key), null);
      assert.equal(await f.sessionStore.getItem(f.key), null);
      assert.equal(signal.aborted, false);

      await assert.rejects(
        f.peer.commit(oldGeneration, async () => assert.fail("stale commit")),
        {
          name: "SessionSupersededError",
        },
      );
      const fresh = await f.get();
      assert.equal(fresh.generation, oldGeneration + 1);
      assert.notEqual(fresh.tokenResult.access_token, f.entry.tokenResult.access_token);

      await vi.advanceTimersByTimeAsync(4_999);
      assert.equal(signal.aborted, false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      assert.equal(signal.aborted, true);
      assert.equal(signal.reason.name, "TimeoutError");
      assert.equal(vi.getTimerCount(), 0);
      assert.equal((await f.get()).tokenResult.access_token, fresh.tokenResult.access_token);

      // A transport may reject after the timeout. The losing promise must remain observed.
      if (mode === "ignores abort") response.reject(new Error("late transport failure"));
    } finally {
      vi.useRealTimers();
      f.fence.close();
      f.peer.close();
    }
  });
}

test("logout continues revoking its snapshot after a timeout without revoking a new session", async () => {
  const started = deferred();
  const revoked = [];
  const f = await fixture((init) => {
    revoked.push(new URLSearchParams(init.body).get("token"));
    started.resolve();
    return revoked.length === 1 ? new Promise(() => {}) : new Response();
  });
  const second = await f.get("second");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const rejected = assert.rejects(f.session.forget(), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      return true;
    });
    await started.promise;
    const fresh = await f.get("fresh");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    assert.deepEqual(revoked, [
      f.entry.tokenResult.refresh_token,
      second.tokenResult.refresh_token,
    ]);
    assert.equal(vi.getTimerCount(), 0);
    assert.equal((await f.get("fresh")).tokenResult.access_token, fresh.tokenResult.access_token);
  } finally {
    vi.useRealTimers();
    f.fence.close();
    f.peer.close();
  }
});

for (const outcome of ["success", "failure"]) {
  test(`revocation ${outcome} clears its deadline after local logout`, async () => {
    const started = deferred();
    const response = deferred();
    let signal;
    const f = await fixture((init) => {
      signal = init.signal;
      started.resolve();
      return response.promise;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const forgetting = f.session.forget();
      const settled =
        outcome === "failure" ? assert.rejects(forgetting, AggregateError) : forgetting;
      await started.promise;
      assert.equal(await f.cache.getItem(f.key), null);
      assert.equal(await f.sessionStore.getItem(f.key), null);
      assert.equal(vi.getTimerCount(), 1);
      if (outcome === "failure") response.reject(new Error("revocation unavailable"));
      else response.resolve(new Response());
      await settled;
      assert.equal(signal.aborted, false);
      assert.equal(vi.getTimerCount(), 0);
      await vi.advanceTimersByTimeAsync(5_000);
      assert.equal(signal.aborted, false);
    } finally {
      vi.useRealTimers();
      f.fence.close();
      f.peer.close();
    }
  });
}

for (const store of ["cache", "sessionStore"]) {
  test(`failed ${store} cleanup rejects without revocation and leaves old credentials fenced`, async () => {
    let revocations = 0;
    const f = await fixture(() => {
      revocations++;
      return new Response();
    });
    const generation = await f.fence.generation();
    const oldSignal = f.fence.signal;
    const failure = new Error("credential store unavailable");
    f[store].clear = async () => {
      throw failure;
    };
    try {
      await assert.rejects(f.session.forget(), (error) => error === failure);
      assert.equal(revocations, 0);
      assert.equal(oldSignal.aborted, true);
      assert.equal(await f.session.identity(op.issuer, "first"), undefined);
      await assert.rejects(
        f.peer.commit(generation, async () => assert.fail("stale commit")),
        {
          name: "SessionSupersededError",
        },
      );
      assert.equal(await f.peer.commit(generation + 1, async () => "fresh"), "fresh");
    } finally {
      f.fence.close();
      f.peer.close();
    }
  });
}

for (const stage of ["before revocation", "transport", "response body"]) {
  test(`owner disposal cancels revocation deadlines at ${stage}`, async () => {
    const lifetime = new AbortController();
    const ready = deferred();
    let signal;
    let calls = 0;
    const f = await fixture(
      (init) => {
        calls++;
        signal = init.signal;
        ready.resolve();
        return stage === "response body"
          ? new Response(new ReadableStream(), {
              status: 400,
              headers: { "content-type": "application/json" },
            })
          : new Promise(() => {});
      },
      { revocationSignal: lifetime.signal },
    );
    await f.get("second");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      if (stage === "before revocation") lifetime.abort(new Error("disposed"));
      const rejected = assert.rejects(f.session.forget(), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.equal(error.errors[0].message, "disposed");
        return true;
      });
      if (stage !== "before revocation") {
        await ready.promise;
        assert.equal(vi.getTimerCount(), 1);
        lifetime.abort(new Error("disposed"));
        assert.equal(vi.getTimerCount(), 0);
      }
      await rejected;
      assert.equal(calls, stage === "before revocation" ? 0 : 1);
      assert.equal(vi.getTimerCount(), 0);
      if (signal) {
        assert.equal(signal.aborted, true);
        assert.equal(getEventListeners(signal, "abort").length, 0);
      }
    } finally {
      vi.useRealTimers();
      f.fence.close();
      f.peer.close();
    }
  });
}
