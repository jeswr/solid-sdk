// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { DataFactory, Parser, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  deriveNodeViews,
  FidelityError,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const NS = "https://example.org/ns#";
const OLD = "https://example.org/old#";
const HEADER = `
  @prefix ex: <${NS}> . @prefix old: <${OLD}> .
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix owl: <http://www.w3.org/2002/07/owl#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
  @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const ONTOLOGY = `${HEADER}
  ex:C a owl:Class ; rdfs:label "C" ; rdfs:comment "C definition" .
  ex:p a owl:DatatypeProperty ; rdfs:label "p" ; rdfs:comment "p definition" ; rdfs:domain ex:C ; rdfs:range xsd:string .
  ex:q a rdf:Property ; rdfs:label "q" ; rdfs:comment "q definition" ; rdfs:domain ex:C ; rdfs:range xsd:string .`;
const CONFIG: CodegenConfig = {
  shapesBase: "https://example.org/shapes#",
  prefixes: { ex: NS },
  entities: [{ name: "C", targetClass: `${NS}C`, subject: { convention: "hash-it" } }],
};
function shape(
  path = "[ sh:alternativePath ( old:p ex:p old:p2 ) ]",
  targets = "old:C, ex:C, old:C2",
  extra = "",
): string {
  return `${HEADER} [] a sh:NodeShape ; sh:targetClass ${targets} ;
    sh:property [ sh:path ${path} ; sh:name "text" ; sh:datatype xsd:string ; sh:maxCount 1 ] ${extra} .`;
}
const ontology = owlRdfsAdapter.adapt(parseTurtle(ONTOLOGY));
function normalized(ttl = shape()) {
  return parseShapes(ttl, CONFIG.shapesBase, ontology);
}
function generated(shapesTtl = shape(), ontologyTtl = ONTOLOGY) {
  return generateModel({ ontologyTtl, shapesTtl, config: CONFIG });
}
function permute(ttl: string): string {
  const writer = new Writer({ format: "N-Triples" });
  writer.addQuads(new Parser().parse(ttl).reverse());
  let output = "";
  writer.end((error, result) => {
    if (error) throw error;
    output = result;
  });
  return output;
}

describe("shape-derived read aliases", () => {
  it("selects the unique ontology declarations regardless of their positions", () => {
    const e = flat(generated().manifest.entities[0]);
    expect(e.typeIris).toEqual([`${NS}C`]);
    expect(e.aliasTypeIris).toEqual([`${OLD}C`, `${OLD}C2`]);
    expect(e.fields[0]?.predicate).toBe(`${NS}p`);
    expect(e.fields[0]?.aliasPredicates).toEqual([`${OLD}p`, `${OLD}p2`]);
  });

  it("accepts the four-member alternativePath cap and any declared property kind", () => {
    expect(
      flat(
        generated(shape("[ sh:alternativePath ( old:q old:q2 old:q3 ex:q ) ]")).manifest
          .entities[0],
      ).fields[0]?.aliasPredicates,
    ).toEqual([`${OLD}q`, `${OLD}q2`, `${OLD}q3`]);
  });

  it("accepts four alias types", () => {
    expect(
      flat(generated(shape(undefined, "old:A, old:B, ex:C, old:C, old:D")).manifest.entities[0])
        .aliasTypeIris,
    ).toHaveLength(4);
  });

  it("never treats skos:closeMatch or skos:exactMatch as read aliases", () => {
    const result = generated(
      shape("ex:p", "ex:C"),
      `${ONTOLOGY}
      ex:C skos:closeMatch old:C ; skos:exactMatch old:C2 .
      ex:p skos:closeMatch old:p ; skos:exactMatch old:p2 .`,
    );
    const e = flat(result.manifest.entities[0]);
    expect(e.aliasTypeIris).toBeUndefined();
    expect(e.fields[0]?.aliasPredicates).toBeUndefined();
  });

  it("is byte-identical across double builds and reversed ontology/shape triple order", () => {
    const first = generated();
    expect(generated().artifacts).toEqual(first.artifacts);
    const reversed = generated(permute(shape()), permute(ONTOLOGY));
    // Input hash artifacts intentionally bind the original input BYTES.
    for (const name of ["model.json", "model.js", "model.d.ts", "shapes.ttl"]) {
      expect(reversed.artifacts[name], name).toBe(first.artifacts[name]);
    }
    const reorderedTargets = generated(shape(undefined, "old:C2, old:C, ex:C"));
    expect(reorderedTargets.artifacts["model.json"]).toBe(first.artifacts["model.json"]);
  });
});

describe("alias admission fails closed", () => {
  it.each([
    "old:A, old:B", // no owl:Class declaration
    "ex:C, ex:D", // two owl:Class declarations
    "ex:C, []",
    'ex:C, "literal"',
    "ex:C, old:A, old:B, old:C, old:D, old:E",
  ])("rejects ambiguous or invalid target classes: %s", (targets) => {
    const extraClass = `${HEADER} ex:D a owl:Class ; rdfs:label "D" ; rdfs:comment "D" .`;
    expect(() => generated(shape(undefined, targets), `${ONTOLOGY}\n${extraClass}`)).toThrow(
      AdmissionError,
    );
  });

  it("an RDFS-only class cannot select the canonical member of multiple targets", () => {
    expect(() =>
      generated(shape(), ONTOLOGY.replace("ex:C a owl:Class", "ex:C a rdfs:Class")),
    ).toThrow(/exactly one ontology owl:Class/);
  });

  it.each([
    "[ sh:alternativePath () ]",
    "[ sh:alternativePath ( ex:p ) ]",
    "[ sh:alternativePath ( ex:p old:a old:b old:c old:d ) ]",
    "[ sh:alternativePath ( old:a old:b ) ]",
    "[ sh:alternativePath ( ex:p ex:q ) ]",
    "[ sh:alternativePath ( ex:p [] ) ]",
    '[ sh:alternativePath ( ex:p "literal" ) ]',
    "[ sh:alternativePath ( ex:p [ sh:inversePath old:p ] ) ]",
    "[ sh:alternativePath ( ex:p old:p old:p ) ]",
    "[ sh:alternativePath ( ex:p old:p ) ; sh:inversePath ex:p ]",
    "[ sh:alternativePath ( ex:p old:p ), ( ex:p old:q ) ]",
    "[ sh:inversePath ex:p ]",
    "( ex:p old:p )",
    "[ sh:zeroOrMorePath ex:p ]",
    '"literal"',
    "ex:p, old:p",
  ])("rejects an invalid/unsupported path: %s", (path) => {
    expect(() => generated(shape(path))).toThrow(AdmissionError);
  });

  it.each([
    "_:list rdf:first ex:p ; rdf:rest _:list .", // cycle
    "_:list rdf:first ex:p ; rdf:rest rdf:nil, _:other .", // branching rest
    "_:list rdf:first ex:p, old:p ; rdf:rest rdf:nil .", // branching first
    "_:list rdf:first ex:p .", // missing rest
    '_:list rdf:first ex:p ; rdf:rest "not nil" .', // invalid tail
  ])("rejects malformed alternativePath lists: %s", (list) => {
    expect(() => generated(`${shape("[ sh:alternativePath _:list ]")}\n${list}`)).toThrow(
      AdmissionError,
    );
  });

  it.each([
    '; sh:property [ sh:path old:p ; sh:name "other" ; sh:datatype xsd:string ]',
    '; sh:property [ sh:path [ sh:alternativePath ( ex:q old:p ) ] ; sh:name "other" ; sh:datatype xsd:string ]',
  ])("rejects aliases reused by a canonical predicate or another alias", (extra) => {
    expect(() => generated(shape(undefined, undefined, extra))).toThrow(AdmissionError);
  });

  it("rejects a missing sh:path instead of silently dropping the field", () => {
    expect(() =>
      normalized(shape().replace("sh:path [ sh:alternativePath ( old:p ex:p old:p2 ) ] ;", "")),
    ).toThrow(AdmissionError);
  });

  it("rejects multiple shapes for the same canonical class", () => {
    expect(() => generated(`${shape()}\n${shape()}`)).toThrow(AdmissionError);
  });
});

describe("alias fidelity in both directions", () => {
  for (const key of ["aliasPredicates", "aliasTypeIris"] as const) {
    it.each([
      "add",
      "drop",
      "swap",
      "reorder",
    ])(`throws on a seeded ${key} %s mutation`, (mutation) => {
      const shapes = normalized();
      const compiled = compileManifest(shapes, CONFIG);
      const e = flat(compiled.manifest.entities[0]);
      const target = key === "aliasTypeIris" ? e : e.fields[0];
      if (!target) throw new Error("missing field");
      const values = key === "aliasTypeIris" ? e.aliasTypeIris : e.fields[0]?.aliasPredicates;
      if (!values) throw new Error("missing aliases");
      if (mutation === "add") values.push(`${OLD}unsourced`);
      if (mutation === "drop") values.pop();
      if (mutation === "swap") values[0] = `${OLD}unsourced`;
      if (mutation === "reorder") values.reverse();
      expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
    });
  }

  it("throws when the canonical member and a read alias are exchanged", () => {
    const shapes = normalized();
    const compiled = compileManifest(shapes, CONFIG);
    const e = flat(compiled.manifest.entities[0]);
    const f = e.fields[0];
    if (!f) throw new Error("missing field");
    f.predicate = `${OLD}p`;
    f.aliasPredicates = [`${NS}p`, `${OLD}p2`];
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
});

describe("composite aliases and derived node views", () => {
  const compositeConfig: CodegenConfig = {
    ...CONFIG,
    entities: [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: {
          root: { targetClass: `${NS}C`, fragment: "it", fields: { text: {} } },
        },
      },
    ],
  };

  it("preserves aliases in a composite and its generated flat node view", () => {
    const shapes = normalized();
    const compiled = compileManifest(shapes, compositeConfig);
    expect(() => assertFidelity(shapes, compiled)).not.toThrow();
    const views = deriveNodeViews(compiled.manifest);
    if (!views) throw new Error("missing views");
    const e = flat(views.manifest.entities[0]);
    expect(e.aliasTypeIris).toEqual([`${OLD}C`, `${OLD}C2`]);
    expect(e.fields[0]?.aliasPredicates).toEqual([`${OLD}p`, `${OLD}p2`]);
    const handle = defineModel(views.manifest).entities.TreeRootNode;
    if (!handle) throw new Error("missing handle");
    const ds = new Store(
      new Parser().parse(`<https://pod.example/#it> a <${OLD}C> ; <${OLD}p> "old" .`),
    );
    const wrapper = new handle.Wrapper("https://pod.example/#it", ds, DataFactory);
    expect(wrapper.isInstance).toBe(true);
    expect((wrapper as unknown as { text: string }).text).toBe("old");
  });

  it.each([
    "type",
    "predicate",
    "omission",
  ])("fidelity rejects composite alias tampering: %s", (mutation) => {
    const shapes = normalized();
    const compiled = compileManifest(shapes, compositeConfig);
    const e = compiled.manifest.entities[0];
    if (e?.kind !== "composite" || !e.nodes[0]?.fields[0]) throw new Error("missing node");
    const node = e.nodes[0];
    if (mutation === "type") node.aliasTypeIris = [];
    if (mutation === "predicate" && node.fields[0]) node.fields[0].aliasPredicates = [];
    if (mutation === "omission") node.fields = [];
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it("explicitly rejects an aliased structural nested link", () => {
    const shapes = normalized(shape().replace("sh:datatype xsd:string", "sh:nodeKind sh:IRI"));
    const config: CodegenConfig = {
      ...CONFIG,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${NS}C`, fragment: "it", links: { text: "root" } },
          },
        },
      ],
    };
    expect(() => compileManifest(shapes, config)).toThrow(/not supported on nested/);
  });
});
