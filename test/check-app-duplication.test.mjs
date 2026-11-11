// AUTHORED-BY Codex GPT-6
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkAppDuplication, scanAppDuplication } from "../scripts/check-app-duplication.mjs";

const guard = fileURLToPath(new URL("../scripts/check-app-duplication.mjs", import.meta.url));
const dirs = [];
const first = "apps/first/src/main.ts";
const second = "apps/second/web/src/main.ts";
// No repeated subwindows: the entire function should coalesce into one cluster.
const logic = `export async function process(items) {
  const values = [];
  for (const item of items) {
    if (item.enabled && item.score > 5) values.push(await transform(item));
    else values.unshift({ ...item, score: 1 });
  }
  return values.filter(value => value !== null).sort((a, b) => a.score - b.score);
}`;
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function workspace(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "app-duplication-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) put(root, path, text);
  return root;
}
const scan = (root) => scanAppDuplication(root, 40);
const check = (root, updateBaseline = false) =>
  checkAppDuplication(root, { window: 40, updateBaseline });
function run(root, ...args) {
  const logs = workspace();
  const out = openSync(join(logs, "stdout"), "w");
  const err = openSync(join(logs, "stderr"), "w");
  let result;
  try {
    result = spawnSync(process.execPath, [guard, "--root", root, "--window", "40", ...args], {
      stdio: ["ignore", out, err],
    });
  } finally {
    closeSync(out);
    closeSync(err);
  }
  if (result.error) throw result.error;
  return {
    ...result,
    stdout: readFileSync(join(logs, "stdout"), "utf8"),
    stderr: readFileSync(join(logs, "stderr"), "utf8"),
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("app duplication ratchet", () => {
  it("normalizes identifiers/literals and merges overlapping windows with line ranges", () => {
    const root = workspace({
      [first]: logic,
      [second]: `// comment\n${logic.replaceAll("items", "entries").replaceAll("5", "80").replaceAll("1", "20")}`,
    });
    const result = scan(root);
    expect(result.clusters).toHaveLength(1);
    const [cluster] = result.clusters;
    expect(cluster.tokens).toBeGreaterThan(40);
    expect(cluster.projects).toEqual(["apps/first", "apps/second"]);
    expect(cluster.locations).toEqual([
      { file: first, startLine: 1, endLine: 8, tokens: cluster.tokens },
      { file: second, startLine: 2, endLine: 9, tokens: cluster.tokens },
    ]);
    expect(check(root).problems.join("\n")).toContain(
      "move shared logic into a packages/* library (AGENTS.md)",
    );
  });

  it("detects app/library copies, but ignores same-app and package-only copies", () => {
    for (const other of ["apps/first/web/src/copy.ts", "apps/first/src/copy.ts"]) {
      expect(scan(workspace({ [first]: logic, [other]: logic })).clusters).toEqual([]);
    }
    expect(
      scan(workspace({ "packages/one/src/main.ts": logic, "packages/two/src/main.ts": logic }))
        .clusters,
    ).toEqual([]);
    expect(
      scan(workspace({ [first]: logic, "packages/library/src/main.ts": logic })).clusters,
    ).toHaveLength(1);
  });

  it("does not report short snippets, comments, import-only or type-only regions", () => {
    const declarations = `import { one, two, three, four, five } from "module";
export { one, two, three, four, five } from "other";
import type { A, B, C, D, E } from "types";
export type { A, B, C, D, E } from "types";
export interface Model { name: string; value: number; a: boolean; b: string; c: number; }
export type Example = { name: string; value: number; a: boolean; b: string; c: number; };
// ${logic.replaceAll("\n", "\n// ")}
/* ${logic} */
const message = "a short string";`;
    expect(scan(workspace({ [first]: declarations, [second]: declarations })).clusters).toEqual([]);
  });

  it("treats erased declarations as barriers and preserves keywords/punctuation", () => {
    const snippets = Array.from({ length: 12 }, (_, i) => `call(item); type T${i} = string;`).join(
      "\n",
    );
    expect(scan(workspace({ [first]: snippets, [second]: snippets })).clusters).toEqual([]);
    expect(
      scan(workspace({ [first]: logic, [second]: "while (true) { break; }".repeat(30) })).clusters,
    ).toEqual([]);
  });

  it("handles templates, regex and JSX without treating literal contents as code", () => {
    const literals =
      "const a = /function fake() { return x; }/g; const b = `function pretend() { return x; }`;";
    expect(
      scan(workspace({ [first]: literals.repeat(2), [second]: literals.repeat(2) })).clusters,
    ).toEqual([]);
    const root = workspace({
      "apps/first/src/view.tsx": `const view = <div>\n  // literal JSX text ${"let fake = 1; ".repeat(20)}\n</div>;\n${logic}`,
      "apps/second/src/view.tsx": `const view = <div>different words</div>;\n${logic}`,
    });
    expect(scan(root).clusters.length).toBeGreaterThan(0);
  });

  it("shares exclusions across app and package source trees", () => {
    const excluded = [
      "x.test.ts",
      "x.spec.tsx",
      "__tests__/x.ts",
      "test/x.js",
      "e2e/x.mjs",
      "fixtures/x.ts",
      "generated/x.ts",
      "x.d.ts",
      "node_modules/x.ts",
    ];
    const root = workspace({
      [first]: logic,
      ...Object.fromEntries(
        ["apps/second", "packages/library"].flatMap((project) =>
          excluded.map((file) => [`${project}/src/${file}`, logic]),
        ),
      ),
      "apps/second/main.ts": logic,
      "apps/second/test/src/main.ts": logic,
    });
    expect(scan(root)).toMatchObject({ files: 1, clusters: [] });
  });

  it("round-trips the CLI baseline; rejects new clusters and requires shrinking after removal", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    expect(run(root).status).toBe(1);
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(run(root).status).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(root, "scripts/app-duplication-baseline.json"), "utf8"),
    );
    expect(baseline.window).toBe(40);
    expect(Object.keys(baseline.clusters)).toHaveLength(1);
    put(root, second, "return true;");
    expect(run(root).stderr).toContain("Stale duplicate cluster");
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(check(root).problems).toEqual([]);
    expect(
      JSON.parse(readFileSync(join(root, "scripts/app-duplication-baseline.json"), "utf8"))
        .clusters,
    ).toEqual({});
    put(root, second, logic);
    expect(check(root).problems.join("\n")).toContain("new cluster");
  }, 15000);

  it("keeps fingerprints stable across comments, whitespace and renamed identifiers", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    check(root, true);
    put(
      root,
      first,
      `// moved down\n\n${logic.replaceAll("items", "records").replaceAll(";", "; /* comment */")}`,
    );
    expect(check(root).problems).toEqual([]);
  });

  it("rejects new files and repeated copies within an existing cluster", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    check(root, true);
    put(root, "apps/first/src/copy.ts", logic);
    expect(check(root).problems.join("\n")).toContain("changed occurrences");
    rmSync(join(root, "apps/first/src/copy.ts"));
    put(root, second, `${logic}\n${logic}`);
    expect(check(root).problems.length).toBeGreaterThan(0);
  });

  it("requires a baseline update when occurrences shrink but a cluster remains", () => {
    const copy = "apps/first/src/copy.ts";
    const root = workspace({ [first]: logic, [second]: logic, [copy]: logic });
    check(root, true);
    rmSync(join(root, copy));
    expect(check(root).problems.join("\n")).toContain("--update-baseline");
    check(root, true);
    expect(check(root).problems).toEqual([]);
  });

  it("rejects growth and shrinkage of a known fragment even with the same fingerprint", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    check(root, true);
    const original = scan(root).clusters[0].fingerprint;
    const extension = `${logic}\nthrow new Error("shared failure");`;
    put(root, first, extension);
    put(root, second, extension);
    expect(scan(root).clusters[0].fingerprint).toBe(original);
    expect(check(root).problems.join("\n")).toContain("changed occurrences");
    check(root, true);
    put(root, first, logic);
    put(root, second, logic);
    expect(check(root).problems.join("\n")).toContain("--update-baseline");
  });

  it("fails malformed baselines, incompatible window sizes and missing roots", () => {
    const root = workspace({ "scripts/app-duplication-baseline.json": "[]" });
    expect(() => check(root)).toThrow(/Invalid/);
    check(root, true);
    expect(() => checkAppDuplication(root, { window: 120 })).toThrow(/incompatible/);
    expect(() => scanAppDuplication(root, 0)).toThrow(/integer/);
    expect(run(join(root, "missing")).status).toBe(1);
  });

  it("defaults to 120 tokens", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    expect(scanAppDuplication(root)).toMatchObject({ window: 120, clusters: [] });
  });
});
