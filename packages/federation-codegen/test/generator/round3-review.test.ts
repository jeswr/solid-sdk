// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { AdmissionError, type CodegenConfig, generateModel, parseShapes } from "../../src/index.js";
import { serializeCanonicalTurtle } from "../../src/rdf.js";

const EX = "https://ex.test/";
const HEADER = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const ONTOLOGY = `${HEADER}
ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .
ex:p a owl:DatatypeProperty; rdfs:label "p"; rdfs:comment "p";
  rdfs:domain ex:Root; rdfs:range xsd:string .`;
const config = (): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: { root: { targetClass: `${EX}Root`, fragment: "it", fields: { weak: {} } } },
    },
  ],
});
const shape = (properties: string) => `${HEADER}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property ${properties} .`;
const generate = (ttl: string, cfg = config()) =>
  generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: ttl, config: cfg, admissionNamespace: EX });
const weak = '[ sh:path ex:p; sh:name "weak"; sh:datatype xsd:string; sh:maxCount 1 ]';

describe("H1: reject overlapping property paths before projection", () => {
  for (const path of ["ex:p", "[ sh:alternativePath ( ex:p ex:oldP ) ]", "ex:oldP"]) {
    for (const reversed of [false, true]) {
      it(`rejects duplicate path ${path} in both orders (reversed=${reversed})`, () => {
        const strongPath = path === "ex:oldP" ? "[ sh:alternativePath ( ex:p ex:oldP ) ]" : path;
        const strong = `[ sh:path ${strongPath}; sh:name "strong"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ]`;
        const other = path === "ex:oldP" ? weak.replace("ex:p", "ex:oldP") : weak;
        const ttl = shape((reversed ? [other, strong] : [strong, other]).join(", "));
        expect(() => generate(ttl)).toThrow(AdmissionError);
      });
    }
  }
});

const INJECTED_PREFIX = "evil: <urn:unused> . <urn:evil> <urn:p> <urn:o> . #";
describe("H2: generator prefix labels", () => {
  it("rejects the forged-statement prefix during generation", () => {
    const cfg = config();
    cfg.prefixes = { [INJECTED_PREFIX]: "urn:ns:" };
    expect(() => generate(shape(weak), cfg)).toThrow(/prefix/i);
  });
  it("rechecks the forged-statement prefix at the writer boundary", () => {
    expect(() => serializeCanonicalTurtle([], { [INJECTED_PREFIX]: "urn:ns:" })).toThrow(/prefix/i);
  });
  it("accepts the legitimate empty prefix", () => {
    const cfg = config();
    cfg.prefixes = { "": EX };
    const result = generate(shape(weak), cfg);
    expect(result.manifest.prefixes).toEqual({ "": EX });
    expect(result.artifacts["shapes.ttl"]).toContain(`@prefix : <${EX}>`);
  });
});

describe("M2: severity is single-valued", () => {
  for (const severities of ["sh:Warning, sh:Violation", "sh:Violation, sh:Warning"]) {
    for (const owner of ["property", "node"] as const) {
      it(`rejects duplicate severity on ${owner} in order ${severities}`, () => {
        const ttl =
          owner === "property"
            ? shape(
                weak.replace(
                  "sh:maxCount 1",
                  `sh:minCount 1; sh:maxCount 1; sh:severity ${severities}`,
                ),
              )
            : shape(weak).replace(
                "sh:targetClass ex:Root",
                `sh:targetClass ex:Root; sh:severity ${severities}`,
              );
        // Raw shape admission must reject even if a later fidelity check would also fail.
        expect(() => parseShapes(ttl, `${EX}shapes/`)).toThrow(AdmissionError);
        expect(() => generate(ttl)).toThrow(AdmissionError);
      });
    }
  }
});
