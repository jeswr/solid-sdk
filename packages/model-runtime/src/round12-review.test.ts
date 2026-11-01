// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { defineModel, type ManifestEntity, MigrationError, type ModelManifest } from "./index.js";

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
