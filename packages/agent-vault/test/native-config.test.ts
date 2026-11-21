// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { nativeConfigSchema, validateNativeCaller } from "../src/native-config.js";

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const config = {
  extensionId,
  storeDir: "/private/fixture-store",
  cookieDomains: [],
  frequentSites: [],
};
describe("native host registration", () => {
  it("checks the exact Chrome caller argument, independently of the host manifest", () => {
    expect(() => validateNativeCaller(config, `chrome-extension://${extensionId}/`)).not.toThrow();
    for (const caller of [
      undefined,
      "https://shop.test",
      `chrome-extension://${extensionId}.evil/`,
      `chrome-extension://${extensionId}/popup/popup.html`,
    ])
      expect(() => validateNativeCaller(config, caller)).toThrow("Vault denied.");
  });
  it("rejects wildcard IDs, relative stores, extra fields and public suffix parent policies", () => {
    expect(nativeConfigSchema.safeParse({ ...config, extensionId: "*" }).success).toBe(false);
    expect(nativeConfigSchema.safeParse({ ...config, password: "fixture-secret" }).success).toBe(
      false,
    );
    expect(() =>
      validateNativeCaller(
        { ...config, storeDir: "relative" },
        `chrome-extension://${extensionId}/`,
      ),
    ).toThrow("Vault invalid.");
    for (const domain of ["co.uk", "com", "github.io", "foo.ck"])
      expect(() =>
        validateNativeCaller(
          { ...config, cookieDomains: [domain] },
          `chrome-extension://${extensionId}/`,
        ),
      ).toThrow("Vault invalid.");
    expect(() =>
      validateNativeCaller(
        { ...config, cookieDomains: ["example.co.uk"] },
        `chrome-extension://${extensionId}/`,
      ),
    ).not.toThrow();
  });
});
