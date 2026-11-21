// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, mount } from "../drive-ui-dom";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

import { SuiteRedirect } from "../../../issues/src/components/suite-redirect";

afterEach(() => vi.unstubAllEnvs());

describe("Issues browser redirect before sign-in", () => {
  it.each(["1", ""])("redirects the root with its exact query in export=%s", async (mode) => {
    vi.stubEnv("APP_STATIC_EXPORT", mode);
    vi.stubEnv("SUITE_ORIGIN", "https://suite.example/");
    vi.resetModules();
    const { default: config } = await import("../../../issues/next.config");
    vi.stubEnv("NEXT_PUBLIC_SUITE_ORIGIN", config.env?.NEXT_PUBLIC_SUITE_ORIGIN as string);
    route.pathname = "/";
    const search = "?tracker=https%3A%2F%2Fpod.example%2Ftracker.ttl%23this&view=board";
    const replace = vi.fn();
    vi.stubGlobal("location", { search, replace });
    const app = vi.fn(() => h("p", null, "Local app"));
    const { host } = await mount(h(SuiteRedirect, null, h(app)));
    expect(replace).toHaveBeenCalledWith(`https://suite.example/tasks/issues${search}`);
    expect(app).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });
  it.each(["1", ""])("renders locally with no configured suite in export=%s", async (mode) => {
    vi.stubEnv("APP_STATIC_EXPORT", mode);
    vi.stubEnv("SUITE_ORIGIN", "");
    vi.resetModules();
    const { default: config } = await import("../../../issues/next.config");
    expect(config.env?.NEXT_PUBLIC_SUITE_ORIGIN).toBe("");
    vi.stubEnv("NEXT_PUBLIC_SUITE_ORIGIN", "");
    const replace = vi.fn();
    route.pathname = "/";
    vi.stubGlobal("location", { search: "", replace });
    const { host } = await mount(h(SuiteRedirect, null, "Local app"));
    expect(host.textContent).toBe("Local app");
    expect(replace).not.toHaveBeenCalled();
  });
  it.each([
    "/clientid.jsonld",
    "/callback.html",
    "/auth/callback.html",
    "/_next/static/chunk.js",
  ])("does not forward %s", async (pathname) => {
    route.pathname = pathname;
    vi.stubEnv("NEXT_PUBLIC_SUITE_ORIGIN", "https://suite.example");
    const replace = vi.fn();
    vi.stubGlobal("location", { search: "", replace });
    const { host } = await mount(h(SuiteRedirect, null, "Local asset"));
    expect(host.textContent).toBe("Local asset");
    expect(replace).not.toHaveBeenCalled();
  });
});
