// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  emitShapesTtl,
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
const store = (body: string) => new Store(new Parser().parse(`${HEADER} ${body}`));
const engine = createRdfEngine();
afterAll(() => engine.dispose());
async function crossCheck(ds: Store, source: string, emitted: string | undefined, conforms = true) {
  if (!emitted) throw new Error("missing emitted profile");
  for (const shapes of [source, emitted]) {
    expect((await engine.validate(ds, shapes)).conforms).toBe(conforms);
  }
}

const ONTOLOGY = `${HEADER}
ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child"; rdfs:subClassOf ex:OldOther, ex:Base .
ex:Other a owl:Class; rdfs:label "Other"; rdfs:comment "Other" .
ex:link a owl:ObjectProperty; rdfs:label "link"; rdfs:comment "link"; rdfs:domain ex:Root; rdfs:range ex:Child .
ex:title a owl:DatatypeProperty; rdfs:label "title"; rdfs:comment "title"; rdfs:domain ex:Child; rdfs:range xsd:string .`;
const treeProfile = (required: boolean, hasClass?: string, otherNode = false) => `${HEADER}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root;
  ${otherNode ? 'sh:property [ sh:path ex:otherLink; sh:name "otherLink"; sh:nodeKind sh:IRI; sh:node ex:OtherShape; sh:maxCount 1 ];' : ""}
  sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI;
    ${hasClass ? `sh:class ex:${hasClass};` : ""} sh:node ex:ChildShape;
    ${required ? "sh:minCount 1;" : ""} sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child, ex:OldChild;
  sh:property [ sh:path [ sh:alternativePath ( ex:title ex:oldTitle ) ]; sh:name "title";
    sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .
ex:OtherShape a sh:NodeShape; sh:targetClass ex:Other, ex:OldOther .`;
const config = (otherNode = false): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: [
    ...(!otherNode
      ? [{ name: "Other", targetClass: `${EX}Other`, subject: { convention: "self" as const } }]
      : []),
    {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: {
        root: {
          targetClass: `${EX}Root`,
          fragment: "it",
          links: { link: "child", ...(otherNode ? { otherLink: "other" } : {}) },
        },
        child: { targetClass: `${EX}Child`, fragment: "child", fields: { title: {} } },
        ...(otherNode
          ? { other: { targetClass: `${EX}Other`, fragment: "other", fields: {} } }
          : {}),
      },
    },
  ],
});
const generateTree = (shapesTtl: string, otherNode = false) =>
  generateModel({
    ontologyTtl: ONTOLOGY,
    shapesTtl,
    config: config(otherNode),
    admissionNamespace: EX,
  });

describe("R9 M1: reject sh:class aliases owned anywhere in the manifest", () => {
  for (const otherNode of [false, true]) {
    it.each([
      true,
      false,
    ])(`rejects cross-owner aliases in compilation (node owner=${otherNode}, required=%s)`, async (required) => {
      const source = treeProfile(required, "OldOther", otherNode);
      const normalized = parseShapes(source, `${EX}shapes/`, parseTurtle(ONTOLOGY));
      const emitted = emitShapesTtl(normalized, {});
      await crossCheck(
        store(`<${DOC}#it> a ex:Root; ex:link ex:child .
        ex:child a ex:Child, ex:OldOther; ex:title "child" .`),
        source,
        emitted,
      );
      await crossCheck(
        store(`<${DOC}#it> a ex:Root; ex:link ex:child .
        ex:child a ex:Child, ex:Other; ex:title "child" .`),
        source,
        emitted,
        false,
      );
      expect(() => compileManifest(normalized, config(otherNode))).toThrow(
        /sh:class.*alias.*migration/i,
      );
      expect(() => generateTree(source, otherNode)).toThrow(/sh:class.*alias.*migration/i);
    });
    it.each([
      true,
      false,
    ])(`fidelity independently rejects cross-owner aliases (node owner=${otherNode}, required=%s)`, (required) => {
      const valid = parseShapes(
        treeProfile(required, "Child", otherNode),
        `${EX}shapes/`,
        parseTurtle(ONTOLOGY),
      );
      const compiled = compileManifest(valid, config(otherNode));
      const contradictory = parseShapes(
        treeProfile(required, "OldOther", otherNode),
        `${EX}shapes/`,
        parseTurtle(ONTOLOGY),
      );
      const tree = compiled.manifest.entities.find((entity) => entity.kind === "composite");
      if (tree?.kind !== "composite") throw new Error("missing tree");
      const link = tree.nodes.flatMap((node) => node.fields).find((field) => field.name === "link");
      if (!link) throw new Error("missing link");
      link.hasClass = `${EX}OldOther`;
      expect(() => assertFidelity(contradictory, compiled)).toThrow(/sh:class.*alias.*migration/i);
    });
  }
});

describe("R9 M2: migration preserves data under other shapes' guards", () => {
  it("rejects shared canonical aliases even when the supplied subjects have disjoint types", async () => {
    const ontologyTtl = `${HEADER}
      ex:A a owl:Class; rdfs:label "A"; rdfs:comment "A" .
      ex:B a owl:Class; rdfs:label "B"; rdfs:comment "B" .
      ex:p a owl:DatatypeProperty; rdfs:label "p"; rdfs:comment "p"; rdfs:domain ex:A; rdfs:range xsd:string .`;
    const source = `${HEADER}
      ex:AShape a sh:NodeShape; sh:targetClass ex:A, ex:OldA;
        sh:property [ sh:path [ sh:alternativePath ( ex:p ex:old ) ]; sh:name "status"; sh:datatype xsd:string; sh:in ( "active" ); sh:minCount 1; sh:maxCount 1 ] .
      ex:BShape a sh:NodeShape; sh:targetClass ex:B;
        sh:property [ sh:path ex:p; sh:name "status"; sh:datatype xsd:string; sh:in ( "pending" ); sh:minCount 1; sh:maxCount 1 ] .`;
    expect(() =>
      generateModel({
        ontologyTtl,
        shapesTtl: source,
        config: {
          shapesBase: `${EX}shapes/`,
          prefixes: {},
          entities: ["A", "B"].map((name) => ({
            name,
            targetClass: `${EX}${name}`,
            subject: { convention: "self" as const },
          })),
        },
        admissionNamespace: EX,
      }),
    ).toThrow(/shared canonical predicate.*alias/i);
  });
  it("migrates reached composite predicates and types while preserving unreached nodes in both profiles", async () => {
    const source = treeProfile(true);
    const result = generateTree(source);
    const e = defineModel(result.manifest).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child .
      ex:child a ex:OldChild; ex:oldTitle "child" .
      ex:stray a ex:OldChild; ex:oldTitle "stray" .`);
    await crossCheck(ds, source, result.artifacts["shapes.ttl"]);
    const emitted = store(await e.storeToTurtle(ds));
    await crossCheck(emitted, source, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, emitted)).toEqual({ title: "child" });
    expect(emitted.getObjects(`${EX}child`, TYPE, null).map((term) => term.value)).toEqual([
      `${EX}Child`,
    ]);
    expect(emitted.getObjects(`${EX}child`, `${EX}oldTitle`, null)).toEqual([]);
    expect(emitted.getQuads(`${EX}stray`, null, null, null)).toEqual(
      ds.getQuads(`${EX}stray`, null, null, null),
    );
  });
});

describe("R9 M3: sh:node focus nodes need no target-class assertion", () => {
  it.each([
    undefined,
    "Base",
  ])("accepts an untyped child shape focus in both profiles (class=%s)", async (hasClass) => {
    const source = treeProfile(true, hasClass);
    const result = generateTree(source);
    const e = defineModel(result.manifest).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child .
      ex:child ${hasClass ? "a ex:Base;" : ""} ex:oldTitle "child" .`);
    await crossCheck(ds, source, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, ds)).toEqual({ title: "child" });
    const emitted = store(await e.storeToTurtle(ds));
    await crossCheck(emitted, source, result.artifacts["shapes.ttl"]);
    expect(e.parse(DOC, emitted)).toEqual({ title: "child" });
    expect(emitted.getObjects(`${EX}child`, TYPE, null)).toEqual(
      ds.getObjects(`${EX}child`, TYPE, null),
    );
    expect(emitted.getObjects(`${EX}child`, `${EX}oldTitle`, null)).toEqual([]);
  });
  it.each([
    true,
    false,
  ])("still grades failed child constraints and explicit classes (required=%s)", async (required) => {
    const source = treeProfile(required, "Base");
    const result = generateTree(source);
    const e = defineModel(result.manifest).entities.Tree;
    for (const child of ["a ex:Base; ex:title 1", 'ex:title "child"']) {
      const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ${child} .`);
      await crossCheck(ds, source, result.artifacts["shapes.ttl"], false);
      expect(e?.parse(DOC, ds)).toEqual(required ? undefined : {});
    }
  });
});
