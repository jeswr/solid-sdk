// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createBrowserCaches,
  type RefreshSessionRecord,
  SessionFence,
} from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { type AccountManager, createAccountManager, UnknownAccountError } from "./accounts.js";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

vi.mock("@jeswr/reactive-authentication", async (original) => ({
  ...(await original<typeof import("@jeswr/reactive-authentication")>()),
  createBrowserCaches: vi.fn(),
}));

const managers: AccountManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(sharedIssuer = false, defaults = false) {
  const alice = createMockOp({ refreshTokens: true, revocation: true, requireInteraction: true });
  const bobRoot = "https://pod.example/bob/";
  const bob = createMockOp({
    issuer: sharedIssuer ? alice.issuer : "https://bob-op.example/",
    webId: "https://id.example/bob#me",
    subject: "https://id.example/bob",
    storages: [bobRoot],
    protectedUrls: [bobRoot],
    refreshTokens: true,
    revocation: true,
    requireInteraction: true,
  });
  let selected = alice;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const op =
      request.url.startsWith(bobRoot) || request.url.startsWith("https://id.example/bob")
        ? bob
        : request.url.startsWith(alice.root) || request.url.startsWith("https://id.example/alice")
          ? alice
          : sharedIssuer
            ? selected
            : request.url.startsWith(bob.issuer)
              ? bob
              : alice;
    return op.fetch(request);
  });
  vi.stubGlobal("fetch", transport);
  const values = new Map<string, {}>();
  const storage = {
    sessions: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: {}) => {
        values.set(key, structuredClone(value));
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
    caches: createMemoryStore(),
  };
  const options: PodAuthOptions = {
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    ui: {
      getWebId: async () => selected.webId!,
      getCode: (url, signal) =>
        (sharedIssuer ? selected : url.origin === new URL(bob.issuer).origin ? bob : alice).getCode(
          url,
          signal,
        ),
    },
    ...(!defaults && { storage }),
  };
  const load = () => {
    const manager = createAccountManager(options);
    managers.push(manager);
    return manager;
  };
  const records = () =>
    [...values.entries()].filter(
      (entry): entry is [string, RefreshSessionRecord] =>
        typeof entry[1] === "object" && "refreshToken" in entry[1],
    );
  return {
    alice,
    bob,
    bobRoot,
    options,
    storage,
    values,
    transport,
    records,
    load,
    select: (op: typeof alice) => {
      selected = op;
    },
  };
}

test("two concurrent accounts switch the dynamic fetch without requests and keep snapshots public", async () => {
  const f = fixture();
  const manager = f.load();
  expect(manager.accounts()).toEqual([]);
  expect(manager.active()).toBeNull();
  expect((await manager.fetch(f.alice.root + "private")).status).toBe(401);
  const changes = vi.fn();
  const stop = manager.on("change", changes);
  manager.on("change", () => {
    throw Error("observer");
  });
  await Promise.all([manager.add({ webId: f.alice.webId }), manager.add({ webId: f.bob.webId })]);
  expect(manager.accounts()).toHaveLength(2);
  const retained = manager.fetch;
  for (const [op, root] of [
    [f.alice, f.alice.root],
    [f.bob, f.bobRoot],
  ] as const) {
    const requests = f.alice.requests.length + f.bob.requests.length;
    await manager.switchTo(op.webId!);
    expect(f.alice.requests.length + f.bob.requests.length).toBe(requests);
    expect(manager.active()?.webId).toBe(op.webId);
    expect((await retained(root + "private")).status).toBe(200);
    expect(manager.authFor(op.webId!).fetch).toBe(manager.fetchFor(op.webId!));
  }
  const accounts = manager.accounts();
  accounts[0]!.subject = "changed";
  accounts[0]!.storages = [];
  const active = manager.active()!;
  active.subject = "changed";
  expect(manager.accounts()[0]!.subject).not.toBe("changed");
  expect(manager.active()!.subject).not.toBe("changed");
  const count = changes.mock.calls.length;
  stop();
  stop();
  await manager.switchTo(f.alice.webId!);
  expect(changes).toHaveBeenCalledTimes(count);
  await expect(manager.switchTo("unknown")).rejects.toBeInstanceOf(UnknownAccountError);
  await expect(manager.remove("unknown")).rejects.toMatchObject({ webId: "unknown" });
  expect(() => manager.fetchFor("unknown")).toThrow(UnknownAccountError);
  expect(() => manager.authFor("unknown")).toThrow(UnknownAccountError);
});

test.each([
  false,
  true,
])("boundaries and DPoP keys stay separate (shared issuer: %s)", async (shared) => {
  const f = fixture(shared);
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  f.select(f.bob);
  await manager.add({ webId: f.bob.webId });
  expect((await manager.fetchFor(f.alice.webId!)(f.alice.root + "private")).status).toBe(200);
  expect((await manager.fetchFor(f.bob.webId!)(f.bobRoot + "private")).status).toBe(200);
  const requestA = f.alice.requests.findLast((r) => r.headers.has("authorization"))!;
  const requestB = f.bob.requests.findLast((r) => r.headers.has("authorization"))!;
  expect(requestB.headers.get("authorization")).not.toBe(requestA.headers.get("authorization"));
  const key = (request: Request) =>
    JSON.parse(Buffer.from(request.headers.get("dpop")!.split(".")[0]!, "base64url").toString())
      .jwk;
  expect(key(requestB)).not.toEqual(key(requestA));
  const before = f.alice.requests.length;
  expect((await manager.fetchFor(f.bob.webId!)(f.alice.root + "private")).status).toBe(401);
  for (const request of f.alice.requests.slice(before)) {
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.has("dpop")).toBe(false);
  }
  const beforeB = f.bob.requests.length;
  expect((await manager.fetchFor(f.alice.webId!)(f.bobRoot + "private")).status).toBe(401);
  for (const request of f.bob.requests.slice(beforeB)) {
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.has("dpop")).toBe(false);
  }
});

test("restoreAll restores both scopes under distinct rotating refresh locks and selects the persisted account", async () => {
  const f = fixture();
  const first = f.load();
  await first.add({ webId: f.alice.webId });
  await first.add({ webId: f.bob.webId });
  await first.switchTo(f.alice.webId!);
  first.dispose();
  const a = f.load(),
    b = f.load();
  const [restoredA, restoredB] = await Promise.all([a.restoreAll(), b.restoreAll()]);
  expect(restoredA.map((i) => i.webId)).toEqual([f.alice.webId, f.bob.webId]);
  expect(restoredB).toEqual(restoredA);
  expect(a.active()?.webId).toBe(f.alice.webId);
  expect(f.alice.stats.refreshes).toBe(2);
  expect(f.bob.stats.refreshes).toBe(2);
  expect(f.alice.stats.reuse + f.bob.stats.reuse).toBe(0);
  expect((await a.fetchFor(f.alice.webId!)(f.alice.root + "private")).status).toBe(200);
  expect((await b.fetchFor(f.bob.webId!)(f.bobRoot + "private")).status).toBe(200);
  const refreshes = f.alice.stats.refreshes + f.bob.stats.refreshes;
  await a.restoreAll();
  expect(f.alice.stats.refreshes + f.bob.stats.refreshes).toBe(refreshes);
});

test.each([
  "expired",
  "transient",
  "storage",
])("one %s restore never prevents another account", async (failure) => {
  const f = fixture();
  const first = f.load();
  await first.add({ webId: f.alice.webId });
  await first.add({ webId: f.bob.webId });
  await first.switchTo(f.alice.webId!);
  first.dispose();
  if (failure === "storage") {
    const credential = f.records().find(([, r]) => r.identity?.webId === f.alice.webId)![0];
    const get = f.storage.sessions.getItem.getMockImplementation()!;
    f.storage.sessions.getItem.mockImplementation(async (key) => {
      if (key === credential) throw Error("read denied");
      return get(key);
    });
  } else f.alice.failRefresh(failure === "expired" ? "invalid_grant" : "temporarily_unavailable");
  const manager = f.load();
  const expired = vi.fn();
  manager.on("expired", expired);
  expect((await manager.restoreAll()).map((i) => i.webId)).toEqual([f.bob.webId]);
  expect(manager.active()?.webId).toBe(f.bob.webId);
  expect(expired.mock.calls).toEqual(failure === "expired" ? [[f.alice.webId]] : []);
  expect((await manager.fetch(f.bobRoot + "private")).status).toBe(200);
});

test.each([
  false,
  true,
])("remove revokes only one account, preserving the other's stored key and fresh restore (active: %s)", async (removeActive) => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  if (removeActive) await manager.switchTo(f.alice.webId!);
  const [bobKey, before] = f.records().find(([, r]) => r.identity?.webId === f.bob.webId)!;
  const oldFetch = manager.fetchFor(f.alice.webId!);
  await manager.remove(f.alice.webId!);
  expect(f.values.get(bobKey)).toEqual(before);
  expect(f.alice.stats.revocations).toBe(1);
  expect(f.bob.stats.revocations).toBe(0);
  expect(manager.active()?.webId).toBe(f.bob.webId);
  await expect(oldFetch(f.alice.root + "private")).rejects.toThrow("disposed");
  const fresh = f.load();
  expect((await fresh.restoreAll()).map((i) => i.webId)).toEqual([f.bob.webId]);
  expect((await fresh.fetch(f.bobRoot + "private")).status).toBe(200);
  await fresh.remove(f.bob.webId!);
  expect(fresh.active()).toBeNull();
  expect(fresh.accounts()).toEqual([]);
  expect((await fresh.fetch(f.bobRoot + "private")).status).toBe(401);
  expect(f.records()).toEqual([]);
});

test("removal still updates state and emits change after revocation failure", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  f.alice.failRevocation(true);
  const changed = vi.fn();
  manager.on("change", changed);
  await expect(manager.remove(f.alice.webId!)).rejects.toThrow("Logout cleanup failed");
  expect(manager.active()).toBeNull();
  expect(f.records()).toEqual([]);
  expect(changed).toHaveBeenCalledOnce();
});

test.each([
  false,
  true,
])("duplicate WebID replaces only its old scope (fresh manager: %s)", async (fresh) => {
  const f = fixture();
  const first = f.load();
  await first.add({ webId: f.alice.webId });
  await first.add({ webId: f.bob.webId });
  const old = first.authFor(f.alice.webId!);
  const [bobKey, bobRecord] = f.records().find(([, r]) => r.identity?.webId === f.bob.webId)!;
  const manager = fresh ? f.load() : first;
  f.alice.failRevocation(true);
  await manager.add({ webId: f.alice.webId });
  expect(manager.active()?.webId).toBe(f.alice.webId);
  expect(f.values.get(bobKey)).toEqual(bobRecord);
  expect(f.records()).toHaveLength(2);
  if (!fresh) {
    expect(manager.accounts().map((i) => i.webId)).toEqual([f.alice.webId, f.bob.webId]);
    await expect(old.fetch(f.alice.root + "private")).rejects.toThrow("disposed");
  }
  expect((await manager.fetch(f.alice.root + "private")).status).toBe(200);
});

test.each([
  "popup",
  "credential",
  "pointer",
  "failed",
])("a %s add leaves other accounts and active pointer unchanged", async (stage) => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  const before = manager.accounts();
  const remembered = [...f.values.entries()].find(([key]) => JSON.parse(key)[1] === "remembered")!;
  const controller = new AbortController();
  if (stage === "popup" || stage === "failed") {
    f.options.ui.getCode = async () => {
      if (stage === "popup") controller.abort(Error("cancelled"));
      throw Error(stage === "failed" ? "failed" : "cancelled");
    };
  } else {
    const write = f.storage.sessions.setItem.getMockImplementation()!;
    let aborted = false;
    f.storage.sessions.setItem.mockImplementation(async (key, value) => {
      await write(key, value);
      if (
        !aborted &&
        (stage === "credential" ? "refreshToken" in value : JSON.parse(key)[1] === "remembered")
      ) {
        aborted = true;
        controller.abort(Error("cancelled"));
      }
    });
  }
  await expect(manager.add({ webId: f.bob.webId }, { signal: controller.signal })).rejects.toThrow(
    stage === "failed" ? "failed" : "cancelled",
  );
  expect(manager.accounts()).toEqual(before);
  expect(manager.active()?.webId).toBe(f.alice.webId);
  expect(f.values.get(remembered[0])).toEqual(remembered[1]);
  expect(f.records()).toHaveLength(1);
  expect((await manager.fetch(f.alice.root + "private")).status).toBe(200);
});

test("already cancelled adds do no work and disposal fences actions and retained core handles", async () => {
  const f = fixture();
  const manager = f.load();
  const controller = new AbortController();
  controller.abort(Error("cancelled"));
  await expect(manager.add(undefined, { signal: controller.signal })).rejects.toThrow("cancelled");
  expect(f.alice.requests).toHaveLength(0);
  await manager.add();
  const auth = manager.authFor(f.alice.webId!);
  manager.dispose();
  manager.dispose();
  await expect(manager.add()).rejects.toThrow("disposed");
  await expect(manager.switchTo(f.alice.webId!)).rejects.toThrow("disposed");
  expect(() => manager.fetch(f.alice.root)).toThrow("disposed");
  await expect(auth.login()).rejects.toThrow("disposed");
  await expect(auth.restore()).rejects.toThrow("disposed");
  expect(await auth.identity()).toBeNull();
  expect((await f.load().restoreAll()).map((i) => i.webId)).toEqual([f.alice.webId]);
});

test("the anonymous lifecycle adapter delegates login to add", async () => {
  const f = fixture();
  const manager = f.load();
  const anonymous = manager.authFor(null);
  expect(await anonymous.identity()).toBeNull();
  expect(await anonymous.restore()).toBeNull();
  expect(await anonymous.remembered()).toEqual([]);
  anonymous.on("login", vi.fn())();
  await anonymous.logout();
  expect((await anonymous.fetch(f.alice.root + "private")).status).toBe(401);
  await anonymous.login({ webId: f.alice.webId });
  expect(manager.active()?.webId).toBe(f.alice.webId);
});

test("Node default storage supports multiple accounts and restore within the manager", async () => {
  const f = fixture(false, true);
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  expect(await manager.restoreAll()).toHaveLength(2);
});

test("session-only logout requires an explicit isolated session scope", async () => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  await expect(auth.logout({ scope: "session" })).rejects.toThrow("requires sessionScope");
  auth.dispose?.();
  expect(() => createPodAuth({ ...f.options, sessionScope: "not valid" })).toThrow("sessionScope");
});

test("runtime expiry reports its WebID and leaves another account's fetch usable", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  await manager.switchTo(f.alice.webId!);
  const expired = vi.fn();
  manager.on("expired", expired);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
  f.alice.failRefresh("invalid_grant");
  f.options.ui.getCode = async () => {
    throw Error("session expired");
  };
  await expect(manager.fetch(f.alice.root + "private")).rejects.toThrow();
  await manager.switchTo(f.bob.webId!);
  expect(expired.mock.calls).toEqual([[f.alice.webId]]);
  expect(manager.accounts().map((i) => i.webId)).toEqual([f.bob.webId]);
  expect((await manager.fetch(f.bobRoot + "private")).status).toBe(200);
});

test("direct core logout removes just that account from the manager", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  await manager.authFor(f.alice.webId!).logout();
  await manager.switchTo(f.bob.webId!);
  expect(manager.accounts().map((i) => i.webId)).toEqual([f.bob.webId]);
});

test("expiry while restoring an existing account notifies once and releases the old core", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  const auth = manager.authFor(f.alice.webId!);
  const namespace = (JSON.parse(f.records()[0]![0])[0] as string).slice(0, -":sessions".length);
  f.values.set(JSON.stringify(["pod-auth:fence:" + namespace, "generation"]), 1);
  f.alice.failRefresh("invalid_grant");
  const expired = vi.fn();
  manager.on("expired", expired);
  expect(await manager.restoreAll()).toEqual([]);
  expect(manager.active()).toBeNull();
  expect(expired.mock.calls).toEqual([[f.alice.webId]]);
  await expect(auth.fetch(f.alice.root)).rejects.toThrow("disposed");
});

test("a failed persisted account-list write rolls back a new add and releases new restore instances", async () => {
  const f = fixture();
  const first = f.load();
  await first.add();
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    if (JSON.parse(key)[1] === "remembered") throw Error("write denied");
    return write(key, value);
  });
  await expect(first.add({ webId: f.bob.webId })).rejects.toThrow("Session storage failed");
  expect(first.active()?.webId).toBe(f.alice.webId);
  const fresh = f.load();
  await expect(fresh.restoreAll()).rejects.toThrow("Session storage failed");
  expect(fresh.accounts()).toEqual([]);
  // A failed re-restore must retain existing cores rather than disposing them.
  await expect(first.restoreAll()).rejects.toThrow("Session storage failed");
  expect((await first.fetch(f.alice.root + "private")).status).toBe(200);
});

test("cancelling the first add during pointer persistence restores an empty catalog", async () => {
  const f = fixture();
  const manager = f.load();
  const controller = new AbortController();
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    await write(key, value);
    if (JSON.parse(key)[1] === "remembered") controller.abort(Error("cancelled"));
  });
  await expect(manager.add(undefined, { signal: controller.signal })).rejects.toThrow("cancelled");
  expect(manager.accounts()).toEqual([]);
  expect([...f.values.keys()].some((key) => JSON.parse(key)[1] === "remembered")).toBe(false);
});

test("disposing during restore discards late results without purging another account", async () => {
  const f = fixture();
  const first = f.load();
  await first.add({ webId: f.alice.webId });
  await first.add({ webId: f.bob.webId });
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await transport(request);
    if (request.url === f.alice.issuer + "token") {
      ready.resolve();
      await release.promise;
    }
    return response;
  });
  const fresh = f.load();
  const restoring = fresh.restoreAll();
  const outcome = expect(restoring).rejects.toThrow("disposed");
  await ready.promise;
  fresh.dispose();
  release.resolve();
  await outcome;
  expect(fresh.accounts()).toEqual([]);
  expect((await first.fetchFor(f.bob.webId!)(f.bobRoot + "private")).status).toBe(200);
});

test("browser defaults retain both session scopes across fresh managers", async () => {
  const f = fixture(false, true);
  const memory = <T extends {}>() => ({ ...createMemoryStore<T>(), clear: vi.fn(async () => {}) });
  vi.mocked(createBrowserCaches).mockReturnValue({
    sessions: memory(),
    fence: new SessionFence("accounts-browser", { broadcast: false }),
    issuer: memory(),
    authorizationServer: memory(),
    client: memory(),
    storageContext: memory(),
    token: memory(),
  });
  vi.stubGlobal("indexedDB", {});
  const first = f.load();
  await first.add({ webId: f.alice.webId });
  await first.add({ webId: f.bob.webId });
  first.dispose();
  expect(await f.load().restoreAll()).toHaveLength(2);
});

test("WebID-less and CID identities are rejected without changing existing accounts", async () => {
  const f = fixture();
  const op = createMockOp({ webId: null, refreshTokens: true });
  vi.stubGlobal("fetch", op.fetch);
  f.options.ui.getCode = op.getCode;
  const manager = f.load();
  await expect(manager.add({ issuer: op.issuer })).rejects.toThrow("require a WebID");
  expect(manager.accounts()).toEqual([]);
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  expect(() =>
    createAccountManager({
      ...f.options,
      lws: {
        subject: {
          cid: {
            documentUrl: "https://agent.example/id",
            keyId: "https://agent.example/id#key",
            privateKey: keys.privateKey,
          },
        },
      },
    }),
  ).toThrow("require WebID sessions");
  const normal = createAccountManager({ ...f.options, lws: { subject: "oidc-id-token" } });
  managers.push(normal);
  expect(normal.accounts()).toEqual([]);
  expect(() => createPodAuth({ ...f.options, sessionScope: 42 as unknown as string })).toThrow(
    "sessionScope",
  );
});

test.each([
  { entries: 42, active: null },
  { entries: [null], active: null },
  { entries: [{ webId: 42, scope: "a" }], active: null },
  { entries: [{ webId: "https://id.example/alice#me", scope: 42 }], active: null },
  { entries: [{ webId: "https://id.example/alice#me", scope: "bad scope" }], active: null },
  {
    entries: [
      { webId: "a", scope: "a" },
      { webId: "a", scope: "b" },
    ],
    active: null,
  },
  {
    entries: [
      { webId: "a", scope: "a" },
      { webId: "b", scope: "a" },
    ],
    active: null,
  },
  { entries: [], active: 42 },
])("untrusted malformed account metadata supplies no credentials: %j", async (value) => {
  const f = fixture();
  const namespace = JSON.stringify([
    "pod-auth-accounts",
    f.options.clientId,
    f.options.redirectUri,
  ]);
  f.values.set(JSON.stringify([namespace, "remembered"]), value);
  expect(await f.load().restoreAll()).toEqual([]);
  expect(f.alice.requests).toHaveLength(0);
});

test("a valid pointer cannot claim the credentials stored for a different WebID", async () => {
  const f = fixture();
  const first = f.load();
  await first.add();
  first.dispose();
  const [key, remembered] = [...f.values.entries()].find(
    ([key]) => JSON.parse(key)[1] === "remembered",
  )! as [string, { entries: { webId: string; scope: string }[]; active: string }];
  remembered.entries[0]!.webId = f.bob.webId!;
  remembered.active = f.bob.webId!;
  f.values.set(key, remembered);
  const fresh = f.load();
  expect(await fresh.restoreAll()).toEqual([]);
  expect(fresh.active()).toBeNull();
  expect(() => fresh.fetchFor(f.bob.webId!)).toThrow(UnknownAccountError);
});

test("a failed revocation during cancelled-add cleanup cannot affect an existing account", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  f.bob.failRevocation(true);
  const controller = new AbortController();
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    await write(key, value);
    if (JSON.parse(key)[1] === "remembered") controller.abort(Error("cancelled"));
  });
  await expect(manager.add({ webId: f.bob.webId }, { signal: controller.signal })).rejects.toThrow(
    "cancelled",
  );
  expect(manager.active()?.webId).toBe(f.alice.webId);
  expect(f.records()).toHaveLength(1);
});

test("external core logout handles a failing manager pointer store without an unhandled observer error", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  const failed = Promise.withResolvers<void>();
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    if (JSON.parse(key)[1] === "remembered") {
      failed.resolve();
      throw Error("write denied");
    }
    await write(key, value);
  });
  await manager.authFor(f.alice.webId!).logout();
  await failed.promise;
  f.storage.sessions.setItem.mockImplementation(write);
  await manager.remove(f.alice.webId!);
  expect(manager.accounts().map((i) => i.webId)).toEqual([f.bob.webId]);
});

test("a Request's own cancellation is preserved by the lifetime wrapper", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  const controller = new AbortController();
  const request = new Request(f.alice.root + "private", { signal: controller.signal });
  controller.abort(Error("cancel request"));
  await expect(manager.fetch(request)).rejects.toThrow("cancel request");
  expect(manager.active()?.webId).toBe(f.alice.webId);
});

test("a queued logout from a superseded core cannot remove its same-WebID replacement", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  const old = manager.authFor(f.alice.webId!);
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let paused = false;
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    await write(key, value);
    if (!paused && JSON.parse(key)[1] === "remembered") {
      paused = true;
      ready.resolve();
      await release.promise;
    }
  });
  const replacement = manager.add({ webId: f.alice.webId });
  await ready.promise;
  await old.logout();
  release.resolve();
  await replacement;
  await manager.switchTo(f.alice.webId!);
  expect(manager.accounts().map((i) => i.webId)).toEqual([f.alice.webId, f.bob.webId]);
  expect(manager.authFor(f.alice.webId!)).not.toBe(old);
  expect((await manager.fetch(f.alice.root + "private")).status).toBe(200);
  expect(f.records()).toHaveLength(2);
});

test("independent managers serialize catalog commits so concurrent additions both survive reload", async () => {
  const f = fixture();
  const a = f.load(),
    b = f.load();
  await Promise.all([a.add({ webId: f.alice.webId }), b.add({ webId: f.bob.webId })]);
  const fresh = f.load();
  expect((await fresh.restoreAll()).map((i) => i.webId).sort()).toEqual(
    [f.alice.webId, f.bob.webId].sort(),
  );
});

test("an account-list write that rejects after writing restores the previous active pointer", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  await manager.switchTo(f.bob.webId!);
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  let failed = false;
  f.storage.sessions.setItem.mockImplementation(async (key, value) => {
    await write(key, value);
    if (!failed && JSON.parse(key)[1] === "remembered") {
      failed = true;
      throw Error("late write failure");
    }
  });
  await expect(manager.add({ webId: f.alice.webId })).rejects.toThrow("Session storage failed");
  expect(manager.active()?.webId).toBe(f.bob.webId);
  const fresh = f.load();
  expect(await fresh.restoreAll()).toHaveLength(2);
  expect(fresh.active()?.webId).toBe(f.bob.webId);
});

test.each([
  undefined,
  42,
  "scope",
  null,
])("sparse or non-object pointers are ignored: %s", async (entry) => {
  const f = fixture();
  const namespace = JSON.stringify([
    "pod-auth-accounts",
    f.options.clientId,
    f.options.redirectUri,
  ]);
  f.values.set(JSON.stringify([namespace, "remembered"]), {
    entries: entry === undefined ? Array(1) : [entry],
    active: null,
  });
  expect(await f.load().restoreAll()).toEqual([]);
});

// Delete credentials and their core pointer, without superseding the stored fence.
function loseSession(f: ReturnType<typeof fixture>, webId: string) {
  for (const [key, value] of f.values) {
    if (typeof value !== "object") continue;
    if (
      ("refreshToken" in value && (value as RefreshSessionRecord).identity?.webId === webId) ||
      (JSON.parse(key)[1] === "active" && "webId" in value && value.webId === webId)
    )
      f.values.delete(key);
  }
}

test("stale removal preserves a replacement's scope, active pointer and reload credentials", async () => {
  const f = fixture();
  const replacing = f.load();
  await replacing.add();
  const stale = f.load();
  await stale.restoreAll();
  await replacing.add();
  const [key, replacement] = f.records()[0]!;
  await stale.remove(f.alice.webId!);
  expect(f.values.get(key)).toEqual(replacement);
  expect(stale.accounts()).toEqual([]);
  const fresh = f.load();
  expect(await fresh.restoreAll()).toHaveLength(1);
  expect(fresh.active()?.webId).toBe(f.alice.webId);
  expect((await fresh.fetch(f.alice.root + "private")).status).toBe(200);
});

test("restoreAll replaces a stale local core when the remembered scope changed", async () => {
  const f = fixture();
  const first = f.load();
  await first.add();
  const stale = f.load();
  await stale.restoreAll();
  const old = stale.authFor(f.alice.webId!);
  await first.add();
  await stale.restoreAll();
  expect(stale.authFor(f.alice.webId!)).not.toBe(old);
  expect((await stale.fetch(f.alice.root + "private")).status).toBe(200);
  await expect(old.fetch(f.alice.root)).rejects.toThrow("disposed");
});

test("similar scope names in two managers never alias their keys or logout fences", async () => {
  const f = fixture();
  const a = f.load(),
    b = f.load();
  const uuid = vi.spyOn(crypto, "randomUUID");
  uuid.mockReturnValueOnce("scope");
  await a.add({ webId: f.alice.webId });
  uuid.mockReturnValueOnce("scope-sessions");
  await b.add({ webId: f.bob.webId });
  expect(new Set(f.records().map(([key]) => JSON.parse(key)[0])).size).toBe(2);
  const [key, bob] = f.records().find(([, record]) => record.identity?.webId === f.bob.webId)!;
  await a.remove(f.alice.webId!);
  expect(f.values.get(key)).toEqual(bob);
  expect((await b.fetch(f.bobRoot + "private")).status).toBe(200);
  expect((await f.load().restoreAll()).map((i) => i.webId)).toEqual([f.bob.webId]);
});

test.each([
  "401",
  "error",
])("missing pointer and credential emit expiry after a %s response", async (outcome) => {
  const f = fixture();
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://foreign.example/lost") {
      loseSession(f, f.alice.webId!);
      if (outcome === "error") throw Error("transport failed");
      return new Response(null, { status: 401 });
    }
    return transport(request);
  });
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  await manager.switchTo(f.alice.webId!);
  const expired = vi.fn();
  manager.on("expired", expired);
  const request = manager.fetch("https://foreign.example/lost");
  if (outcome === "error") await expect(request).rejects.toThrow("transport failed");
  else expect((await request).status).toBe(401);
  await manager.switchTo(f.bob.webId!);
  expect(expired.mock.calls).toEqual([[f.alice.webId]]);
  expect(manager.accounts().map((i) => i.webId)).toEqual([f.bob.webId]);
  expect((await manager.fetch(f.bobRoot + "private")).status).toBe(200);
});

test("a lost durable session is refused before a cached token can be sent", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  const auth = manager.authFor(f.alice.webId!);
  loseSession(f, f.alice.webId!);
  const before = f.alice.requests.length;
  await expect(auth.fetch(f.alice.root + "private")).rejects.toThrow("Session expired");
  expect(f.alice.requests.length).toBe(before);
});

test("credential loss during the public challenge cannot reuse a cached token", async () => {
  const f = fixture();
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === f.alice.root + "lost") loseSession(f, f.alice.webId!);
    return transport(request);
  });
  const manager = f.load();
  await manager.add();
  const before = f.alice.requests.length;
  await expect(manager.fetch(f.alice.root + "lost")).rejects.toThrow("Session expired");
  expect(
    f.alice.requests
      .slice(before)
      .filter((r) => r.url.startsWith(f.alice.root))
      .every((r) => !r.headers.has("authorization") && !r.headers.has("dpop")),
  ).toBe(true);
});

test.each([
  "logout",
  "login",
  "restore",
])("a paused expiry check cannot expire a newer %s lifecycle", async (operation) => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  await auth.login();
  const expired = vi.fn();
  auth.on("expired", expired);
  const get = f.storage.sessions.getItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let pause = true;
  f.storage.sessions.getItem.mockImplementation(async (key) => {
    const value = await get(key);
    if (pause && JSON.parse(key)[1] === "active") {
      pause = false;
      ready.resolve();
      await release.promise;
      return null;
    }
    return value;
  });
  const request = auth.fetch("https://foreign.example/private");
  const rejected = expect(request).rejects.toThrow("Session changed");
  await ready.promise;
  if (operation === "logout") await auth.logout();
  else if (operation === "login") await auth.login();
  else await auth.restore();
  release.resolve();
  await rejected;
  expect(expired).not.toHaveBeenCalled();
  if (operation !== "logout") expect((await auth.fetch(f.alice.root + "private")).status).toBe(200);
  auth.dispose?.();
});

test("dispose immediately closes a core whose add UI ignores cancellation", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add();
  const close = vi.spyOn(SessionFence.prototype, "close");
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const getCode = f.options.ui.getCode;
  f.options.ui.getCode = async (...args) => {
    ready.resolve();
    await release.promise;
    return getCode(...args);
  };
  const pending = manager.add({ webId: f.bob.webId });
  const rejected = expect(pending).rejects.toThrow();
  await ready.promise;
  const retained = f.records().find(([, record]) => record.identity?.webId === f.alice.webId)!;
  manager.dispose();
  expect(close).toHaveBeenCalledTimes(2);
  expect(f.values.get(retained[0])).toEqual(retained[1]);
  release.resolve();
  await rejected;
  expect(close).toHaveBeenCalledTimes(2);
});

test.each([
  "replace",
  "remove",
  "failed-add",
])("dispose cancels retiring %s cores and revocation timers", async (operation) => {
  const f = fixture();
  const ready = Promise.withResolvers<void>();
  const transport = globalThis.fetch;
  let revokeSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/revoke")) {
      revokeSignal = request.signal;
      ready.resolve();
      return new Promise<Response>(() => {});
    }
    return transport(request);
  });
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  const old = manager.authFor(f.alice.webId!);
  const disposed = vi.spyOn(old, "dispose");
  const controller = new AbortController();
  if (operation === "failed-add") {
    const write = f.storage.sessions.setItem.getMockImplementation()!;
    f.storage.sessions.setItem.mockImplementation(async (key, value) => {
      await write(key, value);
      if (JSON.parse(key)[1] === "remembered") controller.abort(Error("cancelled"));
    });
  }
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pending =
      operation === "remove"
        ? manager.remove(f.alice.webId!)
        : manager.add(
            { webId: operation === "replace" ? f.alice.webId : f.bob.webId },
            { signal: controller.signal },
          );
    const rejected = expect(pending).rejects.toThrow(
      operation === "failed-add" ? "cancelled" : "disposed",
    );
    await ready.promise;
    expect(vi.getTimerCount()).toBe(1);
    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(disposed).toHaveBeenCalledOnce();
    await rejected;
    expect(revokeSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    if (operation !== "remove") {
      const fresh = f.load();
      expect((await fresh.restoreAll()).map((i) => i.webId)).toEqual([f.alice.webId]);
      expect((await fresh.fetch(f.alice.root + "private")).status).toBe(200);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("a stale manager retires both its local scope and the remembered replacement when adding again", async () => {
  const f = fixture();
  const first = f.load();
  await first.add();
  const stale = f.load();
  await stale.restoreAll();
  await first.add();
  await stale.add();
  expect(f.records()).toHaveLength(1);
  expect((await stale.fetch(f.alice.root + "private")).status).toBe(200);
  expect(await f.load().restoreAll()).toHaveLength(1);
});

test("an earlier failed request cannot expire a new login after logout", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://foreign.example/delayed") {
      ready.resolve();
      await release.promise;
      throw Error("old transport error");
    }
    return transport(request);
  });
  const auth = createPodAuth(f.options);
  await auth.login();
  const expired = vi.fn();
  auth.on("expired", expired);
  const rejected = expect(auth.fetch("https://foreign.example/delayed")).rejects.toThrow(
    "old transport error",
  );
  await ready.promise;
  await auth.logout();
  await auth.login();
  release.resolve();
  await rejected;
  expect(expired).not.toHaveBeenCalled();
  expect((await auth.fetch(f.alice.root + "private")).status).toBe(200);
  auth.dispose?.();
});

test("a credential upgrade paused in expiry validation cannot publish across logout and re-login", async () => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  await auth.login();
  const get = f.storage.sessions.getItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let reads = 0;
  f.storage.sessions.getItem.mockImplementation(async (key) => {
    const value = await get(key);
    if (JSON.parse(key)[1] === "active" && ++reads === 2) {
      ready.resolve();
      await release.promise;
      return null;
    }
    return value;
  });
  const expired = vi.fn();
  auth.on("expired", expired);
  const before = f.alice.stats.accepted;
  const rejected = expect(auth.fetch(f.alice.root + "private")).rejects.toThrow("Session changed");
  await ready.promise;
  await auth.logout();
  await auth.login();
  release.resolve();
  await rejected;
  expect(expired).not.toHaveBeenCalled();
  expect(f.alice.stats.accepted).toBe(before);
  const retained = structuredClone([...f.values]);
  auth.dispose?.();
  await expect(auth.logout()).rejects.toThrow("disposed");
  expect([...f.values]).toEqual(retained);
  const fresh = createPodAuth(f.options);
  expect((await fresh.restore())?.webId).toBe(f.alice.webId);
  fresh.dispose?.();
});

test.each(["login", "logout"])("expiry validation ignores an in-flight %s", async (operation) => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  await auth.login();
  const get = f.storage.sessions.getItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let pause = true;
  f.storage.sessions.getItem.mockImplementation(async (key) => {
    const value = await get(key);
    if (pause && JSON.parse(key)[1] === "active") {
      pause = false;
      ready.resolve();
      await release.promise;
      return null;
    }
    return value;
  });
  const expired = vi.fn();
  auth.on("expired", expired);
  const rejected = expect(auth.fetch("https://foreign.example/check")).rejects.toThrow(
    "Session changed",
  );
  await ready.promise;
  const underway = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  let action: Promise<unknown>;
  if (operation === "login") {
    await auth.logout();
    const getCode = f.options.ui.getCode;
    f.options.ui.getCode = async (...args) => {
      underway.resolve();
      await finish.promise;
      return getCode(...args);
    };
    action = auth.login();
  } else {
    const remove = f.storage.sessions.removeItem.getMockImplementation()!;
    f.storage.sessions.removeItem.mockImplementation(async (key) => {
      if (JSON.parse(key)[1] === "active") {
        underway.resolve();
        await finish.promise;
      }
      await remove(key);
    });
    action = auth.logout();
  }
  await underway.promise;
  release.resolve();
  await rejected;
  expect(expired).not.toHaveBeenCalled();
  finish.resolve();
  await action;
  auth.dispose?.();
});

test("durable checks validate this identity when another core changed the shared active pointer", async () => {
  const f = fixture();
  const alice = createPodAuth(f.options),
    bob = createPodAuth(f.options);
  await alice.login({ webId: f.alice.webId });
  await bob.login({ webId: f.bob.webId });
  loseSession(f, f.alice.webId!);
  const expired = vi.fn();
  alice.on("expired", expired);
  await expect(alice.fetch(f.alice.root + "private")).rejects.toThrow("Session expired");
  expect(expired).toHaveBeenCalledOnce();
  // Unscoped single-session cores share a fence. Independent manager accounts have separate scopes.
  expect(await bob.identity()).toBeNull();
  expect((await bob.fetch(f.bobRoot + "private")).status).toBe(401);
  await bob.login({ webId: f.bob.webId });
  expect((await bob.fetch(f.bobRoot + "private")).status).toBe(200);
  alice.dispose?.();
  bob.dispose?.();
});

test("parallel fetch during refresh rotation sees a durable record and keeps the account", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  const [key, previous] = f
    .records()
    .find(([, record]) => record.identity?.webId === f.alice.webId)!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const write = f.storage.sessions.setItem.getMockImplementation()!;
  let paused = false;
  f.storage.sessions.setItem.mockImplementation(async (slot, value) => {
    if (
      !paused &&
      slot === key &&
      "refreshToken" in value &&
      value.refreshToken !== previous.refreshToken
    ) {
      paused = true;
      ready.resolve();
      await release.promise;
    }
    await write(slot, value);
  });
  const expired = vi.fn();
  manager.on("expired", expired);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
  const first = manager.fetchFor(f.alice.webId!)(f.alice.root + "rotation-first");
  const observedFirst = Promise.allSettled([first]);
  let second: Promise<Response> | undefined;
  try {
    await ready.promise;
    expect(f.values.get(key)).toEqual(previous);
    const get = f.storage.sessions.getItem.getMockImplementation()!;
    const reached = Promise.withResolvers<{} | null>();
    f.storage.sessions.getItem.mockImplementation(async (slot) => {
      const value = await get(slot);
      if (slot === key) reached.resolve(value);
      return value;
    });
    second = manager.fetchFor(f.alice.webId!)(f.alice.root + "rotation-second");
    expect(await reached.promise).toEqual(previous);
    expect(expired).not.toHaveBeenCalled();
    expect(manager.accounts()).toHaveLength(2);
    release.resolve();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(f.alice.stats.refreshes).toBe(1);
    expect(f.alice.stats.reuse).toBe(0);
    expect(f.records()).toHaveLength(2);
    expect(expired).not.toHaveBeenCalled();
    expect((await manager.fetchFor(f.bob.webId!)(f.bobRoot + "private")).status).toBe(200);
  } finally {
    release.resolve();
    await observedFirst;
    if (second) await Promise.allSettled([second]);
  }
});

test("expiry invalidates cached credentials and stays latched through restore and failed login", async () => {
  const f = fixture();
  const auth = createPodAuth({
    ...f.options,
    boundary: { roots: [f.alice.root], automatic: false },
  });
  try {
    await auth.login();
    expect((await auth.fetch(f.alice.root + "before")).status).toBe(200);
    const originalToken = f.alice.requests
      .findLast((request) => request.headers.has("authorization"))!
      .headers.get("authorization");
    const stored = structuredClone([...f.values]);
    loseSession(f, f.alice.webId!);
    const expired = vi.fn();
    auth.on("expired", expired);
    await expect(auth.fetch(f.alice.root + "lost")).rejects.toThrow("Session expired");
    const generation = [...f.values].find(([key]) => JSON.parse(key)[1] === "generation")!;
    expect(generation[1]).toBeGreaterThan(0);
    // Even resurrecting the old public pointer and credential must not revive cached authority.
    for (const [key, value] of stored)
      if (JSON.parse(key)[1] !== "generation") f.values.set(key, value);
    const requests = f.alice.requests.length;
    await expect(auth.fetch(f.alice.root + "again")).rejects.toThrow("Session expired");
    expect(await auth.restore()).toBeNull();
    expect(f.alice.requests.length).toBe(requests);
    const getCode = f.options.ui.getCode;
    f.options.ui.getCode = async () => {
      throw Error("login cancelled");
    };
    await expect(auth.login()).rejects.toThrow("login cancelled");
    await expect(auth.fetch(f.alice.root + "still-expired")).rejects.toThrow("Session expired");
    expect(await auth.identity()).toBeNull();
    f.options.ui.getCode = getCode;
    const cancel = new AbortController();
    const stop = auth.on("login", () => cancel.abort(Error("cancelled after grant")));
    await expect(auth.login(undefined, { signal: cancel.signal })).rejects.toThrow(
      "cancelled after grant",
    );
    stop();
    await expect(auth.fetch(f.alice.root + "cancelled-grant")).rejects.toThrow("Session expired");
    let fromLogin: Promise<Response> | undefined;
    auth.on("login", () => {
      fromLogin = auth.fetch(f.alice.root + "login-observer");
    });
    await auth.login();
    expect((await fromLogin)?.status).toBe(200);
    expect((await auth.fetch(f.alice.root + "after")).status).toBe(200);
    expect(
      f.alice.requests
        .findLast((request) => request.headers.has("authorization"))!
        .headers.get("authorization"),
    ).not.toBe(originalToken);
    expect(expired).toHaveBeenCalledOnce();
  } finally {
    auth.dispose?.();
  }
});

test("login from the expiry observer waits for session generation invalidation", async () => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let relogin: Promise<unknown> | undefined;
  try {
    await auth.login();
    loseSession(f, f.alice.webId!);
    const write = f.storage.sessions.setItem.getMockImplementation()!;
    let paused = false;
    f.storage.sessions.setItem.mockImplementation(async (key, value) => {
      if (!paused && JSON.parse(key)[1] === "generation") {
        paused = true;
        ready.resolve();
        await release.promise;
      }
      await write(key, value);
    });
    auth.on("expired", () => {
      relogin = auth.login();
    });
    const rejected = expect(auth.fetch(f.alice.root + "expired")).rejects.toThrow(
      "Session expired",
    );
    await ready.promise;
    expect(f.alice.stats.authorizations).toBe(1);
    release.resolve();
    await rejected;
    await relogin;
    expect(f.alice.stats.authorizations).toBe(2);
    expect((await auth.fetch(f.alice.root + "fresh")).status).toBe(200);
  } finally {
    release.resolve();
    await relogin;
    auth.dispose?.();
  }
});

test("dispose during remembered-list loading creates no cores and starts no refresh", async () => {
  const f = fixture();
  const first = f.load();
  await first.add();
  first.dispose();
  const fresh = f.load();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const get = f.storage.sessions.getItem.getMockImplementation()!;
  f.storage.sessions.getItem.mockImplementation(async (key) => {
    const value = await get(key);
    if (JSON.parse(key)[1] === "remembered") {
      ready.resolve();
      await release.promise;
    }
    return value;
  });
  const uuid = vi.spyOn(crypto, "randomUUID");
  const channels: { close: ReturnType<typeof vi.fn> }[] = [];
  class Channel {
    close = vi.fn();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const reads = f.storage.sessions.getItem.mock.calls.length;
  const restoring = fresh.restoreAll();
  const rejected = expect(restoring).rejects.toThrow("disposed");
  await ready.promise;
  fresh.dispose();
  release.resolve();
  await rejected;
  expect(channels).toEqual([]);
  expect(uuid).not.toHaveBeenCalled();
  expect(f.alice.stats.refreshes).toBe(0);
  expect(f.storage.sessions.getItem.mock.calls.length - reads).toBe(1);
  expect(fresh.accounts()).toEqual([]);
});

test("restore propagates caller cancellation into an in-flight refresh", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>();
  const transport = globalThis.fetch;
  let pause = false;
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (pause && request.url === f.alice.issuer + "token") {
      requestSignal = request.signal;
      ready.resolve();
      return new Promise<Response>((_resolve, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason), {
          once: true,
        }),
      );
    }
    return transport(request);
  });
  const original = createPodAuth(f.options),
    restored = createPodAuth(f.options);
  try {
    await original.login();
    const controller = new AbortController();
    pause = true;
    const rejected = expect(restored.restore({ signal: controller.signal })).rejects.toThrow(
      "restore cancelled",
    );
    await ready.promise;
    controller.abort(Error("restore cancelled"));
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(await restored.identity()).toBeNull();
    await expect(restored.restore({ signal: controller.signal })).rejects.toThrow(
      "restore cancelled",
    );
    pause = false;
    expect((await restored.restore())?.webId).toBe(f.alice.webId);
    expect(f.alice.stats.refreshes).toBe(1);
  } finally {
    original.dispose?.();
    restored.dispose?.();
  }
});

test("logout during restore's first generation read prevents any refresh", async () => {
  const f = fixture();
  const auth = createPodAuth(f.options);
  await auth.login();
  const get = f.storage.sessions.getItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let paused = false;
  f.storage.sessions.getItem.mockImplementation(async (key) => {
    const value = await get(key);
    if (!paused && JSON.parse(key)[1] === "generation") {
      paused = true;
      ready.resolve();
      await release.promise;
    }
    return value;
  });
  const restoring = auth.restore();
  try {
    await ready.promise;
    await auth.logout();
    release.resolve();
    expect(await restoring).toBeNull();
    expect(f.alice.stats.refreshes).toBe(0);
  } finally {
    release.resolve();
    await restoring;
    auth.dispose?.();
  }
});

test("an expired restore cannot emit expiry after logout supersedes pointer cleanup", async () => {
  const f = fixture();
  const original = createPodAuth(f.options),
    restored = createPodAuth(f.options);
  await original.login();
  f.alice.failRefresh("invalid_grant");
  const remove = f.storage.sessions.removeItem.getMockImplementation()!;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let paused = false;
  f.storage.sessions.removeItem.mockImplementation(async (key) => {
    if (!paused && JSON.parse(key)[1] === "active") {
      paused = true;
      ready.resolve();
      await release.promise;
    }
    await remove(key);
  });
  const expired = vi.fn();
  restored.on("expired", expired);
  const restoring = restored.restore();
  try {
    await ready.promise;
    await restored.logout();
    release.resolve();
    expect(await restoring).toBeNull();
    expect(expired).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await restoring;
    original.dispose?.();
    restored.dispose?.();
  }
});

test("failed expiry fencing cannot fall back to a cached token during re-login", async () => {
  const f = fixture();
  const auth = createPodAuth({
    ...f.options,
    boundary: { roots: [f.alice.root], automatic: false },
  });
  try {
    await auth.login();
    loseSession(f, f.alice.webId!);
    const write = f.storage.sessions.setItem.getMockImplementation()!;
    f.storage.sessions.setItem.mockImplementation(async (key, value) => {
      if (JSON.parse(key)[1] === "generation") throw Error("fence write denied");
      await write(key, value);
    });
    const before = f.alice.requests.length;
    await expect(auth.fetch(f.alice.root + "expired")).rejects.toThrow("Session storage failed");
    f.storage.sessions.setItem.mockImplementation(write);
    await expect(auth.login()).rejects.toThrow("Session storage failed");
    await expect(auth.fetch(f.alice.root + "cached")).rejects.toThrow("Session expired");
    expect(f.alice.requests.length).toBe(before);
    expect(await auth.identity()).toBeNull();
  } finally {
    auth.dispose?.();
  }
});
