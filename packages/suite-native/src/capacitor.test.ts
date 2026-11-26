// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, test, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ registerPlugin: (name: string) => ({ pluginName: name }) }));

test("registers the native plugins by their native names", async () => {
  const bindings = await import("./capacitor.js");
  expect(bindings.authSessionPlugin).toEqual({ pluginName: "SuiteAuthSession" });
  expect(bindings.shareIntakePlugin).toEqual({ pluginName: "SuiteShareIntake" });
  expect(bindings.shareStagingPlugin).toEqual({ pluginName: "SuiteShareStaging" });
  expect(bindings.secureStorePlugin).toEqual({ pluginName: "SuiteSecureStore" });
  expect(bindings.filesPlugin).toEqual({ pluginName: "SuiteFiles" });
  expect(bindings.pushPlugin).toEqual({ pluginName: "SuitePush" });
  expect(bindings.sharePlugin).toEqual({ pluginName: "Share" });
});
