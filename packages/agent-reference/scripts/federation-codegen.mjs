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
const ontologyTtl = readFileSync(new URL("../vocab/answerable.ttl", import.meta.url), "utf8");
const shapesTtl = readFileSync(new URL("../vocab/answerable.shacl.ttl", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../codegen.config.json", import.meta.url), "utf8"));
const original = { ontologyTtl, shapesTtl, config };
let fullAdmission = [];
try {
  generateModel(original);
} catch (error) {
  if (!(error instanceof AdmissionError)) throw error;
  fullAdmission = error.violations;
}

// Project whole supported classes from the one normative model. No constraint is removed
// from a generated class. Rejected classes remain governed by the full SHACL at the wire.
const shapes = await parseRdf(shapesTtl, "text/turtle");
const ontology = await parseRdf(ontologyTtl, "text/turtle");
const { namedNode } = DataFactory;
const SH = "http://www.w3.org/ns/shacl#";
const classIris = new Set(config.entities.map((entity) => entity.targetClass));
const roots = [...classIris].flatMap((iri) =>
  shapes.getSubjects(namedNode(SH + "targetClass"), namedNode(iri), null),
);
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
