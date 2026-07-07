// AUTHORED-BY Claude Opus 4.8
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  admit,
  type CodegenConfig,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, "..", "..", "examples", "bookmark");
const config = JSON.parse(
  readFileSync(join(exampleDir, "codegen.config.json"), "utf8"),
) as CodegenConfig;

const NS = "https://example.org/broken#";

// A deliberately broken ontology + shape: a class + property with NO label /
// definition / domain / range, and a NodeShape with a literal property missing a
// datatype. Every tier-a check should fire.
const BROKEN_ONTOLOGY = `
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix vann: <http://purl.org/vocab/vann/> .
@prefix ex:   <https://example.org/broken#> .
<https://example.org/broken> a owl:Ontology ;
  vann:preferredNamespaceUri "https://example.org/broken#" .
ex:Thing a owl:Class .
ex:prop a owl:DatatypeProperty .
`;

// A shape whose literal property is missing its datatype (exercises missing-datatype
// in admit(); it would ALSO make the manifest invalid, so it is only fed to admit()).
const BROKEN_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <https://example.org/broken#> .
[] a sh:NodeShape ;
  sh:targetClass ex:Thing ;
  sh:property [ sh:path ex:prop ; sh:nodeKind sh:Literal ; sh:minCount 1 ] .
`;

// A structurally VALID shape (datatype present) so the manifest compiles — the
// admission ERRORS then come purely from the ontology (missing labels / domain-range).
const VALID_SHAPE = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:  <https://example.org/broken#> .
[] a sh:NodeShape ;
  sh:targetClass ex:Thing ;
  sh:property [ sh:path ex:prop ; sh:datatype xsd:string ; sh:minCount 1 ] .
`;

const BROKEN_CONFIG = {
  shapesBase: "https://example.org/broken/shapes#",
  prefixes: { ex: NS },
  entities: [
    { targetClass: `${NS}Thing`, name: "Thing", subject: { convention: "hash-it" as const } },
  ],
};

describe("tier-a admission — fail-closed on a broken ontology / profile", () => {
  it("flags missing labels, definitions, domain/range, and datatype (all errors)", () => {
    const ontology = owlRdfsAdapter.adapt(parseTurtle(BROKEN_ONTOLOGY));
    const shapes = parseShapes(BROKEN_SHAPE, "https://example.org/broken/shapes#");
    const report = admit(ontology, shapes, NS);
    expect(report.ok).toBe(false);
    const codes = new Set(report.violations.map((v) => v.code));
    expect(codes.has("missing-label")).toBe(true);
    expect(codes.has("missing-definition")).toBe(true);
    expect(codes.has("missing-domain-range")).toBe(true);
    expect(codes.has("missing-datatype")).toBe(true);
  });

  it("generateModel throws AdmissionError on the broken inputs (fail-closed)", () => {
    expect(() =>
      generateModel({
        ontologyTtl: BROKEN_ONTOLOGY,
        shapesTtl: VALID_SHAPE,
        config: BROKEN_CONFIG,
      }),
    ).toThrow(AdmissionError);
  });

  it("but proceeds under allowUnadmitted (for demonstrating a gap), returning the report", () => {
    const result = generateModel({
      ontologyTtl: BROKEN_ONTOLOGY,
      shapesTtl: VALID_SHAPE,
      config: BROKEN_CONFIG,
      allowUnadmitted: true,
    });
    expect(result.admission.ok).toBe(false);
    expect(result.admission.violations.length).toBeGreaterThan(0);
  });

  it("the bookmark package admits cleanly (a warning for the unbounded tags set is non-blocking)", () => {
    const result = generateModel({
      ontologyTtl: readFileSync(join(exampleDir, "bookmark.ttl"), "utf8"),
      shapesTtl: readFileSync(join(exampleDir, "bookmark.shacl.ttl"), "utf8"),
      config,
    });
    expect(result.admission.ok).toBe(true);
    const warnings = result.admission.violations.filter((v) => v.severity === "warning");
    expect(warnings.map((w) => w.code)).toContain("missing-cardinality");
  });
});
