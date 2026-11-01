// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  parseShapes,
} from "../../src/index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const HEADER = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const ONTOLOGY = `${HEADER}
ex:Thing a owl:Class; rdfs:label "Thing"; rdfs:comment "Thing" .
ex:p a owl:DatatypeProperty; rdfs:label "p"; rdfs:comment "p"; rdfs:domain ex:Thing; rdfs:range xsd:string .`;
const CONFIG: CodegenConfig = {
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: [{ name: "Thing", targetClass: `${EX}Thing`, subject: { convention: "self" } }],
};
const profile = (parameters: string, path = "ex:p") => `${HEADER}
ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ${path}; sh:name "val"; ${parameters} ] .`;
const data = (body: string) =>
  new Store(new Parser().parse(`${HEADER} ex:doc a ex:Thing; ${body} .`));
const generate = (shapesTtl: string, config = CONFIG) =>
  generateModel({ ontologyTtl: ONTOLOGY, shapesTtl, config, admissionNamespace: EX });
const engine = createRdfEngine();
afterAll(() => engine.dispose());
async function crossCheck(ds: Store, shapes: string, conforms: boolean, emitted?: string) {
  expect((await engine.validate(ds, shapes)).conforms).toBe(conforms);
  if (emitted) expect((await engine.validate(ds, emitted)).conforms).toBe(conforms);
}

describe("R6 M1 declined: deliberate canonical-first singleton migration reads", () => {
  it.each([
    true,
    false,
  ])("deliberately prefers canonical values over conflicting stale aliases (required=%s)", async (required) => {
    const shapes = profile(
      `sh:datatype xsd:integer; sh:minCount ${required ? 1 : 0}; sh:maxCount 1`,
      "[ sh:alternativePath ( ex:old ex:p ex:older ) ]",
    );
    const result = generate(shapes);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    for (const body of ["ex:p 1; ex:old 2", "ex:p 1; ex:older 2", 'ex:p 1; ex:older "bad"']) {
      const ds = data(body);
      // SHACL counts the whole alternativePath union; migration reads deliberately
      // preserve the reviewed bookmark oracle's canonical-first precedence.
      await crossCheck(ds, shapes, false, result.artifacts["shapes.ttl"]);
      expect(entity.parse(DOC, ds)).toEqual({ val: 1 });
      expect((new entity.Wrapper(DOC, ds, DataFactory) as unknown as { val?: number }).val).toBe(1);
    }
    const identical = data("ex:p 1; ex:old 1; ex:older 1");
    await crossCheck(identical, shapes, true, result.artifacts["shapes.ttl"]);
    expect(entity.parse(DOC, identical)).toEqual({ val: 1 });
  });
});

describe("R6 M2: composite aliases must preserve the link class", () => {
  const ontologyTtl = `${ONTOLOGY}
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child" .`;
  const shapesTtl = `${HEADER}
ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:class ex:Child; sh:node ex:ChildShape; sh:minCount 1; sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child, ex:OldChild; sh:property [ sh:path ex:p; sh:name "val"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .`;
  const config: CodegenConfig = {
    ...CONFIG,
    entities: [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: {
          root: { targetClass: `${EX}Thing`, fragment: "it", links: { link: "child" } },
          child: { targetClass: `${EX}Child`, fragment: "child", fields: { val: {} } },
        },
      },
    ],
  };
  const input = { ontologyTtl, shapesTtl, config, admissionNamespace: EX };
  it.each([
    true,
    false,
  ])("checks aliases at runtime without ontology ancestry (data ancestry=%s)", async (inData) => {
    const result = generateModel(input);
    const entity = defineModel(result.manifest).entities.Tree;
    if (!entity) throw new Error("missing tree");
    const ds = new Store(
      new Parser().parse(
        `${HEADER} <${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:OldChild; ex:p "child" . ${inData ? "ex:OldChild rdfs:subClassOf ex:Child ." : ""}`,
      ),
    );
    await crossCheck(ds, shapesTtl, inData, result.artifacts["shapes.ttl"]);
    expect(entity.parse(DOC, ds)).toEqual(inData ? { val: "child" } : undefined);
  });
  it.each([
    true,
    false,
  ])("requires transitive subclass ancestry in the data (data ancestry=%s)", async (inData) => {
    const ancestry = `${HEADER} ex:OldChild rdfs:subClassOf ex:Middle . ex:Middle rdfs:subClassOf ex:Child .`;
    const result = generateModel({ ...input, ontologyTtl: ontologyTtl + ancestry });
    const entity = defineModel(result.manifest).entities.Tree;
    if (!entity) throw new Error("missing tree");
    const ds = new Store(
      new Parser().parse(
        `${HEADER} <${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:OldChild; ex:p "child" . ${inData ? ancestry : ""}`,
      ),
    );
    await crossCheck(ds, shapesTtl, inData, result.artifacts["shapes.ttl"]);
    expect(entity.parse(DOC, ds)).toEqual(inData ? { val: "child" } : undefined);
  });
});

describe("R6 M3: required sets reject every invalid raw member", () => {
  it.each([
    ["datatype", "sh:datatype xsd:integer", '1, "bad"'],
    ["lexical", "sh:datatype xsd:integer", '1, "noon"^^xsd:integer'],
    ["enum", "sh:datatype xsd:integer; sh:in (1 2)", "1, 3"],
    ["bound", "sh:datatype xsd:integer; sh:minInclusive 0", "1, -1"],
    ["length", "sh:datatype xsd:string; sh:minLength 2", '"ok", "x"'],
    [
      "pattern",
      'sh:nodeKind sh:IRI; sh:pattern "^https://"',
      "<https://ok.test/>, <http://bad.test/>",
    ],
    ["node kind", "sh:nodeKind sh:IRI", '<https://ok.test/>, "https://bad.test/"'],
  ])("rejects %s violations but preserves optional filtering", async (_name, constraint, members) => {
    for (const required of [true, false]) {
      const shapes = profile(`${constraint}; sh:minCount ${required ? 1 : 0}; sh:maxCount 3`);
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      const ds = data(`ex:p ${members}`);
      await crossCheck(ds, shapes, false, result.artifacts["shapes.ttl"]);
      const parsed = entity.parse(DOC, ds);
      if (required) expect(parsed).toBeUndefined();
      else expect(parsed?.val).toHaveLength(1);
    }
  });
});

describe("R6 M4: admission uses only validated runtime datatypes", () => {
  it.each([
    ['"noon"^^xsd:time', false],
    ['"12:30:00"^^xsd:time', true],
  ] as const)("rejects unsupported xsd:time even for %s", async (value, conforms) => {
    const shapes = profile("sh:datatype xsd:time; sh:minCount 1; sh:maxCount 1");
    await crossCheck(data(`ex:p ${value}`), shapes, conforms);
    expect(() => generate(shapes)).toThrow(AdmissionError);
  });
});

describe("R6 M5: shape patterns inspect the original IRI lexical value", () => {
  for (const pattern of ["^https://", "^https?://"]) {
    it.each([
      false,
      true,
    ])(`rejects normalized pattern bypasses for ${pattern} (set=%s)`, async (set) => {
      const shapes = profile(
        `sh:nodeKind sh:IRI; sh:pattern "${pattern}"; sh:minCount 1; sh:maxCount ${set ? 3 : 1}`,
      );
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      for (const value of ["HTTPS://example.test/", "https:example.test"]) {
        const ds = data(`ex:p <${value}>`);
        await crossCheck(ds, shapes, false, result.artifacts["shapes.ttl"]);
        expect(entity.parse(DOC, ds)).toBeUndefined();
      }
      const ds = data("ex:p <https://EXAMPLE.test/>");
      await crossCheck(ds, shapes, true, result.artifacts["shapes.ttl"]);
      expect(entity.parse(DOC, ds)?.val).toEqual(
        set ? ["https://example.test/"] : "https://example.test/",
      );
    });
  }
});

describe("R6 L1: minLength never invents a nonblank constraint", () => {
  it("accepts required whitespace that satisfies minLength", async () => {
    const shapes = profile("sh:datatype xsd:string; sh:minLength 1; sh:minCount 1; sh:maxCount 1");
    const result = generate(shapes);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    const ds = data('ex:p " "');
    await crossCheck(ds, shapes, true, result.artifacts["shapes.ttl"]);
    expect(entity.parse(DOC, ds)).toEqual({ val: " " });
  });
  it("fidelity rejects an unsourced nonBlank guard on minLength", () => {
    const shapes = parseShapes(
      profile("sh:datatype xsd:string; sh:minLength 1; sh:maxCount 1"),
      CONFIG.shapesBase,
    );
    const compiled = compileManifest(shapes, CONFIG);
    const entity = compiled.manifest.entities[0];
    if (!entity || entity.kind === "composite" || !entity.fields[0])
      throw new Error("missing field");
    entity.fields[0].guards = { ...entity.fields[0].guards, nonBlank: true };
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
});

describe("R6 L2: explicit UTC offsets preserve valid calendar dates", () => {
  for (const type of ["date", "dateTime"]) {
    it.each(["Z", "+00:00", "-00:00"])(`accepts xsd:${type} with %s`, async (offset) => {
      const shapes = profile(`sh:datatype xsd:${type}; sh:minCount 1; sh:maxCount 1`);
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      const value = `2024-02-29${type === "dateTime" ? "T00:00:00" : ""}${offset}`;
      const ds = data(`ex:p "${value}"^^xsd:${type}`);
      await crossCheck(ds, shapes, true, result.artifacts["shapes.ttl"]);
      expect(entity.parse(DOC, ds)).toEqual({ val: new Date("2024-02-29T00:00:00Z") });
    });
  }
});
