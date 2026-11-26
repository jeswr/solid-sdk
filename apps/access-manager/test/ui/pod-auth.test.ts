// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: factory.create,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  factory.create.mockReturnValue(vi.fn());
  vi.stubGlobal("location", new URL("https://access.example/nested/page"));
  vi.stubEnv("BASE_URL", "/solid-sdk/access-manager/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Access Manager's app-session adapter", () => {
  it("configures one shared getter with the app base, name and development flag", async () => {
    vi.stubEnv("DEV", false);
    const { getPodAuth, APP_NAME } = await import("../../src/auth/pod-auth.js");
    expect(factory.create).toHaveBeenCalledExactlyOnceWith({
      base: "/solid-sdk/access-manager/",
      dev: false,
    });
    expect(getPodAuth).toBe(factory.create.mock.results[0]?.value);
    expect(APP_NAME).toBe("Solid Access Manager");
    expect(factory.create.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
  });

  it("passes an explicit client ID override and dev flag to the shared policy", async () => {
    vi.stubEnv("VITE_CLIENT_ID", "https://identity.example/client.jsonld");
    vi.stubEnv("DEV", true);
    await import("../../src/auth/pod-auth.js");
    expect(factory.create).toHaveBeenCalledWith({
      base: "/solid-sdk/access-manager/",
      dev: true,
      clientId: "https://identity.example/client.jsonld",
    });
  });
});
