// AUTHORED-BY Claude Opus 4.8
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeRepo, scaffold, toPackageName } from "../src/scaffold.ts";

describe("toPackageName", () => {
  it("lowercases and url-safes names", () => {
    expect(toPackageName("My Cool App")).toBe("my-cool-app");
    expect(toPackageName("Foo_Bar.baz")).toBe("foo_bar.baz");
    expect(toPackageName("  --weird--  ")).toBe("weird");
    expect(toPackageName("")).toBe("solid-app");
  });
});

describe("normalizeRepo", () => {
  it("accepts a bare owner/repo", () => {
    expect(normalizeRepo("jeswr/my-app")).toBe("jeswr/my-app");
  });
  it("strips a github URL + .git suffix", () => {
    expect(normalizeRepo("https://github.com/jeswr/my-app.git")).toBe("jeswr/my-app");
    expect(normalizeRepo("https://github.com/jeswr/my-app/")).toBe("jeswr/my-app");
    expect(normalizeRepo("git@github.com:jeswr/my-app.git")).toBe("jeswr/my-app");
  });
  it("rejects garbage (returns undefined so the placeholder stays)", () => {
    expect(normalizeRepo(undefined)).toBeUndefined();
    expect(normalizeRepo("")).toBeUndefined();
    expect(normalizeRepo("not-a-repo")).toBeUndefined();
    expect(normalizeRepo("a/b/c")).toBeUndefined();
    expect(normalizeRepo("bad repo/name")).toBeUndefined();
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
      "lib/solid/login-result.ts",
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

  it("ships the baked-in app-shell wiring (header + config)", () => {
    for (const f of ["lib/app-shell-config.ts", "lib/app-version.ts", "components/AppHeader.tsx"]) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("substitutes APP_NAME into lib/app-shell-config.ts", async () => {
    const config = await readFile(join(result.targetDir, "lib", "app-shell-config.ts"), "utf8");
    // The display name is baked in; the un-given repo keeps its placeholder token.
    expect(config).toContain('"My App"');
    expect(config).toContain("__CSA_REPO__");
    expect(config).not.toContain("__CSA_APP_NAME__");
  });
});

describe("scaffold with --repo", () => {
  let workDir: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "csa-repo-"));
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      result = await scaffold({
        targetDir: "repo-app",
        appName: "Repo App",
        repo: "https://github.com/jeswr/repo-app.git",
      });
    } finally {
      process.chdir(prevCwd);
    }
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("bakes the normalised repo into FEEDBACK_REPO", async () => {
    const config = await readFile(join(result.targetDir, "lib", "app-shell-config.ts"), "utf8");
    expect(config).toContain('"jeswr/repo-app"');
    expect(config).not.toContain("__CSA_REPO__");
    expect(config).not.toContain("__CSA_APP_NAME__");
  });
});
