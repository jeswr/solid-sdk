// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { ManifestError, validateManifest } from "./manifest.js";
import { defineModel } from "./model.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const manifest = (required = true) => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: [
        {
          name: "root",
          typeIris: [`${EX}Root`],
          fragment: "it",
          fields: [
            {
              name: "link",
              kind: "nested",
              predicate: `${EX}link`,
              node: "child",
              hasClass: `${EX}Base`,
              guards: { requiredFailClosed: required },
            },
          ],
        },
        {
          name: "child",
          typeIris: [`${EX}Child`],
          fragment: "child",
          fields: [
            {
              name: "val",
              kind: "literal",
              predicate: `${EX}p`,
              datatype: "xsd:string",
              guards: { requiredFailClosed: true },
            },
          ],
        },
      ],
    },
  ],
});
const tree = (required = true) => {
  const entity = defineModel(manifest(required)).entities.Tree;
  if (!entity) throw new Error("missing tree");
  return entity;
};
const data = (body: string) =>
  new Store(
    new Parser().parse(`
  @prefix ex: <${EX}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  <${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:Child; ex:p "child" . ${body}`),
  );

describe("R7 composite class guard", () => {
  it("build explicitly asserts the link class independently of ontology ancestry", () => {
    const entity = tree();
    const ds = entity.build(DOC, { val: "child" });
    expect(ds.getObjects(`${DOC}#child`, RDF_TYPE, null).map((term) => term.value)).toEqual([
      `${EX}Child`,
      `${EX}Base`,
    ]);
    expect(entity.parse(DOC, ds)).toEqual({ val: "child" });
  });
  it.each([
    ["ex:child a ex:Base .", true],
    ["ex:Child rdfs:subClassOf ex:Base .", true],
    ["ex:child a ex:Other . ex:Other rdfs:subClassOf ex:Base .", true],
    ["ex:Child rdfs:subClassOf [ rdfs:subClassOf ex:Base ] .", true],
    ["ex:Base rdfs:subClassOf ex:Child .", false],
    ['ex:Child rdfs:subClassOf "https://ex.test/Base" .', false],
    ["ex:Child rdfs:subClassOf ex:Other . ex:Other rdfs:subClassOf ex:Child .", false],
  ] as const)("checks actual data types and subclass direction: %s", (body, conforms) => {
    expect(tree().parse(DOC, data(body))).toEqual(conforms ? { val: "child" } : undefined);
  });
  it.each([true, false])("fails closed on an over-budget class graph (required=%s)", (required) => {
    const ds = data("");
    for (let i = 0; i < 10001; i++) {
      ds.addQuad(
        DataFactory.namedNode(i === 0 ? `${EX}Child` : `${EX}C${i}`),
        DataFactory.namedNode(SUBCLASS),
        DataFactory.namedNode(i === 10000 ? `${EX}Base` : `${EX}C${i + 1}`),
      );
    }
    expect(tree(required).parse(DOC, ds)).toEqual(required ? undefined : {});
  });
  it.each([
    "relative",
    "https://ex.test/a b",
    "https://ex.test/a>",
    1,
    null,
  ])("rejects malformed class constraints (%s)", (hasClass) => {
    const input = manifest();
    const field = input.entities[0]?.nodes[0]?.fields[0];
    if (!field) throw new Error("missing field");
    Object.assign(field, { hasClass });
    expect(() => validateManifest(input)).toThrow(ManifestError);
  });
  it("rejects class constraints on flat fields rather than ignoring them", () => {
    const input = manifest();
    const field = input.entities[0]?.nodes[1]?.fields[0];
    if (!field) throw new Error("missing field");
    Object.assign(field, { hasClass: `${EX}Base` });
    expect(() => validateManifest(input)).toThrow(ManifestError);
  });
});
