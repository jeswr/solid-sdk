// AUTHORED-BY Codex GPT-6.1-Sol
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../../issues/next.config";
import { companionApps } from "../../src/welcome/apps";

afterEach(() => vi.unstubAllEnvs());
describe("standalone Issues entry point", () => {
  it("bakes the suite origin into static exports without server redirects", async () => {
    vi.stubEnv("APP_STATIC_EXPORT", "1");
    vi.stubEnv("SUITE_ORIGIN", "https://suite.example/");
    vi.resetModules();
    const { default: exported } = await import("../../../issues/next.config");
    expect(exported.output).toBe("export");
    expect(exported.env?.NEXT_PUBLIC_SUITE_ORIGIN).toBe("https://suite.example");
    expect(exported.redirects).toBeUndefined();
  });
  it("remains local when SUITE_ORIGIN is unset", async () => {
    vi.stubEnv("SUITE_ORIGIN", "");
    expect(await config.redirects?.()).toEqual([]);
  });
  it("redirects pages and preserves a tracker query via Next routing", async () => {
    vi.stubEnv("SUITE_ORIGIN", "https://suite.example/");
    const tracker = "https://pod.example/issue-tracker/tracker.ttl#this";
    const response = await unstable_getResponseFromNextConfig({
      url: `https://issues.example/?tracker=${encodeURIComponent(tracker)}&view=board`,
      nextConfig: config,
    });
    expect(response.status).toBe(307);
    const destination = new URL(getRedirectUrl(response) ?? "");
    expect(destination.origin + destination.pathname).toBe("https://suite.example/tasks/issues");
    expect(destination.searchParams.get("tracker")).toBe(tracker);
  });
  it.each([
    "/clientid.jsonld",
    "/callback.html",
    "/_next/static/chunk.js",
  ])("keeps %s served", async (path) => {
    vi.stubEnv("SUITE_ORIGIN", "https://suite.example");
    const response = await unstable_getResponseFromNextConfig({
      url: `https://issues.example${path}`,
      nextConfig: config,
    });
    expect(getRedirectUrl(response)).toBeNull();
  });
  it("links the welcome entry to Issues inside Tasks", () => {
    expect(companionApps.find((app) => app.id === "issues")?.href).toBe("/tasks/issues");
  });
});
