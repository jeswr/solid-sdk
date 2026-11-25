// AUTHORED-BY Codex GPT-6
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createPush, isPushRoute, type NativePushPlugin, type PushKeys } from "./push.js";
import {
  pushBytes,
  pushId,
  pushInteger,
  pushObject,
  pushString,
  pushUrl,
  relayOrigin,
} from "./push-validation.js";

const b64 = (length: number) => Buffer.alloc(length).toString("base64url");
let keys: PushKeys;
beforeAll(async () => {
  const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", generated.publicKey);
  keys = {
    pushToken: "os-token",
    devicePublicKey: Buffer.from(
      await crypto.subtle.exportKey("raw", generated.publicKey),
    ).toString("base64url"),
    authSecret: b64(16),
    deviceSigningKey: { kty: "EC", crv: "P-256", x: required(jwk.x), y: required(jwk.y) },
  };
});
function fixture() {
  const native: NativePushPlugin = {
    status: vi.fn(async () => ({
      permission: "granted",
      platform: "android",
      installed: true,
      registrationStale: false,
    })),
    enable: vi.fn(async () => structuredClone(keys)),
    sign: vi.fn(async () => ({ proof: `e30.e30.${b64(64)}` })),
    activate: vi.fn(async () => ({ nonce: b64(16) })),
    setTopicMap: vi.fn(async () => {}),
    silence: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    scheduleRenewalReminder: vi.fn(async () => {}),
    consumeLaunchRoute: vi.fn(async () => ({ launchRoute: null })),
  };
  return { native, push: createPush(native) };
}
const topic = {
  index: 0,
  kind: "inbox" as const,
  label: "Inbox",
  route: "/notifications",
  enabled: true,
};

test("pure push subpath does not import the native binding", async () => {
  const module = await import("./push.js");
  expect(module.createPushRegistrar).toBeTypeOf("function");
});
test("validates and forwards every native method, unwrapping launch routes", async () => {
  const { push, native } = fixture();
  expect(await push.status()).toEqual({
    permission: "granted",
    platform: "android",
    installed: true,
    registrationStale: false,
  });
  vi.mocked(native.status).mockResolvedValueOnce({
    permission: "denied",
    platform: "ios",
    installed: false,
    registrationStale: true,
  });
  expect((await push.status()).permission).toBe("denied");
  vi.mocked(native.status).mockResolvedValueOnce({
    permission: "prompt",
    platform: "ios",
    installed: false,
    registrationStale: true,
  });
  expect((await push.status()).permission).toBe("prompt");
  expect(await push.enable()).toEqual(keys);
  await push.setTopicMap({ registrationId: "reg-1", topics: [topic], pushToken: keys.pushToken });
  await push.setTopicMap({
    registrationId: "reg-2",
    topics: [{ ...topic, kind: "chat", route: "/chat/room_1" }],
  });
  await push.silence({ registrationId: "reg-1" });
  expect(
    await push.sign({
      method: "POST",
      url: "https://relay.example/push/installations",
      body: "{}",
    }),
  ).toEqual({ proof: `e30.e30.${b64(64)}` });
  await push.sign({ method: "DELETE", url: "https://relay.example/push/installations/i" });
  expect(await push.activate({ installationId: "install" })).toEqual({ nonce: b64(16) });
  await push.disable();
  await push.disable({ deleteLocalData: false });
  await push.disable({ deleteLocalData: true });
  await push.scheduleRenewalReminder({ expiresAt: Date.now() + 10000 });
  await push.scheduleRenewalReminder({ expiresAt: null });
  expect(await push.consumeLaunchRoute()).toBeNull();
  vi.mocked(native.consumeLaunchRoute).mockResolvedValueOnce({
    launchRoute: { registrationId: "r", route: "/chat/abc" },
  });
  expect(await push.consumeLaunchRoute()).toEqual({ registrationId: "r", route: "/chat/abc" });
  vi.mocked(native.consumeLaunchRoute).mockResolvedValueOnce({
    launchRoute: { registrationId: null, route: "/notifications" },
  });
  expect(await push.consumeLaunchRoute()).toEqual({
    registrationId: null,
    route: "/notifications",
  });
  expect(native.setTopicMap).toHaveBeenCalledWith({
    registrationId: "reg-1",
    topics: [topic],
    pushToken: keys.pushToken,
  });
});

describe("native response distrust", () => {
  test.each([
    ["status", null],
    ["status", []],
    ["status", {}],
    ["status", { permission: "wat", installed: true, platform: "ios", registrationStale: false }],
    ["status", { permission: "granted", installed: 1, platform: "ios", registrationStale: false }],
    [
      "status",
      { permission: "granted", installed: true, platform: "web", registrationStale: false },
    ],
    [
      "status",
      { permission: "granted", installed: true, platform: "ios", registrationStale: "no" },
    ],
    [
      "status",
      {
        permission: "granted",
        installed: true,
        platform: "ios",
        registrationStale: false,
        extra: true,
      },
    ],
    ["enable", {}],
    [
      "enable",
      { pushToken: "secret", devicePublicKey: "bad", authSecret: "bad", deviceSigningKey: {} },
    ],
    ["consumeLaunchRoute", {}],
    ["consumeLaunchRoute", { launchRoute: { registrationId: "r", route: "//evil" } }],
    ["consumeLaunchRoute", { launchRoute: { registrationId: null, route: "/chat/a" } }],
    ["consumeLaunchRoute", { launchRoute: { registrationId: "bad id", route: "/notifications" } }],
  ])("rejects malformed %s response", async (method, value) => {
    const { push, native } = fixture();
    vi.mocked(native[method as "status"]).mockResolvedValueOnce(value as never);
    await expect(push[method as "status"]()).rejects.toThrow("Push operation failed");
  });
  test.each([
    (base: PushKeys) => ({ ...base, pushToken: "" }),
    (base: PushKeys) => ({ ...base, devicePublicKey: b64(65) }),
    (base: PushKeys) => ({
      ...base,
      devicePublicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url"),
    }),
    (base: PushKeys) => ({ ...base, authSecret: b64(15) }),
    (base: PushKeys) => ({ ...base, deviceSigningKey: { ...base.deviceSigningKey, d: "secret" } }),
    (base: PushKeys) => ({ ...base, deviceSigningKey: { ...base.deviceSigningKey, kty: "RSA" } }),
    (base: PushKeys) => ({ ...base, deviceSigningKey: { ...base.deviceSigningKey, crv: "P-384" } }),
    (base: PushKeys) => ({ ...base, deviceSigningKey: { ...base.deviceSigningKey, x: b64(31) } }),
    (base: PushKeys) => ({ ...base, deviceSigningKey: { ...base.deviceSigningKey, y: b64(31) } }),
    (base: PushKeys) => ({
      ...base,
      deviceSigningKey: { kty: "EC", crv: "P-256", x: b64(32), y: b64(32) },
    }),
  ])("rejects private, off-curve or malformed keys", async (change) => {
    const { native, push } = fixture();
    vi.mocked(native.enable).mockResolvedValueOnce(change(keys) as PushKeys);
    await expect(push.enable()).rejects.toThrow("Push operation failed");
  });
  test.each([
    {},
    { proof: "secret" },
    { proof: `e30.e30.${"A".repeat(85)}B` },
  ])("rejects malformed proof result", async (raw) => {
    const { native, push } = fixture();
    vi.mocked(native.sign).mockResolvedValueOnce(raw as never);
    await expect(
      push.sign({ method: "PUT", url: "https://relay.example/push/registrations/r" }),
    ).rejects.toThrow("Push operation failed");
  });
  test("rejects a malformed activation nonce and strips native details", async () => {
    const { native, push } = fixture();
    vi.mocked(native.activate).mockResolvedValueOnce({ nonce: "secret" });
    await expect(push.activate({ installationId: "i" })).rejects.toThrow("Push operation failed");
    vi.mocked(native.silence).mockRejectedValueOnce(new Error("token=secret"));
    await expect(push.silence({ registrationId: "r" })).rejects.toThrow(/^Push operation failed$/u);
  });
});

describe("arguments rejected before bridge calls", () => {
  test.each([
    { registrationId: "bad/", topics: [] },
    { registrationId: "r", topics: null },
    {
      registrationId: "r",
      topics: Array.from({ length: 17 }, (_, index) => ({ ...topic, index })),
    },
    { registrationId: "r", topics: [topic, topic] },
    { registrationId: "r", topics: [{ ...topic, index: -1 }] },
    { registrationId: "r", topics: [{ ...topic, kind: "challenge" }] },
    { registrationId: "r", topics: [{ ...topic, label: "" }] },
    { registrationId: "r", topics: [{ ...topic, route: "/chat/../settings" }] },
    { registrationId: "r", topics: [{ ...topic, enabled: 1 }] },
    { registrationId: "r", topics: [], pushToken: "" },
  ])("rejects topic maps", async (raw) => {
    const { push, native } = fixture();
    await expect(push.setTopicMap(raw as never)).rejects.toThrow();
    expect(native.setTopicMap).not.toHaveBeenCalled();
  });
  test.each([
    { method: "GET", url: "https://relay.example/push/installations" },
    { method: "POST", url: "http://relay.example/push/installations" },
    { method: "POST", url: "https://relay.example/push/installations?q=1" },
    { method: "POST", url: "https://relay.example/push/installations#frag" },
    { method: "POST", url: "https://relay.example/push/installations", body: 1 },
    { method: "POST", url: "https://relay.example/push/installations", body: "a".repeat(65537) },
  ])("rejects signing arguments", async (raw) => {
    const { push, native } = fixture();
    await expect(push.sign(raw as never)).rejects.toThrow();
    expect(native.sign).not.toHaveBeenCalled();
  });
  test.each([
    {},
    { expiresAt: "tomorrow" },
    { expiresAt: -1 },
    { expiresAt: Date.now() - 1000 },
  ])("rejects reminder argument", async (raw) => {
    const { push } = fixture();
    await expect(push.scheduleRenewalReminder(raw as never)).rejects.toThrow();
  });
  test("rejects identifiers and disable options", async () => {
    const { push } = fixture();
    await expect(push.silence({ registrationId: "" })).rejects.toThrow();
    await expect(push.activate({ installationId: "" })).rejects.toThrow();
    await expect(push.disable({ deleteLocalData: 1 } as never)).rejects.toThrow();
  });
});

test.each(["/notifications", "/chat/a", "/chat/ab_C-123"])("accepts safe route %s", (route) =>
  expect(isPushRoute(route)).toBe(true));
test.each([
  null,
  "https://app/chat/a",
  "//app/chat/a",
  "/chat/..",
  "/chat/a/b",
  "/chat/%2F",
  "/chat/%252f",
  "/chat/abc?token",
  "/notifications/",
])("refuses hostile route %s", (route) => expect(isPushRoute(route)).toBe(false));
test("shared validators cover strict URL/encoding/identifier policies", () => {
  expect(pushObject({}, [])).toEqual({});
  for (const value of [null, [], "x", { extra: true }])
    expect(() => pushObject(value, [])).toThrow();
  for (const value of ["", null, "a\n", "a".repeat(4097)])
    expect(() => pushString(value)).toThrow();
  pushString("ok");
  pushId("abc-_1");
  pushInteger(0);
  for (const value of ["", "a/b", 1, "a".repeat(129)]) expect(() => pushId(value)).toThrow();
  for (const value of [-1, true, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => pushInteger(value)).toThrow();
  expect(pushUrl("https://pod.example/profile#me", true)).toBe("https://pod.example/profile#me");
  for (const value of [
    "http://pod.example/",
    "https://a:b@pod.example/",
    "https://pod.example/a#fragment",
    "https://pod.example/a b",
    "https://pod.example/a\\b",
  ])
    expect(() => pushUrl(value)).toThrow();
  expect(relayOrigin("https://relay.example/")).toBe("https://relay.example");
  for (const value of ["https://relay.example/path", "https://relay.example/?query=1"])
    expect(() => relayOrigin(value)).toThrow();
  expect(pushBytes(b64(16), 16)).toHaveLength(16);
  for (const value of [null, "AA=", "", "AB"]) expect(() => pushBytes(value, 1)).toThrow();
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}

test("matches native index, label, route and signing URL bounds before bridge invocation", async () => {
  const { push, native } = fixture();
  await expect(
    push.setTopicMap({ registrationId: "r", topics: [{ ...topic, index: 16 }] }),
  ).rejects.toThrow();
  await expect(
    push.setTopicMap({ registrationId: "r", topics: [{ ...topic, label: "a".repeat(161) }] }),
  ).rejects.toThrow();
  await expect(
    push.setTopicMap({ registrationId: "r", topics: [{ ...topic, label: "a\u0085" }] }),
  ).rejects.toThrow();
  await expect(
    push.setTopicMap({
      registrationId: "r",
      topics: [{ ...topic, route: `/chat/${"a".repeat(507)}` }],
    }),
  ).rejects.toThrow();
  await expect(
    push.sign({ method: "PUT", url: `https://relay.example/${"a".repeat(2048)}` }),
  ).rejects.toThrow();
  expect(native.setTopicMap).not.toHaveBeenCalled();
  expect(native.sign).not.toHaveBeenCalled();
});
