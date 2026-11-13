// AUTHORED-BY GPT-6.1 Sol
import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: create,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  create.mockClear();
});

describe("Money's shared session adapter", () => {
  it.each([false, true])("hands the base path to the shared factory (dev=%s)", async (dev) => {
    vi.resetModules();
    vi.stubEnv("DEV", dev);
    vi.stubEnv("BASE_URL", "/solid-sdk/pod-money/");
    const { getPodAuth } = await import("./pod-auth");
    expect(create).toHaveBeenCalledExactlyOnceWith({ base: "/solid-sdk/pod-money/", dev });
    expect(getPodAuth).toBe(create.mock.results[0]?.value);
  });
});
