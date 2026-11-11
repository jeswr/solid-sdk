// AUTHORED-BY GPT-6.1 Sol
import { afterEach, expect, it, vi } from "vitest";

const { create, get } = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: create,
}));
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  "development",
  "production",
])("creates one lazy %s getter at the site root without touching location", async (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  vi.stubGlobal("location", undefined);
  create.mockReturnValue(get);
  const adapter = await import("./pod-auth");
  expect(create).toHaveBeenCalledExactlyOnceWith({
    base: "/",
    dev: mode === "development",
    boundary: { storageEndpoints: ["/.notifications/"] },
  });
  expect(get).not.toHaveBeenCalled();
  expect(adapter.getPodAuth).toBe(get);
});
