// AUTHORED-BY Codex GPT-6

import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

// Read an indentation-scoped YAML block, following the workflow's block style.
function block(source, key, indent) {
  const spaces = " ".repeat(indent);
  const match = new RegExp(`^${spaces}${key}:\\n((?:${spaces} .*(?:\\n|$)|\\n)*)`, "m").exec(
    source,
  );
  expect(match, `missing ${key} block`).not.toBeNull();
  return match[1];
}

describe("Pages workflow", () => {
  it("gives branch builds read-only credentials and scopes deployment credentials to deploy", () => {
    expect(block(workflow, "permissions", 0).trim()).toBe("contents: read");
    const jobs = block(workflow, "jobs", 0);
    const build = block(jobs, "build", 2);
    expect(build).not.toMatch(/^\s*(?:permissions|pages|id-token):/m);
    const deploy = block(jobs, "deploy", 2);
    const permissions = block(deploy, "permissions", 4);
    expect(permissions).toMatch(/^\s+pages: write$/m);
    expect(permissions).toMatch(/^\s+id-token: write$/m);
    expect(deploy).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("  workflow_dispatch:");
  });

  const paths = [...block(block(workflow, "push", 2), "paths", 4).matchAll(/- '([^']+)'/g)].map(
    (match) => match[1],
  );

  it.each([
    "apps/pod-drive/web/src/App.tsx",
    "packages/app-shell/src/index.ts",
    "tools/federation-codegen/package.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "turbo.json",
    "biome.json",
    ".npmrc",
    "scripts/build-pages.mjs",
    "scripts/vercel-apps.json",
    ".github/workflows/pages.yml",
  ])("rebuilds when the sole changed build input is %s", (path) => {
    expect(paths.some((pattern) => matchesGlob(path, pattern))).toBe(true);
  });
});
