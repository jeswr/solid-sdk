// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "./app-url";

afterEach(() => vi.unstubAllEnvs());

describe("app URLs", () => {
  it("keeps identity and both login returns under the Pages app base", () => {
    vi.stubEnv("BASE_URL", "/solid-sdk/pod-health/");
    const base = "https://jeswr.github.io/solid-sdk/pod-health/";
    expect(appUrl("clientid.jsonld", "https://jeswr.github.io")).toBe(`${base}clientid.jsonld`);
    expect(appUrl("callback.html", "https://jeswr.github.io")).toBe(`${base}callback.html`);
    expect(appUrl("", "https://jeswr.github.io")).toBe(base);
  });
  it.each(["/", "./"])("preserves domain-root behavior with base %s", (base) => {
    vi.stubEnv("BASE_URL", base);
    expect(appUrl("callback.html", "http://localhost:5173")).toBe(
      "http://localhost:5173/callback.html",
    );
    expect(appUrl("", "http://localhost:5173")).toBe("http://localhost:5173/");
  });
});
