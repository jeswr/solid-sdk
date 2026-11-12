// AUTHORED-BY Claude Opus 5.5
// Builds the exported validation shape (./health.shacl.ttl -> dist/health.shacl.ttl):
// the generated shapes plus the node-level composition that federation-codegen cannot
// admit into the codegen profile (see codegen/health.composition.ttl).
// Usage: node scripts/build-shacl.mjs [output-file]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Writer } from "n3";

const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const root = new URL("../", import.meta.url);

function parse(path) {
  const prefixes = {};
  const quads = new Parser({ baseIRI: new URL(path, root).href }).parse(
    readFileSync(new URL(path, root), "utf8"),
    null,
    (prefix, iri) => {
      prefixes[prefix] = iri.value;
    },
  );
  return { quads, prefixes };
}

function key(term) {
  if (term.termType !== "Literal") return `${term.termType}:${term.value}`;
  return `Literal:${term.value}^^${term.datatype.value}@${term.language}`;
}

function quadKey(quad) {
  return [quad.subject, quad.predicate, quad.object, quad.graph].map(key).join(" ");
}

const generated = parse("src/generated/shapes.ttl");
const composition = parse("codegen/health.composition.ttl");

const nodeShapes = new Set(
  generated.quads
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === `${SH}NodeShape`)
    .map((q) => q.subject.value),
);
for (const quad of composition.quads) {
  if (
    quad.predicate.value !== `${SH}node` ||
    quad.graph.termType !== "DefaultGraph" ||
    !nodeShapes.has(quad.subject.value) ||
    !nodeShapes.has(quad.object.value)
  ) {
    throw new Error(
      `codegen/health.composition.ttl may only link generated NodeShapes with sh:node: ${quadKey(quad)}`,
    );
  }
}

const merged = new Map();
for (const quad of [...generated.quads, ...composition.quads]) merged.set(quadKey(quad), quad);
const quads = [...merged.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([, quad]) => quad);

const writer = new Writer({ prefixes: { ...composition.prefixes, ...generated.prefixes } });
writer.addQuads(quads);
writer.end((error, turtle) => {
  if (error) throw error;
  const output = resolve(process.argv[2] ?? fileURLToPath(new URL("dist/health.shacl.ttl", root)));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, turtle);
});
