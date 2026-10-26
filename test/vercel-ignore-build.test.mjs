// AUTHORED-BY Codex GPT-5.6 (Sol)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "./helpers/run-command.mjs";

const source = readFileSync(
  fileURLToPath(new URL("../scripts/vercel-ignore-build.mjs", import.meta.url)),
  "utf8",
);
const dirs = [];
const packageName = "@example/web";

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof content === "string" ? content : JSON.stringify(content));
  }
}

function git(root, ...args) {
  const result = runCommand("git", args, { cwd: root });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function commit(root, files) {
  writeFiles(root, files);
  git(root, "add", "--all");
  git(root, "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  return git(root, "rev-parse", "HEAD");
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  dirs.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.org");
  git(root, "config", "commit.gpgsign", "false");
  const base = commit(root, {
    "scripts/vercel-ignore-build.mjs": source,
    "pnpm-workspace.yaml": `# Fixture workspace with custom, nested and excluded globs.
packages:
  - "apps/*"
  - 'apps/*/web'
  - modules/* # unquoted
  - '!modules/excluded'
`,
    "package.json": { name: "fixture", private: true },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "turbo.json": {},
    "apps/example/package.json": { name: "@example/parent", private: true },
    "apps/example/src/index.js": "export const value = 1;\n",
    "apps/example/web/package.json": {
      name: packageName,
      private: true,
      dependencies: { "@example/direct": "workspace:*", "@example/unrelated": "^1.0.0" },
    },
    "apps/example/web/src/app.js": "export const value = 1;\n",
    "modules/direct/package.json": {
      name: "@example/direct",
      dependencies: { "@example/transitive": "workspace:^" },
    },
    "modules/transitive/package.json": {
      name: "@example/transitive",
      optionalDependencies: { "@example/direct": "workspace:~" },
    },
    "modules/transitive/src/index.js": "export const value = 1;\n",
    "modules/unrelated/package.json": { name: "@example/unrelated" },
    "modules/unrelated/src/index.js": "export const value = 1;\n",
    "modules/excluded/package.json": "intentionally invalid; excluded by workspace glob",
    ...overrides,
  });
  return { root, base };
}

function ignore(root, previous, name = packageName, options = {}) {
  const env = { ...process.env };
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  if (previous !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previous;
  const result = runCommand(
    process.execPath,
    [join(root, "scripts/vercel-ignore-build.mjs"), name],
    {
      cwd: join(root, "apps/example/web"),
      env,
      ...options,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  return result;
}

describe("Vercel ignored-build step", () => {
  it.each([
    "apps/example/web/src/app.js",
    "apps/example/src/index.js",
    "modules/transitive/src/index.js",
  ])("builds when %s changes within the transitive workspace closure", (path) => {
    const { root, base } = fixture();
    commit(root, { [path]: "export const value = 2;\n" });
    const result = ignore(root, base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Build: @example/web build inputs changed");
  });

  it("skips when only an unrelated package changes, even if it has a registry dependency edge", () => {
    const { root, base } = fixture();
    commit(root, { "modules/unrelated/src/index.js": "export const value = 2;\n" });
    const result = ignore(root, base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skip build: @example/web build inputs unchanged");
  });

  it.each([
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ])("follows workspace edges in %s", (field) => {
    const { root, base } = fixture({
      "apps/example/web/package.json": {
        name: packageName,
        [field]: { "@example/direct": "workspace:>=1" },
      },
    });
    commit(root, { "modules/transitive/src/index.js": "changed" });
    expect(ignore(root, base).status).toBe(1);
  });

  it.each([
    undefined,
    "",
    "ffffffffffffffffffffffffffffffffffffffff",
  ])("builds for an unavailable previous SHA despite an unrelated latest commit: %j", (previous) => {
    const { root } = fixture();
    commit(root, { "apps/example/web/src/app.js": "undeployed change" });
    commit(root, { "modules/unrelated/src/index.js": "changed" });
    const result = ignore(root, previous);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VERCEL_GIT_PREVIOUS_SHA");
  });

  it("uses a valid previous SHA across multiple commits", () => {
    const { root, base } = fixture();
    commit(root, { "modules/transitive/src/index.js": "changed" });
    commit(root, { "modules/unrelated/src/index.js": "changed" });
    const result = ignore(root, base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`since ${base}`);
  });

  it.each([undefined, "previous deployment"])("builds in a depth-one clone with %j", (previous) => {
    const { root, base } = fixture();
    commit(root, { "apps/example/web/src/app.js": "undeployed change" });
    commit(root, { "modules/unrelated/src/index.js": "changed" });
    const clone = mkdtempSync(join(tmpdir(), "vercel-shallow-"));
    dirs.push(clone);
    git(root, "clone", "--quiet", "--depth", "1", pathToFileURL(root).href, clone);
    expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
    const result = ignore(clone, previous === undefined ? undefined : base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      previous === undefined ? "is unset" : "is unavailable in this clone",
    );
  });

  it("builds when the previous SHA is resolvable but not an ancestor of HEAD", () => {
    const { root, base } = fixture();
    const previous = commit(root, { "modules/unrelated/src/index.js": "other history" });
    git(root, "reset", "--hard", base);
    commit(root, { "README.md": "unrelated current history" });
    const result = ignore(root, previous);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("not a known ancestor of HEAD");
  });

  it.each([
    "pnpm-lock.yaml",
    "turbo.json",
    "pnpm-workspace.yaml",
    "package.json",
    "tsconfig.base.json",
    ".npmrc",
    "biome.json",
    "scripts/shared-build.mjs",
    "guardrails/package-policy.json",
    "unknown-root-config.json",
  ])("builds for a shared root input change to %s", (path) => {
    const { root, base } = fixture();
    if (["pnpm-workspace.yaml", "package.json"].includes(path)) {
      const before = readFileSync(join(root, path), "utf8");
      commit(root, { [path]: `${before}\n` });
    } else {
      commit(root, { [path]: "changed" });
    }
    expect(ignore(root, base).status).toBe(1);
  });

  it.each([
    "README.md",
    "AGENTS.md",
    "decisions/0001.md",
    "skills/example/SKILL.md",
    "docs/deploy.md",
    ".github/workflows/ci.yml",
    ".claude/agents/example.md",
    ".roborev.toml",
    "LICENSE",
    "LICENSE-MIT",
  ])("skips for the explicitly allowed non-build path %s", (path) => {
    const { root, base } = fixture();
    commit(root, { [path]: "documentation change" });
    expect(ignore(root, base).status).toBe(0);
  });

  it("builds for a package README change within the app closure", () => {
    const { root, base } = fixture();
    commit(root, { "modules/direct/README.md": "package change" });
    expect(ignore(root, base).status).toBe(1);
  });

  it("builds for a root change even when other changes are allowed to skip", () => {
    const { root, base } = fixture();
    commit(root, {
      "README.md": "documentation change",
      "modules/unrelated/src/index.js": "unrelated change",
      "tsconfig.base.json": "shared input change",
    });
    expect(ignore(root, base).status).toBe(1);
  });

  it("builds for an unknown package", () => {
    const { root, base } = fixture();
    const result = ignore(root, base, "@example/missing");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("unknown workspace package @example/missing");
  });

  it("builds when a workspace dependency cannot be resolved", () => {
    const { root, base } = fixture({
      "modules/direct/package.json": {
        name: "@example/direct",
        dependencies: { "@example/missing": "workspace:*" },
      },
    });
    expect(ignore(root, base).status).toBe(1);
  });

  it("builds on an initial deployment without a previous SHA", () => {
    const { root } = fixture();
    const result = ignore(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VERCEL_GIT_PREVIOUS_SHA is unset");
  });

  it("builds when git is unavailable", () => {
    const { root, base } = fixture();
    const result = ignore(root, base, packageName, {
      env: { PATH: "", VERCEL_GIT_PREVIOUS_SHA: base },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VERCEL_GIT_PREVIOUS_SHA is unavailable in this clone");
  });

  it.each([
    "pnpm-workspace.yaml",
    "modules/direct/package.json",
  ])("builds on malformed workspace metadata in %s", (path) => {
    const { root, base } = fixture();
    writeFiles(root, { [path]: "{" });
    expect(ignore(root, base).status).toBe(1);
  });
});
