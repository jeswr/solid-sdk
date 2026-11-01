// AUTHORED-BY Codex GPT-6
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type CompositeManifestEntity,
  defineModel,
  type ManifestEntity,
  MigrationError,
  type ModelManifest,
  validateManifest,
} from "./index.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture member");
  return value;
}

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
const flat = (name: string, aliases = false): ManifestEntity => ({
  name,
  typeIris: [`${EX}${name}`],
  ...(aliases ? { aliasTypeIris: [`${EX}Old${name}`] } : {}),
  subject: { convention: "self" },
  fields: [],
});
const tree = (required = true): CompositeManifestEntity => ({
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
          name: "title",
          predicate: `${EX}title`,
          kind: "literal",
          datatype: "xsd:string",
          maxCount: 1,
        },
      ],
    },
  ],
});

describe("R10 M1: nested validation rejects present optional violations", () => {
  it.each([
    true,
    false,
  ])("grades invalid optional child data at its incoming link (required=%s)", (required) => {
    const e = must(defineModel(manifest(tree(required))).entities.Tree);
    for (const title of ["1", '"one", "two"'])
      expect(
        e.parse(
          DOC,
          store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:title ${title} .`),
        ),
      ).toEqual(required ? undefined : {});
  });
  it("preserves root optional-field drops", () => {
    const input = flat("Root");
    input.fields = must(tree().nodes[1]).fields;
    expect(
      defineModel(manifest(input)).entities.Root?.parse(
        DOC,
        store("ex:doc a ex:Root; ex:title 1 ."),
      ),
    ).toEqual({});
  });
  it("propagates present optional nested class failures through sh:node", () => {
    const input = tree();
    must(input.nodes[1]).fields.push({
      name: "next",
      predicate: `${EX}next`,
      kind: "nested",
      node: "leaf",
      hasClass: `${EX}Base`,
    });
    input.nodes.push({ name: "leaf", typeIris: [`${EX}Leaf`], fragment: "leaf", fields: [] });
    const e = must(defineModel(manifest(input)).entities.Tree);
    expect(
      e.parse(DOC, store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:next ex:leaf .`)),
    ).toBeUndefined();
    expect(e.parse(DOC, store(`<${DOC}#it> a ex:Root; ex:link ex:child .`))).toEqual({});
  });
});

describe("R10 M3: migration preserves conformance or throws a typed error", () => {
  it("preserves an indirect link class proof before deleting an alias type", async () => {
    const input = tree();
    must(must(input.nodes[0]).fields[0]).hasClass = `${EX}Base`;
    const e = must(defineModel(manifest(input)).entities.Tree);
    const ds = store(
      `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:OldChild; ex:title "valid" . ex:OldChild rdfs:subClassOf ex:Base .`,
    );
    const before = [...ds];
    const output = store(await e.storeToTurtle(ds));
    expect(e.parse(DOC, output)).toEqual({ title: "valid" });
    expect([...ds]).toEqual(before);
  });
  it("backstop catches migration erasing another entity's type recognition", async () => {
    const model = defineModel(manifest(flat("A", true), flat("B")));
    const ds = store("ex:doc a ex:OldA . ex:OldA rdfs:subClassOf ex:B .");
    expect(model.entities.A?.parse(DOC, ds)).toEqual({});
    expect(model.entities.B?.parse(DOC, ds)).toEqual({});
    await expect(async () => must(model.entities.A).storeToTurtle(ds)).rejects.toBeInstanceOf(
      MigrationError,
    );
  });
  it("backstop catches a changed projection even when type recognition survives", async () => {
    const input = flat("A");
    input.fields = [
      {
        name: "title",
        predicate: `${EX}title`,
        aliasPredicates: [`${EX}oldTitle`],
        kind: "literal",
        datatype: "xsd:string",
        maxCount: 1,
        default: "fallback",
      },
    ];
    const e = must(defineModel(manifest(input)).entities.A);
    const ds = store("ex:doc a ex:A; ex:oldTitle 1 .");
    expect(e.parse(DOC, ds)).toEqual({});
    // Removing the malformed alias would expose the default and change the result.
    await expect(async () => e.storeToTurtle(ds)).rejects.toThrow(/changed the parsed result/);
  });
  it("backstop also checks recognized but unreached composite nodes", async () => {
    const model = defineModel(manifest(flat("A", true), tree()));
    const ds = store('ex:doc a ex:OldA; ex:title "valid" . ex:OldA rdfs:subClassOf ex:Child .');
    await expect(async () => must(model.entities.A).storeToTurtle(ds)).rejects.toMatchObject({
      name: "MigrationError",
    });
  });
  it("bounds migration recognition work", async () => {
    const e = must(defineModel(manifest(flat("A", true))).entities.A);
    const ds = store(Array.from({ length: 10001 }, (_, i) => `ex:s${i} a ex:OldA .`).join("\n"));
    await expect(async () => e.storeToTurtle(ds)).rejects.toMatchObject({ name: "MigrationError" });
  });
  it("bounds raw field reads during backstop re-parsing", async () => {
    const input = flat("A");
    input.fields = [
      {
        name: "values",
        predicate: `${EX}p`,
        aliasPredicates: [`${EX}old`],
        kind: "literal",
        datatype: "xsd:string",
        collection: "set",
      },
    ];
    const e = must(defineModel(manifest(input)).entities.A);
    const ds = store(
      `ex:doc a ex:A; ex:old ${Array.from({ length: 10001 }, (_, i) => `"${i}"`).join(", ")} .`,
    );
    await expect(async () => e.storeToTurtle(ds)).rejects.toBeInstanceOf(MigrationError);
  });
});

describe("R10 M5: class-only manifest admission", () => {
  it("requires the child's exact canonical target class", () => {
    const input = tree();
    const field = must(must(input.nodes[0]).fields[0]);
    field.classOnly = true;
    field.hasClass = `${EX}Base`;
    expect(() => validateManifest(manifest(input))).toThrow(/class.only.*target class.*sh:class/i);
    field.hasClass = `${EX}Child`;
    expect(() => validateManifest(manifest(input))).not.toThrow();
  });
});

describe("R10 M4: closed manifest admission rejects shared canonical aliases", () => {
  it.each([
    false,
    true,
  ])("rejects shared predicates across entities/nodes (composite=%s)", (composite) => {
    const a = flat("A");
    a.fields = [
      {
        name: "status",
        predicate: `${EX}p`,
        aliasPredicates: [`${EX}old`],
        kind: "literal",
        datatype: "xsd:string",
        collection: "set",
        minCount: 1,
        maxCount: 2,
        in: ["pending", "active"],
      },
    ];
    const b = flat("B");
    b.fields = [
      {
        name: "status",
        predicate: `${EX}p`,
        kind: "literal",
        datatype: "xsd:string",
        maxCount: 1,
        in: ["pending"],
      },
    ];
    const owner = tree();
    must(owner.nodes[1]).fields = b.fields;
    for (const entities of [
      [a, composite ? owner : b],
      [composite ? owner : b, a],
    ])
      expect(() => validateManifest(manifest(...entities))).toThrow(
        /shared canonical predicate.*alias/i,
      );
  });
});
