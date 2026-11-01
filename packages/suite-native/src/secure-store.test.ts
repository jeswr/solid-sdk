// AUTHORED-BY GPT-5.6 Codex
import { describe, expect, test, vi } from "vitest";
import {
  createSecureStore,
  refreshTokenKey,
  SecureStoreError,
  type SecureStoreErrorCode,
  type SecureStorePlugin,
  type SecureStoreSetOptions,
  SuiteNativeError,
} from "./index.js";

const key = "pod-auth:refresh:account";
const options = { userPresence: true, version: 0 };
const codes: SecureStoreErrorCode[] = [
  "cancelled",
  "background",
  "lockout",
  "unavailable",
  "stale",
  "full",
  "invalid",
  "failed",
];
const badVersions = [undefined, null, "0", true, -1, 0.5, NaN, Infinity, 2 ** 53];
const nonObjects = [undefined, null, true, 1, "native detail", []];

function plugin() {
  return {
    status: vi.fn<SecureStorePlugin["status"]>().mockResolvedValue({
      available: true,
      userPresence: true,
      hardwareBacked: true,
    }),
    get: vi.fn<SecureStorePlugin["get"]>().mockResolvedValue({ value: null, version: 0 }),
    set: vi.fn<SecureStorePlugin["set"]>().mockResolvedValue({ version: 1 }),
    remove: vi.fn<SecureStorePlugin["remove"]>().mockResolvedValue({}),
    clear: vi.fn<SecureStorePlugin["clear"]>().mockResolvedValue({}),
    cancel: vi.fn<SecureStorePlugin["cancel"]>().mockResolvedValue({}),
  };
}

async function rejectsCode(promise: Promise<unknown>, code: SecureStoreErrorCode) {
  const error = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(SecureStoreError);
  expect(error).toBeInstanceOf(SuiteNativeError);
  expect(error).toMatchObject({ name: "SecureStoreError", code, message: code });
  expect((error as Error).cause).toBeUndefined();
}

describe("createSecureStore", () => {
  test("reports capabilities without prompting and threads read and committed versions", async () => {
    const p = plugin();
    const store = createSecureStore(p);
    expect(await store.status()).toEqual({
      available: true,
      userPresence: true,
      hardwareBacked: true,
    });
    expect(p.get).not.toHaveBeenCalled();
    expect(await store.get(key)).toEqual({ value: null, version: 0 });
    expect(p.get).toHaveBeenCalledExactlyOnceWith({ key });
    expect(await store.set(key, "token", options)).toEqual({ version: 1 });
    expect(p.set).toHaveBeenCalledExactlyOnceWith({ key, value: "token", ...options });
    p.get.mockResolvedValue({ value: "token", version: 1 });
    expect(await store.get(key)).toEqual({ value: "token", version: 1 });
    p.set.mockResolvedValue({ version: 2 });
    expect(await store.set(key, "rotated", { userPresence: false, version: 1 })).toEqual({
      version: 2,
    });
    expect(p.set).toHaveBeenLastCalledWith({
      key,
      value: "rotated",
      userPresence: false,
      version: 1,
    });
    expect(await store.delete(key)).toBeUndefined();
    expect(p.remove).toHaveBeenCalledExactlyOnceWith({ key });
    expect(await store.clear()).toBeUndefined();
    expect(p.clear).toHaveBeenCalledExactlyOnceWith();
    expect(await store.cancel()).toBeUndefined();
    expect(p.cancel).toHaveBeenCalledExactlyOnceWith();
  });

  test("accepts false capabilities, empty values, tombstones and safe-integer version limits", async () => {
    const p = plugin();
    p.status.mockResolvedValue({ available: false, userPresence: false, hardwareBacked: false });
    const store = createSecureStore(p);
    expect(await store.status()).toEqual({
      available: false,
      userPresence: false,
      hardwareBacked: false,
    });
    p.get.mockResolvedValue({ value: "", version: Number.MAX_SAFE_INTEGER });
    expect(await store.get(key)).toEqual({ value: "", version: Number.MAX_SAFE_INTEGER });
    p.get.mockResolvedValue({ value: null, version: 10 });
    expect(await store.get(key)).toEqual({ value: null, version: 10 });
    p.set.mockResolvedValue({ version: Number.MAX_SAFE_INTEGER });
    expect(
      await store.set(key, "", { userPresence: false, version: Number.MAX_SAFE_INTEGER - 1 }),
    ).toEqual({ version: Number.MAX_SAFE_INTEGER });
    p.set.mockRejectedValue({ code: "failed" });
    await rejectsCode(
      store.set(key, "", { userPresence: false, version: Number.MAX_SAFE_INTEGER }),
      "failed",
    );
    expect(p.set).toHaveBeenLastCalledWith({
      key,
      value: "",
      userPresence: false,
      version: Number.MAX_SAFE_INTEGER,
    });
  });

  test.each(["0", "a", "a:._-09", "a".repeat(128)])("accepts key %s", async (key) => {
    const p = plugin();
    const store = createSecureStore(p);
    await store.get(key);
    await store.set(key, "token", options);
    await store.delete(key);
    expect(p.get).toHaveBeenCalledWith({ key });
    expect(p.set).toHaveBeenCalledWith({ key, value: "token", ...options });
    expect(p.remove).toHaveBeenCalledWith({ key });
  });

  test.each([
    undefined,
    null,
    1,
    {},
    "",
    "A",
    ":a",
    ".a",
    "-a",
    "_a",
    "a/b",
    "a b",
    "a\n",
    "a\r\n",
    "a\u0000",
    "é",
    "a".repeat(129),
  ])("rejects invalid key %j before the bridge", async (bad) => {
    const p = plugin();
    const store = createSecureStore(p);
    await rejectsCode(store.get(bad as string), "invalid");
    await rejectsCode(store.set(bad as string, "token", options), "invalid");
    await rejectsCode(store.delete(bad as string), "invalid");
    expect(p.get).not.toHaveBeenCalled();
    expect(p.set).not.toHaveBeenCalled();
    expect(p.remove).not.toHaveBeenCalled();
  });

  test.each([
    "",
    "a".repeat(16 * 1024),
    "é".repeat(8192),
    "💾".repeat(4096),
  ])("accepts values within 16 KiB of UTF-8", async (value) => {
    const p = plugin();
    await createSecureStore(p).set(key, value, options);
    expect(p.set).toHaveBeenCalledWith({ key, value, ...options });
  });

  test.each([
    undefined,
    null,
    1,
    {},
    "a".repeat(16 * 1024 + 1),
    `${"é".repeat(8192)}a`,
    `${"💾".repeat(4096)}a`,
  ])("rejects invalid or oversized values before the bridge", async (value) => {
    const p = plugin();
    await rejectsCode(createSecureStore(p).set(key, value as string, options), "invalid");
    expect(p.set).not.toHaveBeenCalled();
  });

  test.each(badVersions)("rejects input version %s before the bridge", async (version) => {
    const p = plugin();
    await rejectsCode(
      createSecureStore(p).set(key, "token", { userPresence: true, version: version as number }),
      "invalid",
    );
    expect(p.set).not.toHaveBeenCalled();
  });

  test.each([
    undefined,
    null,
    {},
    { version: 0 },
    { userPresence: "true", version: 0 },
  ])("rejects missing or non-boolean userPresence %j before the bridge", async (options) => {
    const p = plugin();
    await rejectsCode(
      createSecureStore(p).set(key, "token", options as SecureStoreSetOptions),
      "invalid",
    );
    expect(p.set).not.toHaveBeenCalled();
  });

  test.each([
    ...nonObjects,
    {},
    { available: true, userPresence: true },
    { available: "true", userPresence: true, hardwareBacked: true },
    { available: true, userPresence: 1, hardwareBacked: true },
    { available: true, userPresence: true, hardwareBacked: null },
    { available: true, userPresence: true, hardwareBacked: true, detail: "native detail" },
    { available: true, userPresence: true, wrong: true },
    Object.assign([], { available: true, userPresence: true, hardwareBacked: true }),
    Object.create({ available: true, userPresence: true, hardwareBacked: true }),
  ])("rejects malformed status %j", async (response) => {
    const p = plugin();
    p.status.mockResolvedValue(response as Awaited<ReturnType<SecureStorePlugin["status"]>>);
    await rejectsCode(createSecureStore(p).status(), "failed");
  });

  test.each([
    ...nonObjects,
    {},
    { value: "token" },
    { value: undefined, version: 0 },
    { value: 1, version: 1 },
    { value: false, version: 1 },
    { value: "a".repeat(16 * 1024 + 1), version: 1 },
    { value: `${"é".repeat(8192)}a`, version: 1 },
    { value: null, version: 0, detail: "native detail" },
    { value: null, wrong: 0 },
    ...badVersions.map((version) => ({ value: null, version })),
  ])("rejects malformed get response %#", async (response) => {
    const p = plugin();
    p.get.mockResolvedValue(response as Awaited<ReturnType<SecureStorePlugin["get"]>>);
    await rejectsCode(createSecureStore(p).get(key), "failed");
  });

  test.each([
    ...nonObjects,
    {},
    { version: 0 },
    { version: 1, detail: "native detail" },
    { wrong: 1 },
    ...badVersions.map((version) => ({ version })),
  ])("rejects malformed set %j", async (response) => {
    const p = plugin();
    p.set.mockResolvedValue(response as { version: number });
    await rejectsCode(createSecureStore(p).set(key, "token", options), "failed");
  });

  test("rejects a committed version that did not increase", async () => {
    const p = plugin();
    p.set.mockResolvedValue({ version: 1 });
    await rejectsCode(
      createSecureStore(p).set(key, "token", { userPresence: true, version: 2 }),
      "failed",
    );
  });

  test.each([
    ...nonObjects,
    { detail: "native detail" },
  ])("rejects malformed remove, clear and cancel %j", async (response) => {
    const p = plugin();
    p.remove.mockResolvedValue(response as Record<string, never>);
    p.clear.mockResolvedValue(response as Record<string, never>);
    p.cancel.mockResolvedValue(response as Record<string, never>);
    const store = createSecureStore(p);
    await rejectsCode(store.delete(key), "failed");
    await rejectsCode(store.clear(), "failed");
    await rejectsCode(store.cancel(), "failed");
  });

  test.each(codes)("maps %s on every method without exposing native detail", async (code) => {
    const p = plugin();
    for (const method of Object.values(p)) {
      method.mockRejectedValue({ code, message: "secret native detail", cause: "secret" });
    }
    const store = createSecureStore(p);
    await rejectsCode(store.status(), code);
    await rejectsCode(store.get(key), code);
    await rejectsCode(store.set(key, "token", options), code);
    await rejectsCode(store.delete(key), code);
    await rejectsCode(store.clear(), code);
    await rejectsCode(store.cancel(), code);
  });

  test.each([
    undefined,
    null,
    "cancelled",
    new Error("secret native detail"),
    {},
    { code: "UNKNOWN", message: "secret native detail" },
    { code: "toString" },
    { code: 1 },
    { code: null },
  ])("maps unknown native rejection %j to failed", async (error) => {
    const p = plugin();
    p.get.mockRejectedValue(error);
    await rejectsCode(createSecureStore(p).get(key), "failed");
  });

  test("sanitises synchronous plugin failures", async () => {
    const p = plugin();
    p.get.mockImplementation(() => {
      throw new Error("secret native detail");
    });
    await rejectsCode(createSecureStore(p).get(key), "failed");
  });

  test("sanitises native rejections whose code accessor throws", async () => {
    const p = plugin();
    p.get.mockRejectedValue({
      get code() {
        throw new Error("secret native detail");
      },
    });
    await rejectsCode(createSecureStore(p).get(key), "failed");
  });
});

describe("secure-store abort", () => {
  test("an already-aborted signal never calls get or cancel", async () => {
    const p = plugin();
    const controller = new AbortController();
    controller.abort(new Error("private abort reason"));
    await rejectsCode(createSecureStore(p).get(key, controller.signal), "cancelled");
    expect(p.get).not.toHaveBeenCalled();
    expect(p.cancel).not.toHaveBeenCalled();
  });

  test.each(["resolve", "reject"])("aborts immediately and drops a late %s", async (late) => {
    const p = plugin();
    const deferred = Promise.withResolvers<{ value: string | null; version: number }>();
    p.get.mockReturnValue(deferred.promise);
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const read = createSecureStore(p).get(key, controller.signal);
    controller.abort(new Error("private abort reason"));
    await rejectsCode(read, "cancelled");
    expect(p.cancel).toHaveBeenCalledExactlyOnceWith();
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    if (late === "resolve") deferred.resolve({ value: "late secret", version: 1 });
    else deferred.reject({ code: "failed", message: "late native detail" });
    await rejectsCode(read, "cancelled");
  });

  test.each([
    "reject",
    "throw",
    "pending",
    "malformed",
  ])("still cancels locally when native cancel is %s", async (failure) => {
    const p = plugin();
    p.get.mockReturnValue(new Promise(() => {}));
    if (failure === "reject") p.cancel.mockRejectedValue({ code: "failed", message: "secret" });
    if (failure === "throw")
      p.cancel.mockImplementation(() => {
        throw new Error("secret");
      });
    if (failure === "pending") p.cancel.mockReturnValue(new Promise(() => {}));
    if (failure === "malformed") p.cancel.mockResolvedValue(undefined as never);
    const controller = new AbortController();
    const read = createSecureStore(p).get(key, controller.signal);
    controller.abort();
    await rejectsCode(read, "cancelled");
    expect(p.cancel).toHaveBeenCalledExactlyOnceWith();
  });

  test.each([
    "resolve",
    "reject",
    "malformed",
  ])("removes the abort listener after native %s", async (result) => {
    const p = plugin();
    if (result === "reject") p.get.mockRejectedValue({ code: "lockout" });
    if (result === "malformed") p.get.mockResolvedValue(undefined as never);
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const read = createSecureStore(p).get(key, controller.signal);
    if (result === "resolve") expect(await read).toEqual({ value: null, version: 0 });
    else await rejectsCode(read, result === "reject" ? "lockout" : "failed");
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(p.cancel).not.toHaveBeenCalled();
  });

  test("observes abort during the native get call", async () => {
    const p = plugin();
    const controller = new AbortController();
    p.get.mockImplementation(async () => {
      controller.abort();
      return { value: "late secret", version: 1 };
    });
    await rejectsCode(createSecureStore(p).get(key, controller.signal), "cancelled");
    expect(p.cancel).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("refreshTokenKey", () => {
  const identity = {
    issuer: "https://issuer.example/",
    webId: "https://alice.example/profile#me",
    clientId: "https://suite.example/.well-known/solid-client-id-mobile.jsonld",
  };

  test("hashes the JSON identity array with SHA-256 against a known vector", async () => {
    expect(await refreshTokenKey(identity)).toBe(
      "pod-auth:refresh:c7b9be88c468faff1062ff033f4ec7ee26e00dea7f49b35e02d5bc4bfe18ec28",
    );
  });

  test("separates every identity component and keeps the strings byte-exact", async () => {
    const keys = await Promise.all(
      [
        identity,
        { ...identity, issuer: "https://issuer.example" },
        { ...identity, webId: "https://bob.example/profile#me" },
        { ...identity, clientId: "https://another.example/client" },
        { ...identity, webId: "https://alice.example/💾#me" },
      ].map(refreshTokenKey),
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^pod-auth:refresh:[0-9a-f]{64}$/);
    expect(await refreshTokenKey({ issuer: "a,b", webId: "c", clientId: "d" })).not.toBe(
      await refreshTokenKey({ issuer: "a", webId: "b,c", clientId: "d" }),
    );
  });
});
