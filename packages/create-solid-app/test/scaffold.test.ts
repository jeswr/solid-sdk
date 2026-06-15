// AUTHORED-BY Claude Opus 4.8
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scaffold, toPackageName } from "../src/scaffold.ts";

describe("toPackageName", () => {
  it("lowercases and url-safes names", () => {
    expect(toPackageName("My Cool App")).toBe("my-cool-app");
    expect(toPackageName("Foo_Bar.baz")).toBe("foo_bar.baz");
    expect(toPackageName("  --weird--  ")).toBe("weird");
    expect(toPackageName("")).toBe("solid-app");
  });
});

describe("scaffold", () => {
  let workDir: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "csa-scaffold-"));
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      result = await scaffold({ targetDir: "my-app", appName: "My App" });
    } finally {
      process.chdir(prevCwd);
    }
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("copies the expected file tree (key files present)", () => {
    const expected = [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "AGENTS.md",
      "README.md",
      "public/callback.html",
      "app/layout.tsx",
      "app/page.tsx",
      "app/providers.tsx",
      "components/solid/SolidAuthProvider.tsx",
      "components/solid/LoginPanel.tsx",
      "components/solid/ProfileCard.tsx",
      "lib/solid/profile.ts",
      "lib/solid/login-ux.ts",
      "lib/solid/webid-token-provider.ts",
      "scripts/dev.mjs",
      "tests/lib/profile.test.ts",
      "vitest.config.ts",
      "vercel.json",
    ];
    for (const f of expected) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("excludes build/dep artefacts", () => {
    expect(result.files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(result.files.some((f) => f.startsWith(".next/"))).toBe(false);
    expect(result.files).not.toContain("tsconfig.tsbuildinfo");
  });

  it("ships the template lockfile for a resolution-free first install", () => {
    // The dominant TTFS install cost is npm resolving a cold dependency graph; shipping the
    // committed lockfile removes that (measured ~13.9s → ~7.3s warm — dx/ttfs-benchmark.md).
    expect(result.files).toContain("package-lock.json");
  });

  it("substitutes the package.json name", async () => {
    const pkg = JSON.parse(await readFile(join(result.targetDir, "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("my-app");
  });

  it("generates a README titled with the app name", async () => {
    const readme = await readFile(join(result.targetDir, "README.md"), "utf8");
    expect(readme.startsWith("# My App")).toBe(true);
  });

  it("refuses a non-empty target dir", async () => {
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      await expect(scaffold({ targetDir: "my-app", appName: "X" })).rejects.toThrow(/not empty/);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
