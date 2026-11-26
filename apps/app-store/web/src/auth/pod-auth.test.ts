// AUTHORED-BY GPT-6.1 Sol
import { afterEach, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: factory,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each([
  { base: "/", dev: false },
  { base: "/solid-sdk/app-store/", dev: false },
  { base: "/", dev: true },
])("hands base $base and dev=$dev to the shared factory", async ({ base, dev }) => {
  vi.stubEnv("DEV", dev);
  vi.stubEnv("BASE_URL", base);
  await import("./pod-auth");
  expect(factory).toHaveBeenCalledExactlyOnceWith({ base, dev });
});
