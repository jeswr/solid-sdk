// AUTHORED-BY Codex GPT-6
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
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

const baselinePath = "scripts/rdf-discipline-baseline.json";
const snapshot = (root) => readFileSync(join(root, baselinePath), "utf8");
const accept = (root) => checkRdfDiscipline(root, { updateBaseline: true, acceptNew: true });

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
create(s, p, o); statement(s, p, o);`,
    });
    const result = scanRdfDiscipline(root);
    expect(result.counts[path]).toEqual({ "rdf-factory": 8 });
    expect(result.violations[0]).toEqual({ path, line: 5, rule: "rdf-factory" });
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain("at line(s) 5");
  });

  it("finds Quad/Triple constructors and aliases only from factory modules", () => {
    const root = workspace({
      [path]: `import N3, { Quad, Triple as Statement } from "n3";
import * as model from "@rdfjs/data-model";
import { Triple } from "rdf-data-factory";
new Quad(s,p,o); new Statement(s,p,o); new Triple(s,p,o);
new N3.Quad(s,p,o); new model.Triple(s,p,o); new model["Quad"](s,p,o);`,
      "apps/example/src/unrelated.ts": `import { Quad } from "other";
class Triple {} new Triple(); new Quad(); new other.Quad();`,
    });
    expect(scanRdfDiscipline(root).counts).toEqual({ [path]: { "rdf-factory": 6 } });
  });

  it("permits all Store/Writer mutation methods on existing quads but catches inline construction", () => {
    const root = workspace({
      [path]: `import { Writer, StreamWriter, Store, quad } from "n3";
const writer = new Writer(); const stream = new StreamWriter(); const store = new Store();
${["writer", "stream", "store"]
  .flatMap((receiver) =>
    ["addQuad", "addQuads", "removeQuad", "removeQuads", "removeMatches"].map(
      (method) => `${receiver}.${method}(q);`,
    ),
  )
  .join("\n")}
writer.addQuad(quad(s,p,o)); store.removeQuad(quad(s,p,o));`,
    });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-factory": 2 });
  });

  it("recognizes factory constructors in CommonJS and TypeScript require imports", () => {
    const root = workspace({
      [path]: `import N3 = require("n3"); new N3.Quad(s,p,o);
const { Quad: Statement } = N3; new Statement(s,p,o);`,
      "apps/example/scripts/seed.cjs": `const N3 = require("n3"); new N3.Quad(s,p,o);
const { Quad, Triple: Statement } = require("rdf-data-factory");
new Quad(s,p,o); new Statement(s,p,o);`,
    });
    expect(scanRdfDiscipline(root).violations).toHaveLength(5);
  });

  it.each([
    '"INSERT DATA { <a> <b> <c> }"',
    '"DELETE DATA { <a> <b> <c> }"',
    "`DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }`",
    "`INSERT { ?s ?p ?o }`",
    '"@prefix ex: <https://example.test/> ."',
    '"PREFIX ex: <https://example.test/>"',
    '"PREFIX : <https://example.test/>"',
    `\`<\${subject}> <\${predicate}> "value" .\``,
    "'<https://example.test/s> <https://example.test/p> \"value\" .'",
    '"<https://example.test/s> a <Class> ."',
    '"<s> <https://example.test/p>"',
    '`<subject> <https://example.test/p> "value" .`',
    '"<subject> a <https://example.test/Class> ."',
    '"<" + s + "> <"',
    '"PREFIX ex: " + "<https://example.test/>"',
    '["<", subject, "> <", predicate, "> <", object, "> ."].join("")',
    '["<" + s + ">", "<" + p + ">", "<" + o + ">"].join(" ")',
    '(["<", s, "> <", p, ">"]).join("")',
    '["INSERT DATA {}"].join("")',
    '"INSERT " + "DATA {" + body + "}"',
  ])("finds one RDF literal construction in %s", (literal) => {
    const root = workspace({ [path]: `const update = ${literal};` });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-literal": 1 });
  });

  it.each([
    '"delete data { <a> <b> <c> }"',
    '"insert { ?s ?p ?o }"',
    '"INSERT DATA is a label"',
    '"DELETE DATA"',
    '"INSERT INTO example"',
    '"@prefix is a word"',
    '"PREFIX example"',
    `\`<\${tag}><span>content</span>\``,
    '"<div><span>content</span>"',
    '"<div> <span>content</span>"',
    "`<subject> a <Class> .`",
    `\`<prefix\${tag}> <span>\``,
  ])("ignores non-RDF text %s", (literal) => {
    expect(scanRdfDiscipline(workspace({ [path]: `const text = ${literal};` })).violations).toEqual(
      [],
    );
  });

  it("ignores comments, regexes and non-factory functions", () => {
    const root = workspace({
      [path]: `// DataFactory.quad(s,p,o); INSERT DATA {}
/* @prefix ex: <https://example.test/> . */
const regex = /INSERT DATA|@prefix|quad\\(/;
function quad(a,b) { return a+b; } quad(1,2);`,
    });
    expect(scanRdfDiscipline(root).violations).toEqual([]);
  });

  it("uses only template text while walking calls inside interpolations", () => {
    const root = workspace({ [path]: `\`label \${insert({ where: true })} \${df.quad(s,p,o)}\`;` });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-factory": 1 });
  });

  it("walks independent string constructions inside template and concatenation calls", () => {
    const root = workspace({
      [path]: `\`label \${emit("INSERT DATA {}")}\`;
"label" + emit("DELETE DATA {}");`,
    });
    expect(scanRdfDiscipline(root).counts[path]).toEqual({ "rdf-literal": 2 });
  });

  it("requires real same-line allow comments, non-empty reasons and an actual violation", () => {
    const root = workspace({
      [path]: `${factory} // rdf-discipline-allow: serializer compatibility
// rdf-discipline-allow: unused on this line
${factory}
${factory} // rdf-discipline-allow:
const fake = "// rdf-discipline-allow: fake"; ${factory}
/* rdf-discipline-allow: fake */ ${factory}
const template = \`// rdf-discipline-allow: fake\`; ${factory}`,
    });
    const result = scanRdfDiscipline(root);
    expect(result.allowed).toBe(2);
    expect(result.counts[path]).toEqual({ "rdf-discipline-allow": 2, "rdf-factory": 5 });
    expect(result.problems).toEqual([
      `${path}:4 rdf-discipline-allow requires a non-empty reason`,
      `${path}:2 unused rdf-discipline-allow (no violation on this line)`,
    ]);
    const cli = run(root, "--update-baseline", "--accept-new");
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain("2 allow-comment(s)");
    expect(cli.stdout).not.toContain("Baseline updated");
    expect(cli.stdout).not.toContain("Accepted increase");
    expect(() => snapshot(root)).toThrow();
  });

  it("ratchets allow counts per file, including replacing existing debt with allowances", () => {
    const root = workspace({ [path]: factory });
    accept(root);
    const before = snapshot(root);
    put(root, path, `${factory} // rdf-discipline-allow: legacy serializer`);
    expect(checkRdfDiscipline(root).problems.join("\n")).toContain(
      "rdf-discipline-allow (1 > baseline 0)",
    );
    expect(run(root, "--update-baseline").status).toBe(1);
    expect(snapshot(root)).toBe(before);
    expect(run(root, "--update-baseline", "--accept-new").stdout).toContain("Accepted increase:");
    expect(JSON.parse(snapshot(root))).toEqual({ [path]: { "rdf-discipline-allow": 1 } });
    put(root, path, "");
    expect(checkRdfDiscipline(root)).toMatchObject({ problems: [], allowed: 0 });
    expect(run(root).stdout).toContain("baseline can shrink: run --update-baseline");
  });

  it("locates multiline calls on the method line so same-line allowances work", () => {
    const root = workspace({
      [path]: `factory\n  .quad(s,p,o); // rdf-discipline-allow: serializer boundary\nfactory\n  .quad(s,p,o);`,
    });
    expect(scanRdfDiscipline(root).violations).toEqual([{ path, line: 4, rule: "rdf-factory" }]);
  });

  it("does not interpret JSX text as an allow-comment", () => {
    const file = "apps/example/src/view.tsx";
    const root = workspace({
      [file]: `const view = <div>// rdf-discipline-allow: fake</div>; ${factory}`,
    });
    expect(scanRdfDiscipline(root)).toMatchObject({
      allowed: 0,
      counts: { [file]: { "rdf-factory": 1 } },
    });
  });

  it("scans all source extensions, app scripts and production test/build/out directories under src", () => {
    const included = [
      ...["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].map(
        (ext) => `apps/example/web/src/main.${ext}`,
      ),
      ...["test", "tests", "fixture", "fixtures", "e2e", "build", "out", "dist"].map(
        (dir) => `apps/example/src/${dir}/x.ts`,
      ),
      "apps/example/scripts/seed.cjs",
      "apps/example/scripts/nested/seed.mts",
    ];
    const excludedSrc = [
      "x.test.jsx",
      "x.spec.cts",
      "__tests__/x.ts",
      "__fixtures__/x.ts",
      "generated/x.ts",
      "x.d.ts",
      "x.d.mts",
      "x.d.cts",
      "node_modules/x.ts",
    ];
    const root = workspace({
      ...Object.fromEntries(
        [
          ...included,
          ...excludedSrc.map((file) => `apps/example/src/${file}`),
          "apps/example/test/src/x.ts",
          "apps/example/fixtures/src/x.ts",
          "apps/example/build/src/x.ts",
          "apps/example/out/src/x.ts",
          "apps/example/dist/src/x.ts",
          "apps/example/scripts/x.test.ts",
          "apps/example/scripts/__fixtures__/x.ts",
          "apps/example/other.ts",
          "packages/library/src/main.ts",
        ].map((file) => [file, factory]),
      ),
    });
    expect(scanRdfDiscipline(root)).toMatchObject({
      files: included.length,
      skippedSrcPaths: excludedSrc.length,
    });
    expect(run(root).stdout).toContain(`${excludedSrc.length} skipped src/ paths`);
  });

  it("refuses new debt on update, prints every explicit increase, and preserves the baseline on refusal", () => {
    const other = "apps/example/src/new.ts";
    const root = workspace({ [path]: factory });
    expect(run(root).status).toBe(1);
    expect(run(root, "--update-baseline").status).toBe(1);
    const initial = run(root, "--update-baseline", "--accept-new");
    expect(initial.status).toBe(0);
    expect(initial.stdout).toContain(`Accepted increase: ${path} rdf-factory (1 > baseline 0)`);
    const before = snapshot(root);
    put(root, path, `${factory} ${factory} const data = "INSERT DATA {}";`);
    put(root, other, factory);
    expect(run(root, "--update-baseline").status).toBe(1);
    expect(snapshot(root)).toBe(before);
    const accepted = run(root, "--update-baseline", "--accept-new");
    expect(accepted.status).toBe(0);
    expect(accepted.stdout.match(/Accepted increase:/g)).toHaveLength(3);
    expect(run(root).status).toBe(0);
  }, 15000);

  it("passes count reductions and file deletions without changing the baseline", () => {
    const other = "apps/example/src/other.ts";
    const root = workspace({ [path]: `${factory} ${factory}`, [other]: factory });
    accept(root);
    const before = snapshot(root);
    put(root, path, factory);
    rmSync(join(root, other));
    const reduced = run(root);
    expect(reduced.status).toBe(0);
    expect(reduced.stdout).toContain("baseline can shrink: run --update-baseline");
    expect(snapshot(root)).toBe(before);
    expect(run(root, "--update-baseline").status).toBe(0);
    expect(JSON.parse(snapshot(root))).toEqual({ [path]: { "rdf-factory": 1 } });
    put(root, path, "");
    expect(run(root).status).toBe(0);
  });

  it("matches moved rule counts one-to-one, but refuses copies, increases and mismatched moves", () => {
    const moved = "apps/example/src/moved.ts";
    const root = workspace({ [path]: `${factory} // rdf-discipline-allow: legacy\n${factory}` });
    accept(root);
    renameSync(join(root, path), join(root, moved));
    expect(checkRdfDiscipline(root).problems).toEqual([]);
    expect(run(root).stdout).toContain(`RDF baseline moved: ${path} -> ${moved}`);
    expect(run(root, "--update-baseline").status).toBe(0);
    put(root, path, `${factory} // rdf-discipline-allow: legacy\n${factory}`);
    expect(checkRdfDiscipline(root).problems.length).toBeGreaterThan(0);
    rmSync(join(root, moved));
    put(root, path, `${factory} ${factory}`);
    expect(checkRdfDiscipline(root).problems.length).toBeGreaterThan(0);
  });

  it("does not reuse a removed file allowance for two new paths", () => {
    const root = workspace({ [path]: factory });
    accept(root);
    rmSync(join(root, path));
    put(root, "apps/example/src/a.ts", factory);
    put(root, "apps/example/src/b.ts", factory);
    expect(checkRdfDiscipline(root).problems).toHaveLength(1);
  });

  it("uses deterministic code-point ordering for paths and diagnostics", () => {
    const names = ["ä", "Z", "a", "𐀀", "\uE000"];
    const root = workspace(
      Object.fromEntries(names.map((name) => [`apps/example/src/${name}.ts`, factory])),
    );
    const result = scanRdfDiscipline(root);
    expect(result.violations.map((v) => v.path)).toEqual(
      ["Z", "a", "ä", "\uE000", "𐀀"].map((name) => `apps/example/src/${name}.ts`),
    );
    expect(accept(root).notes.map((note) => note.split(" ")[2])).toEqual(
      Object.keys(result.counts),
    );
  });

  it("validates baselines even on update and fails missing roots", () => {
    const root = workspace({ [baselinePath]: '{"old.ts":{"rdf-factory":-1}}' });
    expect(() => checkRdfDiscipline(root)).toThrow(/Invalid/);
    expect(() => accept(root)).toThrow(/Invalid/);
    expect(run(join(root, "missing")).status).toBe(1);
  });
});
