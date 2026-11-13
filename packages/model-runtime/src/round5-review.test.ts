// AUTHORED-BY Codex GPT-6
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { defineModel, type ManifestField, type ModelManifest, readLiteral, XSD } from "./index.js";
import { serializeTurtle } from "./rdf.js";

const EX = "https://ex.test/";
const RES = `${EX}doc`;
const { namedNode, literal, blankNode, quad } = DataFactory;
function entity(fields: ManifestField[] = []) {
  const manifest: ModelManifest = {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: {},
    entities: [
      { name: "Thing", typeIris: [`${EX}Thing`], subject: { convention: "self" }, fields },
    ],
  };
  const e = defineModel(manifest).entities.Thing;
  if (!e) throw new Error("missing entity");
  return e;
}
function field(datatype: string, set = false): ManifestField {
  return {
    name: "val",
    predicate: `${EX}value`,
    kind: "literal",
    datatype,
    ...(set ? { collection: "set" } : { maxCount: 1 }),
  };
}

const malformed: [string, Term][] = [
  ["Variable", DataFactory.variable("value")],
  ["quoted Quad", quad(namedNode(RES), namedNode(`${EX}p`), literal("nested"))],
  ...["-a", ".a", "a.", "a b", "a; <urn:p> <urn:o> . #", "a\n", "a:", "\u0300a"].map(
    (label): [string, Term] => [`blank label ${JSON.stringify(label)}`, blankNode(label)],
  ),
  ...[
    "en_US",
    "en-",
    "1en",
    "en--us",
    "en\n",
    "en; <urn:p> <urn:o> . #",
    "abcdefghi",
    "en-a",
    "en-a-foo-a-bar",
  ].map((lang): [string, Term] => [`language ${JSON.stringify(lang)}`, literal("text", lang)]),
];
describe("R5.1 runtime output integrity", () => {
  it.each(malformed)("rejects a store containing %s", async (_kind, term) => {
    const store = new Store([quad(namedNode(RES), namedNode(`${EX}p`), term as Quad["object"])]);
    await expect(async () => entity().storeToTurtle(store)).rejects.toThrow(TypeError);
  });
  it("rejects an empty blank-node label before N3 can replace it", async () => {
    const empty = Object.assign(blankNode("temporary"), { id: "_:" });
    await expect(async () =>
      serializeTurtle([quad(namedNode(RES), namedNode(`${EX}p`), empty)], {}),
    ).rejects.toThrow(TypeError);
  });
  it("rejects unknown RDF term kinds", async () => {
    const term = { termType: "Other", value: "x" } as unknown as Quad["object"];
    await expect(async () =>
      serializeTurtle([quad(namedNode(RES), namedNode(`${EX}p`), term)], {}),
    ).rejects.toThrow(TypeError);
  });
  it("checks the reparsed quad set before returning any output", async () => {
    const spy = vi.spyOn(Parser.prototype, "parse").mockImplementation(() => []);
    try {
      await expect(async () =>
        entity().storeToTurtle(
          new Store([quad(namedNode(RES), namedNode(`${EX}p`), literal("kept"))]),
        ),
      ).rejects.toThrow(TypeError);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
  it("rejects syntactically valid injected output from a forged N3 blank-node id", async () => {
    const forged = Object.assign(blankNode("safe"), {
      id: "_:safe . <urn:evil> <urn:p> <urn:o> . #",
    });
    Object.defineProperty(forged, "value", { value: "safe" });
    await expect(async () =>
      serializeTurtle([quad(namedNode(RES), namedNode(`${EX}p`), forged)], {}),
    ).rejects.toThrow(/round-trip integrity/);
  });
  it("rejects a valid language tag whose datatype would change during serialization", async () => {
    const inconsistent = literal("text", "en");
    Object.defineProperty(inconsistent, "datatype", { value: namedNode(`${XSD}string`) });
    await expect(async () =>
      serializeTurtle([quad(namedNode(RES), namedNode(`${EX}p`), inconsistent)], {}),
    ).rejects.toThrow(/round-trip integrity/);
  });
  it.each([
    "en-US",
    "zh-Hant-TW",
    "de-CH-1901",
    "en-US-u-ca-gregory",
    "x-private",
    "i-klingon",
  ])("preserves well-formed BCP 47 tag %s", async (language) => {
    const q = quad(namedNode(RES), namedNode(`${EX}p`), literal("text", language));
    const parsed = new Parser().parse(await serializeTurtle([q], {}));
    expect(parsed[0]?.equals(q)).toBe(true);
  });
  it("round-trips cyclic blank nodes, shared nodes, graphs and duplicate quads as a set", async () => {
    const a = blankNode("0.é");
    const b = blankNode("_b");
    const qs = [
      quad(a, namedNode(`${EX}p`), b),
      quad(b, namedNode(`${EX}p`), a),
      quad(a, namedNode(`${EX}p`), literal("text", "en-US"), b),
    ];
    const ttl = await serializeTurtle([...qs, ...qs], {});
    expect(new Store(new Parser().parse(ttl)).size).toBe(3);
  });
});

describe("R5.2 exact decimal reads", () => {
  it.each([
    "1.0000000000000001",
    "0.99999999999999999",
    "9007199254740993",
    `0.${"0".repeat(400)}1`,
  ])("rejects precision loss in %s", (lex) => {
    expect(() => readLiteral(literal(lex, namedNode(`${XSD}decimal`)))).toThrow();
  });
  it.each([
    "+01.000",
    "-.00",
    ".1000",
    "0.0000001",
    "1000000000000000000000",
  ])("accepts exact canonical equivalence for %s", (lex) => {
    expect(readLiteral(literal(lex, namedNode(`${XSD}decimal`)))).toBe(Number(lex));
  });
});

describe("R5.3 enum RDF identity", () => {
  it.each([
    false,
    true,
  ])("does not canonicalize a different IRI into an enum member (set=%s)", (set) => {
    const f: ManifestField = {
      ...field("xsd:string", set),
      kind: "iri",
      datatype: undefined,
      in: ["https://example.test/"],
      guards: { iriScheme: "http-https" },
    };
    const e = entity([f]);
    const ds = e.build(RES, {});
    ds.add(quad(namedNode(RES), namedNode(`${EX}value`), namedNode("https://example.test")));
    expect(e.parse(RES, ds)?.val).toBeUndefined();
  });
  for (const set of [false, true]) {
    for (const [datatype, member, aliases] of [
      ["xsd:integer", 1, ["01", "+1"]],
      ["xsd:decimal", 1, ["1.0", "01"]],
      ["xsd:boolean", true, ["1"]],
    ] as const) {
      it.each(aliases)(`drops noncanonical %s from ${datatype} enum (set=${set})`, (lex) => {
        const f = { ...field(datatype, set), in: [member], aliasPredicates: [`${EX}old`] };
        const e = entity([f]);
        for (const predicate of [`${EX}value`, `${EX}old`]) {
          const ds = e.build(RES, {});
          ds.add(
            quad(
              namedNode(RES),
              namedNode(predicate),
              literal(lex, namedNode(datatype.replace("xsd:", XSD))),
            ),
          );
          expect(e.parse(RES, ds)?.val).toBeUndefined();
          const w = new e.Wrapper(RES, ds, DataFactory) as unknown as { val: unknown };
          expect(set ? [...(w.val as Set<unknown>)] : w.val).toEqual(set ? [] : undefined);
        }
        const canonical = e.build(RES, { val: set ? [member] : member });
        expect(e.parse(RES, canonical)?.val).toEqual(set ? [member] : member);
      });
    }
  }
});

const subtypeCases = [
  ["language", "en-US", "en_US"],
  ["normalizedString", "a b", "a\tb"],
  ["token", "a b", " a  b "],
  ["NMTOKEN", "a:b.1", "a b"],
  ["Name", ":é.name", "1name"],
  ["NCName", "é.name", "a:b"],
  ["ID", "name", "1name"],
  ["IDREF", "name", "a:b"],
  ["ENTITY", "name", "a:b"],
  ["NMTOKENS", "a b", "a  b"],
  ["IDREFS", "a b", "a:b"],
  ["ENTITIES", "a b", ""],
] as const;
describe("R5.4 string subtype lexical spaces", () => {
  it.each(["normalizedString", "token"])("rejects non-XML characters in xsd:%s", (type) => {
    for (const bad of ["a\u0000b", "a\ud800b", "a\uffffb"]) {
      expect(() => readLiteral(literal(bad, namedNode(`${XSD}${type}`)))).toThrow();
      const e = entity([field(`xsd:${type}`)]);
      expect(e.parse(RES, e.build(RES, { val: bad }))?.val).toBeUndefined();
    }
  });
  it.each(subtypeCases)("validates xsd:%s on singleton/set reads and writes", (type, good, bad) => {
    for (const set of [false, true]) {
      const e = entity([field(`xsd:${type}`, set)]);
      const build = (value: string) => e.build(RES, { val: set ? [value] : value });
      expect(e.parse(RES, build(good))?.val).toEqual(set ? [good] : good);
      expect(e.parse(RES, build(bad))?.val).toBeUndefined();
      const ds = e.build(RES, {});
      ds.add(
        quad(namedNode(RES), namedNode(`${EX}value`), literal(bad, namedNode(`${XSD}${type}`))),
      );
      expect(e.parse(RES, ds)?.val).toBeUndefined();
      const writable = e.build(RES, {});
      const wrapper = new e.Wrapper(RES, writable, DataFactory) as unknown as {
        val: string | Set<string>;
      };
      if (set) (wrapper.val as Set<string>).add(bad);
      else wrapper.val = bad;
      expect(e.parse(RES, writable)?.val).toBeUndefined();
    }
  });
});

describe("R5.5 runtime parity", () => {
  it.each(["date", "dateTime"])("reads negative-zero xsd:%s years as year zero", (type) => {
    // XSD 1.1 permits `-0000`; it denotes year zero (supersedes the earlier rejection).
    const lex = type === "date" ? "-0000-01-01Z" : "-0000-01-01T00:00:00Z";
    const yearZero = new Date(0);
    yearZero.setUTCFullYear(0, 0, 1);
    expect(readLiteral(literal(lex, namedNode(`${XSD}${type}`)))).toEqual(yearZero);
  });
  it.each([
    ["date", "02026-01-01Z"],
    ["date", "-02026-01-01Z"],
    ["date", "00000-01-01Z"],
    ["date", "-000001-01-01Z"],
    ["dateTime", "02026-01-01T00:00:00Z"],
    ["dateTime", "-02026-01-01T00:00:00Z"],
    ["dateTime", "00000-01-01T00:00:00Z"],
    ["dateTime", "-000000-01-01T00:00:00.000Z"],
    ["dateTime", "-000001-01-01T00:00:00Z"],
  ])("rejects xsd:%s %s (XSD 1.1 yearFrag: leading zero only in four digits)", (type, lex) => {
    expect(() => readLiteral(literal(lex, namedNode(`${XSD}${type}`)))).toThrow();
  });
  it("reads the legacy six-digit negative xsd:dateTime only in the exact old writer form", () => {
    const yearMinusOne = new Date(0);
    yearMinusOne.setUTCFullYear(-1, 0, 1);
    expect(
      readLiteral(literal("-000001-01-01T00:00:00.000Z", namedNode(`${XSD}dateTime`))),
    ).toEqual(yearMinusOne);
    expect(() =>
      readLiteral(literal("-000001-01-01T00:00:00.000Z", namedNode(`${XSD}dateTimeStamp`))),
    ).toThrow();
  });
  for (const type of ["date", "dateTime"]) {
    it.each([10000, 100000, -1, -10000, 0])(`round-trips xsd:${type} year %i`, async (year) => {
      const e = entity([field(`xsd:${type}`)]);
      const date = new Date(0);
      date.setUTCFullYear(year, 0, 1);
      const store = e.build(RES, { val: date });
      expect(e.parse(RES, store)?.val).toEqual(date);
      expect(
        e.parse(RES, new Store(new Parser().parse(await e.storeToTurtle(store))))?.val,
      ).toEqual(date);
    });
  }
  it("sanitizes before build empty/blank drops and preserves direct setter empty strings", () => {
    const e = entity([
      { ...field("xsd:string"), guards: { emptyStringDrop: true } },
      {
        ...field("xsd:string", true),
        name: "tags",
        predicate: `${EX}tags`,
        guards: { trim: true, dropBlank: true },
      },
    ]);
    const ds = e.build(RES, {
      val: "\u0000",
      tags: ["\u0000", "\u0000 \u0000", "\u0000 good \u0000"],
    });
    expect(e.parse(RES, ds)).toEqual({ tags: ["good"] });
    const w = new e.Wrapper(RES, ds, DataFactory) as unknown as { val: string };
    w.val = "";
    expect(e.parse(RES, ds)?.val).toBe("");
  });
  for (const aliases of [false, true]) {
    for (const method of ["values", "keys", "entries", Symbol.iterator] as const) {
      it(`defers ${String(method)} enumeration until first next (aliases=${aliases})`, () => {
        const f = field("xsd:string", true);
        if (aliases) f.aliasPredicates = [`${EX}old`];
        const e = entity([f]);
        const ds = e.build(RES, { val: ["first"] });
        const w = new e.Wrapper(RES, ds, DataFactory) as unknown as { val: Set<string> };
        const iterator = w.val[method]();
        ds.add(
          quad(namedNode(RES), namedNode(aliases ? `${EX}old` : `${EX}value`), literal("later")),
        );
        expect([...iterator]).toEqual(
          method === "entries"
            ? [
                ["first", "first"],
                ["later", "later"],
              ]
            : ["first", "later"],
        );
      });
    }
  }
  it("defines singleton and set accessors as non-enumerable class accessors", () => {
    const e = entity([
      field("xsd:string"),
      { ...field("xsd:string", true), name: "tags", predicate: `${EX}tags` },
    ]);
    for (const key of ["val", "tags"])
      expect(Object.getOwnPropertyDescriptor(e.Wrapper.prototype, key)?.enumerable).toBe(false);
  });
});
