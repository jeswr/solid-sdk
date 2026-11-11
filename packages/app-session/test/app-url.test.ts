// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "../src/app-url";

afterEach(() => vi.unstubAllEnvs());

describe("app URLs", () => {
  it("keeps identity and both login returns under the Pages app base", () => {
    const basePath = "/solid-sdk/test-app/";
    const base = "https://jeswr.github.io/solid-sdk/test-app/";
    expect(appUrl("clientid.jsonld", basePath, "https://jeswr.github.io")).toBe(
      `${base}clientid.jsonld`,
    );
    expect(appUrl("callback.html", basePath, "https://jeswr.github.io")).toBe(
      `${base}callback.html`,
    );
    expect(appUrl("", basePath, "https://jeswr.github.io")).toBe(base);
  });
  it.each(["/", "./"])("preserves domain-root behavior with base %s", (base) => {
    expect(appUrl("callback.html", base, "http://localhost:5173")).toBe(
      "http://localhost:5173/callback.html",
    );
    expect(appUrl("", base, "http://localhost:5173")).toBe("http://localhost:5173/");
  });
});
