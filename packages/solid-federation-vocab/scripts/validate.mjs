// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Validate the vocabulary sources:
//   1. parse every *.ttl with n3.Parser → confirm well-formed Turtle, count quads,
//      and assert every term carries the required rdfs:label / rdfs:comment /
//      rdfs:isDefinedBy.
//   2. parse + expand every *context*.jsonld with the `jsonld` library → confirm
//      the @context is a valid, processable JSON-LD context.
//
// This is the repo's test gate. RDF here goes through n3 / jsonld — never a
// bespoke parser (suite house rule).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Parser } from "n3";
import jsonld from "jsonld";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_ONTOLOGY = "http://www.w3.org/2002/07/owl#Ontology";

let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const ttlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".ttl"));
if (ttlFiles.length === 0) fail("no .ttl files found");

for (const file of ttlFiles) {
  console.log(`\nTurtle: ${file}`);
  const ttl = readFileSync(join(ROOT, file), "utf8");
  let quads;
  try {
    quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${file}` }).parse(ttl);
  } catch (err) {
    fail(`parse error: ${err.message}`);
    continue;
  }
  ok(`well-formed Turtle (${quads.length} quads)`);

  // Subjects that are typed but NOT the ontology node must have label + comment
  // + isDefinedBy. Re-used terms (isDefinedBy pointing elsewhere) still get a
  // label/comment restatement here, so the same assertion holds.
  const subjects = new Map(); // subject IRI -> { types:Set, preds:Set }
  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    const s = subjects.get(q.subject.value) ?? { types: new Set(), preds: new Set() };
    s.preds.add(q.predicate.value);
    if (q.predicate.value === RDF_TYPE) s.types.add(q.object.value);
    subjects.set(q.subject.value, s);
  }

  let termCount = 0;
  for (const [iri, info] of subjects) {
    if (info.types.has(OWL_ONTOLOGY)) continue; // ontology node — checked separately
    if (info.types.size === 0 && !iri.startsWith("https://w3id.org/jeswr/")) continue;
    termCount += 1;
    for (const required of [`${RDFS}label`, `${RDFS}comment`, `${RDFS}isDefinedBy`]) {
      if (!info.preds.has(required)) {
        fail(`${iri} is missing <${required}>`);
      }
    }
  }
  if (termCount > 0) ok(`${termCount} term(s) each carry rdfs:label + rdfs:comment + rdfs:isDefinedBy`);

  // Ontology node sanity.
  const ontology = [...subjects].find(([, i]) => i.types.has(OWL_ONTOLOGY));
  if (!ontology) fail("no owl:Ontology node");
  else ok(`ontology node: ${ontology[0]}`);
}

const ctxFiles = readdirSync(ROOT).filter((f) => f.endsWith("context.jsonld") || f === "context.jsonld");
if (ctxFiles.length === 0) fail("no *context.jsonld files found");

for (const file of ctxFiles) {
  console.log(`\nJSON-LD context: ${file}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  } catch (err) {
    fail(`invalid JSON: ${err.message}`);
    continue;
  }
  if (!doc["@context"]) {
    fail("no @context key");
    continue;
  }
  // Expand a sample instance that uses the context — this exercises the whole
  // context through the jsonld processor and catches a malformed term mapping.
  const sample = {
    "@context": doc["@context"],
    type: doc["@context"]["@context"] ? undefined : undefined,
  };
  try {
    // Build a tiny instance referencing terms common to both contexts.
    const instance = { "@context": doc["@context"], id: "https://example.org/x" };
    if (doc["@context"].Task) instance.type = "Task";
    if (doc["@context"].App) instance.type = "App";
    if (doc["@context"].title) instance.title = "sample";
    const expanded = await jsonld.expand(instance);
    ok(`@context expands cleanly (${expanded.length} expanded node(s))`);
  } catch (err) {
    fail(`context expansion failed: ${err.message}`);
  }
  void sample;
}

console.log("");
if (failures > 0) {
  console.error(`VALIDATION FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log("VALIDATION PASSED — all Turtle well-formed, all contexts expand.");
