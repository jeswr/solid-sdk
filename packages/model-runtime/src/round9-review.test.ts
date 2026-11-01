// AUTHORED-BY Codex GPT-6
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type CompositeManifestEntity,
  defineModel,
  type ManifestEntity,
  type ModelManifest,
  validateManifest,
} from "./index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const store = (body: string) =>
  new Store(
    new Parser().parse(`@prefix ex: <${EX}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . ${body}`),
  );
const manifest = (...entities: ModelManifest["entities"]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities,
});
const other: ManifestEntity = {
  name: "Other",
  typeIris: [`${EX}Other`],
  aliasTypeIris: [`${EX}OldOther`],
  subject: { convention: "self" },
  fields: [],
};
const tree = (required = true, hasClass?: string): CompositeManifestEntity => ({
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
          ...(hasClass ? { hasClass } : {}),
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
          aliasPredicates: [`${EX}oldTitle`],
          kind: "literal",
          datatype: "xsd:string",
          minCount: 1,
          maxCount: 1,
          guards: { requiredFailClosed: true },
        },
      ],
    },
  ],
});

describe("R9 M1: link classes cannot name any owner's type alias", () => {
  it.each([true, false])("rejects another entity's alias (required=%s)", (required) => {
    for (const entities of [
      [tree(required, `${EX}OldOther`), other],
      [other, tree(required, `${EX}OldOther`)],
    ]) {
      expect(() => validateManifest(manifest(...entities))).toThrow(/sh:class.*alias.*migration/i);
    }
  });
  it.each([true, false])("rejects another composite node's alias (required=%s)", (required) => {
    const input = tree(required, `${EX}OldOther`);
    input.nodes[0]?.fields.push({
      name: "otherLink",
      predicate: `${EX}otherLink`,
      kind: "nested",
      node: "other",
    });
    input.nodes.push({
      name: "other",
      typeIris: other.typeIris,
      aliasTypeIris: other.aliasTypeIris,
      fields: [],
      fragment: "other",
    });
    expect(() => validateManifest(manifest(input))).toThrow(/sh:class.*alias.*migration/i);
  });
});

const status = (name: string, value: string, aliased = false): ManifestEntity => ({
  name,
  typeIris: [`${EX}${name}`],
  ...(aliased ? { aliasTypeIris: [`${EX}Old${name}`] } : {}),
  subject: { convention: "self" },
  fields: [
    {
      name: "status",
      predicate: `${EX}p`,
      ...(aliased ? { aliasPredicates: [`${EX}old`] } : {}),
      kind: "literal",
      datatype: "xsd:string",
      minCount: 1,
      maxCount: 1,
      in: [value],
      guards: { requiredFailClosed: true },
    },
  ],
});

describe("R9 M2: alias migration follows the owning shape's focus nodes", () => {
  it("preserves B's canonical value instead of applying A's enum guards", async () => {
    const e = defineModel(manifest(status("A", "active", true), status("B", "pending"))).entities.B;
    if (!e) throw new Error("missing B");
    const ds = store('ex:doc a ex:B; ex:p "pending"; ex:old "active" .');
    const before = [...ds];
    expect(e.parse(DOC, ds)).toEqual({ status: "pending" });
    const emitted = store(await e.storeToTurtle(ds));
    expect(e.parse(DOC, emitted)).toEqual({ status: "pending" });
    expect(emitted.getObjects(DOC, `${EX}old`, null)).toEqual(ds.getObjects(DOC, `${EX}old`, null));
    expect([...ds]).toEqual(before);
  });
  it("migrates recognized roots, including alias subclasses, while preserving unrelated data", async () => {
    const e = defineModel(manifest(status("A", "active", true))).entities.A;
    if (!e) throw new Error("missing A");
    const ds = store(`ex:doc a ex:Special; ex:old "active" .
      ex:Special rdfs:subClassOf ex:OldA . ex:alias a ex:OldA; ex:old "active" .
      ex:stray a ex:Unrelated; ex:p "pending"; ex:old "active" .`);
    const emitted = store(await e.storeToTurtle(ds));
    expect(e.parse(DOC, emitted)).toEqual({ status: "active" });
    expect(emitted.getObjects(DOC, TYPE, null)).toEqual(ds.getObjects(DOC, TYPE, null));
    expect(emitted.getObjects(`${EX}alias`, TYPE, null).map((term) => term.value)).toEqual([
      `${EX}A`,
    ]);
    expect(emitted.getObjects(`${EX}stray`, `${EX}p`, null)).toEqual(
      ds.getObjects(`${EX}stray`, `${EX}p`, null),
    );
    expect(emitted.getObjects(`${EX}stray`, `${EX}old`, null)).toEqual(
      ds.getObjects(`${EX}stray`, `${EX}old`, null),
    );
  });
  it("migrates linked composite nodes and leaves unreached node predicates and types intact", async () => {
    const e = defineModel(manifest(tree())).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child .
      ex:child a ex:OldChild; ex:oldTitle "linked" .
      ex:stray a ex:OldChild; ex:oldTitle "unreached" .`);
    const emitted = store(await e.storeToTurtle(ds));
    expect(e.parse(DOC, emitted)).toEqual({ title: "linked" });
    expect(emitted.getObjects(`${EX}child`, `${EX}oldTitle`, null)).toEqual([]);
    expect(emitted.getObjects(`${EX}child`, TYPE, null).map((term) => term.value)).toEqual([
      `${EX}Child`,
    ]);
    expect(emitted.getQuads(`${EX}stray`, null, null, null)).toEqual(
      ds.getQuads(`${EX}stray`, null, null, null),
    );
  });
});

describe("R9 M3: nested sh:node validates constraints without a target-type requirement", () => {
  it.each([
    undefined,
    `${EX}Base`,
  ])("accepts a child without its target type (hasClass=%s)", (hasClass) => {
    const e = defineModel(manifest(tree(true, hasClass))).entities.Tree;
    const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child .
      ex:child ${hasClass ? "a ex:Base;" : ""} ex:title "child" .`);
    expect(e?.parse(DOC, ds)).toEqual({ title: "child" });
  });
  it.each([
    true,
    false,
  ])("still grades invalid child properties and explicit class failures (required=%s)", (required) => {
    const e = defineModel(manifest(tree(required, `${EX}Base`))).entities.Tree;
    for (const child of ["a ex:Base; ex:title 1", 'ex:title "child"']) {
      const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ${child} .`);
      expect(e?.parse(DOC, ds)).toEqual(required ? undefined : {});
    }
  });
  it("still requires root recognition while migrating an untyped child reached through sh:node", async () => {
    const e = defineModel(manifest(tree())).entities.Tree;
    if (!e) throw new Error("missing tree");
    const ds = store(`<${DOC}#it> a ex:Special; ex:link ex:child .
      ex:Special rdfs:subClassOf ex:Root . ex:child ex:oldTitle "child" .`);
    expect(e.parse(DOC, ds)).toEqual({ title: "child" });
    const emitted = store(await e.storeToTurtle(ds));
    expect(e.parse(DOC, emitted)).toEqual({ title: "child" });
    expect(emitted.getObjects(`${EX}child`, TYPE, null)).toEqual([]);
    ds.removeQuads(ds.getQuads(`${DOC}#it`, TYPE, null, null));
    expect(e.parse(DOC, ds)).toBeUndefined();
  });
});
