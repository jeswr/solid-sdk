// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test } from "vitest";
import { isNativeApp, platform } from "./platform.js";

const cap = (native: boolean, name: string) => ({
  isNativePlatform: () => native,
  getPlatform: () => name,
});

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

test("reports the native platform", () => {
  expect(platform(cap(true, "ios"))).toBe("ios");
  expect(platform(cap(true, "android"))).toBe("android");
  expect(isNativeApp(cap(true, "android"))).toBe(true);
});

test("treats the web runtime and unknown platforms as web", () => {
  expect(platform(cap(false, "web"))).toBe("web");
  expect(platform(cap(true, "electron"))).toBe("web");
  expect(isNativeApp(cap(false, "ios"))).toBe(false);
});

test("reads the injected Capacitor global", () => {
  expect(platform()).toBe("web");
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: true };
  expect(platform()).toBe("web");
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  expect(platform()).toBe("web");
  (globalThis as { Capacitor?: unknown }).Capacitor = cap(true, "ios");
  expect(platform()).toBe("ios");
  expect(isNativeApp()).toBe(true);
});
