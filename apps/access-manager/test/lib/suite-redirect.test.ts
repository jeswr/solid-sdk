// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SUITE_URL, goToSuite, suitePermissionsUrl } from "../../src/suite-redirect.js";

describe("suitePermissionsUrl", () => {
  it("defaults to the public suite's Permissions route", () => {
    expect(DEFAULT_SUITE_URL).toBe("https://solid-suite.vercel.app");
    expect(suitePermissionsUrl(undefined)).toBe("https://solid-suite.vercel.app/permissions");
    expect(suitePermissionsUrl("  ")).toBe("https://solid-suite.vercel.app/permissions");
  });

  it("follows a configured suite, including one mounted under a path", () => {
    expect(suitePermissionsUrl("https://suite.example")).toBe("https://suite.example/permissions");
    expect(suitePermissionsUrl("https://example.org/suite?x=1#top")).toBe(
      "https://example.org/suite/permissions",
    );
    expect(suitePermissionsUrl("https://example.org/suite/")).toBe(
      "https://example.org/suite/permissions",
    );
    expect(suitePermissionsUrl("http://localhost:3210")).toBe("http://localhost:3210/permissions");
  });

  it("never redirects to a malformed, insecure or credentialed setting", () => {
    for (const value of [
      "not a url",
      "http://suite.example",
      "javascript:alert(1)",
      "https://user:pass@suite.example",
    ])
      expect(suitePermissionsUrl(value)).toBe("https://solid-suite.vercel.app/permissions");
  });

  it("reads VITE_SUITE_URL when no value is passed", () => {
    vi.stubEnv("VITE_SUITE_URL", "https://configured.example");
    try {
      expect(suitePermissionsUrl()).toBe("https://configured.example/permissions");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("replaces the current page in history", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    try {
      goToSuite("https://solid-suite.vercel.app/permissions");
      expect(replace).toHaveBeenCalledWith("https://solid-suite.vercel.app/permissions");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
