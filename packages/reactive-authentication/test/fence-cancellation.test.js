// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test, vi } from "vitest";
import { FencedCache } from "../src/FencedCache.js";
import {
  CredentialBoundary,
  ReactiveAuthenticationClient,
  SessionFence,
  SessionSupersededError,
} from "../src/mod.js";

async function waitForCommit(fence) {
  await vi.waitFor(async () => {
    const { pending } = await navigator.locks.query();
    assert.ok(
      pending.some(
        (lock) =>
          lock.name === `reactive-authentication:${fence.namespace}:fence` &&
          lock.mode === "shared",
      ),
      "the send is waiting behind logout cleanup",
    );
  });
}

for (const cancellation of ["caller", "null reason", "provider", "session", "none"]) {
  test(`a queued client send handles ${cancellation} cancellation during peer logout cleanup`, async () => {
    const namespace = `cancel-send-${crypto.randomUUID()}`;
    const store = createMemoryStore();
    const fence = new SessionFence(namespace, { store, broadcast: false });
    const peer = new SessionFence(namespace, { store, broadcast: false });
    const upgrading = Promise.withResolvers();
    const upgrade = Promise.withResolvers();
    const clearing = Promise.withResolvers();
    const clear = Promise.withResolvers();
    const controller = new AbortController();
    const providerController = new AbortController();
    const reason = new Error("caller cancelled while queued");
    const sent = [];
    const client = new ReactiveAuthenticationClient({
      boundary: new CredentialBoundary(["https://pod.example/"]),
      fence,
      providers: [
        {
          matches: async () => true,
          upgrade: async (request) => {
            upgrading.resolve();
            await upgrade.promise;
            return new Request(request, {
              headers: { authorization: "Bearer credential" },
              ...(cancellation === "provider" ? { signal: providerController.signal } : {}),
            });
          },
        },
      ],
      fetch: async (request) => {
        sent.push(request);
        return new Response(null, { status: 401 });
      },
    });
    const pending = client.fetch("https://pod.example/private", { signal: controller.signal });
    let settled = false;
    const outcome = pending.then(
      () => assert.fail("a stale send must not succeed"),
      (error) => {
        settled = true;
        return error;
      },
    );
    let logout;
    try {
      await upgrading.promise;
      logout = peer.supersede(async () => {
        clearing.resolve();
        await clear.promise;
      });
      await clearing.promise;
      upgrade.resolve();
      await waitForCommit(fence);
      assert.equal(settled, false);

      if (cancellation === "caller") controller.abort(reason);
      else if (cancellation === "null reason") controller.abort(null);
      else if (cancellation === "provider") providerController.abort(reason);
      else if (cancellation === "session") await fence.generation();
      else clear.resolve();

      await vi.waitFor(() => assert.equal(settled, true));
      const error = await outcome;
      if (cancellation === "caller" || cancellation === "provider") assert.equal(error, reason);
      else if (cancellation === "null reason") assert.equal(error.name, "AbortError");
      else assert.ok(error instanceof SessionSupersededError);
      assert.equal(sent.length, 1, "the credentialed attempt never reaches the transport");
      assert.equal(sent[0].headers.has("authorization"), false);
    } finally {
      upgrade.resolve();
      clear.resolve();
      await Promise.allSettled([pending, outcome, logout]);
      fence.close();
      peer.close();
    }
  });
}

for (const operation of ["client fetch", "fence commit", "cache write"]) {
  for (const alreadyAborted of [false, true]) {
    test(`${operation} ${alreadyAborted ? "rejects an already-aborted signal" : "can abort its lock wait"} while cleanup is blocked`, async () => {
      const fence = new SessionFence(`cancel-${crypto.randomUUID()}`, { broadcast: false });
      const clearing = Promise.withResolvers();
      const clear = Promise.withResolvers();
      const controller = new AbortController();
      const reason = new Error("cancelled without waiting for cleanup");
      const logout = fence.supersede(async () => {
        clearing.resolve();
        await clear.promise;
      });
      let pending;
      let outcome;
      let writes = 0;
      const store = createMemoryStore();
      try {
        await clearing.promise;
        if (alreadyAborted) controller.abort(reason);
        const generation = await fence.generation();
        if (operation === "client fetch") {
          const client = new ReactiveAuthenticationClient({
            boundary: new CredentialBoundary(["https://pod.example/"]),
            fence,
            providers: [],
            fetch: async () => {
              writes++;
              return new Response();
            },
          });
          pending = client.fetch("https://pod.example/private", { signal: controller.signal });
        } else if (operation === "fence commit") {
          pending = fence.commit(
            generation,
            async () => {
              writes++;
            },
            controller.signal,
          );
        } else {
          const cache = new FencedCache("cancel-test", { namespace: "test", fence, store });
          pending = cache.write("key", "credential", { generation, signal: controller.signal });
        }
        let settled = false;
        outcome = pending.then(
          () => assert.fail("cancelled operations must reject"),
          (error) => {
            settled = true;
            return error;
          },
        );
        if (!alreadyAborted) {
          await waitForCommit(fence);
          controller.abort(reason);
        }
        await vi.waitFor(() => assert.equal(settled, true));
        assert.equal(await outcome, reason);
        assert.equal(writes, 0);
        assert.equal(await store.getItem("key"), null);
      } finally {
        clear.resolve();
        await Promise.allSettled([pending, outcome, logout]);
        fence.close();
      }
    });
  }
}
