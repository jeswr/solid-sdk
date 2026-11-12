// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, OwnershipChangedError, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The mock profile document lists the OP for its own URL, so this WebID has no fragment.
const bob = "https://id.example/bob";

function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp({ refreshTokens: true, revocation: true, ...config });
  vi.stubGlobal("fetch", op.fetch);
  const values = new Map<string, {}>();
  const sessions = {
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: {}) => {
      values.set(key, structuredClone(value));
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions, caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  };
  const load = (ui: Partial<PodAuthOptions["ui"]> = {}) =>
    createPodAuth({ ...options, ui: { ...options.ui, ...ui } });
  const keyOf = (name: string) =>
    [...values.keys()].find((key) => key.startsWith("[") && JSON.parse(key)[1] === name);
  const named = (name: string) => {
    const key = keyOf(name);
    return key === undefined ? undefined : values.get(key);
  };
  const records = () =>
    [...values.values()].filter((value) => typeof value === "object" && "refreshToken" in value);
  return { op, values, sessions, options, load, keyOf, named, records };
}

/** A popup that stays open until released, as a slow sign-in in another tab would. */
function pausedCode(op: ReturnType<typeof createMockOp>) {
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const getCode = vi.fn(async (url: URL, signal: AbortSignal) => {
    opened.resolve();
    await release.promise;
    return await op.getCode(url, signal);
  });
  return { getCode, opened: opened.promise, release: () => release.resolve() };
}

test("an exact-WebID reauthorization replaces a grant whose refresh persistently fails", async () => {
  const f = fixture();
  const webId = f.op.webId!;
  const first = await f.load().login({ webId });
  f.op.failRefresh("invalid_client");
  const auth = f.load();
  expect(await auth.restore()).toBeNull();
  const remembered = await auth.remembered();
  expect(remembered).toEqual([{ webId, issuer: f.op.issuer }]);
  // Renewal redeems the same refresh credential again, so a plain login stays locked out.
  await expect(auth.login({ webId })).rejects.toThrow("unexpected HTTP status code");
  expect(f.op.stats.authorizations).toBe(1);
  const replaced = await auth.login({ webId }, { reauthorize: true, expectRemembered: remembered });
  expect(replaced).toMatchObject({ webId, issuer: f.op.issuer });
  expect(replaced.grantId).not.toBe(first.grantId);
  expect(f.op.stats.authorizations).toBe(2);
  expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
  expect(await auth.remembered()).toEqual(remembered);
  expect(f.named("owner")).toMatchObject({ webId, grantId: replaced.grantId });
  f.op.failRefresh();
  await expect(f.load().restore()).resolves.toMatchObject({ grantId: replaced.grantId });
  // The replaced grant stays catalogued, so logout revokes it as well.
  await auth.logout();
  expect(f.op.stats.revocations).toBe(2);
  expect(f.records()).toEqual([]);
});

test("a reauthorization with no stored grant authorizes once", async () => {
  const f = fixture();
  const auth = f.load();
  await expect(
    auth.login({ webId: f.op.webId! }, { reauthorize: true, expectRemembered: [] }),
  ).resolves.toMatchObject({ webId: f.op.webId });
  expect(f.op.stats.authorizations).toBe(1);
});

test.each([
  "pointer",
  "owner",
])("reauthorization refuses before authorization when the %s names another account", async (record) => {
  const f = fixture();
  await f.load().login({ webId: f.op.webId! });
  if (record === "owner") f.values.delete(f.keyOf("active")!);
  const saved = structuredClone([...f.values]);
  const getCode = vi.fn(f.op.getCode);
  const auth = f.load({ getCode });
  await expect(auth.login({ webId: bob }, { reauthorize: true })).rejects.toBeInstanceOf(
    OwnershipChangedError,
  );
  expect(getCode).not.toHaveBeenCalled();
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toBeNull();
});

test("reauthorization requires a WebID hint", async () => {
  const f = fixture();
  await expect(
    f.load().login({ issuer: f.op.issuer }, { reauthorize: true }),
  ).rejects.toBeInstanceOf(TypeError);
  expect(f.op.stats.authorizations).toBe(0);
});

test.each([
  ["an object", {}],
  [
    "two accounts",
    [
      { webId: bob, issuer: "https://op.example/" },
      { webId: bob, issuer: "x" },
    ],
  ],
  ["a missing issuer", [{ webId: bob }]],
  ["a missing entry", [null]],
])("expectRemembered rejects %s", async (_name, expectRemembered) => {
  const f = fixture();
  await expect(
    f
      .load()
      .login(
        { webId: f.op.webId! },
        { expectRemembered: expectRemembered as { webId: string; issuer: string }[] },
      ),
  ).rejects.toThrow("expectRemembered must be a remembered() result");
  expect(f.op.stats.authorizations).toBe(0);
});

test.each([
  "empty",
  "remembered",
])("a stale observation refuses before authorization; observed=%s", async (observed) => {
  const f = fixture();
  if (observed === "empty") await f.load().login({ webId: f.op.webId! });
  const saved = structuredClone([...f.values]);
  const getCode = vi.fn(f.op.getCode);
  const auth = f.load({ getCode });
  await expect(
    auth.login(
      { webId: f.op.webId! },
      { expectRemembered: observed === "empty" ? [] : [{ webId: bob, issuer: f.op.issuer }] },
    ),
  ).rejects.toBeInstanceOf(OwnershipChangedError);
  expect(getCode).not.toHaveBeenCalled();
  expect([...f.values]).toEqual(saved);
});

test("a matching observation logs in and publishes the pointer", async () => {
  const f = fixture();
  const webId = f.op.webId!;
  await f.load().login({ webId });
  f.op.failRefresh("invalid_client");
  const auth = f.load();
  const remembered = await auth.remembered();
  f.op.failRefresh();
  // The stored grant renews; the observation still holds at the pointer write.
  await expect(auth.login({ webId }, { expectRemembered: remembered })).resolves.toMatchObject({
    webId,
  });
  expect(f.op.stats.authorizations).toBe(1);
  expect(await auth.remembered()).toEqual(remembered);
});

function setPointer(f: ReturnType<typeof fixture>, webId: string) {
  // Another tab's pointer write: a well-formed pointer that is not the observed one.
  const namespace = JSON.stringify(["pod-auth", f.options.clientId, f.options.redirectUri]);
  f.values.set(JSON.stringify([namespace + ":sessions", "active"]), {
    webId,
    issuer: f.op.issuer,
    selected: {},
    requestUrl: f.op.root,
    context: "elsewhere",
  });
}

test.each([
  "another sign-in",
  "a pointer change",
])("%s while the popup is open makes the guarded commit fail and keeps the newer session", async (change) => {
  const f = fixture();
  const popup = pausedCode(f.op);
  const auth = f.load({ getCode: popup.getCode });
  const signingIn = auth.login({ webId: f.op.webId! }, { expectRemembered: [] });
  const failure = expect(signingIn).rejects.toBeInstanceOf(OwnershipChangedError);
  await popup.opened;
  const other = f.load();
  const newer = change === "another sign-in" ? await other.login({ issuer: f.op.issuer }) : null;
  if (newer === null) setPointer(f, bob);
  const saved = structuredClone([...f.values]);
  popup.release();
  await failure;
  // Nothing from the rejected attempt was published.
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toBeNull();
  expect(f.op.stats.revocations).toBe(0);
  if (newer !== null) {
    expect(await other.identity()).toEqual(newer);
    expect((await other.fetch(f.op.root + "private")).status).toBe(200);
    await expect(f.load().restore()).resolves.toMatchObject({ grantId: newer.grantId });
  }
});

/** Pauses the next login after its credential write, at its next fence read outside the lock. */
function pauseAfterCredentialWrite(f: ReturnType<typeof fixture>) {
  let armed = true;
  let written = false;
  const paused = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const get = f.sessions.getItem.getMockImplementation()!;
  const set = f.sessions.setItem.getMockImplementation()!;
  f.sessions.setItem.mockImplementation(async (key, value) => {
    await set(key, value);
    if (armed && "refreshToken" in value) written = true;
  });
  f.sessions.getItem.mockImplementation(async (key) => {
    if (armed && written && key.includes("pod-auth:fence:")) {
      armed = false;
      paused.resolve();
      await resume.promise;
    }
    return await get(key);
  });
  return { paused: paused.promise, resume: () => resume.resolve() };
}

test.each([
  "same-context reauthorization",
  "pointer change",
  "same-context renewal",
])("a %s between the credential commit and the pointer write is decided at the pointer write", async (change) => {
  const f = fixture();
  const pause = pauseAfterCredentialWrite(f);
  const webId = f.op.webId!;
  const auth = f.load();
  const signingIn = auth.login({ webId }, { expectRemembered: [] });
  await pause.paused;
  expect(f.records()).toHaveLength(1);
  const other = f.load();
  let newer = null;
  if (change === "pointer change") setPointer(f, bob);
  else
    newer = await other.login(
      { webId },
      change === "same-context reauthorization" ? { reauthorize: true } : {},
    );
  pause.resume();
  if (change === "same-context renewal") {
    // The other tab renewed this attempt's own grant and wrote the same pointer: no conflict.
    const identity = await signingIn;
    expect(identity.grantId).toBe(newer!.grantId);
    expect(f.records()).toHaveLength(1);
    expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
    expect((await other.fetch(f.op.root + "private")).status).toBe(200);
    return;
  }
  await expect(signingIn).rejects.toBeInstanceOf(OwnershipChangedError);
  expect(await auth.identity()).toBeNull();
  expect(f.op.stats.revocations).toBe(0);
  if (newer === null) {
    // The owner this attempt published reverts to none; its catalogue entry and record are gone.
    expect(f.records()).toEqual([]);
    expect(f.named("owner")).toBeUndefined();
    expect(f.named("accounts")).toBeUndefined();
    return;
  }
  // The newer grant replaced this attempt's entry for the shared context, and stays intact.
  expect(f.records()).toHaveLength(1);
  expect(f.named("owner")).toMatchObject({ grantId: newer.grantId });
  expect(f.named("accounts")).toEqual([
    expect.objectContaining({ webId, key: expect.any(String) }),
  ]);
  expect((await other.fetch(f.op.root + "private")).status).toBe(200);
  await expect(f.load().restore()).resolves.toMatchObject({ grantId: newer.grantId });
});

test("a rejected reauthorization keeps the displaced grant revocable when a newer grant took its context", async () => {
  const f = fixture();
  const webId = f.op.webId!;
  await f.load().login({ webId });
  f.op.failRefresh("invalid_client");
  const pause = pauseAfterCredentialWrite(f);
  const auth = f.load();
  const signingIn = auth.login({ webId }, { reauthorize: true });
  await pause.paused;
  const other = f.load();
  const newer = await other.login({ webId }, { reauthorize: true });
  pause.resume();
  await expect(signingIn).rejects.toBeInstanceOf(OwnershipChangedError);
  // The original grant (displaced by this attempt) and the newer grant remain; this attempt's is gone.
  expect(f.records()).toHaveLength(2);
  expect(f.named("owner")).toMatchObject({ grantId: newer.grantId });
  await other.logout();
  expect(f.op.stats.revocations).toBe(2);
  expect(f.records()).toEqual([]);
});

test("a rejected identity discards only its own grant and keeps another context's grant", async () => {
  const f = fixture();
  const alice = await f.load().login({ issuer: f.op.issuer });
  const saved = structuredClone([...f.values]);
  const auth = f.load();
  // The OP authenticates Alice for a sign-in that named Bob.
  await expect(auth.login({ webId: bob })).rejects.toThrow("selected account");
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toBeNull();
  expect(f.op.stats.revocations).toBe(0);
  await expect(f.load().restore()).resolves.toMatchObject({ grantId: alice.grantId });
});

test("a rejected reauthorization restores the grant it displaced", async () => {
  const f = fixture();
  const webId = f.op.webId!;
  const alice = await f.load().login({ webId });
  const saved = structuredClone([...f.values]);
  const auth = f.load();
  // The new grant installs under the same context, then its pointer write meets a changed owner.
  const set = f.sessions.setItem.getMockImplementation()!;
  let displaced = false;
  f.sessions.setItem.mockImplementation(async (key, value) => {
    await set(key, value);
    if (!displaced && "refreshToken" in value) {
      displaced = true;
      const owner = f.keyOf("owner")!;
      f.values.set(owner, { ...f.values.get(owner), grantId: "another grant" });
    }
  });
  await expect(auth.login({ webId }, { reauthorize: true })).rejects.toBeInstanceOf(
    OwnershipChangedError,
  );
  const owner = f.keyOf("owner")!;
  f.values.set(owner, saved.find(([key]) => key === owner)![1]);
  expect([...f.values]).toEqual(saved);
  f.sessions.setItem.mockImplementation(set);
  await expect(f.load().restore()).resolves.toMatchObject({ grantId: alice.grantId });
});

test.each([
  ["access-only", { refreshTokens: false }],
  ["issuer-only", { webId: null }],
])("a rejected %s identity leaves no grant or owner", async (_name, config) => {
  const f = fixture(config);
  const auth = f.load();
  await expect(auth.login({ webId: bob })).rejects.toThrow("selected account");
  expect(await auth.identity()).toBeNull();
  expect(f.named("owner")).toBeUndefined();
  expect(f.records()).toEqual([]);
  await expect(auth.login({ issuer: f.op.issuer })).resolves.toMatchObject({
    issuer: f.op.issuer,
  });
});

test("guarded logins are never shared with a concurrent login", async () => {
  const f = fixture();
  const popup = pausedCode(f.op);
  const auth = f.load({ getCode: popup.getCode });
  const webId = f.op.webId!;
  const plain = auth.login({ webId });
  await expect(auth.login({ webId }, { expectRemembered: [] })).rejects.toThrow(
    "Another login is in progress",
  );
  popup.release();
  await plain;
  await auth.logout();
  const guarded = auth.login({ webId }, { reauthorize: true });
  await expect(auth.login({ webId })).rejects.toThrow("Another login is in progress");
  await guarded;
});
