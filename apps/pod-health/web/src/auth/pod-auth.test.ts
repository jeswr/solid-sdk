// AUTHORED-BY GPT-6.1 Sol
import { clearLegacyCredentials, createAppPodAuth } from "@jeswr/app-session";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: vi.fn(() => vi.fn()),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("Health's shared session adapter", () => {
  it.each([false, true])("hands the base path to the shared factory (dev=%s)", async (dev) => {
    vi.stubEnv("DEV", dev);
    vi.stubEnv("BASE_URL", "/solid-sdk/pod-health/");
    await import("./pod-auth");
    expect(createAppPodAuth).toHaveBeenCalledExactlyOnceWith({
      base: "/solid-sdk/pod-health/",
      dev,
    });
  });

  it("removes exactly Health's obsolete records through the shared cleanup", async () => {
    const { APP_NAME, LEGACY_CREDENTIALS } = await import("./pod-auth");
    expect(APP_NAME).toBe("Pod Health");
    // Pin the migration inventory against the pre-port storage writers.
    expect(LEGACY_CREDENTIALS).toEqual({
      indexedDb: ["pod-health:sessions"],
      localStorage: ["pod-health:remembered-account"],
      sessionStorage: ["pod-health:pss.autologin.flow", "pod-health:autologin-attempted"],
    });
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase });
    for (const key of LEGACY_CREDENTIALS.localStorage ?? []) localStorage.setItem(key, "old");
    for (const key of LEGACY_CREDENTIALS.sessionStorage ?? []) sessionStorage.setItem(key, "old");
    localStorage.setItem("pod-health:app-shell-theme", "dark");
    localStorage.setItem("pod-docs:remembered-account", "other app");
    sessionStorage.setItem("pod-docs:autologin-attempted", "other app");
    clearLegacyCredentials(LEGACY_CREDENTIALS);
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("pod-health:sessions");
    expect(localStorage.getItem("pod-health:remembered-account")).toBeNull();
    expect(sessionStorage.getItem("pod-health:pss.autologin.flow")).toBeNull();
    expect(sessionStorage.getItem("pod-health:autologin-attempted")).toBeNull();
    expect(localStorage.getItem("pod-health:app-shell-theme")).toBe("dark");
    expect(localStorage.getItem("pod-docs:remembered-account")).toBe("other app");
    expect(sessionStorage.getItem("pod-docs:autologin-attempted")).toBe("other app");
    sessionStorage.clear();
  });
});
