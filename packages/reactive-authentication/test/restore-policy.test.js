// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { afterAll, beforeAll, test } from "vitest";
import { SessionFence } from "../src/mod.js";
import { startOpenIdProvider, startSolidStorage } from "./helpers/openid.js";
import { solidClient } from "./helpers/solid.js";

let op, rs;
beforeAll(async () => {
  op = await startOpenIdProvider({ requireInteraction: true });
  rs = await startSolidStorage(op);
});
afterAll(async () => {
  await rs.close();
  await op.close();
});

function setup(fenceStore = createMemoryStore()) {
  const namespace = crypto.randomUUID();
  const sessions = createMemoryStore();
  const fence = new SessionFence(namespace, { store: fenceStore, broadcast: false });
  const provider = {
    namespace,
    sessionStore: sessions,
    fence,
    preserveRefreshOnFailure: true,
    silentAfterRefreshFailure: true,
    silentFirst: false,
  };
  return { sessions, fence, provider, load: () => solidClient(op, rs, { provider, fence }) };
}

test("opt-in restore preserves transient credentials, clears invalid_grant, and makes only a silent fallback", async () => {
  const f = setup();
  const first = f.load();
  const request = new Request(`${rs.url}/alice/policy`);
  await first.provider.upgrade(request);
  assert.equal(first.code.calls, 1);
  const before = op.stats.authorize.length;
  op.failRefresh("temporarily_unavailable");
  try {
    await assert.rejects(
      f.load().provider.restore(request),
      (e) => e.error === "temporarily_unavailable",
    );
    op.failRefresh(undefined);
    const restored = f.load();
    assert.ok(await restored.provider.restore(request));
    assert.equal(restored.code.calls, 0);
    assert.equal(op.stats.authorize.length, before);
    op.failRefresh("invalid_grant");
    await assert.rejects(
      f.load().provider.restore(request),
      (e) => e.error === "interaction_required",
    );
    assert.equal(op.stats.authorize.length, before + 1);
    assert.equal(op.stats.authorize.at(-1).prompt, "none");
    const absent = f.load();
    assert.equal(await absent.provider.restore(request), undefined);
    assert.equal(absent.code.calls, 0);
  } finally {
    op.failRefresh(undefined);
    f.fence.close();
  }
});

test("a rotated refresh credential survives a failed final fence read and restores on retry", async () => {
  const fenceStore = createMemoryStore();
  const getGeneration = fenceStore.getItem;
  const failure = new Error("transient fence read failure");
  let failNextRead = false;
  fenceStore.getItem = async (key) => {
    if (failNextRead) {
      failNextRead = false;
      throw failure;
    }
    return await getGeneration(key);
  };
  const f = setup(fenceStore);
  const setSession = f.sessions.setItem;
  let sessionKey, record;
  let failAfterRotation = false;
  f.sessions.setItem = async (key, value) => {
    await setSession(key, value);
    sessionKey = key;
    record = value;
    if (failAfterRotation) {
      failAfterRotation = false;
      failNextRead = true;
    }
  };
  const request = new Request(`${rs.url}/alice/final-commit-retry`);
  try {
    await f.load().provider.upgrade(request);
    const original = record;
    const refreshes = op.stats.refresh;
    const authorizations = op.stats.authorize.length;
    const reuses = op.stats.reuse;
    failAfterRotation = true;
    await assert.rejects(f.load().provider.restore(request), (e) => e === failure);
    assert.equal(op.stats.refresh, refreshes + 1);
    assert.notEqual(record.refreshToken, original.refreshToken);
    assert.equal(await f.sessions.getItem(sessionKey), record);

    const retry = f.load();
    assert.ok(await retry.provider.restore(request));
    assert.equal(op.stats.refresh, refreshes + 2);
    assert.equal(op.stats.reuse, reuses);
    assert.equal(op.stats.authorize.length, authorizations);
    assert.equal(retry.code.calls, 0);
  } finally {
    f.fence.close();
  }
});

test("stored keys allow a fresh session to revoke without redeeming a refresh token", async () => {
  const f = setup();
  const keys = [];
  const set = f.sessions.setItem;
  f.sessions.setItem = async (key, value) => {
    keys.push(key);
    await set(key, value);
  };
  await f.load().provider.upgrade(new Request(`${rs.url}/alice/logout`));
  const before = op.stats.refresh;
  const generation = await f.fence.generation();
  await f.load().provider.session.forget(async () => {
    assert.equal(
      f.fence.signalFor(generation).aborted,
      true,
      "catalog is read after supersession, under the fence",
    );
    return keys;
  });
  assert.equal(op.stats.refresh, before);
  assert.equal(await f.sessions.getItem(keys[0]), null);
  f.fence.close();
});

for (const persist of [true, false]) {
  test(`refresh preservation supports non-rotating tokens; persistent=${persist}`, async () => {
    const issuer = await startOpenIdProvider({ rotate: false });
    const f = setup();
    if (!persist) delete f.provider.sessionStore;
    let before, after;
    const set = f.sessions.setItem;
    f.sessions.setItem = async (key, value) => {
      before ??= value.refreshToken;
      after = value.refreshToken;
      await set(key, value);
    };
    const page = solidClient(issuer, rs, { provider: f.provider, fence: f.fence });
    const request = new Request(`${rs.url}/alice/non-rotating`);
    try {
      const upgraded = await page.provider.upgrade(request);
      await page.provider.invalidate(upgraded);
      await page.provider.upgrade(request);
      assert.equal(issuer.stats.refresh, 1);
      assert.equal(issuer.stats.reuse, 0);
      assert.equal(page.code.calls, 1);
      assert.equal(after, before);
      await page.provider.invalidate(await page.provider.upgrade(request));
      await page.provider.upgrade(request);
      assert.equal(issuer.stats.refresh, 2);
      assert.equal(page.code.calls, 1);
    } finally {
      f.fence.close();
      await issuer.close();
    }
  });
}

test("an account lock is re-resolved after another context commits its alias", async () => {
  const f = setup();
  let calls = 0;
  f.provider.sessionLock = async () => (++calls === 1 ? "alias" : "account");
  const page = f.load();
  await page.provider.upgrade(new Request(`${rs.url}/alice/alias`));
  assert.ok(calls >= 4);
  await page.provider.invalidate(await page.provider.upgrade(new Request(`${rs.url}/alice/alias`)));
  f.fence.close();
});
