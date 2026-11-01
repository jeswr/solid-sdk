// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import type { Literal, NamedNode } from "n3";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { httpIriOrUndefined, isHttpIri } from "./guards.js";
import { ManifestError, type ManifestField, validateManifest } from "./manifest.js";
import { defineModel } from "./model.js";

const RES = "https://ex.test/doc";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const field = (extra: Partial<ManifestField> = {}): ManifestField => ({
  name: "val",
  predicate: "urn:p",
  kind: "literal",
  datatype: "xsd:string",
  maxCount: 1,
  ...extra,
});
const manifest = (f = field()) => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities: [
    { name: "Thing", typeIris: ["urn:T"], subject: { convention: "hash-it" }, fields: [f] },
  ],
});
function entity(f = field()) {
  const e = defineModel(manifest(f)).entities.Thing;
  if (!e) throw new Error("missing entity");
  return e;
}
function stored(objects: (NamedNode | Literal)[]): Store {
  const store = new Store(new Parser().parse(`<${RES}#it> a <urn:T> .`));
  for (const object of objects)
    store.addQuad(DataFactory.namedNode(`${RES}#it`), DataFactory.namedNode("urn:p"), object);
  return store;
}
const lit = (value: string, datatype = "string") =>
  DataFactory.literal(value, DataFactory.namedNode(XSD + datatype));

describe("security review R1: manifest IRIREF safety", () => {
  for (const slot of [
    "type",
    "predicate",
    "datatype",
    "enum",
    "compositeType",
    "compositePredicate",
  ] as const) {
    it(`rejects unsafe and relative ${slot} IRIs`, () => {
      for (const iri of [
        "relative",
        "urn:T> . <urn:evil> <urn:p> <urn:o>",
        ...[...'< >"{}|^`\\', "\u0000", "\u007f"].map((c) => `urn:x${c}y`),
      ]) {
        const m = manifest(field({ kind: "iri", datatype: undefined, in: ["urn:ok"] }));
        const e = m.entities[0];
        if (!e) throw new Error("missing entity");
        if (slot === "type") e.typeIris = [iri];
        if (slot === "predicate") e.fields[0] = field({ predicate: iri });
        if (slot === "datatype") e.fields[0] = field({ datatype: iri });
        if (slot === "enum") e.fields[0] = field({ kind: "iri", datatype: undefined, in: [iri] });
        const input = slot.startsWith("composite")
          ? {
              ...m,
              entities: [
                {
                  name: "Tree",
                  kind: "composite",
                  root: "root",
                  nodes: [
                    {
                      name: "root",
                      typeIris: ["urn:R"],
                      fragment: "it",
                      fields: [
                        {
                          name: "child",
                          predicate: slot === "compositePredicate" ? iri : "urn:child",
                          kind: "nested",
                          node: "child",
                        },
                      ],
                    },
                    {
                      name: "child",
                      typeIris: [slot === "compositeType" ? iri : "urn:C"],
                      fragment: "child",
                      fields: [],
                    },
                  ],
                },
              ],
            }
          : m;
        expect(() => validateManifest(input), iri).toThrow(ManifestError);
      }
    });
  }
});

describe("security review R4: set cardinality", () => {
  for (const required of [true, false]) {
    it(`enforces set bounds after malformed-member drops (required=${required})`, () => {
      const e = entity(
        field({
          collection: "set",
          minCount: 2,
          maxCount: 3,
          guards: { requiredFailClosed: required },
        }),
      );
      for (const values of [
        [],
        [lit("a")],
        [lit("a"), DataFactory.namedNode("urn:bad")],
        [lit("a"), lit("b"), lit("c"), lit("d")],
        [lit("a"), lit("b"), lit("c"), DataFactory.namedNode("urn:bad")],
      ]) {
        expect(e.parse(RES, stored(values))).toEqual(required ? undefined : {});
      }
      expect(e.parse(RES, stored([lit("a"), lit("b")]))).toEqual({ val: ["a", "b"] });
    });
  }
});

describe("security review R6: exact composite link identity", () => {
  for (const required of [true, false]) {
    it(`follows only the exact linked subject, never its URL-normalized decoy (required=${required})`, () => {
      const e = defineModel({
        ...manifest(),
        entities: [
          {
            name: "Tree",
            kind: "composite",
            root: "root",
            nodes: [
              {
                name: "root",
                typeIris: ["urn:R"],
                fragment: "it",
                fields: [
                  {
                    name: "child",
                    predicate: "urn:child",
                    kind: "nested",
                    node: "child",
                    guards: { requiredFailClosed: required },
                  },
                ],
              },
              {
                name: "child",
                typeIris: ["urn:C"],
                fragment: "child",
                fields: [field({ guards: { requiredFailClosed: true } })],
              },
            ],
          },
        ],
      }).entities.Tree;
      if (!e) throw new Error("missing tree");
      for (const tail of ["", '<https://EX.test:443/child> a <urn:C>; <urn:p> "real" .']) {
        const store = new Store(
          new Parser().parse(
            `<${RES}#it> a <urn:R>; <urn:child> <https://EX.test:443/child> . <https://ex.test/child> a <urn:C>; <urn:p> "decoy" . ${tail}`,
          ),
        );
        expect(e.parse(RES, store)).toEqual(tail ? { val: "real" } : required ? undefined : {});
      }
    });
  }
});

it("security review R7: rejects forbidden characters surviving URL.href", () => {
  for (const iri of ["https://ex.test/a|b", "https://ex.test/?{x}", "https://ex.test/#^"]) {
    expect(httpIriOrUndefined(iri)).toBeUndefined();
    expect(isHttpIri(iri)).toBe(false);
  }
  expect(httpIriOrUndefined("https://ex.test/a%7Cb")).toBe("https://ex.test/a%7Cb");
});

it("security review R8: https-only fields enforce scheme on reads, writes and live sets", () => {
  for (const collection of [undefined, "set"] as const) {
    const e = entity({
      ...field({ kind: "iri", datatype: undefined, collection }),
      guards: { iriScheme: "https" },
    } as unknown as ManifestField);
    const store = e.build(RES, {
      val: collection ? ["http://ex.test/", "https://ex.test/"] : "http://ex.test/",
    });
    expect(e.parse(RES, store)).toEqual(collection ? { val: ["https://ex.test/"] } : {});
    expect(e.parse(RES, stored([DataFactory.namedNode("http://ex.test/")]))).toEqual({});
    const w = new e.Wrapper(`${RES}#it`, new Store(), DataFactory).mark() as unknown as Record<
      string,
      unknown
    >;
    if (collection) {
      (w.val as Set<string>).add("http://ex.test/");
      expect([...(w.val as Set<string>)]).toEqual([]);
    } else {
      w.val = "http://ex.test/";
      expect(w.val).toBeUndefined();
    }
  }
});

describe("security review R9: strict RDF literal mapping", () => {
  const malformed: Array<[string, NamedNode | Literal]> = [
    ["string", DataFactory.namedNode("urn:not-a-literal")],
    ["boolean", lit("yes", "boolean")],
    ...["integer", "int", "unsignedInt"].flatMap((dt) =>
      ["", "0x10", " 1", "1 ", "1\n", "1.0", "1e2", "+"].map((v): [string, NamedNode | Literal] => [
        dt,
        lit(v, dt),
      ]),
    ),
    ...["", "0x10", " 1", "1\n", "1e2"].map((v): [string, NamedNode | Literal] => [
      "decimal",
      lit(v, "decimal"),
    ]),
    ["double", lit("1\n", "double")],
    ["float", lit("1\n", "float")],
    ["integer", lit("1", "decimal")],
    ["string", lit("true", "boolean")],
  ];
  for (const [dt, term] of malformed) {
    it(`drops malformed ${dt} ${term.termType} ${JSON.stringify(term.value)} and rejects when required`, () => {
      for (const required of [false, true]) {
        const e = entity(
          field({ datatype: `xsd:${dt}`, guards: { requiredFailClosed: required } }),
        );
        expect(e.parse(RES, stored([term]))).toEqual(required ? undefined : {});
      }
    });
  }
  it("accepts XSD boolean, signed integer, decimal and floating lexical forms", () => {
    for (const [dt, values] of [
      ["boolean", ["true", "false", "1", "0"]],
      ["integer", ["+01", "-1", "0"]],
      ["decimal", ["+.5", "1.", "-1.25"]],
      ["double", ["1e2", "INF", "-INF", "NaN"]],
    ] as const) {
      const e = entity(field({ datatype: `xsd:${dt}`, guards: { requiredFailClosed: true } }));
      for (const v of values) expect(e.parse(RES, stored([lit(v, dt)]))).toHaveProperty("val");
    }
  });
});

describe("security review R10: ambiguous singletons", () => {
  for (const required of [true, false]) {
    it(`drops ambiguous fields without masking by defaults (required=${required})`, () => {
      const e = entity(field({ default: "fallback", guards: { requiredFailClosed: required } }));
      for (const values of [
        [lit("first"), lit("second")],
        [lit("first"), DataFactory.namedNode("urn:bad")],
      ]) {
        expect(e.parse(RES, stored(values))).toEqual(required ? undefined : {});
      }
      expect(e.parse(RES, stored([lit("first"), lit("first")]))).toEqual({ val: "first" });
    });
  }
});

describe("security review R11: closed enums", () => {
  for (const collection of [undefined, "set"] as const) {
    it(`enforces enums on parse, build and accessors (collection=${collection})`, () => {
      const e = entity(field({ collection, in: ["a", "b"] }));
      expect(e.parse(RES, stored([lit("outside")]))).toEqual({});
      expect(
        e.parse(RES, e.build(RES, { val: collection ? ["outside", "a"] : "outside" })),
      ).toEqual(collection ? { val: ["a"] } : {});
      const w = new e.Wrapper(`${RES}#it`, new Store(), DataFactory).mark() as unknown as Record<
        string,
        unknown
      >;
      if (collection) {
        (w.val as Set<string>).add("outside");
        expect([...(w.val as Set<string>)]).toEqual([]);
      } else {
        w.val = "outside";
        expect(w.val).toBeUndefined();
      }
      const required = entity(
        field({ collection, in: ["a", "b"], guards: { requiredFailClosed: true } }),
      );
      expect(required.parse(RES, stored([lit("outside")]))).toBeUndefined();
    });
  }
});

describe("security review R12: no ignored guards", () => {
  for (const f of [
    field({ guards: { iriScheme: "http-https" } }),
    field({ datatype: "xsd:integer", guards: { minLength: 1 } }),
    field({ datatype: "xsd:boolean", guards: { nonBlank: true } }),
    field({ guards: { minInclusive: 1 } }),
    field({ guards: { sortOnRead: true } }),
    field({ defaultNow: true }),
    field({ datatype: "xsd:duration", guards: { sanitizeText: true } }),
  ]) {
    it(`rejects incompatible field options ${JSON.stringify(f)}`, () => {
      expect(() => validateManifest(manifest(f))).toThrow(ManifestError);
    });
  }
});

it("security review R15: skill documents the non-validating build contract", () => {
  const e = entity(field({ guards: { requiredFailClosed: true } }));
  for (const data of [{}, { val: 42 }]) expect(e.parse(RES, e.build(RES, data))).toBeUndefined();
  const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
  expect(skill).toContain("build does not enforce requiredFailClosed");
});
