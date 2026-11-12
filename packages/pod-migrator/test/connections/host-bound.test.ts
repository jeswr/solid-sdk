// AUTHORED-BY Claude Opus 5.5
import { createSolidAuth } from "@jeswr/solid-auth-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createHostBoundConnection,
  forgetHostBoundConnection,
  inspectPod,
} from "../../src/connections.js";
import { createPodHttp } from "../../src/index.js";
import { fakeAuth, sourceRoot, sourceWebId } from "./fixtures.js";

vi.mock("@jeswr/solid-auth-core", () => ({ createSolidAuth: vi.fn() }));

const ownerKey = "pod-migrator:target:host-owner";
const recentKey = "pod-migrator:target:recent-accounts";
const origin = "https://suite.example";
const base = "/settings/move-pod/";
const callback = `${origin}${base}callback/target?code=abc&state=xyz`;

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(createSolidAuth).mockReset();
});

function connect(owner: string, auth = fakeAuth(sourceWebId)) {
  vi.mocked(createSolidAuth).mockReturnValue(auth);
  return { auth, connection: createHostBoundConnection({ id: "target", origin, base, owner }) };
}

it("restores a stored session only for the host account that started it", async () => {
  storage.setItem(ownerKey, "alice");
  const { auth, connection } = connect("alice");
  await connection.initialize(`${origin}${base}`);
  expect(auth.logout).not.toHaveBeenCalled();
  expect(auth.restore).toHaveBeenCalled();
  expect(connection.snapshot().webId).toBe(sourceWebId);
});

it.each([
  ["another host account", "bob"],
  ["no recorded host account", null],
])("logs out a stored session owned by %s before restoring", async (_label, stored) => {
  if (stored) storage.setItem(ownerKey, stored);
  storage.setItem(recentKey, "[]");
  const { auth, connection } = connect("alice");
  await connection.initialize(`${origin}${base}`);
  expect(auth.logout).toHaveBeenCalledBefore(auth.restore);
  expect(connection.snapshot().status).toBe("signed-out");
  expect(storage.getItem(ownerKey)).toBeNull();
  expect(storage.getItem(recentKey)).toBeNull();
});

it("does not complete a sign-in callback started by another host account", async () => {
  storage.setItem(ownerKey, "bob");
  const { auth, connection } = connect("alice");
  await connection.initialize(callback);
  expect(auth.handleRedirect).not.toHaveBeenCalled();
  expect(auth.logout).toHaveBeenCalled();
});

it("completes a sign-in callback the same host account started", async () => {
  const { auth, connection } = connect("alice", fakeAuth(null));
  await connection.login("https://alice.example/profile/card#me", "webid");
  expect(storage.getItem(ownerKey)).toBe("alice");
  await connection.initialize(callback);
  expect(auth.handleRedirect).toHaveBeenCalledWith(callback);
  expect(auth.logout).not.toHaveBeenCalled();
});

it("still discards the session when its durable delete fails", async () => {
  storage.setItem(ownerKey, "bob");
  const auth = fakeAuth(sourceWebId);
  auth.logout.mockImplementation(async () => {
    auth.webId = null;
    throw new Error("delete failed");
  });
  auth.restore.mockResolvedValue({ outcome: "login" });
  const { connection } = connect("alice", auth);
  await connection.initialize(`${origin}${base}`);
  expect(connection.snapshot().status).toBe("signed-out");
});

it("forgets its owner on explicit logout", async () => {
  storage.setItem(ownerKey, "alice");
  const { connection } = connect("alice");
  await connection.initialize(`${origin}${base}`);
  await connection.logout();
  expect(storage.getItem(ownerKey)).toBeNull();
});

it("forgets a session on host sign-out only for its owner, and always on sign-out-all", async () => {
  const auth = fakeAuth(sourceWebId);
  vi.mocked(createSolidAuth).mockReturnValue(auth);
  storage.setItem(ownerKey, "alice");
  await forgetHostBoundConnection({ id: "target", origin, base, owner: "bob" });
  expect(auth.logout).not.toHaveBeenCalled();
  expect(storage.getItem(ownerKey)).toBe("alice");
  await forgetHostBoundConnection({ id: "target", origin, base, owner: "alice" });
  expect(auth.logout).toHaveBeenCalledTimes(1);
  expect(storage.getItem(ownerKey)).toBeNull();
  await forgetHostBoundConnection({ id: "target", origin, base });
  expect(auth.logout).toHaveBeenCalledTimes(1);
  storage.setItem(ownerKey, "bob");
  await forgetHostBoundConnection({ id: "target", origin, base });
  expect(auth.logout).toHaveBeenCalledTimes(2);
  expect(storage.getItem(ownerKey)).toBeNull();
  expect(createSolidAuth).toHaveBeenCalledWith(
    expect.objectContaining({ dbName: "pod-migrator:target:sessions" }),
  );
});

it("treats blocked storage as an unknown owner", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  const { auth, connection } = connect("alice");
  await connection.login("https://alice.example/profile/card#me", "webid");
  await connection.initialize(`${origin}${base}`);
  expect(auth.logout).toHaveBeenCalled();
});

it("keeps the source on a slow pod but rejects a caller cancellation", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    await new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    );
    return new Response(null);
  });
  const http = createPodHttp({ root: sourceRoot, fetch });
  const slow = await inspectPod(
    { root: sourceRoot, ownerWebId: sourceWebId, http },
    AbortSignal.timeout(5),
  );
  expect(slow.implementation).toBeUndefined();
  const controller = new AbortController();
  const pending = inspectPod(
    { root: sourceRoot, ownerWebId: sourceWebId, http },
    AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
  );
  controller.abort();
  await expect(pending).rejects.toBeDefined();
});
