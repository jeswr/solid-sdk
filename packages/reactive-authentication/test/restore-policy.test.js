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

function setup() {
  const namespace = crypto.randomUUID();
  const sessions = createMemoryStore();
  const fence = new SessionFence(namespace, { broadcast: false });
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
  await f.load().provider.session.forget(keys);
  assert.equal(op.stats.refresh, before);
  assert.equal(await f.sessions.getItem(keys[0]), null);
  f.fence.close();
});

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
