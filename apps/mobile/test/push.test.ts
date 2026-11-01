// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { beforeEach, expect, test, vi } from "vitest";
import type { SuitePushPlugin } from "../src/push.ts";

const native = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(),
  setTopicMap: vi.fn(),
  silence: vi.fn(),
  sign: vi.fn(),
  activate: vi.fn(),
  disable: vi.fn(),
  consumeLaunchRoute: vi.fn(),
}));
const register = vi.hoisted(() => vi.fn(() => native));
vi.mock("@capacitor/core", () => ({ registerPlugin: register }));

import { SuitePush } from "../src/push.ts";

beforeEach(() => {
  for (const method of Object.values(native)) method.mockReset();
});

test("registers the native SuitePush bridge and exposes the P13 surface", () => {
  expect(register).toHaveBeenCalledExactlyOnceWith("SuitePush");
  const plugin: SuitePushPlugin = SuitePush;
  expect(Object.keys(plugin).sort()).toEqual(Object.keys(native).sort());
});

test("preserves status and public key result shapes", async () => {
  const status = {
    permission: "prompt",
    installed: false,
    platform: "android",
    registrationStale: false,
  };
  const enabled = {
    pushToken: "token",
    devicePublicKey: "public",
    authSecret: "secret",
    deviceSigningKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  };
  native.status.mockResolvedValue(status);
  native.enable.mockResolvedValue(enabled);
  expect(await SuitePush.status()).toBe(status);
  expect(await SuitePush.enable()).toBe(enabled);
  expect(native.status).toHaveBeenCalledExactlyOnceWith();
  expect(native.enable).toHaveBeenCalledExactlyOnceWith();
});

test("passes native arguments without altering signed body bytes or account identity", async () => {
  const topics = {
    registrationId: "account-b",
    pushToken: "confirmed-token",
    topics: [
      { index: 0, kind: "chat" as const, label: "Book club", route: "/chat/book", enabled: true },
    ],
  };
  const request = {
    method: "POST",
    url: "https://relay.example/push/installations",
    body: '{ "x": 1 }\n',
  };
  native.sign.mockResolvedValue({ proof: "jws" });
  native.activate.mockResolvedValue({ nonce: "nonce" });
  await SuitePush.setTopicMap(topics);
  await SuitePush.silence({ registrationId: "account-b" });
  expect(await SuitePush.sign(request)).toEqual({ proof: "jws" });
  expect(await SuitePush.activate({ installationId: "installation" })).toEqual({ nonce: "nonce" });
  expect(native.setTopicMap).toHaveBeenCalledExactlyOnceWith(topics);
  expect(native.silence).toHaveBeenCalledExactlyOnceWith({ registrationId: "account-b" });
  expect(native.sign).toHaveBeenCalledExactlyOnceWith(request);
  expect(native.activate).toHaveBeenCalledExactlyOnceWith({ installationId: "installation" });
});

test("preserves the durable stale flag so the registrar can refresh after restart", async () => {
  native.status.mockResolvedValue({
    permission: "granted",
    installed: true,
    platform: "ios",
    registrationStale: true,
  });
  expect((await SuitePush.status()).registrationStale).toBe(true);
  const topics = { registrationId: "account-b", topics: [] };
  await SuitePush.setTopicMap(topics);
  expect(native.setTopicMap).toHaveBeenCalledExactlyOnceWith(topics);
});

test("separates local silence from confirmed remote cleanup", async () => {
  await SuitePush.disable();
  await SuitePush.disable({ deleteLocalData: true });
  expect(native.disable.mock.calls).toEqual([[undefined], [{ deleteLocalData: true }]]);
});

test("unwraps a launch route once, including the registration for account switching", async () => {
  const launch = { registrationId: "account-b", route: "/chat/book" };
  native.consumeLaunchRoute
    .mockResolvedValueOnce({ launchRoute: launch })
    .mockResolvedValueOnce({ launchRoute: null });
  expect(await SuitePush.consumeLaunchRoute()).toBe(launch);
  expect(await SuitePush.consumeLaunchRoute()).toBeNull();
});

test("preserves a forgotten registration's notifications-only launch without an account", async () => {
  const launch = { registrationId: null, route: "/notifications" };
  native.consumeLaunchRoute.mockResolvedValueOnce({ launchRoute: launch });
  expect(await SuitePush.consumeLaunchRoute()).toEqual(launch);
});

test("propagates native permission, availability and activation timeout failures", async () => {
  for (const [method, error] of [
    ["enable", "push-unavailable"],
    ["activate", "activation-timeout"],
    ["sign", "INVALID_ARGUMENT"],
  ] as const) {
    native[method].mockRejectedValue(new Error(error));
  }
  await expect(SuitePush.enable()).rejects.toThrow("push-unavailable");
  await expect(SuitePush.activate({ installationId: "id" })).rejects.toThrow("activation-timeout");
  await expect(
    SuitePush.sign({ method: "DELETE", url: "https://relay.example/push/installations/id" }),
  ).rejects.toThrow("INVALID_ARGUMENT");
});
