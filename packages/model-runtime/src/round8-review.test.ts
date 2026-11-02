// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { defineModel, type ManifestField, type ModelManifest, validateManifest } from "./index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const HEADER = `@prefix ex: <${EX}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const store = (body: string) => new Store(new Parser().parse(`${HEADER} ${body}`));
const manifest = (fields: ManifestField[]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities: [
    {
      name: "Thing",
      typeIris: [`${EX}Thing`],
      aliasTypeIris: [`${EX}OldThing`],
      subject: { convention: "self" },
      fields,
    },
  ],
});
const entity = (fields: ManifestField[]) => {
  const result = defineModel(manifest(fields)).entities.Thing;
  if (!result) throw new Error("missing entity");
  return result;
};
const numeric: ManifestField = {
  name: "val",
  predicate: `${EX}p`,
  aliasPredicates: [`${EX}old`],
  kind: "literal",
  datatype: "xsd:integer",
  collection: "set",
  minCount: 2,
  maxCount: 3,
  guards: { requiredFailClosed: true },
};
const numericData = () => store('ex:doc a ex:Thing; ex:p 1; ex:old "01"^^xsd:integer .');
const iris = (set: boolean): ManifestField => ({
  name: "val",
  predicate: `${EX}p`,
  aliasPredicates: [`${EX}old`],
  kind: "iri",
  ...(set ? { collection: "set" as const } : {}),
  minCount: 1,
  maxCount: set ? 3 : 1,
  guards: { requiredFailClosed: true, iriScheme: "https", iriPattern: "https", minLength: 24 },
});

describe("R8 M1: migration retains guarded raw terms", () => {
  it("serialization preserves distinct integer lexical identities and raw cardinality", async () => {
    const e = entity([numeric]);
    const ds = numericData();
    const before = [...ds];
    expect(e.parse(DOC, ds)).toEqual({ val: [1] });
    const emitted = store(await e.storeToTurtle(ds));
    expect(emitted.getObjects(DOC, `${EX}p`, null)).toEqual(
      ds.getObjects(DOC, `${EX}p`, null).concat(ds.getObjects(DOC, `${EX}old`, null)),
    );
    expect(e.parse(DOC, emitted)).toEqual({ val: [1] });
    expect([...ds]).toEqual(before);
    expect(emitted.getObjects(DOC, `${EX}old`, null)).toEqual([]);
  });
  it.each([false, true])("serialization preserves a raw-length-valid IRI (set=%s)", async (set) => {
    const e = entity([iris(set)]);
    const ds = store("ex:doc a ex:Thing; ex:old <https://example.org:443/> .");
    expect(e.parse(DOC, ds)).toEqual({
      val: set ? ["https://example.org/"] : "https://example.org/",
    });
    const emitted = store(await e.storeToTurtle(ds));
    expect(emitted.getObjects(DOC, `${EX}p`, null)).toEqual(ds.getObjects(DOC, `${EX}old`, null));
    expect(e.parse(DOC, emitted)).toEqual(e.parse(DOC, ds));
  });
  it.each([
    "add",
    "invalid add",
    "missing delete",
  ])("live-set %s preserves retained lexical identities", (operation) => {
    const e = entity([numeric]);
    const ds = numericData();
    const values = (new e.Wrapper(DOC, ds, DataFactory) as unknown as { val: Set<number> }).val;
    if (operation === "add") values.add(2);
    else if (operation === "invalid add") values.add("bad" as unknown as number);
    else expect(values.delete(3)).toBe(false);
    expect(ds.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual(
      operation === "add" ? ["1", "01", "2"] : ["1", "01"],
    );
    expect(ds.getObjects(DOC, `${EX}old`, null)).toEqual([]);
    expect(e.parse(DOC, ds)).toEqual({ val: operation === "add" ? [1, 2] : [1] });
  });
  it("live-set deletion preserves other raw IRIs and clear removes all aliases", () => {
    const e = entity([iris(true)]);
    const ds = store(
      "ex:doc a ex:Thing; ex:old <https://example.org:443/>, <https://other.example.org/> .",
    );
    const values = (new e.Wrapper(DOC, ds, DataFactory) as unknown as { val: Set<string> }).val;
    expect(values.delete("https://other.example.org/")).toBe(true);
    expect(ds.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual([
      "https://example.org:443/",
    ]);
    values.clear();
    expect(values.size).toBe(0);
    expect(ds.getObjects(DOC, `${EX}old`, null)).toEqual([]);
  });
  it("singleton migration keeps the canonical-first raw term and discards conflicting aliases", async () => {
    const e = entity([{ ...numeric, collection: undefined, minCount: 1, maxCount: 1 }]);
    const ds = store('ex:doc a ex:Thing; ex:p "01"^^xsd:integer; ex:old 2 .');
    const emitted = store(await e.storeToTurtle(ds));
    expect(emitted.getObjects(DOC, `${EX}p`, null).map((term) => term.value)).toEqual(["01"]);
    expect(e.parse(DOC, emitted)).toEqual({ val: 1 });
  });
  it("migration rejects repairs that change conformance while explicit API writes still normalize", async () => {
    const e = entity([{ ...numeric, minCount: 1 }]);
    const ds = store('ex:doc a ex:Thing; ex:old "01"^^xsd:integer, "bad"^^xsd:integer .');
    await expect(async () => e.storeToTurtle(ds)).rejects.toMatchObject({ name: "MigrationError" });
    expect(
      e
        .build(DOC, { val: [1] })
        .getObjects(DOC, `${EX}p`, null)
        .map((term) => term.value),
    ).toEqual(["1"]);
  });
});

function composite(required = true): ModelManifest {
  return {
    ...manifest([]),
    entities: [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: [
          {
            name: "root",
            typeIris: [`${EX}Thing`],
            fragment: "it",
            fields: [
              {
                name: "link",
                predicate: `${EX}link`,
                kind: "nested",
                node: "child",
                hasClass: `${EX}Child`,
                guards: { requiredFailClosed: required },
              },
            ],
          },
          {
            name: "child",
            typeIris: [`${EX}Child`],
            aliasTypeIris: [`${EX}OldChild`],
            fragment: "child",
            fields: [
              {
                name: "val",
                predicate: `${EX}p`,
                kind: "literal",
                datatype: "xsd:string",
                guards: { requiredFailClosed: true },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("R8 M2: contradictory link class/type alias", () => {
  it.each([
    true,
    false,
  ])("manifest rejects a link requiring a target alias removed by migration (required=%s)", (required) => {
    const input = composite(required);
    const tree = input.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing tree");
    const link = tree.nodes[0]?.fields[0];
    if (!link) throw new Error("missing link");
    link.hasClass = `${EX}OldChild`;
    expect(() => validateManifest(input)).toThrow(/sh:class.*alias.*migration/i);
  });
});

describe("R8 M3: accepted node types use data-graph subclass membership", () => {
  it.each([
    "Thing",
    "OldThing",
  ])("recognizes a flat instance through %s without changing subclass types", async (target) => {
    const e = entity([]);
    const ds = store(
      `ex:doc a ex:Special . ex:Special rdfs:subClassOf [ rdfs:subClassOf ex:${target} ] .`,
    );
    const wrapper = new e.Wrapper(DOC, ds, DataFactory);
    expect(wrapper.isInstance).toBe(true);
    expect(e.parse(DOC, ds)).toEqual({});
    wrapper.mark();
    expect(ds.getObjects(DOC, TYPE, null).map((term) => term.value)).toEqual([
      `${EX}Special`,
      `${EX}Thing`,
    ]);
    const emitted = store(await e.storeToTurtle(ds));
    expect(emitted.getObjects(DOC, TYPE, null)).toEqual(ds.getObjects(DOC, TYPE, null));
  });
  it.each(["Child", "OldChild"])("recognizes an unlisted composite subclass of %s", (target) => {
    const input = composite();
    const tree = input.entities[0];
    if (tree?.kind !== "composite" || !tree.nodes[0]?.fields[0]) throw new Error("missing tree");
    tree.nodes[0].fields[0].hasClass = `${EX}Base`;
    const e = defineModel(input).entities.Tree;
    const ds = store(`<${DOC}#it> a ex:SpecialRoot; ex:link ex:child .
      ex:SpecialRoot rdfs:subClassOf ex:Thing . ex:child a ex:SpecialChild; ex:p "child" .
      ex:SpecialChild rdfs:subClassOf ex:${target}, ex:Base .`);
    expect(e?.parse(DOC, ds)).toEqual({ val: "child" });
  });
  it.each([
    true,
    false,
  ])("accepts unrelated cyclic child types when explicit sh:class is satisfied (required=%s)", (required) => {
    const input = composite(required);
    const tree = input.entities[0];
    if (tree?.kind !== "composite" || !tree.nodes[0]?.fields[0]) throw new Error("missing tree");
    tree.nodes[0].fields[0].hasClass = `${EX}Base`;
    const e = defineModel(input).entities.Tree;
    const ds =
      store(`<${DOC}#it> a ex:Thing; ex:link ex:child . ex:child a ex:Special, ex:Base; ex:p "child" .
      ex:Special rdfs:subClassOf ex:Other . ex:Other rdfs:subClassOf ex:Special .`);
    expect(e?.parse(DOC, ds)).toEqual({ val: "child" });
  });
  it("bounds all accepted classes together at the existing 10000 raw-read budget", () => {
    const e = entity([]);
    const chain = (count: number) =>
      store(
        `ex:doc a ex:C0 . ${Array.from({ length: count }, (_, i) => `ex:C${i} rdfs:subClassOf ${i === count - 1 ? "ex:OldThing" : `ex:C${i + 1}`} .`).join("\n")}`,
      );
    expect(e.parse(DOC, chain(9999))).toEqual({});
    expect(e.parse(DOC, chain(10000))).toBeUndefined();
  });
});
