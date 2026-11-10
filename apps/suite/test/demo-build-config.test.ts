// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ["1", "1", undefined, true],
  ["1", undefined, "pages", true],
  ["1", undefined, "gate", false],
  ["1", undefined, undefined, false],
  [undefined, "1", "pages", false],
  ["0", "1", "pages", false],
] as const)("guards deployment builds with fixtures=%s, Vercel=%s, workflow=%s", async (fixtures, vercel, pages, blocked) => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", fixtures);
  vi.stubEnv("VERCEL", vercel);
  vi.stubEnv("GITHUB_WORKFLOW", pages);
  vi.resetModules();
  const config = import("../next.config");
  if (blocked) await expect(config).rejects.toThrow("Demo fixtures must be disabled");
  else await expect(config).resolves.toHaveProperty("default");
});
