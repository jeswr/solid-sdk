// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test } from "vitest";
import { OAuthCodeSource, SessionFence } from "../src/mod.js";
import { insecure, transport } from "./helpers/http.js";
import { startOAuthProvider } from "./helpers/oauth.js";
import { automaticCodeProvider } from "./helpers/openid.js";

for (const stage of ["generation validation", "token invalidation"]) {
  test(`OAuth preserves its captured generation across peer logout during ${stage}`, async () => {
    const provider = await startOAuthProvider();
    const namespace = `oauth-generation-${crypto.randomUUID()}`;
    const generations = createMemoryStore();
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let pauseRead = 0;
    const fence = new SessionFence(namespace, {
      broadcast: false,
      store: {
        ...generations,
        getItem: async (key) => {
          const value = await generations.getItem(key);
          if (--pauseRead === 0) {
            started.resolve();
            await gate.promise; // A shared-store read may complete with its pre-logout value.
          }
          return value;
        },
      },
    });
    const peer = new SessionFence(namespace, { store: generations, broadcast: false });
    const memory = createMemoryStore();
    const writes = [];
    let pauseInvalidation = false;
    const cache = {
      ...memory,
      setItem: async (key, value) => {
        if (pauseInvalidation && value.expiresAt === 0) {
          pauseInvalidation = false;
          started.resolve();
          await gate.promise;
        }
        writes.push(value);
        await memory.setItem(key, value);
      },
    };
    const durable = createMemoryStore();
    const persisted = [];
    const code = automaticCodeProvider();
    const source = new OAuthCodeSource({
      authorizationServer: provider.metadata(),
      clientId: "client",
      redirectUri: "https://app.example/cb",
      scopes: ["read"],
      codeProvider: code,
      namespace,
      fence,
      cache,
      sessionStore: {
        ...durable,
        setItem: async (key, value) => {
          persisted.push(value);
          await durable.setItem(key, value);
        },
      },
      http: insecure,
    });
    try {
      let rejectedToken;
      if (stage === "token invalidation") {
        rejectedToken = (await source.authorize()).token;
        pauseInvalidation = true;
      } else {
        pauseRead = 2; // Capture generation, then pause its validation before session acquisition.
      }
      const flows = code.calls;
      const grants = provider.stats.token.length;
      const pending = source.getAccessToken({
        signal: new AbortController().signal,
        rejectedToken,
      });
      const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
      await started.promise;
      await peer.supersede();
      assert.equal(
        fence.signal.aborted,
        false,
        "no broadcast or local abort masks the generation race",
      );
      gate.resolve();
      await rejected;
      assert.equal(code.calls, flows, "the outstanding operation cannot start a new flow");
      assert.equal(provider.stats.token.length, grants, "no token acquired after peer logout");
      assert.ok(
        writes.every((entry) => entry.generation === 0),
        "no new-generation cache commit",
      );
      assert.ok(
        persisted.every((entry) => entry.generation === 0),
        "no new-generation durable commit",
      );
      assert.ok((await source.authorize()).token, "a fresh operation can authorize after logout");
      assert.equal(writes.at(-1).generation, 1);
      assert.equal(persisted.at(-1).generation, 1);
    } finally {
      gate.resolve();
      fence.close();
      peer.close();
      await provider.close();
    }
  });
}

test("OAuth sources validate supplied stores, sort configuration keys and transmit audiences", async () => {
  const options = {
    issuer: "https://issuer.example/",
    clientId: "client",
    redirectUri: "https://app.example/cb",
    scopes: ["read"],
    codeProvider: {},
  };
  assert.throws(
    () => new OAuthCodeSource({ ...options, cache: createMemoryStore() }),
    /SessionFence/,
  );
  const provider = await startOAuthProvider();
  try {
    const code = automaticCodeProvider();
    const http = {
      ...insecure,
      fetch: async (url, init) => {
        const response = await transport(url, init);
        if (new URL(url).pathname !== "/token") return response;
        const body = await response.json();
        delete body.expires_in;
        return Response.json(body, { status: response.status });
      },
    };
    const source = new OAuthCodeSource({
      ...options,
      issuer: provider.issuer,
      codeProvider: code,
      audience: "https://api.example/",
      parameters: { z_custom: "z", a_custom: "a" },
      http,
    });
    const access = await source.authorize();
    assert.equal(typeof access.token, "string");
    assert.equal("expiresAt" in access, false);
    assert.equal(provider.stats.authorize.at(-1).audience, "https://api.example/");
    assert.equal(provider.stats.token.at(-1).audience, "https://api.example/");
    await source.forget();
    const failed = new OAuthCodeSource({
      ...options,
      issuer: `${provider.issuer}missing`,
      http: insecure,
    });
    await assert.rejects(failed.authorize());
    await assert.rejects(failed.authorize());
  } finally {
    await provider.close();
  }
});
