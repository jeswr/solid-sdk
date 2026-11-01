// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSuiteEnv, SuiteEnvError } from "../src/shell/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});
describe("shell environment", () => {
  it("has conservative capability defaults and the community providers", () => {
    const env = parseSuiteEnv({});
    expect(env).toMatchObject({
      NEXT_PUBLIC_SUITE_IDP_NAME: "your provider",
      NEXT_PUBLIC_SUITE_DEMO: true,
      NEXT_PUBLIC_SHOW_BACKLOG_APPS: false,
      SUITE_TEST_CAPS: {},
    });
    expect(env.NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS).toEqual([
      "https://solidcommunity.net/",
      "https://login.inrupt.com/",
      "https://teamid.live/",
    ]);
  });
  it("parses explicit public configuration and all boolean capabilities", () => {
    const caps = {
      selfRegistration: true,
      publicLinks: false,
      authenticatedAgentGrants: true,
      grantExpiry: false,
      grantPurpose: true,
      accessRequests: true,
      liveUpdates: false,
      serverSearch: true,
      notifyAgents: false,
    };
    expect(
      parseSuiteEnv({
        NEXT_PUBLIC_SUITE_IDP: "https://id.example.org/",
        NEXT_PUBLIC_SUITE_IDP_NAME: " Example ",
        NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL: "https://id.example.org/account",
        NEXT_PUBLIC_SHOW_BACKLOG_APPS: "1",
        NEXT_PUBLIC_SUITE_DEMO: "0",
        NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: "https://one.example.org/, https://two.example.org/",
        SUITE_TEST_CAPS: JSON.stringify(caps),
      }),
    ).toMatchObject({
      NEXT_PUBLIC_SUITE_IDP_NAME: "Example",
      NEXT_PUBLIC_SUITE_DEMO: false,
      NEXT_PUBLIC_SHOW_BACKLOG_APPS: true,
      NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: ["https://one.example.org/", "https://two.example.org/"],
      SUITE_TEST_CAPS: caps,
    });
  });
  it.each([
    { NEXT_PUBLIC_SUITE_IDP: "http://example.org" },
    { NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL: "javascript:alert(1)" },
    { NEXT_PUBLIC_SUITE_IDP_NAME: " " },
    { NEXT_PUBLIC_SHOW_BACKLOG_APPS: "true" },
    { NEXT_PUBLIC_SUITE_DEMO: "no" },
    { NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: "https://example.org/,http://example.com/" },
    { NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: "" },
    { SUITE_TEST_CAPS: "{" },
    { SUITE_TEST_CAPS: "[]" },
    { SUITE_TEST_CAPS: "null" },
    { SUITE_TEST_CAPS: '{"selfRegistration":"true"}' },
    { SUITE_TEST_CAPS: '{"surprise":true}' },
  ])("rejects malformed configuration with a typed, value-free error: %j", (record) => {
    expect(() => parseSuiteEnv(record)).toThrow(SuiteEnvError);
    try {
      parseSuiteEnv(record);
    } catch (error) {
      expect((error as SuiteEnvError).fields).toEqual(Object.keys(record));
    }
  });
  it("reads literal environment variables once", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_IDP", "https://id.example.org/");
    vi.stubEnv("NEXT_PUBLIC_SUITE_DEMO", "0");
    const { suiteEnv } = await import("../src/shell/lib/env");
    const first = suiteEnv();
    vi.stubEnv("NEXT_PUBLIC_SUITE_DEMO", "1");
    expect(suiteEnv()).toBe(first);
    expect(first.NEXT_PUBLIC_SUITE_DEMO).toBe(false);
  });
  it("warns once and defaults invalid fields without dropping valid ones", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_IDP", "secret-invalid-value");
    vi.stubEnv("NEXT_PUBLIC_SUITE_IDP_NAME", "Example");
    vi.stubEnv("SUITE_TEST_CAPS", '{"unexpected":true}');
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { suiteEnv } = await import("../src/shell/lib/env");
    expect(suiteEnv()).toMatchObject({
      NEXT_PUBLIC_SUITE_IDP_NAME: "Example",
      SUITE_TEST_CAPS: {},
    });
    expect(suiteEnv().NEXT_PUBLIC_SUITE_IDP).toBeUndefined();
    suiteEnv();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls.flat().join(" ")).not.toContain("secret-invalid-value");
  });
});
