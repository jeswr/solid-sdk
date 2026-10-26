// AUTHORED-BY Codex GPT-6.1-Sol
// Regression checks for the VOC-02 migration and its opt-in legacy sidecar.
// Local ontology tooling uses the same n3 parser/store as ontology-gate.mjs.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Store } from "n3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const oldRoot = new URL("/jeswr/", "https://w3id.org").href;
const newRoot = "https://jeswr.org/ns/";
const OWL = "http://www.w3.org/2002/07/owl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const DCT = "http://purl.org/dc/terms/";
const legacyFile = "legacy-w3id-alignments.ttl";
const parse = (file) =>
  new Store(new Parser({ baseIRI: newRoot }).parse(readFileSync(file, "utf8")));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const sectorFiles = walk(join(ROOT, "sectors"));
const mainFiles = ["fedapp.ttl", "fedreg.ttl", "task.ttl"]
  .map((file) => join(ROOT, file))
  .concat(sectorFiles.filter((file) => basename(file) === `${basename(dirname(file))}.ttl`));
assert.equal(mainFiles.length, 17);
const currentTerms = new Map();
for (const file of mainFiles) {
  const store = parse(file);
  const [ontology] = store.getSubjects(`${RDF}type`, `${OWL}Ontology`, null);
  assert.ok(ontology.value.startsWith(newRoot), file);
  for (const q of store) {
    if (q.subject.termType !== "NamedNode" || !q.subject.value.startsWith(`${ontology.value}#`))
      continue;
    const types = currentTerms.get(q.subject.value) ?? new Set();
    if (q.predicate.value === `${RDF}type`) types.add(q.object.value);
    currentTerms.set(q.subject.value, types);
  }
}
assert.equal(currentTerms.size, 774, "pre-rebase term inventory must be preserved");
const legacy = parse(join(ROOT, legacyFile));
assert.equal(legacy.size, currentTerms.size, "exactly one mapping per pre-rebase term");
const seen = new Set();
const counts = { equivalentClass: 0, equivalentProperty: 0, sameAs: 0 };
for (const q of legacy) {
  assert.equal(q.subject.termType, "NamedNode");
  assert.ok(q.subject.value.startsWith(oldRoot));
  assert.ok(!seen.has(q.subject.value), `duplicate mapping: ${q.subject.value}`);
  seen.add(q.subject.value);
  assert.equal(q.object.termType, "NamedNode");
  const target = newRoot + q.subject.value.slice(oldRoot.length);
  assert.equal(q.object.value, target, "mapping must point old → new with the same local term");
  const types = currentTerms.get(target);
  assert.ok(types?.size, `mapped term must exist: ${target}`);
  if (types.has(`${OWL}Class`) || types.has(`${RDFS}Class`)) {
    assert.equal(q.predicate.value, `${OWL}equivalentClass`);
    counts.equivalentClass += 1;
  } else if (
    [...types].some((type) =>
      [
        `${RDF}Property`,
        `${OWL}ObjectProperty`,
        `${OWL}DatatypeProperty`,
        `${OWL}AnnotationProperty`,
      ].includes(type),
    )
  ) {
    assert.equal(q.predicate.value, `${OWL}equivalentProperty`);
    counts.equivalentProperty += 1;
  } else {
    assert.equal(q.predicate.value, `${OWL}sameAs`);
    counts.sameAs += 1;
  }
}
assert.deepEqual(counts, { equivalentClass: 220, equivalentProperty: 304, sameAs: 250 });
assert.equal(
  readFileSync(join(ROOT, legacyFile), "utf8"),
  readFileSync(join(ROOT, "docs", legacyFile), "utf8"),
);
console.log("✓ All 774 legacy terms have exactly one correctly typed old → new mapping.");

let ontologyCount = 0;
const rootFiles = readdirSync(ROOT)
  .filter((file) => file.endsWith(".ttl") && file !== legacyFile)
  .map((file) => join(ROOT, file));
for (const file of [...rootFiles, ...sectorFiles.filter((file) => file.endsWith(".ttl"))]) {
  const store = parse(file);
  for (const q of store) {
    for (const term of [q.subject, q.predicate, q.object]) {
      assert.ok(!term.value.includes(oldRoot), `${file}: active legacy reference`);
    }
    if (q.predicate.value === `${OWL}imports`) {
      assert.ok(!q.object.value.includes("legacy-w3id"), `${file}: imported legacy sidecar`);
    }
  }
  for (const ontology of store.getSubjects(`${RDF}type`, `${OWL}Ontology`, null)) {
    if (!ontology.value.startsWith(newRoot)) continue; // preserve third-party ontologies
    ontologyCount += 1;
    assert.deepEqual(
      store.getObjects(ontology, `${OWL}versionInfo`, null).map((term) => term.value),
      ["2.0.0"],
      file,
    );
    assert.deepEqual(
      store.getObjects(ontology, `${OWL}versionIRI`, null).map((term) => term.value),
      [`${ontology.value}/2.0.0`],
      file,
    );
    assert.ok(
      store
        .getObjects(ontology, `${DCT}description`, null)
        .some((term) => term.value.includes("rebases this ontology")),
      `${file}: missing rebase explanation`,
    );
  }
}
assert.equal(ontologyCount, 34, "main ontologies, owned sidecars and curated modules versioned");
for (const file of walk(join(ROOT, "docs")).filter((path) => basename(path) !== legacyFile)) {
  assert.ok(
    !readFileSync(file, "utf8").includes(oldRoot),
    `${file}: generated docs retain legacy base`,
  );
}
const merged = readFileSync(join(ROOT, "dist", "vocab.nt"), "utf8");
assert.ok(!merged.includes(oldRoot), "legacy sidecar must stay outside dist/vocab.nt");
const fedcon = parse(join(ROOT, "fedcon.ttl"));
assert.equal(
  fedcon.getSubjects(`${RDF}type`, `${OWL}Ontology`, null)[0].value,
  "https://jeswr.org/fedcon",
);
assert.equal(
  fedcon.countQuads(null, `${OWL}versionIRI`, null, null),
  0,
  "fedcon version unchanged",
);
console.log(
  "✓ All 34 rebased ontologies are 2.0.0; fedcon identity is preserved; docs and build exclude legacy IRIs.",
);

// Verify every catalog target exists and each new namespace alias identifies the
// target ontology (or its version). XML catalogs here contain literal uri pairs.
let catalogCount = 0;
for (const file of sectorFiles.filter((path) => basename(path) === "catalog-v001.xml")) {
  const aliases = new Map();
  for (const [, iri, target] of readFileSync(file, "utf8").matchAll(
    /<uri name="([^"]+)" uri="([^"]+)"\s*\/>/g,
  )) {
    const path = join(dirname(file), target);
    assert.ok(existsSync(path), `${file}: missing ${target}`);
    aliases.set(iri, path);
    if (!iri.startsWith(newRoot)) continue;
    const store = parse(path);
    assert.ok(
      store.countQuads(iri.replace(/#$/, ""), `${RDF}type`, `${OWL}Ontology`, null) > 0 ||
        store.countQuads(null, `${OWL}versionIRI`, iri, null) > 0,
      `${file}: stale ontology/version alias ${iri}`,
    );
  }
  const main = join(dirname(file), `${basename(dirname(file))}.ttl`);
  const visited = new Set();
  const visit = (path) => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const imported of parse(path).getObjects(null, `${OWL}imports`, null)) {
      const target = aliases.get(imported.value);
      assert.ok(target, `${file}: import not resolved offline: ${imported.value}`);
      assert.ok(
        !target.endsWith(legacyFile),
        "legacy equivalences must stay out of every import closure",
      );
      visit(target);
    }
  };
  visit(main);
  catalogCount += 1;
}
assert.equal(catalogCount, 14);
console.log("✓ All 14 catalog import closures resolve offline and exclude the legacy sidecar.");
