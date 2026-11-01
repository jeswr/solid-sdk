// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  isCompositeConfig,
  parseShapes,
  parseTurtle,
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
async function crossCheck(
  ds: Store,
  shapes: string,
  emitted: string | undefined,
  conforms: boolean,
) {
  expect((await engine.validate(ds, shapes)).conforms).toBe(conforms);
  if (!emitted) throw new Error("missing emitted shapes");
  expect((await engine.validate(ds, emitted)).conforms).toBe(conforms);
}

describe("R7 M1: shape constraints precede IRI projection", () => {
  for (const set of [false, true]) {
    it.each([
      ["short original spelling", "https://example.org", 20, false],
      ["long original spelling", "https://example.org:443/", 24, true],
    ] as const)(`checks minLength on the %s (set=${set})`, async (_name, iri, min, conforms) => {
      const shapes = profile(
        `sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:minLength ${min}; sh:minCount 1; sh:maxCount ${set ? 3 : 1}`,
      );
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      const ds = data(`ex:p <${iri}>`);
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], conforms);
      expect(entity.parse(DOC, ds)).toEqual(
        conforms ? { val: set ? ["https://example.org/"] : "https://example.org/" } : undefined,
      );
      const wrapper = new entity.Wrapper(DOC, ds, DataFactory) as unknown as {
        val: string | Set<string> | undefined;
      };
      expect(set ? [...(wrapper.val as Set<string>)] : wrapper.val).toEqual(
        conforms ? (set ? ["https://example.org/"] : "https://example.org/") : set ? [] : undefined,
      );
    });
  }
  it.each([
    false,
    true,
  ])("drops an optional raw-length violation without rechecking the projection (set=%s)", async (set) => {
    const shapes = profile(
      `sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:minLength 24; sh:maxCount ${set ? 3 : 1}`,
    );
    const result = generate(shapes);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    for (const conforms of [true, false]) {
      const ds = data(`ex:p <https://example.org${conforms ? ":443/" : ""}>`);
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], conforms);
      expect(entity.parse(DOC, ds)).toEqual(
        conforms ? { val: set ? ["https://example.org/"] : "https://example.org/" } : {},
      );
      if (conforms && set) {
        const values = (new entity.Wrapper(DOC, ds, DataFactory) as unknown as { val: Set<string> })
          .val;
        expect(values.has("https://example.org/")).toBe(true);
        expect(values.delete("https://example.org/")).toBe(true);
        expect(values.size).toBe(0);
      }
    }
  });
});

describe("R7 M3: IRI enum members retain exact RDF identity", () => {
  const member = "https://example.org";
  for (const set of [false, true]) {
    const shapes = profile(
      `sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:in (<${member}>); sh:minCount 1; sh:maxCount ${set ? 3 : 1}`,
    );
    it(`reads the declared spelling and rejects its normalized lookalike (set=${set})`, async () => {
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      for (const conforms of [true, false]) {
        const ds = data(`ex:p <${member}${conforms ? "" : "/"}>`);
        await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], conforms);
        expect(entity.parse(DOC, ds)).toEqual(
          conforms ? { val: set ? [member] : member } : undefined,
        );
      }
    });
    it(`writes the declared spelling through build and wrapper mutations (set=${set})`, async () => {
      const result = generate(shapes);
      const entity = defineModel(result.manifest).entities.Thing;
      if (!entity) throw new Error("missing entity");
      const ds = entity.build(DOC, { val: set ? [member] : member });
      expect(ds.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual([member]);
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], true);
      const wrapper = new entity.Wrapper(DOC, ds, DataFactory) as unknown as {
        val: string | Set<string>;
      };
      if (set) {
        const values = wrapper.val as Set<string>;
        expect(values.has(member)).toBe(true);
        expect(values.has(`${member}/`)).toBe(false);
        expect(values.delete(`${member}/`)).toBe(false);
        expect(values.delete(member)).toBe(true);
        values.add(`${member}/`);
        expect(values.size).toBe(0);
        values.add(member);
      } else {
        wrapper.val = `${member}/`;
        expect(ds.getObjects(DOC, `${EX}p`, null)).toHaveLength(0);
        wrapper.val = member;
      }
      expect(ds.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual([member]);
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], true);
    });
  }
  it("keeps distinct enum IRIs even when URL.href would make them equal", async () => {
    const shapes = profile(
      `sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:in (<${member}> <${member}/>); sh:minCount 2; sh:maxCount 3`,
    );
    const result = generate(shapes);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    const ds = entity.build(DOC, { val: [member, `${member}/`] });
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], true);
    expect(entity.parse(DOC, ds)).toEqual({ val: [member, `${member}/`] });
  });
  it("applies config scheme policy separately without rewriting admitted enum identities", async () => {
    const members = ["https://EXAMPLE.org:443/", "http://EXAMPLE.org:80/"];
    const shapes = profile(
      `sh:nodeKind sh:IRI; sh:in (${members.map((iri) => `<${iri}>`).join(" ")}); sh:minCount 1; sh:maxCount 1`,
    );
    const config = structuredClone(CONFIG);
    const entityConfig = config.entities[0];
    if (!entityConfig || isCompositeConfig(entityConfig)) throw new Error("missing config");
    entityConfig.fields = { val: { iriScheme: "https" } };
    const result = generate(shapes, config);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    for (const iri of members) {
      const ds = data(`ex:p <${iri}>`);
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], true);
      expect(entity.parse(DOC, ds)).toEqual(iri.startsWith("https:") ? { val: iri } : undefined);
      const built = entity.build(DOC, { val: iri });
      expect(built.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual(
        iri.startsWith("https:") ? [iri] : [],
      );
    }
  });
});

describe("R7 L1: set cardinality counts distinct raw RDF terms", () => {
  it.each([
    false,
    true,
  ])("checks minCount before JS deduplication (aliases=%s)", async (aliases) => {
    const shapes = profile(
      "sh:datatype xsd:integer; sh:minCount 2; sh:maxCount 3",
      aliases ? "[ sh:alternativePath ( ex:p ex:old ) ]" : "ex:p",
    );
    const result = generate(shapes);
    const entity = defineModel(result.manifest).entities.Thing;
    if (!entity) throw new Error("missing entity");
    const ds = data(aliases ? 'ex:p 1; ex:old "01"^^xsd:integer' : 'ex:p 1, "01"^^xsd:integer');
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], true);
    expect(entity.parse(DOC, ds)).toEqual({ val: [1] });
    const duplicate = data(aliases ? "ex:p 1; ex:old 1" : "ex:p 1, 1");
    await crossCheck(duplicate, shapes, result.artifacts["shapes.ttl"], false);
    expect(entity.parse(DOC, duplicate)).toBeUndefined();
    const invalid = data('ex:p 1, "bad"^^xsd:integer');
    await crossCheck(invalid, shapes, result.artifacts["shapes.ttl"], false);
    expect(entity.parse(DOC, invalid)).toBeUndefined();
  });
});

describe("R7 M2: composite class constraints survive compilation and fidelity", () => {
  const ontologyTtl = `${ONTOLOGY}
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child" .
ex:OldChild rdfs:subClassOf ex:Child .`;
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
  it.each([
    undefined,
    `${EX}Other`,
  ])("fidelity rejects a lost or replaced class (%s)", (hasClass) => {
    const shapes = parseShapes(shapesTtl, CONFIG.shapesBase, parseTurtle(ontologyTtl));
    const compiled = compileManifest(shapes, config);
    const tree = compiled.manifest.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing composite");
    const field = tree.nodes
      .flatMap((node) => node.fields)
      .find((field) => field.kind === "nested");
    if (!field) throw new Error("missing link");
    Object.assign(field, { hasClass });
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it.each([
    true,
    false,
  ])("checks dataset class membership with link grading (required=%s)", async (required) => {
    const shapes = required
      ? shapesTtl
      : shapesTtl.replace("sh:minCount 1; sh:maxCount 1 ] .", "sh:maxCount 1 ] .");
    const result = generateModel({
      ontologyTtl,
      shapesTtl: shapes,
      config,
      admissionNamespace: EX,
    });
    const entity = defineModel(result.manifest).entities.Tree;
    if (!entity) throw new Error("missing tree");
    for (const [types, ancestry, conforms] of [
      ["ex:OldChild", "", false],
      ["ex:OldChild, ex:Child", "", true],
      [
        "ex:OldChild",
        "ex:OldChild rdfs:subClassOf ex:Middle . ex:Middle rdfs:subClassOf ex:Child .",
        true,
      ],
      [
        "ex:OldChild",
        "ex:OldChild rdfs:subClassOf ex:Middle . ex:Middle rdfs:subClassOf ex:OldChild .",
        false,
      ],
      [
        "ex:OldChild",
        "ex:OldChild rdfs:subClassOf ex:Middle . ex:Middle rdfs:subClassOf ex:OldChild, ex:Child .",
        true,
      ],
    ] as const) {
      const ds = new Store(
        new Parser().parse(`${HEADER}
<${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ${types}; ex:p "child" . ${ancestry}`),
      );
      await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], conforms);
      expect(entity.parse(DOC, ds)).toEqual(
        conforms ? { val: "child" } : required ? undefined : {},
      );
    }
  });
});
