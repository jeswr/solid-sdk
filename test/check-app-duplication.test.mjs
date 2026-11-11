// AUTHORED-BY Codex GPT-6
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const check = (root, updateBaseline = false, acceptNew = false) =>
  checkAppDuplication(root, { window: 40, updateBaseline, acceptNew });
const accept = (root) => check(root, true, true);
const baselinePath = "scripts/app-duplication-baseline.json";
const snapshot = (root) => readFileSync(join(root, baselinePath), "utf8");
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

  it("shares extensions and exclusions across apps and libraries and scans app scripts", () => {
    const included = [
      ...["jsx", "cjs", "mts", "cts"].map((ext) => `apps/second/src/main.${ext}`),
      "apps/second/scripts/seed.ts",
      ...["test", "tests", "fixtures", "fixture", "e2e", "build", "out", "dist"].map(
        (dir) => `packages/library/src/${dir}/x.ts`,
      ),
    ];
    const excludedSrc = [
      "x.test.ts",
      "x.spec.tsx",
      "__tests__/x.ts",
      "__fixtures__/x.ts",
      "generated/x.ts",
      "x.d.ts",
      "x.d.mts",
      "x.d.cts",
      "node_modules/x.ts",
    ];
    const root = workspace({
      [first]: logic,
      ...Object.fromEntries(included.map((file) => [file, logic])),
      ...Object.fromEntries(
        ["apps/second", "packages/library"].flatMap((project) =>
          [
            ...excludedSrc.map((file) => `${project}/src/${file}`),
            ...["test", "fixtures", "build", "out"].map((dir) => `${project}/${dir}/src/x.ts`),
          ].map((file) => [file, logic]),
        ),
      ),
      "apps/second/other.ts": logic,
      "apps/second/scripts/x.spec.mts": logic,
      "packages/library/scripts/outside.ts": logic,
    });
    expect(scan(root)).toMatchObject({
      files: 1 + included.length,
      skippedSrcPaths: 2 * excludedSrc.length,
    });
    expect(run(root).stdout).toContain(`${2 * excludedSrc.length} skipped src/ paths`);
  });

  it("treats suite sub-apps as independent projects, including copies within the suite", () => {
    const drive = "apps/suite/src/apps/drive/lib/main.ts";
    const mail = "apps/suite/src/apps/mail/lib/main.ts";
    const root = workspace({ [drive]: logic, [mail]: logic });
    expect(scan(root).clusters).toHaveLength(1);
    expect(scan(root).clusters[0].projects).toEqual([
      "apps/suite/src/apps/drive",
      "apps/suite/src/apps/mail",
    ]);
    expect(
      scan(workspace({ [drive]: logic, "apps/suite/src/apps/drive/other.ts": logic })).clusters,
    ).toEqual([]);
  });

  it("refuses new clusters on update unless explicitly accepted, then permits removed clusters", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    expect(run(root).status).toBe(1);
    const refusal = run(root, "--update-baseline");
    expect(refusal.status).toBe(1);
    expect(refusal.stdout).not.toContain("Baseline updated");
    expect(() => snapshot(root)).toThrow();
    const accepted = run(root, "--update-baseline", "--accept-new");
    expect(accepted.status).toBe(0);
    expect(accepted.stdout.match(/Accepted increase:/g)).toHaveLength(2);
    expect(run(root).status).toBe(0);
    const before = snapshot(root);
    expect(JSON.parse(before).window).toBe(40);
    expect(Object.keys(JSON.parse(before).clusters)).toHaveLength(1);
    put(root, second, "return true;");
    const reduced = run(root);
    expect(reduced.status).toBe(0);
    expect(reduced.stdout).toContain("baseline can shrink: run --update-baseline");
    expect(snapshot(root)).toBe(before);
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(JSON.parse(snapshot(root)).clusters).toEqual({});
    put(root, second, logic);
    expect(check(root).problems.join("\n")).toContain("new cluster");
  }, 15000);

  it("keeps fingerprints stable across comments, whitespace and renamed identifiers", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    accept(root);
    put(
      root,
      first,
      `// moved down\n\n${logic.replaceAll("items", "records").replaceAll(";", "; /* comment */")}`,
    );
    expect(check(root).problems).toEqual([]);
  });

  it("rejects new files and repeated copies within an existing cluster", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    accept(root);
    put(root, "apps/first/src/copy.ts", logic);
    expect(check(root).problems.join("\n")).toContain("changed occurrences");
    rmSync(join(root, "apps/first/src/copy.ts"));
    put(root, second, `${logic}\n${logic}`);
    expect(check(root).problems.length).toBeGreaterThan(0);
  });

  it("passes occurrence and project reductions while a cluster remains", () => {
    const copy = "apps/third/src/copy.ts";
    const root = workspace({ [first]: logic, [second]: logic, [copy]: logic });
    accept(root);
    const fingerprint = scan(root).clusters[0].fingerprint;
    const before = snapshot(root);
    rmSync(join(root, copy));
    expect(scan(root).clusters[0].fingerprint).toBe(fingerprint);
    expect(check(root).problems).toEqual([]);
    expect(check(root).notes.join("\n")).toContain("baseline can shrink: run --update-baseline");
    expect(snapshot(root)).toBe(before);
    expect(check(root, true).problems).toEqual([]);
    expect(snapshot(root)).not.toBe(before);
  });

  it("compares footprints by counts instead of exact token lengths", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    accept(root);
    const original = scan(root).clusters[0].fingerprint;
    const extension = `${logic}\nthrow new Error("shared failure");`;
    put(root, first, extension);
    put(root, second, extension);
    expect(scan(root).clusters[0].fingerprint).toBe(original);
    expect(check(root).problems).toEqual([]);
    expect(check(root, true).problems).toEqual([]);
    put(root, first, logic);
    put(root, second, logic);
    expect(check(root).problems).toEqual([]);
  });

  it("requires acceptance for new paths and extra locations and preserves the baseline on refusal", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    accept(root);
    const before = snapshot(root);
    const copy = "apps/first/src/copy.ts";
    put(root, copy, logic);
    expect(run(root, "--update-baseline").status).toBe(1);
    expect(snapshot(root)).toBe(before);
    const acceptedPath = run(root, "--update-baseline", "--accept-new");
    expect(acceptedPath.status).toBe(0);
    expect(acceptedPath.stdout).toContain(`${copy}: 1 > baseline 0`);
    put(root, second, `${logic}\n${logic}`);
    const refusal = check(root, true);
    expect(refusal.problems.length).toBeGreaterThan(0);
    const accepted = run(root, "--update-baseline", "--accept-new");
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("Accepted increase:");
    expect(check(root).problems).toEqual([]);
  });

  it("ignores parentheses and whitespace-only JSX during reflow", () => {
    const one = "apps/first/src/view.jsx";
    const two = "apps/second/src/view.jsx";
    const view = `export function View(items) { return <div><span>{items.map(item => <b>{item.name}</b>)}</span><span>{items.filter(item => item.ready).map(item => <i>{item.title}</i>)}</span></div>; }`;
    const root = workspace({ [one]: view, [two]: view });
    accept(root);
    expect(scan(root).clusters).toHaveLength(1);
    const fingerprint = scan(root).clusters[0].fingerprint;
    put(
      root,
      two,
      view
        .replaceAll("return <", "return (<")
        .replace("</div>;", "</div>);")
        .replaceAll("><", ">\n    <"),
    );
    expect(scan(root).clusters[0].fingerprint).toBe(fingerprint);
    expect(check(root).problems).toEqual([]);
    put(root, one, view.replaceAll("item.name", "((item.name))").replaceAll("><", ">\n<"));
    expect(check(root).problems).toEqual([]);
  });

  it.each([
    `export const mime = {${Array.from({ length: 80 }, (_, i) => `"type${i}": "application/type${i}"`).join(",")}};`,
    `const vocab = [${Array.from({ length: 80 }, (_, i) => `"https://example.test/term${i}"`).join(",")}];`,
    `const data = [${Array.from({ length: 80 }, (_, i) => `[${i}, ${i + 1}, ${i + 2}]`).join(",")}];`,
    `const vocab = {${Array.from({ length: 80 }, (_, i) => `term${i}: "https://example.test/term${i}"`).join(",")}};`,
    `const data = [${Array.from({ length: 80 }, (_, i) => `["type", "value", ${i}, call()]`).join(",")}];`,
  ])("skips data-heavy windows and vocab lists", (data) => {
    expect(scan(workspace({ [first]: data, [second]: data })).clusters).toEqual([]);
  });

  it("fingerprints canonical token names independently of TypeScript enum values", () => {
    const snippet =
      'export function execute(input) { if (input.ready) return input.run(input.value); throw new Error("failed"); }';
    const root = workspace({ [first]: snippet, [second]: snippet });
    const anchor = [
      "Token:export",
      "Token:function",
      "Identifier",
      "Identifier",
      "Token:{",
      "Token:if",
      "Identifier",
      "Token:.",
      "Identifier",
      "Token:return",
      "Identifier",
      "Token:.",
    ];
    const expected = createHash("sha256")
      .update(JSON.stringify([12, anchor]))
      .digest("hex");
    expect(scanAppDuplication(root, 12).clusters.map((cluster) => cluster.fingerprint)).toContain(
      expected,
    );
  });

  it("orders projects, locations and baselines by code point, independently of locale", () => {
    const root = workspace(
      Object.fromEntries(
        ["ä", "Z", "a", "𐀀", "\uE000"].map((name) => [`apps/${name}/src/x.ts`, logic]),
      ),
    );
    const cluster = scan(root).clusters[0];
    const projects = ["Z", "a", "ä", "\uE000", "𐀀"].map((name) => `apps/${name}`);
    expect(cluster.projects).toEqual(projects);
    expect(cluster.locations.map((location) => location.file)).toEqual(
      projects.map((project) => `${project}/src/x.ts`),
    );
    expect(accept(root).notes.map((note) => note.split(" ")[3].slice(0, -1))).toEqual(
      cluster.locations.map((location) => location.file),
    );
  });

  it("fails malformed baselines, incompatible window sizes and missing roots", () => {
    const root = workspace({ "scripts/app-duplication-baseline.json": "[]" });
    expect(() => check(root)).toThrow(/Invalid/);
    expect(() => accept(root)).toThrow(/Invalid/);
    put(root, baselinePath, '{"window":40,"clusters":{}}');
    expect(() => checkAppDuplication(root, { window: 120 })).toThrow(/incompatible/);
    expect(() => scanAppDuplication(root, 0)).toThrow(/integer/);
    expect(run(join(root, "missing")).status).toBe(1);
  });

  it("defaults to 120 tokens", () => {
    const root = workspace({ [first]: logic, [second]: logic });
    expect(scanAppDuplication(root)).toMatchObject({ window: 120, clusters: [] });
  });
});
