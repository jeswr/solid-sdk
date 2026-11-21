#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { AdmissionError, emitLockfile, generateModel } from "@jeswr/federation-codegen";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { DataFactory } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outIndex = process.argv.lastIndexOf("--out");
const out = resolve(root, outIndex < 0 ? "src/generated" : process.argv[outIndex + 1]);
const readVocab = (file) => readFileSync(new URL(`../vocab/${file}`, import.meta.url), "utf8");
const messageOntologyTtl = readVocab("answerable.ttl");
const ontologyTtl = [messageOntologyTtl, readVocab("answerable-stores.ttl")].join("\n");
const messageShapesTtl = readVocab("answerable.shacl.ttl");
const storeShapesTtl = readVocab("answerable-stores.shacl.ttl");
const shapesTtl = [messageShapesTtl, storeShapesTtl].join("\n");
const config = JSON.parse(readFileSync(new URL("../codegen.config.json", import.meta.url), "utf8"));
const original = { ontologyTtl, shapesTtl, config };
const isStoreEntity = (entity) => ["RecordEntry", "WithheldRecordEntry"].includes(entity.name);
function admission(ontologyTtl, shapesTtl, entities) {
  try {
    generateModel({ ontologyTtl, shapesTtl, config: { ...config, entities } });
    return [];
  } catch (error) {
    if (!(error instanceof AdmissionError)) throw error;
    return error.violations;
  }
}
// Admission of each profile is independent. Their store and message shapes may
// constrain the same class in different projections.
const fullAdmission = [
  ...admission(
    messageOntologyTtl,
    messageShapesTtl,
    config.entities.filter((entity) => !isStoreEntity(entity)),
  ),
  ...admission(ontologyTtl, storeShapesTtl, config.entities.filter(isStoreEntity)),
];

// Project whole supported classes from the one normative model. No constraint is removed
// from a generated class. Rejected classes remain governed by the full SHACL at the wire.
const shapes = await parseRdf(shapesTtl, "text/turtle");
const ontology = await parseRdf(ontologyTtl, "text/turtle");
const { namedNode } = DataFactory;
const SH = "http://www.w3.org/ns/shacl#";
const classIris = new Set(config.entities.map((entity) => entity.targetClass));
// The durable GrantRecord also has a store shape for its ordered projection.
const messageShapes = await parseRdf(messageShapesTtl, "text/turtle");
const roots = [...classIris].flatMap((iri) => {
  const target = namedNode(iri);
  const predicate = namedNode(SH + "targetClass");
  const existing = messageShapes.getSubjects(predicate, target, null);
  return existing.length
    ? shapes
        .getSubjects(predicate, target, null)
        .filter((term) => existing.some((root) => root.equals(term)))
    : shapes.getSubjects(predicate, target, null);
});
const selected = new Set(roots.map((term) => term.value));
const queue = [...roots];
for (const term of queue) {
  for (const quad of shapes.getQuads(term, null, null, null)) {
    if (quad.object.termType === "BlankNode" && !selected.has(quad.object.value)) {
      selected.add(quad.object.value);
      queue.push(quad.object);
    }
  }
}
const shapeQuads = [...shapes].filter((quad) => selected.has(quad.subject.value));
const properties = new Set(
  shapeQuads
    .filter((quad) => quad.predicate.value === SH + "path")
    .map((quad) => quad.object.value),
);
const ontologyQuads = [...ontology].filter(
  (quad) => classIris.has(quad.subject.value) || properties.has(quad.subject.value),
);
const input = {
  ontologyTtl: await serialize(ontologyQuads, { format: "text/turtle" }),
  shapesTtl: await serialize(shapeQuads, { format: "text/turtle" }),
  config,
  admissionNamespace: "https://w3id.org/jeswr/awp#",
};
const result = generateModel(input);
mkdirSync(out, { recursive: true });
for (const [name, bytes] of Object.entries(result.artifacts))
  writeFileSync(resolve(out, name), bytes);
// Also pin the COMPLETE inputs, not just the supported projection.
writeFileSync(resolve(out, "codegen.lock.json"), emitLockfile(original));
writeFileSync(resolve(out, "full-admission.json"), `${JSON.stringify(fullAdmission, null, 2)}\n`);
console.log(
  `Generated ${result.manifest.entities.map((entity) => entity.name).join(", ")}; full-model admission has ${fullAdmission.filter((v) => v.severity === "error").length} errors (preserved in full-admission.json).`,
);
