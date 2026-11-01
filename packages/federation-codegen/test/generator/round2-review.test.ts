// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { ManifestFieldGuards } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  isCompositeConfig,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";

const EX = "https://ex.test/";
const SH = "http://www.w3.org/ns/shacl#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const HEADER = `@prefix ex: <${EX}> . @prefix sh: <${SH}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const ONTOLOGY = `${HEADER}
ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child" .
ex:link a owl:ObjectProperty; rdfs:label "link"; rdfs:comment "link"; rdfs:domain ex:Root; rdfs:range ex:Child .
ex:p a owl:DatatypeProperty; rdfs:label "p"; rdfs:comment "p"; rdfs:domain ex:Child; rdfs:range xsd:string .`;
const ontologyQuads = parseTurtle(ONTOLOGY);
const ontology = owlRdfsAdapter.adapt(ontologyQuads);
const shapesTtl = (
  parameters = "sh:datatype xsd:string; sh:maxCount 1",
  path = "ex:p",
) => `${HEADER}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:class ex:Child; sh:minCount 1; sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child; sh:property [ sh:path ${path}; sh:name "val"; ${parameters} ] .`;
const config = (composite = true): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: composite
    ? [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${EX}Root`, fragment: "it", links: { link: "child" } },
            child: { targetClass: `${EX}Child`, fragment: "child", fields: { val: {} } },
          },
        },
      ]
    : [
        { name: "Root", targetClass: `${EX}Root`, subject: { convention: "self" } },
        { name: "Child", targetClass: `${EX}Child`, subject: { convention: "self" } },
      ],
});
const generate = (ttl = shapesTtl(), cfg = config()) =>
  generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: ttl, config: cfg, admissionNamespace: EX });
const normalized = (ttl: string) => parseShapes(ttl, `${EX}shapes/`, ontology, ontologyQuads);
const fieldsOf = (compiled: ReturnType<typeof compileManifest>) =>
  compiled.manifest.entities.flatMap((e) =>
    e.kind === "composite" ? e.nodes.flatMap((n) => n.fields) : e.fields,
  );

it("H1: rejects an inline sh:node whose missing child title SHACL rejects end to end", async () => {
  const ttl = `${HEADER}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:minCount 1; sh:maxCount 1; sh:node [ sh:property [ sh:path ex:p; sh:datatype xsd:string; sh:minCount 1 ] ] ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child .`;
  const cfg = config();
  const e = cfg.entities[0];
  if (!e || !isCompositeConfig(e) || !e.nodes.child) throw new Error("missing child");
  e.nodes.child.fields = {};
  const engine = createRdfEngine();
  try {
    const ds = await parseRdf(
      `<${EX}doc#it> a <${EX}Root>; <${EX}link> <${EX}child> . <${EX}child> a <${EX}Child> .`,
      "text/turtle",
      {},
    );
    expect((await engine.validate(ds, ttl)).conforms).toBe(false);
    expect(() => generate(ttl, cfg)).toThrow(AdmissionError);
  } finally {
    engine.dispose();
  }
});

it.each([
  '"ex:ChildShape"',
  "ex:UnprojectedShape",
])("H1: rejects an unprojected sh:node %s", (node) => {
  expect(() =>
    generate(shapesTtl().replace("sh:class ex:Child", `sh:class ex:Child; sh:node ${node}`)),
  ).toThrow(AdmissionError);
});

describe("M1: generation rejects configured defaults on Violation minCount fields", () => {
  for (const composite of [false, true]) {
    it(`rejects required field defaults (composite=${composite})`, () => {
      const cfg = config(composite);
      const e = cfg.entities.find(
        (e) => isCompositeConfig(e) || ("targetClass" in e && e.targetClass === `${EX}Child`),
      );
      if (!e) throw new Error("missing entity");
      if (isCompositeConfig(e)) {
        if (!e.nodes.child) throw new Error("missing child");
        e.nodes.child.fields = { val: { default: "fallback" } };
      } else e.fields = { val: { default: "fallback" } };
      expect(() =>
        generate(
          shapesTtl("sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1").replace(
            "sh:class ex:Child;",
            "sh:severity sh:Warning;",
          ),
          cfg,
        ),
      ).toThrow(/default.*MUST|MUST.*default|required.*default/i);
    });
  }
});

describe("M2: generation reserves implicit structural predicates", () => {
  it.each([
    `<${TYPE}>`,
    `[ sh:alternativePath ( ex:p <${TYPE}> ) ]`,
  ])("rejects rdf:type in path %s", (path) => {
    expect(() => generate(shapesTtl(undefined, path))).toThrow(AdmissionError);
  });
  it("rejects rdf:type as a composite structural link", () => {
    expect(() => generate(shapesTtl().replace("sh:path ex:link", `sh:path <${TYPE}>`))).toThrow(
      AdmissionError,
    );
  });
  it("rejects a flat field claiming a composite link predicate", () => {
    expect(() => generate(shapesTtl(undefined, "ex:link"))).toThrow(AdmissionError);
  });
});

describe("M3: generation enforces type alias ownership across shapes", () => {
  it.each([
    "canonical",
    "alias",
  ])("rejects an external target reused as another shape type %s", (slot) => {
    let ttl = shapesTtl().replace(
      "sh:targetClass ex:Root",
      "sh:targetClass ex:Root, <https://legacy.test/T>",
    );
    const cfg = config();
    if (slot === "canonical") {
      ttl +=
        "\n<https://legacy.test/Shape> a sh:NodeShape; sh:targetClass <https://legacy.test/T> .";
      cfg.entities.push({
        name: "External",
        targetClass: "https://legacy.test/T",
        subject: { convention: "self" },
      });
    } else
      ttl = ttl.replace(
        "sh:targetClass ex:Child",
        "sh:targetClass ex:Child, <https://legacy.test/T>",
      );
    expect(() => generate(ttl, cfg)).toThrow(AdmissionError);
  });
});

const malformedParameters: Array<[string, string]> = [
  ...["minCount", "maxCount", "minLength", "maxLength"].flatMap(
    (p): Array<[string, string]> => [
      [p, '"nonsense"'],
      [p, "<https://ex.test/one>"],
      [p, '"1"^^xsd:string'],
      [p, '"0x10"^^xsd:integer'],
      [p, '"-1"^^xsd:integer'],
      [p, '"1.5"^^xsd:decimal'],
      [p, '"9007199254740993"^^xsd:integer'],
    ],
  ),
  ...["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"].flatMap(
    (p): Array<[string, string]> => [
      [p, '"nonsense"'],
      [p, "<https://ex.test/one>"],
      [p, '"0x10"^^xsd:integer'],
      [p, '"1e2"^^xsd:decimal'],
      [p, '"NaN"^^xsd:double'],
    ],
  ),
  ...["pattern", "flags"].flatMap(
    (p): Array<[string, string]> => [
      [p, "<https://ex.test/text>"],
      [p, '"\\\\S"@en'],
      [p, '"1"^^xsd:integer'],
    ],
  ),
  ...["datatype", "class", "nodeKind", "severity"].flatMap(
    (p): Array<[string, string]> => [
      [
        p,
        `"${p === "severity" ? `${SH}Warning` : p === "nodeKind" ? `${SH}IRI` : "https://ex.test/T"}"`,
      ],
      [p, "[]"],
    ],
  ),
  ["severity", "ex:UnknownSeverity"],
];
describe("M4: projected SHACL parameters retain term kinds, datatypes and lexical forms", () => {
  for (const [parameter, value] of malformedParameters) {
    it(`rejects malformed sh:${parameter} ${value}`, () => {
      const base = ["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"].includes(
        parameter,
      )
        ? "sh:datatype xsd:integer; sh:maxCount 1"
        : parameter === "datatype"
          ? "sh:maxCount 1"
          : parameter === "maxCount"
            ? "sh:datatype xsd:string"
            : "sh:datatype xsd:string; sh:maxCount 1";
      expect(() =>
        generate(
          shapesTtl(`${base}; sh:${parameter} ${value}`, "[ sh:alternativePath ( ex:p ex:oldP ) ]"),
        ),
      ).toThrow(AdmissionError);
    });
  }
  for (const [datatype, member] of [
    ["boolean", '"yes"^^xsd:boolean'],
    ["integer", '"0x10"^^xsd:integer'],
    ["unsignedByte", '"256"^^xsd:unsignedByte'],
    ["positiveInteger", '"-1"^^xsd:positiveInteger'],
    ["decimal", '"1e2"^^xsd:decimal'],
    ["float", '"1e100"^^xsd:float'],
    ["duration", '"P1W"^^xsd:duration'],
    ["string", "[]"],
    ["boolean", '"true"'],
    ["integer", '"1"^^xsd:decimal'],
  ]) {
    it(`rejects malformed sh:in ${member} on ${datatype} instead of coercing aliases`, () => {
      expect(() =>
        generate(
          shapesTtl(
            `sh:datatype xsd:${datatype}; sh:maxCount 1; sh:in (${member})`,
            "[ sh:alternativePath ( ex:p ex:oldP ) ]",
          ),
        ),
      ).toThrow(AdmissionError);
    });
  }
  it.each([
    ["integer", '"+01"^^xsd:integer', 1],
    ["boolean", '"0"^^xsd:boolean', false],
    ["decimal", '"+.5"^^xsd:decimal', 0.5],
    ["duration", '"PT1M"^^xsd:duration', "PT1M"],
  ])("strictly decodes valid %s enum members", (datatype, member, expected) => {
    const result = generate(
      shapesTtl(`sh:datatype xsd:${datatype}; sh:maxCount 1; sh:in (${member})`),
    );
    const f = result.manifest.entities
      .flatMap((e) => (e.kind === "composite" ? e.nodes.flatMap((n) => n.fields) : e.fields))
      .find((f) => f.name === "val");
    expect(f?.in).toEqual([expected]);
  });
});

describe("M5: fidelity requires every shape-derived guard in flat and composite fields", () => {
  const cases: Array<[string, string, keyof ManifestFieldGuards | "in"]> = [
    ["numeric minimum", "sh:datatype xsd:integer; sh:minInclusive 1", "minInclusive"],
    ["numeric maximum", "sh:datatype xsd:integer; sh:maxInclusive 10", "maxInclusive"],
    ["length minimum", "sh:datatype xsd:string; sh:minLength 2", "minLength"],
    ["length nonBlank", "sh:datatype xsd:string; sh:minLength 1", "nonBlank"],
    ["pattern nonBlank", 'sh:datatype xsd:string; sh:pattern "\\\\S"', "nonBlank"],
    ["http scheme", 'sh:nodeKind sh:IRI; sh:pattern "^https?://"', "iriScheme"],
    ["https scheme", 'sh:nodeKind sh:IRI; sh:pattern "^https://"', "iriScheme"],
    ["enum", 'sh:datatype xsd:string; sh:in ("a" "b")', "in"],
    ["required", "sh:datatype xsd:string; sh:minCount 1", "requiredFailClosed"],
  ];
  for (const composite of [false, true]) {
    for (const [label, parameter, key] of cases) {
      it(`rejects deletion of ${label} (composite=${composite})`, () => {
        // Flat Root's class hint is advisory, so it can be projected without a nested link.
        const ttl = shapesTtl(`${parameter}; sh:maxCount 1`).replace(
          "sh:class ex:Child;",
          "sh:severity sh:Warning;",
        );
        const shapes = normalized(ttl);
        const compiled = compileManifest(shapes, config(composite));
        expect(() => assertFidelity(shapes, compiled)).not.toThrow();
        const f = fieldsOf(compiled).find((f) => f.name === "val");
        if (!f) throw new Error("missing val");
        if (key === "in") delete f.in;
        else {
          if (!f.guards) throw new Error("missing guard");
          delete f.guards[key];
        }
        expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
      });
    }
  }
});

it("L1: documents current 78-test parity and implemented SHACL-derived G5", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const adr = readFileSync(
    new URL("../../../../decisions/0003-domain-model-codegen.md", import.meta.url),
    "utf8",
  );
  expect(readme).not.toContain("Snapshot caveat");
  expect(readme).toContain("78/78");
  const row = adr.split("\n").find((line) => line.startsWith("| G5 "));
  expect(row).toContain("implemented");
  expect(row).toContain("sh:targetClass");
  expect(row).toContain("sh:alternativePath");
  expect(row).toContain("#213");
});
