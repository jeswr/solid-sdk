// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test } from "vitest";
import {
  APP_ID,
  BUNDLED_ORIGINS,
  DEFAULT_SUITE_URL,
  mobileConfig,
  suiteMode,
  suiteOrigin,
} from "../src/config.ts";

describe("suiteOrigin", () => {
  test("defaults to the deployed suite", () => {
    expect(suiteOrigin({}).href).toBe(`${DEFAULT_SUITE_URL}/`);
  });

  test.each([
    ["http", { SUITE_URL: "http://suite.example" }],
    ["http loopback without debug", { SUITE_URL: "http://localhost:3210" }],
    ["http non-loopback in debug", { SUITE_URL: "http://suite.example", MOBILE_DEBUG: "1" }],
    ["a path", { SUITE_URL: "https://suite.example/app" }],
    ["a query", { SUITE_URL: "https://suite.example/?x=1" }],
    ["credentials", { SUITE_URL: "https://a:b@suite.example" }],
    ["a custom scheme", { SUITE_URL: "capacitor://localhost" }],
  ])("rejects %s", (_, env) => {
    expect(() => suiteOrigin(env)).toThrow();
  });

  test("allows loopback dev servers only in debug builds", () => {
    expect(suiteOrigin({ SUITE_URL: "http://localhost:3210", MOBILE_DEBUG: "1" }).host).toBe(
      "localhost:3210",
    );
  });

  test("rejects the emulator host alias, which is not a secure context", () => {
    expect(() => suiteOrigin({ SUITE_URL: "http://10.0.2.2:3210", MOBILE_DEBUG: "1" })).toThrow();
  });

  test("never sets allowNavigation", () => {
    expect(mobileConfig({}).server).not.toHaveProperty("allowNavigation");
  });
});

describe("mobileConfig", () => {
  test("locks a release build to the suite origin", () => {
    const config = mobileConfig({ SUITE_URL: "https://suite.example" });
    expect(config).toMatchObject({
      appId: APP_ID,
      webDir: "www",
      loggingBehavior: "none",
      server: {
        url: "https://suite.example",
        errorPath: "offline.html",
        cleartext: false,
        androidScheme: "https",
      },
      android: {
        allowMixedContent: false,
        webContentsDebuggingEnabled: false,
        useLegacyBridge: false,
      },
      ios: {
        includePlugins: ["@capacitor/app"],
        limitsNavigationsToAppBoundDomains: true,
        webContentsDebuggingEnabled: false,
      },
    });
  });

  test("debug builds enable WebView debugging and cleartext loopback", () => {
    const config = mobileConfig({ SUITE_URL: "http://localhost:3210", MOBILE_DEBUG: "1" });
    expect(config.server).toMatchObject({ url: "http://localhost:3210", cleartext: true });
    expect(config.android?.webContentsDebuggingEnabled).toBe(true);
    expect(config.ios?.webContentsDebuggingEnabled).toBe(true);
    // Bridge payload logging would print secure-store values, even in debug builds.
    expect(config.loggingBehavior).toBe("none");
  });
});

describe("bundled mode (MOB-P3 E6)", () => {
  test("defaults to remote and rejects unknown modes", () => {
    expect(suiteMode({})).toBe("remote");
    expect(suiteMode({ SUITE_MODE: "bundled" })).toBe("bundled");
    expect(() => suiteMode({ SUITE_MODE: "local" })).toThrow("SUITE_MODE");
  });

  test("serves the export from the local origin with no server.url", () => {
    const config = mobileConfig({ SUITE_MODE: "bundled", SUITE_URL: "https://suite.example" });
    expect(config.webDir).toBe("www-bundled");
    expect(config.server).toEqual({
      androidScheme: "https",
      hostname: "localhost",
      iosScheme: "capacitor",
    });
    expect(config.loggingBehavior).toBe("none");
    expect(config.android).toMatchObject({ allowMixedContent: false, useLegacyBridge: false });
    expect(config.ios).toMatchObject({
      includePlugins: ["@capacitor/app"],
      limitsNavigationsToAppBoundDomains: false,
      webContentsDebuggingEnabled: false,
    });
    expect(BUNDLED_ORIGINS).toEqual(["https://localhost", "capacitor://localhost"]);
  });

  test("debug bundled builds enable WebView debugging only", () => {
    const config = mobileConfig({ SUITE_MODE: "bundled", MOBILE_DEBUG: "1" });
    expect(config.android?.webContentsDebuggingEnabled).toBe(true);
    expect(config.ios?.webContentsDebuggingEnabled).toBe(true);
    expect(config.server).not.toHaveProperty("cleartext");
  });
});
