// AUTHORED-BY Codex (GPT-6.1 Sol)
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
  serializeCanonicalTurtle,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const EX = "https://example.org/merged#";
const H = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const ontologyTtl = `${H}
ex:Record a owl:Class; rdfs:label "Record"; rdfs:comment "Record" .
ex:text a owl:DatatypeProperty; rdfs:label "text"; rdfs:comment "text"; rdfs:domain ex:Record; rdfs:range xsd:string .
ex:extra a owl:DatatypeProperty; rdfs:label "extra"; rdfs:comment "extra"; rdfs:domain ex:Record; rdfs:range xsd:string .`;
const config: CodegenConfig = {
  shapesBase: "https://example.org/merged-shapes#",
  prefixes: { ex: EX },
  entities: [{ name: "Record", targetClass: `${EX}Record`, subject: { convention: "self" } }],
};
const shape = (
  name: string,
  constraint: string,
) => `ex:${name} a sh:NodeShape; sh:targetClass ex:Record;
  sh:property [ sh:path ex:text; ${constraint} ] .`;
const source = (
  a = "sh:datatype xsd:string; sh:minCount 1",
  b = "sh:datatype xsd:string; sh:maxCount 1",
) => `${H}${shape("AShape", a)}${shape("BShape", b)}`;
const generate = (shapesTtl = source(), cfg = config) =>
  generateModel({ ontologyTtl, shapesTtl, config: cfg, admissionNamespace: EX });
const normalized = (ttl = source()) =>
  parseShapes(ttl, config.shapesBase, owlRdfsAdapter.adapt(parseTurtle(ontologyTtl)));
const engine = createRdfEngine();
afterAll(() => engine.dispose());

describe("multiple NodeShapes per class admission", () => {
  it("merges additional optional properties and retains each severity and message", () => {
    const ttl = `${H}${shape("AShape", 'sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1; sh:message "must"')}
      ex:BShape a sh:NodeShape; sh:targetClass ex:Record; sh:property [ sh:path ex:extra;
        sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1; sh:severity sh:Warning; sh:message "should" ] .`;
    const result = generate(ttl);
    const fields = flat(result.manifest.entities[0]).fields;
    expect(result.manifest.entities).toHaveLength(1);
    expect(fields.find((f) => f.name === "text")?.guards?.requiredFailClosed).toBe(true);
    expect(fields.find((f) => f.name === "extra")?.guards?.requiredFailClosed).toBeUndefined();
    expect(result.artifacts["shapes.ttl"]).toContain('"must"');
    expect(result.artifacts["shapes.ttl"]).toContain('"should"');
    expect(result.artifacts["shapes.ttl"]).toContain("sh:Warning");
    const e = defineModel(result.manifest).entities.Record;
    expect(
      e?.parse("https://pod.test/doc", e.build("https://pod.test/doc", { text: "valid" })),
    ).toEqual({ text: "valid" });
  });

  it("conjoins compatible same-path cardinalities and matches emitted SHACL", async () => {
    const result = generate();
    expect(flat(result.manifest.entities[0]).fields[0]).toMatchObject({
      minCount: 1,
      maxCount: 1,
      guards: { requiredFailClosed: true },
    });
    const e = defineModel(result.manifest).entities.Record;
    for (const [objects, valid] of [
      ['"valid"', true],
      ['"one", "two"', false],
    ] as const) {
      const ds = new Store(
        new Parser().parse(`${H}<https://pod.test/doc> a ex:Record; ex:text ${objects} .`),
      );
      expect((await engine.validate(ds, result.artifacts["shapes.ttl"] as string)).conforms).toBe(
        valid,
      );
      expect(e?.parse("https://pod.test/doc", ds) !== undefined).toBe(valid);
    }
  });

  it("conjoins enum, numeric and string bounds without first-picking a property", () => {
    const numeric = generate(
      source(
        "sh:datatype xsd:integer; sh:minInclusive 2; sh:maxCount 5; sh:in ( 2 3 4 )",
        "sh:datatype xsd:integer; sh:maxInclusive 3; sh:minCount 1; sh:in ( 3 4 5 )",
      ),
    );
    expect(flat(numeric.manifest.entities[0]).fields[0]).toMatchObject({
      in: [3, 4],
      minCount: 1,
      maxCount: 5,
      guards: { minInclusive: 2, maxInclusive: 3, requiredFailClosed: true },
    });
    const text = generate(
      source(
        "sh:datatype xsd:string; sh:minLength 2",
        "sh:datatype xsd:string; sh:minLength 5; sh:maxCount 1",
      ),
    );
    expect(flat(text.manifest.entities[0]).fields[0]?.guards?.minLength).toBe(5);
    expect(generate(source("sh:maxCount 1", "sh:datatype xsd:string")).admission.ok).toBe(true);
  });

  it.each([
    true,
    false,
  ])("preserves Violation presence independently of advisory minima (required=%s)", (required) => {
    const ttl = source(
      `sh:datatype xsd:string; sh:minCount ${required ? 1 : 0}; sh:severity sh:Violation`,
      "sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1; sh:severity sh:Warning",
    );
    const field = flat(generate(ttl).manifest.entities[0]).fields[0];
    expect(field?.guards?.requiredFailClosed === true).toBe(required);
    const cfg = structuredClone(config);
    const entity = cfg.entities[0];
    if (!entity || "kind" in entity) throw new Error("missing flat config");
    entity.fields = { text: { default: "fallback" } };
    if (required) expect(() => generate(ttl, cfg)).toThrow(/default.*MUST/);
    else expect(generate(ttl, cfg).admission.ok).toBe(true);
  });

  it.each([
    ["sh:datatype xsd:string", "sh:datatype xsd:integer", "datatype"],
    ["sh:class <urn:A>", "sh:class <urn:B>", "hasClass"],
    ["sh:nodeKind sh:IRI", "sh:nodeKind sh:Literal", "nodeKind"],
    ["sh:datatype xsd:string", "sh:nodeKind sh:IRI", "incompatible"],
    ["sh:nodeKind sh:Literal", "sh:class <urn:A>", "incompatible"],
    ["sh:minCount 2", "sh:maxCount 1", "minCount"],
    [
      "sh:datatype xsd:integer; sh:minInclusive 5",
      "sh:datatype xsd:integer; sh:maxInclusive 2",
      "minInclusive",
    ],
    [
      "sh:datatype xsd:string; sh:in ( 'a' )",
      "sh:datatype xsd:string; sh:in ( 'b' )",
      "enumeration",
    ],
    ["sh:name 'left'", "sh:name 'right'", "name"],
    ["sh:node <urn:A>", "sh:node <urn:B>", "node"],
    ["sh:pattern '^https://'", "sh:pattern '^https?://'", "pattern"],
  ])("rejects conflicting %s / %s and names both NodeShapes", (a, b, reason) => {
    expect(() => generate(source(a, b))).toThrow(AdmissionError);
    expect(() => generate(source(a, b))).toThrow(new RegExp(`AShape.*BShape.*${reason}`));
    expect(() => generate(`${H}${shape("BShape", b)}${shape("AShape", a)}`)).toThrow(
      new RegExp(`AShape.*BShape.*${reason}`),
    );
  });

  it.each([
    "not",
    "or",
    "and",
    "hasValue",
    "qualifiedValueShape",
  ])("keeps a second shape's unsupported sh:%s closed", (component) => {
    expect(() =>
      generate(
        `${source()} ex:Safety a sh:NodeShape; sh:targetClass ex:Record; sh:${component} [] .`,
      ),
    ).toThrow(AdmissionError);
  });

  it("validates every source guard against the merged value kind", () => {
    expect(() => generate(source("sh:minLength 1", "sh:datatype xsd:integer"))).toThrow(
      /minLength requires a string-valued projection/,
    );
    expect(() => generate(source("sh:pattern '^https://'", "sh:datatype xsd:integer"))).toThrow(
      /unknown pattern/,
    );
    const valid = generate(source("sh:minInclusive 2", "sh:datatype xsd:integer; sh:maxCount 1"));
    expect(flat(valid.manifest.entities[0]).fields[0]?.guards?.minInclusive).toBe(2);
  });

  it("keeps duplicate paths within one NodeShape rejected", () => {
    expect(() =>
      generate(`${H}ex:A a sh:NodeShape; sh:targetClass ex:Record;
      sh:property [ sh:path ex:text; sh:datatype xsd:string ], [ sh:path ex:text; sh:maxCount 1 ] .`),
    ).toThrow(/duplicate-property-path/);
  });

  it("retains all constraints across three source shapes and fidelity detects dropped coverage", () => {
    const shapes = normalized(
      `${source()} ${shape("CShape", "sh:datatype xsd:string; sh:minLength 3")}`,
    );
    const compiled = compileManifest(shapes, config);
    expect(shapes.nodeShapes[0]?.properties[0]?.sources).toHaveLength(3);
    delete flat(compiled.manifest.entities[0]).fields[0]?.guards?.minLength;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it("names every contributing shape when a third shape conflicts with an accumulated constraint", () => {
    const ttl = `${source("sh:maxCount 1", "sh:datatype xsd:string")}
      ${shape("CShape", "sh:datatype xsd:integer")}`;
    expect(() => generate(ttl)).toThrow(/AShape.*BShape.*CShape.*datatype/);
  });

  it("merges named and anonymous shapes deterministically under triple permutation", () => {
    const ttl = `${source()} [] a sh:NodeShape; sh:targetClass ex:Record;
      sh:property [ sh:path ex:extra; sh:datatype xsd:string; sh:maxCount 1 ] .`;
    const permuted = serializeCanonicalTurtle(parseTurtle(ttl).reverse(), {}, "N-Triples");
    const original = generate(ttl);
    for (const name of ["model.json", "model.js", "model.d.ts", "shapes.ttl"])
      expect(generate(permuted).artifacts[name], name).toBe(original.artifacts[name]);
  });

  it("anonymous shape identities include literal languages and datatypes", () => {
    const ttl = `${H}[] a sh:NodeShape; sh:targetClass ex:Record; sh:message "same"@en;
      sh:property [ sh:path ex:text; sh:datatype xsd:string; sh:maxCount 1 ] .
      [] a sh:NodeShape; sh:targetClass ex:Record; sh:message "same"@fr;
      sh:property [ sh:path ex:text; sh:datatype xsd:string; sh:maxCount 1 ] .`;
    const permuted = serializeCanonicalTurtle(parseTurtle(ttl).reverse(), {}, "N-Triples");
    expect(generate(permuted).artifacts["shapes.ttl"]).toBe(generate(ttl).artifacts["shapes.ttl"]);
  });

  it("bounds anonymous shape identity inspection before recursive hostile metadata", () => {
    let chain = '"leaf"';
    for (let i = 0; i < 130; i++) chain = `[ <urn:metadata> ${chain} ]`;
    const ttl = `${source()} [] a sh:NodeShape; sh:targetClass ex:Record; <urn:metadata> ${chain} .`;
    expect(() => generate(ttl)).toThrow(/identity inspection exceeds its budget/);
  });

  it("rejects canonical/alternative-path overlaps across merged shapes", () => {
    const alias = `${H}ex:AShape a sh:NodeShape; sh:targetClass ex:Record;
      sh:property [ sh:path [ sh:alternativePath ( ex:text <https://old.test/text> ) ]; sh:datatype xsd:string ] .`;
    expect(() =>
      generate(`${alias} ex:BShape a sh:NodeShape; sh:targetClass ex:Record;
      sh:property [ sh:path <https://old.test/text>; sh:datatype xsd:string ] .`),
    ).toThrow(/AShape.*BShape.*overlapping path/);
    expect(() => generate(`${alias} ${shape("BShape", "sh:datatype xsd:string")}`)).toThrow(
      /AShape.*BShape.*alternative paths/,
    );
  });

  it("reuses one anonymous property-shape identity inside a merged class group", () => {
    const ttl = `${H}
      ex:AShape a sh:NodeShape; sh:targetClass ex:Record; sh:property _:shared .
      ex:BShape a sh:NodeShape; sh:targetClass ex:Record; sh:property _:shared .
      _:shared sh:path ex:text; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 .`;
    const shapes = normalized(ttl);
    const sources = shapes.nodeShapes[0]?.properties[0]?.sources;
    expect(sources).toHaveLength(2);
    expect(new Set(sources?.map((c) => c.shapeIri)).size).toBe(1);
    expect(flat(generate(ttl).manifest.entities[0]).fields).toHaveLength(1);
    const reversed = serializeCanonicalTurtle(parseTurtle(ttl).reverse(), {}, "N-Triples");
    expect(generate(reversed).artifacts["shapes.ttl"]).toBe(generate(ttl).artifacts["shapes.ttl"]);
  });

  it("keeps cross-class anonymous property-shape identity collisions rejected", () => {
    const ttl = `${H}
      ex:AShape a sh:NodeShape; sh:targetClass ex:Record; sh:property _:shared .
      ex:BShape a sh:NodeShape; sh:targetClass ex:Other; sh:property _:shared .
      _:shared sh:path ex:text; sh:datatype xsd:string; sh:maxCount 1 .`;
    expect(() => normalized(ttl)).toThrow(/blank node has multiple shape identities/);
  });

  it("rejects differing alias focus sets instead of applying extra constraints to legacy-only focuses", () => {
    expect(() =>
      generate(
        source().replace(
          "ex:BShape a sh:NodeShape; sh:targetClass ex:Record",
          "ex:BShape a sh:NodeShape; sh:targetClass ex:Record, <https://old.test/Record>",
        ),
      ),
    ).toThrow(/AShape.*BShape.*alias sets/);
  });

  it("rejects competing flat configs instead of choosing the first for a merged class", () => {
    const cfg = structuredClone(config);
    cfg.entities.push({
      name: "Alternate",
      targetClass: `${EX}Record`,
      subject: { convention: "self" },
      fields: { text: { requiredFailClosed: true } },
    });
    expect(() => generate(source(), cfg)).toThrow(
      /more than one entity config.*Record and Alternate/,
    );
    expect(() => compileManifest(normalized(), cfg)).toThrow(/more than one entity config/);
  });

  it.each([
    true,
    false,
  ])("rejects competing flat and composite configs (flat first=%s)", (flatFirst) => {
    const flatConfig = config.entities[0];
    if (!flatConfig) throw new Error("missing config");
    const composite: CodegenConfig["entities"][number] = {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: { root: { targetClass: `${EX}Record`, fragment: "it", fields: { text: {} } } },
    };
    const cfg = {
      ...config,
      entities: flatFirst ? [flatConfig, composite] : [composite, flatConfig],
    };
    expect(() => generate(source(), cfg)).toThrow(/more than one entity config/);
    expect(() => compileManifest(normalized(), cfg)).toThrow(/more than one entity config/);
  });

  it("allows sh:node to reference any member of a merged child shape group", () => {
    const vocab = `${ontologyTtl} ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${EX}Root`, fragment: "it", links: { child: "child" } },
            child: { targetClass: `${EX}Record`, fragment: "child", fields: { text: {} } },
          },
        },
      ],
    };
    for (const target of ["AShape", "BShape"]) {
      const profile = `${source()} ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property [
        sh:path ex:child; sh:node ex:${target}; sh:minCount 1; sh:maxCount 1 ] .`;
      expect(
        generateModel({ ontologyTtl: vocab, shapesTtl: profile, config: cfg }).admission.ok,
      ).toBe(true);
    }
  });
});
