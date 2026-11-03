// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { afterEach, beforeEach, test, vi } from "vitest";
import { withLock } from "../src/locks.js";
import { SessionFence } from "../src/mod.js";
import { startOpenIdProvider, startSolidStorage } from "./helpers/openid.js";
import { solidClient } from "./helpers/solid.js";

beforeEach(() => vi.stubGlobal("navigator", undefined));
afterEach(() => vi.unstubAllGlobals());

test("Node locks serialize one key in FIFO order and allow different keys to progress", async () => {
  const held = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const order = [];
  const first = withLock("fifo", async () => {
    order.push("first");
    entered.resolve();
    await held.promise;
    return 1;
  });
  await entered.promise;
  const second = withLock("fifo", async () => order.push("second"));
  const third = withLock("fifo", async () => order.push("third"));
  try {
    assert.equal(await withLock("independent", async () => 2), 2);
    assert.deepEqual(order, ["first"]);
  } finally {
    held.resolve();
  }
  assert.equal(await first, 1);
  await Promise.all([second, third]);
  assert.deepEqual(order, ["first", "second", "third"]);
  const failure = new Error("callback failed");
  await assert.rejects(
    withLock("fifo", async () => {
      throw failure;
    }),
    (e) => e === failure,
  );
  assert.equal(await withLock("fifo", async () => 3), 3);
});

test("aborting a queued Node lock rejects promptly without letting its successors bypass the holder", async () => {
  const held = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const first = withLock("abort-queue", async () => {
    entered.resolve();
    await held.promise;
  });
  await entered.promise;
  const controller = new AbortController();
  let called = false;
  const canceled = withLock("abort-queue", async () => assert.fail("canceled callback ran"), {
    signal: controller.signal,
  });
  const last = withLock("abort-queue", async () => {
    called = true;
  });
  const reason = new Error("cancel queued lock");
  try {
    controller.abort(reason);
    await assert.rejects(canceled, (e) => e === reason);
    await setImmediate();
    assert.equal(called, false);
  } finally {
    held.resolve();
  }
  await Promise.all([first, last]);
  assert.equal(called, true);
});

test("Node fence locks order active commits, logout and stale commits", async () => {
  const store = createMemoryStore();
  const namespace = crypto.randomUUID();
  const writer = new SessionFence(namespace, { store, broadcast: false });
  const peer = new SessionFence(namespace, { store, broadcast: false });
  const held = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const order = [];
  let credential;
  const commit = writer.commit(0, async () => {
    entered.resolve();
    await held.promise;
    credential = "committed";
    order.push("commit");
  });
  await entered.promise;
  const logout = peer.supersede(async () => {
    order.push("logout");
    credential = undefined;
  });
  const stale = assert.rejects(
    writer.commit(0, async () => assert.fail("stale write ran")),
    { name: "SessionSupersededError" },
  );
  try {
    await setImmediate();
    assert.deepEqual(order, []);
  } finally {
    held.resolve();
    await Promise.all([commit, logout, stale]);
    writer.close();
    peer.close();
  }
  assert.deepEqual(order, ["commit", "logout"]);
  assert.equal(credential, undefined);
  assert.equal(await writer.generation(), 1);
});

test("concurrent Node renewals redeem each rotating refresh token only once", async () => {
  const op = await startOpenIdProvider();
  const rs = await startSolidStorage(op);
  const namespace = crypto.randomUUID();
  const fence = new SessionFence(namespace, { broadcast: false });
  const cache = createMemoryStore();
  const sessionStore = createMemoryStore();
  const options = { cache, fence, provider: { namespace, sessionStore, fence } };
  const first = solidClient(op, rs, options);
  const second = solidClient(op, rs, options);
  const request = new Request(`${rs.url}/alice/node-lock`);
  try {
    const original = await first.provider.upgrade(request);
    await first.provider.invalidate(original);
    const [a, b] = await Promise.all([
      first.provider.upgrade(request),
      second.provider.upgrade(request),
    ]);
    assert.equal(a.headers.get("authorization"), b.headers.get("authorization"));
    assert.equal(op.stats.refresh, 1);
    assert.equal(op.stats.reuse, 0);
    assert.equal(first.code.calls, 1);
    assert.equal(second.code.calls, 0);
  } finally {
    fence.close();
    await rs.close();
    await op.close();
  }
});
