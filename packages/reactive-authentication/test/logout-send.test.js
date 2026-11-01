// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test } from "vitest";
import { CredentialBoundary, ReactiveAuthenticationClient, SessionFence } from "../src/mod.js";

const boundary = new CredentialBoundary(["https://pod.example/"]);
const credentialed = (request) =>
  new Request(request, { headers: { authorization: "Bearer credential" } });

for (const retry of ["initial", "nonce", "renewal"]) {
  test(`the ${retry} credentialed send is ordered before peer logout, without waiting for its response`, async () => {
    const namespace = `send-${crypto.randomUUID()}`;
    const generations = createMemoryStore();
    const validating = Promise.withResolvers();
    const validation = Promise.withResolvers();
    const response = Promise.withResolvers();
    let pauseRead = false;
    const fence = new SessionFence(namespace, {
      broadcast: false,
      store: {
        ...generations,
        getItem: async (key) => {
          const value = await generations.getItem(key);
          if (pauseRead) {
            pauseRead = false;
            validating.resolve();
            await validation.promise;
          }
          return value;
        },
      },
    });
    const peer = new SessionFence(namespace, { store: generations, broadcast: false });
    const pauseAt = retry === "initial" ? 1 : 2;
    const events = [];
    let upgrades = 0;
    let invalidations = 0;
    const client = new ReactiveAuthenticationClient({
      boundary,
      fence,
      providers: [
        {
          matches: async () => true,
          upgrade: async (request) => {
            pauseRead = ++upgrades === pauseAt;
            return credentialed(request);
          },
          invalidate: async () => {
            invalidations++;
          },
        },
      ],
      fetch: async (request) => {
        if (request.headers.has("authorization") && upgrades === pauseAt) {
          events.push("send");
          return await response.promise; // Ignore abort, as an injected transport is allowed to do.
        }
        return new Response(null, {
          status: 401,
          headers:
            retry === "nonce"
              ? { "www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "nonce" }
              : { "www-authenticate": "Bearer" },
        });
      },
    });
    const pending = client.fetch("https://pod.example/private");
    let logout;
    try {
      await validating.promise;
      logout = peer.supersede(async () => {
        events.push("logout");
      });
      const locks = await navigator.locks.query();
      assert.ok(
        locks.pending.some(
          (lock) =>
            lock.name === `reactive-authentication:${namespace}:fence` && lock.mode === "exclusive",
        ),
        "logout must wait for final generation validation and transport initiation",
      );
      validation.resolve();
      await logout;
      assert.deepEqual(events, ["send", "logout"]);
      assert.equal(fence.signal.aborted, false, "no broadcast masks the shared-store race");
      assert.equal(await fence.generation(), 1);
      assert.equal(invalidations, retry === "renewal" ? 1 : 0);
      response.resolve(new Response("done"));
      assert.equal(await (await pending).text(), "done");
    } finally {
      validation.resolve();
      response.resolve(new Response("done"));
      await Promise.allSettled([pending, logout]);
      fence.close();
      peer.close();
    }
  });
}

for (const stage of ["upgrade", "send"]) {
  test(`cancellation during generation validation prevents the ${stage}`, async () => {
    const generations = createMemoryStore();
    const validating = Promise.withResolvers();
    const validation = Promise.withResolvers();
    let pauseRead = false;
    const fence = new SessionFence(`cancel-${crypto.randomUUID()}`, {
      broadcast: false,
      store: {
        ...generations,
        getItem: async (key) => {
          const value = await generations.getItem(key);
          if (pauseRead) {
            pauseRead = false;
            validating.resolve();
            await validation.promise;
          }
          return value;
        },
      },
    });
    let upgrades = 0;
    const sent = [];
    const client = new ReactiveAuthenticationClient({
      boundary,
      fence,
      providers: [
        {
          matches: async () => {
            pauseRead = stage === "upgrade";
            return true;
          },
          upgrade: async (request) => {
            upgrades++;
            pauseRead = stage === "send";
            return credentialed(request);
          },
        },
      ],
      fetch: async (request) => {
        sent.push(request);
        return new Response(null, { status: sent.length === 1 ? 401 : 200 });
      },
    });
    const controller = new AbortController();
    const cancellation = new Error("cancelled during generation read");
    const pending = client.fetch("https://pod.example/private", { signal: controller.signal });
    const rejected = assert.rejects(pending, (error) => error === cancellation);
    try {
      await validating.promise;
      controller.abort(cancellation);
      validation.resolve();
      await rejected;
      assert.equal(upgrades, stage === "upgrade" ? 0 : 1);
      assert.equal(sent.length, 1, "only the anonymous attempt reached the transport");
      assert.equal(sent[0].headers.has("authorization"), false);
    } finally {
      validation.resolve();
      await Promise.allSettled([pending, rejected]);
      fence.close();
    }
  });
}
