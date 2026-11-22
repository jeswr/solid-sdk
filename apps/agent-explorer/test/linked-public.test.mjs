// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const checker = fileURLToPath(new URL("../scripts/check-public-bundle.mjs", import.meta.url));
const importer = fileURLToPath(new URL("../scripts/import-engine-runs.py", import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "explorer-linked-public-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function check(script, file) {
  const log = `${file}.log`;
  const fd = openSync(log, "w");
  try {
    const child = spawnSync(process.execPath, [script, file], { stdio: ["ignore", fd, fd] });
    assert.ifError(child.error);
    return { status: child.status, log: readFileSync(log, "utf8") };
  } finally {
    closeSync(fd);
  }
}

test("public bundle checks both escaped roadmap strings inside linked RDF views", (t) => {
  const roadmap = JSON.parse(
    readFileSync(new URL("../data/roadmap.json", import.meta.url), "utf8"),
  );
  const texts = [roadmap.note, roadmap.phases[7].items[1].detail];
  const dir = fixture(t);
  const file = join(dir, "test--baseline.json");
  function refuses() {
    const result = check(checker, file);
    assert.equal(result.status, 1, result.log);
    assert.match(result.log, /carries roadmap text/);
  }
  const key = `sha-256:${"a".repeat(64)}`;
  const writeView = (jsonld, turtle) =>
    writeFileSync(file, JSON.stringify({ [key]: { what: "record-entry", jsonld, turtle } }));
  const cleanRdf = '<urn:s> <urn:p> "public fragment" .';
  writeView('{"@id":"urn:s","urn:p":"public fragment"}', cleanRdf);
  const clean = check(checker, file);
  assert.equal(clean.status, 0, clean.log);
  for (const text of texts) {
    assert.match(text, /["\\\r\n\t]/);
    const literal = JSON.stringify(text);
    const jsonld = `{"@id":"urn:s","urn:p":${literal}}`;
    const turtle = `<urn:s> <urn:p> ${literal} .`;
    const trig = `<urn:g> { <urn:s> <urn:p> ${literal} . }`;
    for (const [ld, rdf] of [
      [jsonld, cleanRdf],
      ["{}", turtle],
      ["{}", trig],
    ]) {
      writeView(ld, rdf);
      refuses();
    }
  }
  // A Unicode escape can also hide roadmap text at the outer JSON layer.
  const literal = JSON.stringify(texts[0]);
  const first = literal.charCodeAt(1).toString(16).padStart(4, "0");
  writeFileSync(file, `{"nested":["\\u${first}${literal.slice(2)}]}`);
  refuses();
});

test("public bundle checks nested rdf:JSON literals with quotes and a newline", (t) => {
  const dir = fixture(t);
  const script = join(dir, "scripts", "check-public-bundle.mjs");
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "data"));
  copyFileSync(checker, script);
  const text = 'Private fixture: the next step is "under review".\nKeep the timeline internal.';
  const roadmap = JSON.parse(
    readFileSync(new URL("../data/roadmap.json", import.meta.url), "utf8"),
  );
  writeFileSync(join(dir, "data", "roadmap.json"), JSON.stringify({ roadmap, text }));

  const datatype = "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON";
  const lexical = JSON.stringify({ entries: [{ detail: text }] });
  const jsonld = JSON.stringify({
    "@id": "urn:s",
    "urn:p": { "@type": datatype, "@value": lexical },
  });
  const turtle = `<urn:s> <urn:p> ${JSON.stringify(lexical)}^^<${datatype}> .`;
  for (const [name, contents] of [
    ["view.jsonld", jsonld],
    ["view.ttl", turtle],
    ["jsonld-table.json", JSON.stringify({ view: { jsonld } })],
    ["turtle-table.json", JSON.stringify({ view: { turtle } })],
  ]) {
    const path = join(dir, name);
    writeFileSync(path, contents);
    const result = check(script, path);
    assert.equal(result.status, 1, `${name}: ${result.log}`);
    assert.match(result.log, /carries roadmap text/);
  }
});

test("public bundle rejects a deeply encoded rdf:JSON value and names its file", (t) => {
  const file = join(fixture(t), "deep-view.jsonld");
  const datatype = "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON";
  const detail = "A public fixture with no matching roadmap text.";
  const writeView = (lexical) =>
    writeFileSync(
      file,
      JSON.stringify({ "@id": "urn:s", "urn:p": { "@type": datatype, "@value": lexical } }),
    );
  writeView(JSON.stringify({ detail }));
  const shallow = check(checker, file);
  assert.equal(shallow.status, 0, shallow.log);
  let lexical = detail;
  for (let depth = 0; depth < 8; depth++) lexical = JSON.stringify({ nested: lexical });
  writeView(lexical);
  const deep = check(checker, file);
  assert.equal(deep.status, 1, deep.log);
  assert.match(deep.log, /deep-view\.jsonld: reached the roadmap scan decode depth limit/);
});

test("importer checks the run group and refuses symlinked tables and linked directories", async (t) => {
  await run("python3", [
    "-B",
    "-c",
    `
import importlib.util, sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('importer', sys.argv[1])
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
root = Path(sys.argv[2])
src, dest, outside = (root / name for name in ('source', 'dest', 'outside'))
for directory in (src, dest, outside):
    directory.mkdir()
ref = 'linked/sample--baseline.json'
table = outside / 'sample--baseline.json'
table.write_text('{}')
importer.validate_linked_reference({'scenario': 'sample'}, ref)

def refuses(operation, message):
    try:
        operation()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('unexpected success')

refuses(lambda: importer.validate_linked_reference(
    {'scenario': 'sample', 'configuration': 'alternative'}, ref), 'invalid linked table reference')
(src / 'linked').symlink_to(outside, target_is_directory=True)
copy = lambda: importer.copy_linked_table(src, dest, ref)
refuses(copy, 'regular directory')
(src / 'linked').unlink()
(src / 'linked').mkdir()
(src / ref).symlink_to(table)
refuses(copy, 'regular file')
(src / ref).unlink()
(src / ref).write_text('{}')
(dest / 'linked').symlink_to(outside, target_is_directory=True)
refuses(copy, 'regular directory')
(dest / 'linked').unlink()
(dest / 'linked').mkdir()
(dest / ref).symlink_to(table)
refuses(copy, 'regular file')
(dest / ref).unlink()
copy()
assert (dest / ref).read_bytes() == b'{}' + bytes([10])
assert table.read_text() == '{}'
`,
    importer,
    fixture(t),
  ]);
});
