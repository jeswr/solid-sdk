// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  "development",
  "production",
] as const)("redirects the web Drive entry before rendering the session gate in %s", async (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  const { default: config } = await import("../next.config");
  expect((await config.redirects?.()) ?? []).toContainEqual({
    source: "/drive",
    destination: "/drive/my",
    permanent: false,
  });
});

it("keeps the static native export on its page redirect", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  const { default: config } = await import("../next.config");
  expect(config.output).toBe("export");
  expect(config.redirects).toBeUndefined();
});
