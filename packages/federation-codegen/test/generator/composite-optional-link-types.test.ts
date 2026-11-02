// AUTHORED-BY Claude Opus 5.5
//
// sst-ild.4.12: a composite's flat `*Data` type must not mark a child's required fields
// required when the link to that child is optional. Build omits an optional link's child
// when the caller supplies none of its fields, so the static type has to accept that.
// Required links keep their children's required fields required.
import { defineModel } from "@jeswr/model-runtime";
import type { Store } from "n3";
import { describe, expect, it } from "vitest";
import { type CodegenConfig, generateModel } from "../../src/index.js";

const EX = "https://example.org/sched#";

const ONTOLOGY = `
@prefix ex:   <${EX}> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
ex:Task a owl:Class ; rdfs:label "Task"@en ; skos:definition "A to-do item."@en .
ex:Rule a owl:Class ; rdfs:label "Rule"@en ; skos:definition "A recurrence rule."@en .
ex:Owner a owl:Class ; rdfs:label "Owner"@en ; skos:definition "The owning agent."@en .
ex:Anchor a owl:Class ; rdfs:label "Anchor"@en ; skos:definition "A rule's anchor date."@en .
`;

const SHAPES = `
@prefix ex:  <${EX}> .
@prefix exs: <https://example.org/sched/shapes#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
exs:TaskShape a sh:NodeShape ; sh:targetClass ex:Task ;
  sh:property [ sh:path ex:summary ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
    sh:severity sh:Violation ] ;
  sh:property [ sh:path ex:rule ; sh:nodeKind sh:IRI ; sh:class ex:Rule ; sh:maxCount 1 ;
    sh:severity sh:Info ] ;
  sh:property [ sh:path ex:owner ; sh:nodeKind sh:IRI ; sh:class ex:Owner ; sh:minCount 1 ;
    sh:maxCount 1 ; sh:severity sh:Violation ] .
exs:RuleShape a sh:NodeShape ; sh:targetClass ex:Rule ;
  sh:property [ sh:path ex:frequency ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
    sh:severity sh:Violation ] ;
  sh:property [ sh:path ex:interval ; sh:datatype xsd:positiveInteger ; sh:maxCount 1 ;
    sh:severity sh:Info ] ;
  sh:property [ sh:path ex:anchor ; sh:nodeKind sh:IRI ; sh:class ex:Anchor ; sh:minCount 1 ;
    sh:maxCount 1 ; sh:severity sh:Violation ] .
exs:AnchorShape a sh:NodeShape ; sh:targetClass ex:Anchor ;
  sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
    sh:severity sh:Violation ] .
exs:OwnerShape a sh:NodeShape ; sh:targetClass ex:Owner ;
  sh:property [ sh:path ex:name ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ;
    sh:severity sh:Violation ] .
`;

const CONFIG: CodegenConfig = {
  shapesBase: "https://example.org/sched/shapes#",
  prefixes: { ex: EX, xsd: "http://www.w3.org/2001/XMLSchema#" },
  entities: [
    {
      name: "Task",
      kind: "composite",
      root: "task",
      nodes: {
        task: {
          targetClass: `${EX}Task`,
          fragment: "it",
          fields: { summary: {} },
          links: { rule: "rule", owner: "owner" },
        },
        rule: {
          targetClass: `${EX}Rule`,
          fragment: "rule",
          fields: { frequency: {}, interval: {} },
          links: { anchor: "anchor" },
        },
        anchor: { targetClass: `${EX}Anchor`, fragment: "anchor", fields: { label: {} } },
        owner: { targetClass: `${EX}Owner`, fragment: "owner", fields: { name: {} } },
      },
    },
  ],
};

const generated = generateModel({ ontologyTtl: ONTOLOGY, shapesTtl: SHAPES, config: CONFIG });
const dts = generated.artifacts["model.d.ts"] ?? "";
const dataBlock = dts.slice(
  dts.indexOf("export interface TaskData {"),
  dts.indexOf("}\n", dts.indexOf("export interface TaskData {")),
);

describe("composite *Data requiredness across optional links", () => {
  it("keeps root and required-link children's MUST fields required", () => {
    expect(dataBlock).toContain('"summary": string;');
    expect(dataBlock).toContain('"name": string;');
  });

  it("types an optional link's MUST fields optional, including behind a required grandchild link", () => {
    expect(dataBlock).toContain('"frequency"?: string;');
    expect(dataBlock).toContain('"label"?: string;');
  });

  const manifest = JSON.parse(generated.artifacts["model.json"] ?? "{}");
  const Task = defineModel(manifest).entities.Task as unknown as {
    build(url: string, data: Record<string, unknown>): Store;
    parse(url: string, dataset: Store): Record<string, unknown> | undefined;
  };
  const Url = "https://pod.example/t";

  it("matches the runtime: build omits the optional subtree when none of its fields is given", () => {
    const store = Task.build(Url, { summary: "s", name: "n" });
    expect(store.getQuads(null, `${EX}rule`, null, null)).toHaveLength(0);
    expect(store.getQuads(null, `${EX}anchor`, null, null)).toHaveLength(0);
    expect(store.getQuads(null, `${EX}owner`, null, null)).toHaveLength(1);
  });

  it("matches the runtime: parse returns the object without the optional subtree's fields", () => {
    expect(Task.parse(Url, Task.build(Url, { summary: "s", name: "n" }))).toEqual({
      summary: "s",
      name: "n",
    });
    expect(
      Task.parse(
        Url,
        Task.build(Url, { summary: "s", name: "n", frequency: "WEEKLY", label: "l" }),
      ),
    ).toEqual({ summary: "s", name: "n", frequency: "WEEKLY", label: "l" });
  });
});
