// AUTHORED-BY Claude Opus 5.5
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkCodegen } from "../scripts/check-codegen.mjs";

const guard = fileURLToPath(new URL("../scripts/check-codegen.mjs", import.meta.url));
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DRIFT_TEST = `await promisify(execFile)("pnpm", ["run", "codegen", "--out", output]);
expect(read(output)).toEqual(read(committed));`;
const WORKSPACE_YAML = `packages:
  - "packages/*"
  - "apps/*"
  - "apps/*/web"
  - "tools/*"
`;
const MANIFEST = {
  name: "@jeswr/example",
  scripts: {
    codegen:
      "node node_modules/@jeswr/federation-codegen/dist/cli.js gen --ontology a.ttl --shapes a.shacl.ttl --config codegen.config.json --out src/generated",
  },
  devDependencies: { "@jeswr/federation-codegen": "workspace:*" },
};

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "codegen-guard-"));
  dirs.push(root);
  for (const [path, content] of Object.entries({
    "pnpm-workspace.yaml": WORKSPACE_YAML,
    ...files,
  })) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function generated(project, manifest = MANIFEST, test = DRIFT_TEST) {
  return {
    [`${project}/package.json`]: manifest,
    [`${project}/src/generated/codegen.lock.json`]: "{}",
    [`${project}/test/codegen.test.ts`]: test,
  };
}

describe("codegen guard", () => {
  it("passes a generated package with a codegen script, generator edge and drift test", () => {
    const root = workspace(generated("packages/example"));
    expect(checkCodegen(root)).toEqual({ projects: 1, problems: [] });
    const result = spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 generated project(s)");
  });

  it("ignores projects that commit no generated model", () => {
    const root = workspace({ "packages/plain/package.json": { name: "@jeswr/plain" } });
    expect(checkCodegen(root)).toEqual({ projects: 0, problems: [] });
  });

  it("covers apps and accepts single-quoted drift calls in src tests", () => {
    const root = workspace({
      ...generated("apps/demo", MANIFEST, ""),
      "apps/demo/src/model.test.mts": `run('pnpm', ['run', 'codegen', '--out', dir]);\nassert.deepEqual(a, b);`,
    });
    expect(checkCodegen(root).problems).toEqual([]);
  });

  it("reports each missing requirement and fails the CLI", () => {
    const root = workspace(
      generated(
        "packages/example",
        { name: "@jeswr/example", devDependencies: { "@jeswr/federation-codegen": "^1.0.0" } },
        "it('has no drift check', () => {});",
      ),
    );
    const { problems } = checkCodegen(root);
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/"codegen" script/);
    expect(problems.join("\n")).toMatch(/workspace: devDependency/);
    expect(problems.join("\n")).toMatch(/drift test/);
    const result = spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packages/example");
  });

  it("requires the codegen script to write to src/generated", () => {
    const manifest = {
      ...MANIFEST,
      scripts: { codegen: MANIFEST.scripts.codegen.replace("src/generated", "out") },
    };
    const root = workspace(generated("packages/example", manifest));
    expect(checkCodegen(root).problems).toEqual([
      'packages/example: the "codegen" script must write to src/generated',
    ]);
  });

  it("does not count drift calls inside node_modules or dist", () => {
    const root = workspace({
      ...generated("packages/example", MANIFEST, ""),
      "packages/example/test/node_modules/dep/x.test.ts": DRIFT_TEST,
      "packages/example/test/dist/x.test.js": DRIFT_TEST,
    });
    expect(checkCodegen(root).problems).toHaveLength(1);
  });

  it("covers every pnpm-workspace project kind, including apps/*/web and tools/*", () => {
    const bare = { name: "@jeswr/bare" };
    const root = workspace({
      "apps/x/web/package.json": bare,
      "apps/x/web/src/generated/codegen.lock.json": "{}",
      "tools/z/package.json": bare,
      "tools/z/src/generated/codegen.lock.json": "{}",
    });
    const { projects, problems } = checkCodegen(root);
    expect(projects).toBe(2);
    expect(problems.filter((p) => p.startsWith("apps/x/web:"))).toHaveLength(3);
    expect(problems.filter((p) => p.startsWith("tools/z:"))).toHaveLength(3);
  });

  it("ignores commented-out drift calls and calls with no assertion", () => {
    for (const test of [
      '// TODO add ["codegen", "--out"] drift test\nexpect(1).toBe(1);',
      '/* run("codegen", "--out", dir) */ expect(1).toBe(1);',
      'await run("pnpm", ["run", "codegen", "--out", dir]);',
    ]) {
      const root = workspace(generated("packages/example", MANIFEST, test));
      expect(checkCodegen(root).problems).toEqual([
        "packages/example: needs a drift test that runs `pnpm run codegen --out <tmp>` and compares src/generated byte-for-byte",
      ]);
    }
  });

  it("finds drift tests in spec files and a tests/ directory", () => {
    const root = workspace({
      ...generated("packages/example", MANIFEST, ""),
      "packages/example/tests/drift.spec.cts": DRIFT_TEST,
    });
    expect(checkCodegen(root).problems).toEqual([]);
  });

  it("accepts --out= and a trailing slash, and a generator under dependencies", () => {
    for (const out of ["--out=src/generated", "--out ./src/generated/"]) {
      const manifest = {
        name: "@jeswr/example",
        scripts: { codegen: MANIFEST.scripts.codegen.replace("--out src/generated", out) },
        dependencies: { "@jeswr/federation-codegen": "workspace:^" },
      };
      const root = workspace(generated("packages/example", manifest));
      expect(checkCodegen(root).problems).toEqual([]);
    }
  });

  it("reports an unreadable package.json", () => {
    const root = workspace({
      "packages/example/package.json": "{ not json",
      "packages/example/src/generated/codegen.lock.json": "{}",
    });
    expect(checkCodegen(root).problems).toEqual([
      "packages/example: commits a generated model but has no readable package.json",
    ]);
  });

  it("fails rather than passing vacuously when --root is not a workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "codegen-guard-empty-"));
    dirs.push(root);
    expect(() => checkCodegen(root)).toThrow(/pnpm-workspace\.yaml/);
    const result = spawnSync(process.execPath, [guard, "--root", join(root, "missing")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm-workspace.yaml");
  });

  it("passes the real workspace", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    expect(checkCodegen(root).problems).toEqual([]);
  });
});
