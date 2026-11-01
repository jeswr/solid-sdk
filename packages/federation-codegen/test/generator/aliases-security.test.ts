// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  type CodegenConfig,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";

const NS = "https://example.org/ns#";
const OLD = "https://example.org/old#";
const HEADER = `
  @prefix ex: <${NS}> . @prefix old: <${OLD}> .
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix owl: <http://www.w3.org/2002/07/owl#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const ONTOLOGY = `${HEADER}
  ex:Root a owl:Class ; rdfs:label "Root" ; rdfs:comment "Root" .
  ex:Child a owl:Class ; rdfs:label "Child" ; rdfs:comment "Child" ; rdfs:subClassOf <urn:Base> .
  ex:link a owl:ObjectProperty ; rdfs:label "link" ; rdfs:comment "link" ; rdfs:domain ex:Root ; rdfs:range ex:Child .
  ex:label a owl:DatatypeProperty ; rdfs:label "label" ; rdfs:comment "label" ; rdfs:domain ex:Child ; rdfs:range xsd:string .`;
const SHAPES = `${HEADER}
  ex:RootShape a sh:NodeShape ; sh:targetClass old:Root, ex:Root ;
    sh:property [ sh:path ex:link ; sh:name "link" ; sh:nodeKind sh:IRI ;
      sh:class <urn:Base> ; sh:node ex:ChildShape ; sh:minCount 1 ; sh:maxCount 1 ] .
  ex:ChildShape a sh:NodeShape ; sh:targetClass old:Child, ex:Child ; sh:property ex:LabelShape .
  ex:LabelShape a sh:PropertyShape ; sh:path [ sh:alternativePath ( old:label ex:label ) ] ;
    sh:name "label" ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ; sh:minLength 1 .`;
const CONFIG: CodegenConfig = {
  shapesBase: "https://example.org/shapes#",
  prefixes: { ex: NS },
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: {
        root: { targetClass: `${NS}Root`, fragment: "it", links: { link: "child" } },
        child: { targetClass: `${NS}Child`, fragment: "child", fields: { label: {} } },
      },
    },
  ],
};
const generate = (shapesTtl = SHAPES, ontologyTtl = ONTOLOGY) =>
  generateModel({ ontologyTtl, shapesTtl, config: CONFIG, admissionNamespace: NS });

describe("aliases retain closed admission and composite target checks", () => {
  it("generates alias reads with named shapes and explicit subclass ancestry together", () => {
    const result = generate();
    expect(result.admission.ok).toBe(true);
    const tree = defineModel(result.manifest).entities.Tree;
    if (!tree) throw new Error("missing tree");
    const ds = new Store(
      new Parser().parse(
        `<https://pod.example/doc#it> a <${OLD}Root> ; <${NS}link> <https://pod.example/child> .
         <https://pod.example/child> a <${OLD}Child> ; <${OLD}label> "legacy" .`,
      ),
    );
    expect(tree.parse("https://pod.example/doc", ds)).toEqual({ label: "legacy" });
    const quads = parseTurtle(ONTOLOGY);
    const ontology = owlRdfsAdapter.adapt(quads);
    expect(parseShapes(SHAPES, CONFIG.shapesBase, quads)).toEqual(
      parseShapes(SHAPES, CONFIG.shapesBase, ontology, quads),
    );
  });

  it("rejects a composite target when its subclass ancestry or referenced shape is wrong", () => {
    expect(() =>
      generate(
        SHAPES,
        ONTOLOGY.replace("rdfs:subClassOf <urn:Base>", "rdfs:subClassOf <urn:Other>"),
      ),
    ).toThrow(/target|class|shape/);
    expect(() => generate(SHAPES.replace("sh:node ex:ChildShape", "sh:node ex:RootShape"))).toThrow(
      /target|class|shape/,
    );
  });

  it.each([
    SHAPES.replace("sh:minLength 1", "sh:minLength 1 ; sh:maxLength 10"),
    SHAPES.replace("sh:property ex:LabelShape", "sh:closed true ; sh:property ex:LabelShape"),
    `${SHAPES}\nex:Orphan sh:alternativePath ( ex:label old:label ) .`,
  ])("keeps unsupported constraints and orphan paths closed with aliases", (shapesTtl) => {
    expect(() => generate(shapesTtl)).toThrow(AdmissionError);
  });
});
