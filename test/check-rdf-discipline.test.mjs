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
import { checkRdfDiscipline, scanRdfDiscipline } from "../scripts/check-rdf-discipline.mjs";

const guard = fileURLToPath(new URL("../scripts/check-rdf-discipline.mjs", import.meta.url));
const dirs = [];
const path = "apps/example/src/main.ts";
const factory = "DataFactory.quad(s, p, o);";
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function workspace(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "rdf-discipline-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) put(root, path, text);
  return root;
}
function run(root, ...args) {
  const logs = workspace();
  const out = openSync(join(logs, "stdout"), "w");
  const err = openSync(join(logs, "stderr"), "w");
  let result;
  try {
    result = spawnSync(process.execPath, [guard, "--root", root, ...args], {
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

describe("RDF discipline ratchet", () => {
  it("finds factory methods, import aliases and destructured aliases with precise lines", () => {
    const root = workspace({
      [path]: `import { quad as make } from "@rdfjs/data-model";
import { triple } from "rdf-data-factory";
import { quad } from "n3";
const { quad: create, triple: statement } = factory;
DataFactory.quad(s, p, o);
df.triple(s, p, o);
factory["quad"](s, p, o);
make(s, p, o); triple(s, p, o); quad(s, p, o);
create(s, p, o); statement(s, p, o);
store.addQuad(q); store.addQuads(qs); store.removeQuad(q);`,
    });
    const result = scanRdfDiscipline(root);
    expect(result.counts[path]).toEqual({ "rdf-factory": 8, "rdf-store-mutation": 3 });
    expect(result.violations[0]).toEqual({ path, line: 5, rule: "rdf-factory" });
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain(`${path}:5 rdf-factory`);
  });

  it.each([
    '"INSERT DATA { <a> <b> <c> }"',
    '"delete data { <a> <b> <c> }"',
    "`DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`",
    "`INSERT { ?s ?p ?o } WHERE { ?s ?p ?o }`",
    '"@prefix ex: <https://example.test/> ."',
    `\`<\${subject}> <\${predicate}> "value" .\``,
    '`<subject> <https://example.test/p> "value" .`',
    "`<subject> a <Class> .`",
  ])("finds RDF literal %s", (literal) => {
    const root = workspace({ [path]: `const update = ${literal};` });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-literal": 1 });
  });

  it("ignores comments, regexes, ordinary strings and non-factory functions", () => {
    const root = workspace({
      [path]: `// DataFactory.quad(s, p, o); @prefix INSERT DATA
/* store.addQuad(q); DELETE DATA {} */
const text = "quad( addQuads( DELETE label";
const label = "Insert your data here";
const regex = /INSERT DATA|@prefix|quad\\(/;
const other = "<s> <https://example.test/p>";
function quad(a, b) { return a + b; }
quad(1, 2);`,
    });
    expect(scanRdfDiscipline(root).violations).toEqual([]);
  });

  it("uses only template text, while walking calls inside interpolations", () => {
    const root = workspace({ [path]: `\`label \${insert({ where: true })} \${df.quad(s,p,o)}\`;` });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-factory": 1 });
  });

  it("allows only real same-line escape comments with non-empty reasons", () => {
    const root = workspace({
      [path]: `${factory} // rdf-discipline-allow: serializer compatibility
// rdf-discipline-allow: this applies only to the comment line
${factory}
${factory} // rdf-discipline-allow:   
const fake = "// rdf-discipline-allow: fake"; ${factory}
/* rdf-discipline-allow: fake */ ${factory}
const template = \`// rdf-discipline-allow: fake\`; ${factory}`,
    });
    const result = scanRdfDiscipline(root);
    expect(result.allowed).toBe(2);
    expect(result.counts[path]["rdf-factory"]).toBe(5);
    expect(result.problems).toEqual([`${path}:4 rdf-discipline-allow requires a non-empty reason`]);
    const cli = run(root, "--update-baseline");
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain("2 allow-comment(s)");
  });

  it("scans app/web source extensions and excludes tests, declarations and generated source", () => {
    const excluded = [
      "x.test.ts",
      "x.spec.tsx",
      "__tests__/x.ts",
      "test/x.js",
      "tests/x.ts",
      "e2e/x.mjs",
      "fixtures/x.ts",
      "generated/x.ts",
      "x.d.ts",
      "node_modules/dep/x.ts",
    ];
    const root = workspace({
      ...Object.fromEntries(excluded.map((file) => [`apps/example/src/${file}`, factory])),
      "apps/example/test/src/x.ts": factory,
      "apps/example/web/src/generated/x.ts": factory,
      "apps/example/other.ts": factory,
      "packages/library/src/main.ts": factory,
      ...Object.fromEntries(
        ["ts", "tsx", "js", "mjs"].map((ext) => [`apps/example/web/src/main.${ext}`, factory]),
      ),
    });
    const result = scanRdfDiscipline(root);
    expect(result.files).toBe(4);
    expect(result.violations).toHaveLength(4);
  });

  it("locates multiline calls on the method line so same-line escapes work", () => {
    const root = workspace({
      [path]: `factory\n  .quad(s, p, o); // rdf-discipline-allow: serializer boundary\nstore\n  .addQuad(q);`,
    });
    expect(scanRdfDiscipline(root).violations).toEqual([
      { path, line: 4, rule: "rdf-store-mutation" },
    ]);
  });

  it("does not interpret JSX text as an allow-comment", () => {
    const file = "apps/example/src/view.tsx";
    const root = workspace({
      [file]: `const view = <div>// rdf-discipline-allow: fake</div>; ${factory}`,
    });
    const result = scanRdfDiscipline(root);
    expect(result.allowed).toBe(0);
    expect(result.counts[file]).toEqual({ "rdf-factory": 1 });
  });

  it("round-trips CLI baselines and fails increases, new files/rules, reductions and deletions", () => {
    const root = workspace({ [path]: factory });
    expect(run(root).status).toBe(1);
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(root, "scripts/rdf-discipline-baseline.json"), "utf8")),
    ).toEqual({ [path]: { "rdf-factory": 1 } });
    expect(run(root).status).toBe(0);
    put(root, path, `${factory}\n${factory}`);
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain("2 > baseline 1");
    put(root, path, `${factory}\nstore.addQuad(q);`);
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain("rdf-store-mutation");
    put(root, path, factory);
    put(root, "apps/example/src/new.ts", factory);
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain("new.ts:1");
    rmSync(join(root, "apps/example/src/new.ts"));
    put(root, path, "");
    expect(run(root).stderr).toContain("--update-baseline");
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(run(root).status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(root, "scripts/rdf-discipline-baseline.json"), "utf8")),
    ).toEqual({});
    put(root, path, factory);
    checkRdfDiscipline(root, true);
    rmSync(join(root, path));
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain("stale baseline");
  }, 15000);

  it("fails malformed baselines and missing roots", () => {
    const root = workspace({
      "scripts/rdf-discipline-baseline.json": '{"old.ts":{"rdf-factory":-1}}',
    });
    expect(() => checkRdfDiscipline(root)).toThrow(/Invalid/);
    expect(run(join(root, "missing")).status).toBe(1);
  });
});
