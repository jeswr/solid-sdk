// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { defineModel, ManifestError, type ModelManifest, validateManifest } from "./index.js";

const EX = "https://ex.test/";
const RES = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const { namedNode, literal, blankNode, quad } = DataFactory;
function manifest(kind: "self" | "hash-it" | "composite" = "self", required = true): ModelManifest {
  return {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: {},
    entities:
      kind === "composite"
        ? [
            {
              name: "Thing",
              kind: "composite",
              root: "root",
              nodes: [
                {
                  name: "root",
                  typeIris: [`${EX}Root`],
                  fragment: "it",
                  fields: [
                    {
                      name: "child",
                      kind: "nested",
                      predicate: `${EX}child`,
                      node: "child",
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
                      maxCount: 1,
                    },
                  ],
                },
              ],
            },
          ]
        : [{ name: "Thing", typeIris: [`${EX}Thing`], subject: { convention: kind }, fields: [] }],
  };
}
function entity(kind: "self" | "hash-it" | "composite" = "self", required = true) {
  const e = defineModel(manifest(kind, required)).entities.Thing;
  if (!e) throw new Error("missing entity");
  return e;
}
const INJECTED_PREFIX = "evil: <urn:unused> . <urn:evil> <urn:p> <urn:o> . #";
describe("H2: Turtle PN_PREFIX validation", () => {
  it.each([
    INJECTED_PREFIX,
    "a:",
    "a.",
    "1a",
    "_a",
    "a/b",
    "a b",
    "a\n",
    "a%20",
    "a\\u0062",
  ])("rejects unsafe prefix label %j", (prefix) => {
    const m = manifest();
    m.prefixes = { [prefix]: "urn:ns:" };
    expect(() => validateManifest(m)).toThrow(ManifestError);
  });
  it.each([
    "",
    "a",
    "a.b",
    "a-",
    "a_1",
    "é",
    "α",
    "𐀀",
    "a\u00b7",
    "a\u0300",
    "a\u203f",
  ])("round-trips a legitimate prefix label %j", async (prefix) => {
    const m = manifest();
    m.prefixes = { [prefix]: EX };
    const e = defineModel(m).entities.Thing;
    const ttl = await e?.serialize(RES, {});
    expect(ttl).toContain(`@prefix ${prefix}: <${EX}>`);
    expect(new Parser().parse(ttl as string)).toHaveLength(1);
  });
  for (const operation of ["serialize", "storeToTurtle"] as const) {
    it(`rechecks mutable prefix labels before ${operation}`, async () => {
      const model = defineModel(manifest());
      const e = model.entities.Thing;
      if (!e) throw new Error("missing entity");
      model.manifest.prefixes[INJECTED_PREFIX] = "urn:ns:";
      await expect(async () =>
        operation === "serialize" ? e.serialize(RES, {}) : e.storeToTurtle(new Store()),
      ).rejects.toThrow(ManifestError);
    });
  }
});

// With a self subject, this produces a valid forged statement if written verbatim by N3.
const FORGED_SUBJECT = "https://ex.test/s> <urn:p> <urn:o> . <urn:evil> <urn:p> <urn:o> . #";
const UNSAFE_RESOURCES = [
  FORGED_SUBJECT,
  "https://ex.test/a|b",
  "https://ex.test/a b",
  "relative",
  "",
  "https://ex.test/a\n",
];
describe("H3: resource and subject identity is validated without rewriting", () => {
  for (const kind of ["self", "hash-it", "composite"] as const) {
    for (const resource of UNSAFE_RESOURCES) {
      it(`${kind} rejects unsafe resource ${JSON.stringify(resource)} at every entry point`, async () => {
        const e = entity(kind);
        expect(() => e.subject(resource)).toThrow(TypeError);
        expect(() => e.build(resource, { val: "child" })).toThrow(TypeError);
        await expect(async () => e.serialize(resource, { val: "child" })).rejects.toThrow(
          TypeError,
        );
        // Even an attacker-populated subject must not make an unsafe resource parseable.
        const subject = kind === "self" ? resource : `${resource}#it`;
        const ds = new Store([
          quad(
            namedNode(subject),
            namedNode(TYPE),
            namedNode(`${EX}${kind === "composite" ? "Root" : "Thing"}`),
          ),
        ]);
        expect(e.parse(resource, ds)).toBeUndefined();
        expect(
          await e.parseDocument(resource, "this is deliberately invalid Turtle"),
        ).toBeUndefined();
        expect(() => new e.Wrapper(resource, ds, DataFactory)).toThrow(TypeError);
        expect(() => new e.Wrapper(namedNode(resource), ds, DataFactory)).toThrow(TypeError);
      });
    }
    for (const resource of [
      "https://EX.test:443/café",
      "https://ex.test",
      ...(kind === "composite" ? [] : ["urn:example:doc"]),
    ]) {
      it(`${kind} preserves exact safe identity ${resource}`, async () => {
        const e = entity(kind);
        const subject = kind === "self" ? resource : `${resource}#it`;
        expect(e.subject(resource)).toBe(subject);
        const ds = e.build(resource, { val: "child" });
        expect(ds.countQuads(namedNode(subject), namedNode(TYPE), null, null)).toBe(1);
        expect(e.parse(resource, ds)).toEqual(kind === "composite" ? { val: "child" } : {});
        expect(new e.Wrapper(namedNode(subject), ds, DataFactory).id).toBe(subject);
        const ttl = await e.serialize(resource, { val: "child" });
        expect(
          new Store(new Parser().parse(ttl)).countQuads(
            namedNode(subject),
            namedNode(TYPE),
            null,
            null,
          ),
        ).toBe(1);
        if (kind === "composite")
          expect(ds.countQuads(namedNode(`${resource}#child`), namedNode(TYPE), null, null)).toBe(
            1,
          );
      });
    }
    it(`${kind} rejects unsafe named subjects in storeToTurtle`, async () => {
      const e = entity(kind);
      const ds = new Store([
        quad(namedNode(FORGED_SUBJECT), namedNode(TYPE), namedNode(`${EX}Thing`)),
      ]);
      await expect(async () => e.storeToTurtle(ds)).rejects.toThrow(TypeError);
    });
  }
});

describe("M1: composite cardinality counts distinct raw object terms", () => {
  for (const required of [false, true]) {
    for (const extra of [
      literal(`${RES}#child`),
      blankNode("child"),
      namedNode(`${RES}#other`),
      literal("x", "en"),
      literal("x", "fr"),
    ]) {
      for (const reversed of [false, true]) {
        it(`rejects ambiguous ${extra.termType}/${extra.value}/${"language" in extra ? extra.language : ""} (required=${required}, reversed=${reversed})`, () => {
          const e = entity("composite", required);
          const ds = e.build(RES, { val: "real" });
          const root = namedNode(`${RES}#it`);
          const pred = namedNode(`${EX}child`);
          const target = namedNode(`${RES}#child`);
          ds.removeQuads(ds.getQuads(root, pred, null, null));
          for (const object of reversed ? [extra, target] : [target, extra])
            ds.addQuad(root, pred, object);
          expect(e.parse(RES, ds)).toEqual(required ? undefined : {});
        });
      }
    }
    it(`does not count the same raw target in two graphs twice (required=${required})`, () => {
      const e = entity("composite", required);
      const ds = e.build(RES, { val: "real" });
      ds.addQuad(
        namedNode(`${RES}#it`),
        namedNode(`${EX}child`),
        namedNode(`${RES}#child`),
        namedNode(`${EX}graph`),
      );
      expect(e.parse(RES, ds)).toEqual({ val: "real" });
    });
  }
});
