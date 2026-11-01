// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  emitShapesTtl,
  FidelityError,
  generateModel,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
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
const profile = (parameters: string) => `${HEADER}
ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path [ sh:alternativePath ( ex:p ex:old ) ]; sh:name "val"; ${parameters} ] .`;
const store = (body: string) => new Store(new Parser().parse(`${HEADER} ${body}`));
const generate = (shapesTtl: string) =>
  generateModel({ ontologyTtl: ONTOLOGY, shapesTtl, config: CONFIG, admissionNamespace: EX });
const engine = createRdfEngine();
afterAll(() => engine.dispose());
async function crossCheck(ds: Store, source: string, emitted: string | undefined, conforms = true) {
  if (!emitted) throw new Error("missing emitted profile");
  for (const shapes of [source, emitted])
    expect((await engine.validate(ds, shapes)).conforms).toBe(conforms);
}

describe("R8 M1: raw RDF migration agrees with both SHACL profiles", () => {
  const shapes = profile("sh:datatype xsd:integer; sh:minCount 2; sh:maxCount 3");
  it.each([
    "serialization",
    "live add",
    "live invalid add",
    "live missing delete",
  ])("preserves raw integer cardinality through %s", async (operation) => {
    const result = generate(shapes);
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store('ex:doc a ex:Thing; ex:p 1; ex:old "01"^^xsd:integer .');
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, ds)).toEqual({ val: [1] });
    if (operation !== "serialization") {
      const values = (new e.Wrapper(DOC, ds, DataFactory) as unknown as { val: Set<number> }).val;
      if (operation === "live add") values.add(2);
      else if (operation === "live invalid add") values.add("bad" as unknown as number);
      else expect(values.delete(3)).toBe(false);
    }
    const migrated = operation === "serialization" ? store(await e.storeToTurtle(ds)) : ds;
    await crossCheck(migrated, shapes, result.artifacts["shapes.ttl"]);
    expect(migrated.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual(
      operation === "live add" ? ["1", "01", "2"] : ["1", "01"],
    );
    expect(e.parse(DOC, migrated)).toEqual({ val: operation === "live add" ? [1, 2] : [1] });
  });
  it.each([
    false,
    true,
  ])("preserves lexical IRI length during serialization (set=%s)", async (set) => {
    const shapes = profile(
      `sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:minLength 24; sh:minCount 1; sh:maxCount ${set ? 3 : 1}`,
    );
    const result = generate(shapes);
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store("ex:doc a ex:Thing; ex:old <https://example.org:443/> .");
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    const emitted = store(await e.storeToTurtle(ds));
    await crossCheck(emitted, shapes, result.artifacts["shapes.ttl"]);
    expect(emitted.getObjects(DOC, `${EX}p`, null)).toEqual(ds.getObjects(DOC, `${EX}old`, null));
    expect(e.parse(DOC, emitted)).toEqual({
      val: set ? ["https://example.org/"] : "https://example.org/",
    });
  });
  it("live deletion preserves retained lexical IRI length", async () => {
    const shapes = profile(
      'sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:minLength 24; sh:minCount 1; sh:maxCount 3',
    );
    const result = generate(shapes);
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store(
      "ex:doc a ex:Thing; ex:old <https://example.org:443/>, <https://other.example.org/> .",
    );
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    const values = (new e.Wrapper(DOC, ds, DataFactory) as unknown as { val: Set<string> }).val;
    expect(values.delete("https://other.example.org/")).toBe(true);
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    expect(ds.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual([
      "https://example.org:443/",
    ]);
  });
});

const TREE_ONTOLOGY = `${ONTOLOGY}
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child"; rdfs:subClassOf ex:OldChild .`;
const treeProfile = (hasClass = "Child", required = true) => `${HEADER}
ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:class ex:${hasClass}; sh:node ex:ChildShape; ${required ? "sh:minCount 1;" : ""} sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child, ex:OldChild; sh:property [ sh:path ex:p; sh:name "val"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .`;
const TREE_CONFIG: CodegenConfig = {
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
const generateTree = (shapesTtl: string) =>
  generateModel({
    ontologyTtl: TREE_ONTOLOGY,
    shapesTtl,
    config: TREE_CONFIG,
    admissionNamespace: EX,
  });

describe("R8 M2: reject sh:class naming a target alias removed by migration", () => {
  it.each([
    true,
    false,
  ])("generation rejects contradictory alias requirements (required=%s)", async (required) => {
    const shapes = treeProfile("OldChild", required);
    const normalized = parseShapes(shapes, CONFIG.shapesBase, parseTurtle(TREE_ONTOLOGY));
    const emitted = emitShapesTtl(normalized, {});
    const before = store(
      `<${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:Child, ex:OldChild; ex:p "child" .`,
    );
    await crossCheck(before, shapes, emitted);
    const after = store(
      `<${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:Child; ex:p "child" .`,
    );
    await crossCheck(after, shapes, emitted, false);
    expect(() => generateTree(shapes)).toThrow(/sh:class.*alias.*migration/i);
    expect(() => compileManifest(normalized, TREE_CONFIG)).toThrow(/sh:class.*alias.*migration/i);
  });
  it.each([
    true,
    false,
  ])("fidelity independently rejects the contradictory manifest (required=%s)", (required) => {
    const valid = parseShapes(
      treeProfile("Child", required),
      CONFIG.shapesBase,
      parseTurtle(TREE_ONTOLOGY),
    );
    const compiled = compileManifest(valid, TREE_CONFIG);
    const contradictory = parseShapes(
      treeProfile("OldChild", required),
      CONFIG.shapesBase,
      parseTurtle(TREE_ONTOLOGY),
    );
    const tree = compiled.manifest.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing composite");
    const link = tree.nodes.flatMap((node) => node.fields).find((field) => field.kind === "nested");
    if (!link) throw new Error("missing link");
    link.hasClass = `${EX}OldChild`;
    expect(() => assertFidelity(contradictory, compiled)).toThrow(FidelityError);
    expect(() => assertFidelity(contradictory, compiled)).toThrow(/sh:class.*alias.*migration/i);
  });
});

describe("R8 M3: targetClass accepts data-graph subclasses", () => {
  it.each([
    "Child",
    "OldChild",
  ])("parses an unlisted subclass reaching %s in both profiles", async (target) => {
    const shapes = treeProfile("Base");
    const ontologyTtl = `${TREE_ONTOLOGY}\nex:Child rdfs:subClassOf ex:Base .`;
    const result = generateModel({
      ontologyTtl,
      shapesTtl: shapes,
      config: TREE_CONFIG,
      admissionNamespace: EX,
    });
    const e = defineModel(result.manifest).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds =
      store(`<${DOC}#it> a ex:SpecialRoot; ex:link ex:child . ex:SpecialRoot rdfs:subClassOf ex:Thing .
      ex:child a ex:SpecialChild; ex:p "child" . ex:SpecialChild rdfs:subClassOf ex:Middle .
      ex:Middle rdfs:subClassOf ex:${target}, ex:Base, ex:SpecialChild .`);
    const before = [...ds];
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, ds)).toEqual({ val: "child" });
    const emitted = store(await e.storeToTurtle(ds));
    await crossCheck(emitted, shapes, result.artifacts["shapes.ttl"]);
    expect(emitted.getObjects(`${EX}child`, TYPE, null).map((term) => term.value)).toEqual([
      `${EX}SpecialChild`,
    ]);
    expect([...ds]).toEqual(before);
  });
  it.each([
    true,
    false,
  ])("grades an absent data-graph ancestry despite ontology compatibility (required=%s)", async (required) => {
    const shapes = treeProfile("Thing", required);
    const ontologyTtl = `${TREE_ONTOLOGY}\nex:Child rdfs:subClassOf ex:Thing .`;
    const result = generateModel({
      ontologyTtl,
      shapesTtl: shapes,
      config: TREE_CONFIG,
      admissionNamespace: EX,
    });
    const e = defineModel(result.manifest).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds = store(
      `<${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:Child; ex:p "child" .`,
    );
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"], false);
    expect(e.parse(DOC, ds)).toEqual(required ? undefined : {});
  });
  it("recognizes a flat subclass through an alias without inserting canonical types on serialization", async () => {
    const shapes = `${HEADER} ex:S a sh:NodeShape; sh:targetClass ex:Thing, ex:OldThing; sh:property [ sh:path ex:p; sh:name "val"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .`;
    const result = generate(shapes);
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store(
      'ex:doc a ex:Special . ex:Special rdfs:subClassOf ex:OldThing . ex:doc ex:p "value" .',
    );
    await crossCheck(ds, shapes, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, ds)).toEqual({ val: "value" });
    const emitted = store(await e.storeToTurtle(ds));
    await crossCheck(emitted, shapes, result.artifacts["shapes.ttl"]);
    expect(emitted.getObjects(DOC, TYPE, null)).toEqual(ds.getObjects(DOC, TYPE, null));
  });
});
