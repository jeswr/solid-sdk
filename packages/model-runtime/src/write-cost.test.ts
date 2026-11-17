// AUTHORED-BY Codex (GPT-6.1 Sol)
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  type ManifestEntity,
  type ManifestField,
  MigrationError,
  type ModelManifest,
} from "./index.js";

const EX = "https://write.test/";
const DOC = `${EX}doc`;
const manifest = (...entities: ModelManifest["entities"]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities,
});
const shape = (): ManifestEntity & { fields: [ManifestField, ManifestField] } => ({
  name: "Thing",
  typeIris: [`${EX}Thing`],
  subject: { convention: "self" },
  fields: [
    {
      name: "title",
      predicate: `${EX}title`,
      kind: "literal",
      datatype: "xsd:string",
      guards: { nonBlank: true },
    },
    { name: "url", predicate: `${EX}url`, kind: "iri", guards: { iriScheme: "https" } },
  ],
});
const dataset = () =>
  new Store(
    new Parser().parse(
      `@prefix ex: <${EX}> . ex:doc a ex:Thing; ex:title "before" .\n` +
        Array.from({ length: 20_000 }, (_, i) => `ex:s${i} a ex:Unrelated .`).join("\n"),
    ),
  );
const entity = (primary = manifest(shape()), migrationManifest?: ModelManifest) => {
  const e = defineModel(primary, { migrationManifest }).entities.Thing;
  if (!e) throw new Error("missing entity");
  return e;
};

describe("write migration costs", () => {
  it.each([
    false,
    true,
  ])("skips whole-dataset migration for alias-free contexts (override=%s)", (override) => {
    const primary = manifest(shape());
    const e = entity(primary, override ? primary : undefined);
    const ds = dataset();
    const w = new e.Wrapper(DOC, ds, DataFactory);
    Object.assign(w, { title: "clean\u0000text", url: " https://example.org " });
    expect(e.parse(DOC, ds)).toEqual({ title: "cleantext", url: "https://example.org/" });
    Object.assign(w, { title: " ", url: "javascript:bad" });
    expect(e.parse(DOC, ds)).toEqual({});
    Object.assign(w, { title: undefined, url: 42 });
    expect(e.parse(DOC, ds)).toEqual({});
    expect(ds.size).toBe(20_001);
  });

  it("mark skips the alias-free audit on a dataset with 20,000 unrelated subjects", () => {
    const e = entity();
    const ds = dataset();
    const w = new e.Wrapper(`${EX}new`, ds, DataFactory);
    expect(w.mark()).toBe(w);
    expect(w.isInstance).toBe(true);
    expect(ds.size).toBe(20_003);
  });

  it("treats explicit empty alias arrays as no aliases", () => {
    const owner = shape();
    owner.aliasTypeIris = [];
    for (const field of owner.fields) field.aliasPredicates = [];
    const e = entity(manifest(owner));
    const ds = dataset();
    const w = new e.Wrapper(DOC, ds, DataFactory);
    Object.assign(w, { title: "after" });
    expect(w.mark()).toBe(w);
    expect(e.parse(DOC, ds)?.title).toBe("after");
  });

  it.each(["after", undefined, 42])("still audits an aliased field before writing %s", (title) => {
    const owner = shape();
    owner.fields[0].aliasPredicates = [`${EX}oldTitle`];
    const e = entity(manifest(owner));
    const ds = dataset();
    const before = [...ds];
    expect(() => Object.assign(new e.Wrapper(DOC, ds, DataFactory), { title })).toThrow(
      MigrationError,
    );
    expect([...ds]).toEqual(before);
  });

  it("still audits mark when its owner has type aliases", () => {
    const owner = shape();
    owner.aliasTypeIris = [`${EX}OldThing`];
    const e = entity(manifest(owner));
    const ds = dataset();
    const before = [...ds];
    expect(() => new e.Wrapper(DOC, ds, DataFactory).mark()).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });

  it("skips a field with no aliases even when the same owner has other aliases", () => {
    const owner = shape();
    owner.aliasTypeIris = [`${EX}OldThing`];
    owner.fields[1].aliasPredicates = [`${EX}oldUrl`];
    const e = entity(manifest(owner));
    const ds = dataset();
    Object.assign(new e.Wrapper(DOC, ds, DataFactory), { title: "after" });
    expect(e.parse(DOC, ds)?.title).toBe("after");
  });

  it("mark skips predicate-only aliases because it cannot migrate those fields", () => {
    const owner = shape();
    owner.fields[0].aliasPredicates = [`${EX}oldTitle`];
    const e = entity(manifest(owner));
    const ds = dataset();
    expect(() => new e.Wrapper(DOC, ds, DataFactory).mark()).not.toThrow();
  });

  it.each([
    "type",
    "predicate",
  ])("retains the audit when an override contributes a %s alias", (kind) => {
    const primary = manifest(shape());
    const other = shape();
    if (kind === "type") other.aliasTypeIris = [`${EX}OldThing`];
    else other.fields[0].aliasPredicates = [`${EX}oldTitle`];
    const e = entity(primary, manifest(other));
    const ds = dataset();
    const before = [...ds];
    const w = new e.Wrapper(DOC, ds, DataFactory);
    expect(() => Object.assign(w, { title: "after" })).toThrow(MigrationError);
    expect(() => w.mark()).toThrow(MigrationError);
    expect([...ds]).toEqual(before);
  });

  it("never lets an alias-free override bypass the primary manifest's aliases", () => {
    const owner = shape();
    owner.fields[0].aliasPredicates = [`${EX}oldTitle`];
    const e = entity(manifest(owner), manifest(shape()));
    const ds = dataset();
    expect(() => Object.assign(new e.Wrapper(DOC, ds, DataFactory), { title: "after" })).toThrow(
      MigrationError,
    );
  });

  it("conservatively retains checks for aliases on other owners, including composite children", () => {
    const e = entity(
      manifest(shape(), {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: [
          {
            name: "root",
            typeIris: [`${EX}Root`],
            fragment: "it",
            fields: [{ name: "link", predicate: `${EX}link`, kind: "nested", node: "child" }],
          },
          {
            name: "child",
            typeIris: [`${EX}Child`],
            aliasTypeIris: [`${EX}OldChild`],
            fragment: "child",
            fields: [],
          },
        ],
      }),
    );
    const ds = dataset();
    expect(() => Object.assign(new e.Wrapper(DOC, ds, DataFactory), { title: "after" })).toThrow(
      MigrationError,
    );
  });
});
