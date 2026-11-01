// AUTHORED-BY Codex
import { expect, it } from "vitest";
import canonical from "../playwright.config";

it("loads the local Playwright entry point with the canonical server and every viewport/theme project", async () => {
  const entryPoint = "../playwright.local.config";
  const { default: local } = (await import(entryPoint)) as typeof import("../playwright.config");

  expect(local).toBe(canonical);
  expect(local.testDir).toBe("./e2e");
  expect(local.projects?.map((project) => project.name)).toEqual([
    "375-light",
    "375-dark",
    "768-light",
    "768-dark",
    "1280-light",
    "1280-dark",
  ]);
  expect(local.webServer).toMatchObject({ reuseExistingServer: false });
});
