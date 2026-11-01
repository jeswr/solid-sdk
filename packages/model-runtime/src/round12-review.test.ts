// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type CompositeManifestEntity,
  defineModel,
  type ManifestEntity,
  MigrationError,
  type ModelManifest,
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
const a = (): ManifestEntity => ({
  name: "Thing",
  typeIris: [`${EX}Thing`],
  aliasTypeIris: [`${EX}OldThing`],
  subject: { convention: "self" },
  fields: [],
});
const b = (): ManifestEntity => ({
  name: "Other",
  typeIris: [`${EX}Other`],
  subject: { convention: "self" },
  fields: [],
});

describe("R12: migrationManifest adds owning context and never drops primary checks", () => {
  // Deleting the OldThing alias type removes the only data-graph proof of Other.
  const data = "ex:doc a ex:OldThing . ex:OldThing rdfs:subClassOf ex:Other .";

  it.each([
    ["without the option", undefined],
    ["with an override omitting the other owner", manifest(a())],
    ["with an override equal to the primary", manifest(a(), b())],
  ])("mark() rejects and leaves the dataset unchanged %s", (_label, override) => {
    const e = defineModel(
      manifest(a(), b()),
      override === undefined ? {} : { migrationManifest: override },
    ).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store(data);
    const before = [...ds];
    expect(() => new e.Wrapper(DOC, ds, DataFactory).mark()).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });

  it("storeToTurtle keeps the primary manifest's checks under an override", async () => {
    const e = defineModel(manifest(a(), b()), { migrationManifest: manifest(a()) }).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store(data);
    const before = [...ds];
    await expect(async () => e.storeToTurtle(ds)).rejects.toBeInstanceOf(MigrationError);
    expect([...ds]).toEqual(before);
  });

  it("an override still migrates when every check is preserved", async () => {
    const e = defineModel(manifest(a(), b()), { migrationManifest: manifest(a()) }).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store("ex:doc a ex:OldThing .");
    new e.Wrapper(DOC, ds, DataFactory).mark();
    expect(ds.countQuads(DOC, null, `${EX}OldThing`, null)).toBe(0);
    expect(ds.countQuads(DOC, null, `${EX}Thing`, null)).toBe(1);
    expect(await e.storeToTurtle(ds)).not.toContain("OldThing");
  });
});

describe("R13: overrides keep primary checks for untyped composite write focuses", () => {
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
            name: "tags",
            predicate: `${EX}p`,
            aliasPredicates: [`${EX}old`],
            kind: "literal",
            datatype: "xsd:string",
            collection: "set",
            minCount: 1,
            guards: { requiredFailClosed: true },
          },
          {
            name: "title",
            predicate: `${EX}title`,
            aliasPredicates: [`${EX}oldTitle`],
            kind: "literal",
            datatype: "xsd:string",
            maxCount: 1,
          },
          // An optional link: resolving it needs the composite's own node table.
          { name: "child", predicate: `${EX}child`, kind: "nested", node: "leaf" },
        ],
      },
      { name: "leaf", typeIris: [`${EX}Leaf`], fragment: "leaf", fields: [] },
    ],
  });
  type Root = { tags: Set<string>; title: string | undefined };
  // Untyped and unreached: only the write's own focus makes it a check subject. The
  // integer alias member makes the required set invalid, so migrating only the
  // guarded "valid" member would silently repair the record.
  const data = 'ex:doc ex:old "valid", 1 .';
  const mutations: [string, (w: Root) => unknown][] = [
    ["tags.delete", (w) => w.tags.delete("absent")],
    ["tags.add", (w) => w.tags.add("valid")],
    ["tags.clear", (w) => w.tags.clear()],
  ];
  it.each(mutations)("%s rejects with and without an override", (_label, mutate) => {
    for (const options of [{}, { migrationManifest: manifest(a()) }]) {
      const e = defineModel(manifest(tree()), options).entities.Tree;
      if (!e) throw new Error("missing entity");
      const ds = store(data);
      const before = [...ds];
      const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as Root;
      expect(() => mutate(w)).toThrow(MigrationError);
      expect([...ds]).toEqual(before);
    }
  });
});

describe("R14: one focus check per write, so the shared budget is not double-counted", () => {
  const view = (): ManifestEntity => ({
    name: "View",
    typeIris: [`${EX}View`],
    subject: { convention: "self" },
    fields: [
      {
        name: "tags",
        predicate: `${EX}p`,
        aliasPredicates: [`${EX}old`],
        kind: "literal",
        datatype: "xsd:string",
        collection: "set",
      },
    ],
  });
  it("a large valid aliased set on an untyped subject migrates under an override", () => {
    const members = Array.from({ length: 3000 }, (_, i) => `"m${i}"`).join(", ");
    for (const options of [{}, { migrationManifest: manifest(a()) }]) {
      const e = defineModel(manifest(view()), options).entities.View;
      if (!e) throw new Error("missing entity");
      const ds = store(`ex:doc ex:old ${members} .`);
      const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { tags: Set<string> };
      expect(w.tags.delete("absent")).toBe(false);
      expect(ds.countQuads(DOC, `${EX}old`, null, null)).toBe(0);
      expect(ds.countQuads(DOC, `${EX}p`, null, null)).toBe(3000);
    }
  });
});
