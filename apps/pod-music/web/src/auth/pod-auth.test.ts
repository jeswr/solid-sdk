// AUTHORED-BY GPT-6.1 Sol
import type { AppPodAuthOptions } from "@jeswr/app-session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({ create: vi.fn((_options: AppPodAuthOptions) => vi.fn()) }));
vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: factory.create,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function optionsAt(dev: boolean, base = "/solid-sdk/pod-music/") {
  vi.stubEnv("DEV", dev);
  vi.stubEnv("BASE_URL", base);
  const adapter = await import("./pod-auth");
  expect(adapter.getPodAuth).toBe(factory.create.mock.results[0].value);
  return factory.create.mock.calls[0][0] as AppPodAuthOptions;
}

describe("Music app-session adapter", () => {
  it("hands Music's Pages base to the shared factory without patching global fetch", async () => {
    const ambient = globalThis.fetch;
    expect(await optionsAt(false)).toEqual({ base: "/solid-sdk/pod-music/", dev: false });
    expect(globalThis.fetch).toBe(ambient);
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it.each(["/", "./"])("passes a domain-root base %s through unchanged", async (base) => {
    expect(await optionsAt(false, base)).toEqual({ base, dev: false });
  });

  it("passes the development flag to the shared loopback policy", async () => {
    expect(await optionsAt(true)).toEqual({ base: "/solid-sdk/pod-music/", dev: true });
  });
});
