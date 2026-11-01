// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type CompositeManifestEntity,
  defineModel,
  type ManifestEntity,
  MigrationError,
  type ModelManifest,
  validateManifest,
} from "./index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const store = (body: string) =>
  new Store(
    new Parser().parse(
      `@prefix ex: <${EX}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . ${body}`,
    ),
  );
const manifest = (...entities: ModelManifest["entities"]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities,
});
const flat = (datatype = "xsd:string"): ManifestEntity => ({
  name: "Thing",
  typeIris: [`${EX}Thing`],
  aliasTypeIris: [`${EX}OldThing`],
  subject: { convention: "self" },
  fields: [
    {
      name: "values",
      predicate: `${EX}p`,
      aliasPredicates: [`${EX}old`],
      kind: "literal",
      datatype,
      collection: "set",
      minCount: 1,
      guards: { requiredFailClosed: true },
    },
  ],
});
const tree = (): CompositeManifestEntity => ({
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
          predicate: `${EX}link`,
          kind: "nested",
          node: "child",
          guards: { requiredFailClosed: true },
        },
      ],
    },
    {
      name: "child",
      typeIris: [`${EX}Child`],
      fragment: "child",
      fields: [{ name: "next", predicate: `${EX}next`, kind: "nested", node: "leaf", minCount: 1 }],
    },
    { name: "leaf", typeIris: [`${EX}Leaf`], fragment: "leaf", fields: [] },
  ],
});
describe("R11 M2: strict nested minimums", () => {
  it("validates and enforces an advisory nested minimum without root requiredness", () => {
    const input = manifest(tree());
    expect(() => validateManifest(input)).not.toThrow();
    const e = defineModel(input).entities.Tree;
    expect(e?.parse(DOC, store(`<${DOC}#it> a ex:Root; ex:link ex:child .`))).toBeUndefined();
    expect(
      e?.parse(DOC, store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:next ex:leaf .`)),
    ).toEqual({});
  });
  it.each([-1, 1.5, "1", 2])("rejects invalid nested minCount %s", (minimum) => {
    const input = tree();
    const field = input.nodes[1]?.fields[0];
    if (!field) throw new Error("missing field");
    (field as unknown as { minCount: unknown }).minCount = minimum;
    expect(() => validateManifest(manifest(input))).toThrow(/minCount/);
  });
});
describe("R11 M3: migration is checked before explicit mutations", () => {
  it.each([
    "add",
    "delete",
    "clear",
  ])("does not repair an invalid required set before %s", (operation) => {
    const e = defineModel(manifest(flat())).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store('ex:doc a ex:Thing; ex:old "valid", 1 .');
    const before = [...ds];
    const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { values: Set<string> };
    expect(() => {
      if (operation === "add") w.values.add("valid");
      else if (operation === "delete") w.values.delete("absent");
      else w.values.clear();
    }).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });
  it("checks singleton migration before applying a setter", () => {
    const input = flat();
    input.fields = [
      {
        name: "title",
        predicate: `${EX}p`,
        aliasPredicates: [`${EX}old`],
        kind: "literal",
        datatype: "xsd:string",
        maxCount: 1,
        default: "fallback",
      },
    ];
    const e = defineModel(manifest(input)).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store("ex:doc a ex:Thing; ex:old 1 .");
    const before = [...ds];
    const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { title: string };
    expect(() => {
      w.title = "requested";
    }).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });
  it("checks every owning entity before mark and preserves the dataset on throw", () => {
    const a = flat();
    a.fields = [];
    const b: ManifestEntity = {
      name: "Other",
      typeIris: [`${EX}Other`],
      subject: { convention: "self" },
      fields: [],
    };
    const e = defineModel(manifest(a, b)).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store("ex:doc a ex:OldThing . ex:OldThing rdfs:subClassOf ex:Other .");
    const before = [...ds];
    expect(() => new e.Wrapper(DOC, ds, DataFactory).mark()).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });
});
describe("R11 M4: set preservation uses membership equality", () => {
  for (const datatype of ["xsd:string", "xsd:dateTime"]) {
    it.each([
      true,
      false,
    ])(`accepts ${datatype} sets in either insertion order (alias first=%s)`, async (aliasFirst) => {
      const e = defineModel(manifest(flat(datatype))).entities.Thing;
      if (!e) throw new Error("missing entity");
      const values =
        datatype === "xsd:string"
          ? ['"old"', '"canonical"']
          : [
              '"2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
              '"2026-01-02T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
            ];
      const triples = [`ex:doc ex:old ${values[0]} .`, `ex:doc ex:p ${values[1]} .`];
      const ds = store(
        `ex:doc a ex:Thing . ${(aliasFirst ? triples : triples.reverse()).join(" ")}`,
      );
      const before = e.parse(DOC, ds)?.values as unknown[];
      const output = store(await e.storeToTurtle(ds));
      expect(e.parse(DOC, output)?.values).toEqual(expect.arrayContaining(before));
      expect((e.parse(DOC, output) as { values: unknown[] }).values).toHaveLength(before.length);
    });
  }
});
