// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { defineModel, type ModelManifest } from "./index.js";

const EX = "https://ex.test/";
const RES = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ATTACK = "urn:x> . <urn:evil> <urn:p> <urn:o> . #";
const { namedNode, literal, quad } = DataFactory;

function model(composite = false) {
  const fields = [
    { name: "iri", predicate: `${EX}iri`, kind: "iri" as const, maxCount: 1 },
    { name: "iris", predicate: `${EX}iris`, kind: "iri" as const, collection: "set" as const },
  ];
  const manifest: ModelManifest = {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: { ex: EX },
    entities: composite
      ? [
          {
            name: "Thing",
            kind: "composite",
            root: "root",
            nodes: [{ name: "root", typeIris: [`${EX}Thing`], fragment: "it", fields }],
          },
        ]
      : [{ name: "Thing", typeIris: [`${EX}Thing`], subject: { convention: "self" }, fields }],
  };
  const m = defineModel(manifest);
  const e = m.entities.Thing;
  if (!e) throw new Error("missing entity");
  return { m, e };
}

describe("H1: the serialization boundary rejects every unsafe RDF position", () => {
  for (const composite of [false, true]) {
    for (const unsafe of [ATTACK, "relative", "https://ex.test/a|b"]) {
      for (const position of [
        "subject",
        "predicate",
        "object",
        "graph",
        "type",
        "datatype",
      ] as const) {
        it(`rejects ${position} ${JSON.stringify(unsafe)} (composite=${composite})`, async () => {
          const { e } = model(composite);
          const ds = new Store([
            quad(
              namedNode(position === "subject" ? unsafe : RES),
              namedNode(position === "predicate" ? unsafe : position === "type" ? TYPE : `${EX}p`),
              position === "datatype"
                ? literal("value", namedNode(unsafe))
                : namedNode(position === "object" || position === "type" ? unsafe : `${EX}o`),
              position === "graph" ? namedNode(unsafe) : DataFactory.defaultGraph(),
            ),
          ]);
          await expect(async () => e.storeToTurtle(ds)).rejects.toThrow(TypeError);
        });
      }
    }
    for (const operation of ["serialize", "storeToTurtle"] as const) {
      for (const position of ["label", "namespace"] as const) {
        it(`rechecks mutable prefix ${position} in ${operation} (composite=${composite})`, async () => {
          const { m, e } = model(composite);
          m.manifest.prefixes[position === "label" ? "evil:" : "evil"] =
            position === "namespace" ? ATTACK : EX;
          await expect(async () =>
            operation === "serialize" ? e.serialize(RES, {}) : e.storeToTurtle(new Store()),
          ).rejects.toThrow();
        });
      }
    }
  }

  it("checks the graph after alias migration and does not mutate the input", async () => {
    const { m, e } = model();
    const entity = m.manifest.entities[0];
    if (!entity || entity.kind === "composite") throw new Error("expected flat entity");
    entity.aliasTypeIris = [`${EX}Old`];
    entity.typeIris[0] = ATTACK;
    const ds = new Store([quad(namedNode(RES), namedNode(TYPE), namedNode(`${EX}Old`))]);
    await expect(async () => e.storeToTurtle(ds)).rejects.toThrow(TypeError);
    expect(ds.getQuads(RES, TYPE, `${EX}Old`, null)).toHaveLength(1);
  });

  it("preserves safe lexical identities in all RDF positions and namespaces", async () => {
    const { m, e } = model();
    const safe = "https://EX.test:443/café";
    m.manifest.prefixes.safe = safe;
    const ds = new Store([
      quad(namedNode(safe), namedNode(safe), literal("value", namedNode(safe)), namedNode(safe)),
    ]);
    const ttl = await e.storeToTurtle(ds);
    const parsed = new Parser().parse(ttl);
    expect(parsed).toHaveLength(1);
    const original = [...ds][0];
    if (!original) throw new Error("missing original quad");
    expect(parsed[0]?.equals(original)).toBe(true);
    expect(ttl).toContain(`@prefix safe: <${safe}>`);
  });
});

describe("H1: NamedNode mutation accessors are guarded", () => {
  it.each([
    ATTACK,
    "relative",
    "https://ex.test/a|b",
  ])("types.add rejects %j without changing the store", (unsafe) => {
    const { e } = model();
    const ds = e.build(RES, {});
    const wrapper = new e.Wrapper(RES, ds, DataFactory);
    expect(() => wrapper.types.add(unsafe)).toThrow(TypeError);
    expect(ds.size).toBe(1);
  });
  it("scalar and live-set IRI accessors drop unsafe values before insertion", () => {
    const { e } = model();
    const ds = e.build(RES, { iri: ATTACK, iris: [ATTACK] });
    const wrapper = new e.Wrapper(RES, ds, DataFactory) as unknown as {
      iri?: string;
      iris: Set<string>;
    };
    wrapper.iri = ATTACK;
    wrapper.iris.add(ATTACK);
    expect(ds.size).toBe(1);
  });
});
