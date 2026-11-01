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

const DRIFT_TEST = `await promisify(execFile)("pnpm", ["run", "codegen", "--out", output]);`;
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
  for (const [path, content] of Object.entries(files)) {
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
      "apps/demo/src/model.test.mts": `run('pnpm', ['run', 'codegen', '--out', dir]);`,
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

  it("passes the real workspace", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    expect(checkCodegen(root).problems).toEqual([]);
  });
});
