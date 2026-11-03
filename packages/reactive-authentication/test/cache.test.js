// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import "fake-indexeddb/auto";
import { createBrowserCaches } from "../src/createBrowserCaches.js";

test("browser preset persists only metadata, isolates accounts, and expires metadata", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const caches = createBrowserCaches("my-app/account", 100);
  const other = createBrowserCaches("my-app/other-account", 100);
  await caches.issuer.setItem("resource", "https://idp.example");
  await caches.authorizationServer.setItem("resource", { issuer: "https://idp.example" });
  await caches.client.setItem("issuer", { client_id: "private-client" });
  await caches.token.setItem("resource", { secret: "memory only" });
  await other.issuer.setItem("resource", "https://other.example");
  const restored = createBrowserCaches("my-app/account", 100);
  assert.equal(await restored.issuer.getItem("resource"), "https://idp.example");
  assert.deepEqual(await restored.authorizationServer.getItem("resource"), {
    issuer: "https://idp.example",
  });
  assert.equal(await restored.client.getItem("issuer"), null);
  assert.equal(await restored.token.getItem("resource"), null);
  now = 1099;
  assert.notEqual(await restored.issuer.getItem("resource"), null);
  now = 1100;
  assert.equal(await restored.issuer.getItem("resource"), null);
  assert.equal(await restored.authorizationServer.getItem("resource"), null);
  await other.issuer.setItem("resource", "https://other.example");
  await restored.issuer.clear();
  assert.equal(await other.issuer.getItem("resource"), "https://other.example");
  await restored.authorizationServer.clear();
  await other.issuer.clear();
});

test("browser preset validates namespace and metadata lifetime", () => {
  assert.throws(() => createBrowserCaches(""), TypeError);
  for (const age of [0, -1, NaN, Infinity]) {
    assert.throws(() => createBrowserCaches("invalid-ttl", age), RangeError);
  }
});

test("browser fence wrappers classify failures while preserving IndexedDB generations", async () => {
  const namespace = `wrapped-fence-${crypto.randomUUID()}`;
  const failure = new Error("IndexedDB unavailable");
  const classified = new Error("Classified storage failure", { cause: failure });
  let unavailable = false;
  const wrapFenceStore = vi.fn((store) => ({
    ...store,
    getItem: async (key) => {
      try {
        if (unavailable) throw failure;
        return await store.getItem(key);
      } catch (cause) {
        assert.equal(cause, failure);
        throw classified;
      }
    },
  }));
  const caches = createBrowserCaches(namespace, { wrapFenceStore });
  const reloaded = createBrowserCaches(namespace);
  try {
    assert.equal(wrapFenceStore.mock.calls.length, 1);
    assert.equal(await caches.fence.generation(), 0);
    await caches.fence.supersede();
    assert.equal(await reloaded.fence.generation(), 1);
    unavailable = true;
    await assert.rejects(caches.fence.generation(), (error) => error === classified);
    unavailable = false;
    assert.equal(await caches.fence.generation(), 1);
  } finally {
    caches.fence.close();
    reloaded.fence.close();
  }
});
