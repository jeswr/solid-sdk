// AUTHORED-BY Claude Opus 5.5
/**
 * Opt-in exact `xsd:decimal` mapping (`field.decimal: "exact"`) and the reviewed
 * closed `upper-alpha-3` string pattern (projection of `sh:pattern "^[A-Z]{3}$"`).
 */
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  EXACT_DECIMAL_MAX_LENGTH,
  exactDecimalMapper,
  fieldLiteralMapper,
  isExactDecimalLexical,
  isUpperAlpha3,
  literalMapper,
  type ManifestEntity,
  ManifestError,
  type ManifestField,
  type ModelManifest,
  matchesStringPattern,
  readLiteral,
  validateManifest,
  XSD,
} from "./index.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const DEC = `${XSD}decimal`;
const STR = `${XSD}string`;

const manifest = (fields: ManifestField[]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: { ex: EX, xsd: XSD },
  entities: [{ name: "Price", typeIris: [`${EX}Price`], subject: { convention: "self" }, fields }],
});

const FIELDS: ManifestField[] = [
  {
    name: "amount",
    predicate: `${EX}amount`,
    kind: "literal",
    datatype: DEC,
    decimal: "exact",
    minCount: 1,
    maxCount: 1,
    guards: { requiredFailClosed: true },
  },
  {
    name: "fee",
    predicate: `${EX}fee`,
    kind: "literal",
    datatype: "xsd:decimal",
    decimal: "exact",
    maxCount: 1,
  },
  {
    name: "parts",
    predicate: `${EX}part`,
    kind: "literal",
    datatype: DEC,
    decimal: "exact",
    collection: "set",
  },
  {
    name: "currency",
    predicate: `${EX}currency`,
    kind: "literal",
    datatype: STR,
    minCount: 1,
    maxCount: 1,
    guards: { requiredFailClosed: true, stringPattern: "upper-alpha-3" },
  },
  {
    name: "altCurrency",
    predicate: `${EX}altCurrency`,
    kind: "literal",
    datatype: STR,
    maxCount: 1,
    guards: { stringPattern: "upper-alpha-3" },
  },
  {
    name: "currencies",
    predicate: `${EX}currencies`,
    kind: "literal",
    datatype: STR,
    collection: "set",
    guards: { stringPattern: "upper-alpha-3" },
  },
  {
    name: "legacy",
    predicate: `${EX}legacy`,
    kind: "literal",
    datatype: DEC,
    maxCount: 1,
  },
];

const model = defineModel(manifest(FIELDS));
const price = model.entities.Price as NonNullable<(typeof model.entities)["Price"]>;

const doc = (body: string) =>
  new Store(
    new Parser().parse(
      `@prefix ex: <${EX}> . @prefix xsd: <${XSD}> . <${DOC}> a ex:Price ; ${body} .`,
    ),
  );
const objects = (store: Store, p: string) =>
  store.getQuads(DOC, `${EX}${p}`, null, null).map((q) => q.object);

const VALID = [
  "0",
  "10.50",
  "9007199254740993.01",
  "007.50",
  "-0.0",
  "+1",
  "-12.340",
  "1.000000000000000000000000000001",
  "9".repeat(EXACT_DECIMAL_MAX_LENGTH),
  `-${"1".repeat(EXACT_DECIMAL_MAX_LENGTH - 3)}.0`,
];
const INVALID: unknown[] = [
  "",
  ".5",
  "5.",
  "-.5",
  "1e3",
  "1E3",
  "1.5e-3",
  " 1",
  "1 ",
  "1\n",
  "\t1",
  "1 000",
  "-",
  "+",
  ".",
  "+-1",
  "--1",
  "1.2.3",
  "1,5",
  "0x10",
  "NaN",
  "INF",
  "Infinity",
  "１",
  "٣",
  "1٣",
  "१.५",
  "9".repeat(EXACT_DECIMAL_MAX_LENGTH + 1),
  `-${"1".repeat(EXACT_DECIMAL_MAX_LENGTH)}`,
  "1\u0000",
  10.5,

  null,
  undefined,
  {},
];

describe("isExactDecimalLexical — the closed exact decimal grammar", () => {
  it.each(VALID)("accepts %j", (v) => expect(isExactDecimalLexical(v)).toBe(true));
  it.each(INVALID)("rejects %j", (v) => expect(isExactDecimalLexical(v)).toBe(false));
  it("caps the lexical at 64 characters and rejects a bigint", () => {
    expect(EXACT_DECIMAL_MAX_LENGTH).toBe(64);
    expect(isExactDecimalLexical(10n)).toBe(false);
    expect(price.build(DOC, { amount: 10n, currency: "USD" }).size).toBe(2);
  });
});

describe("exactDecimalMapper / fieldLiteralMapper", () => {
  it("maps xsd:decimal (full IRI or shorthand) to a lexically-validated string", () => {
    for (const dt of [DEC, "xsd:decimal"]) {
      const m = exactDecimalMapper(dt);
      expect(m.jsType).toBe("string");
      expect(m.lexicalValid).toBe(isExactDecimalLexical);
      expect(m.numericValid).toBeUndefined();
    }
  });
  it.each([
    "integer",
    "positiveInteger",
    "nonNegativeInteger",
    "long",
    "int",
    "unsignedByte",
    "double",
    "float",
    "string",
  ])("rejects the exact mapping for xsd:%s (subtypes included)", (local) => {
    expect(() => exactDecimalMapper(`${XSD}${local}`)).toThrow(/requires xsd:decimal/);
    expect(() => fieldLiteralMapper(`${XSD}${local}`, "exact")).toThrow(/requires xsd:decimal/);
  });
  it("defaults to the unchanged number mapping and rejects unknown mappings", () => {
    expect(fieldLiteralMapper(DEC).jsType).toBe("number");
    expect(fieldLiteralMapper(DEC)).toEqual(expect.objectContaining({ jsType: "number" }));
    expect(literalMapper(DEC).jsType).toBe("number");
    expect(() => fieldLiteralMapper(DEC, "loose" as never)).toThrow(/unsupported/);
  });
  it("reads only Literals typed exactly xsd:decimal and writes the string unchanged", () => {
    const m = exactDecimalMapper(DEC);
    const lit = (v: string, dt: string) => DataFactory.literal(v, DataFactory.namedNode(dt));
    expect(m.as(lit("10.50", DEC) as never)).toBe("10.50");
    expect(() => m.as(lit("10", `${XSD}integer`) as never)).toThrow();
    expect(() => m.as(lit("10.50", STR) as never)).toThrow();
    expect(() => m.as(DataFactory.namedNode(`${EX}x`) as never)).toThrow();
    const out = m.from("007.50" as never, DataFactory);
    expect(out.termType).toBe("Literal");
    expect(out.value).toBe("007.50");
    expect((out as { datatype: { value: string } }).datatype.value).toBe(DEC);
  });
  it("leaves the shared readLiteral (admission) on the default number mapping", () => {
    expect(readLiteral(DataFactory.literal("10.50", DataFactory.namedNode(DEC)))).toBe(10.5);
  });
});

describe("isUpperAlpha3 / matchesStringPattern", () => {
  it.each(["USD", "EUR", "GBP", "AAA", "ZZZ", "XAU"])("accepts %j", (v) => {
    expect(isUpperAlpha3(v)).toBe(true);
    expect(matchesStringPattern("upper-alpha-3", v)).toBe(true);
  });
  it.each([
    "usd",
    "Usd",
    "uSD",
    "US",
    "U",
    "",
    "USDX",
    "USD ",
    " USD",
    "USD\n",
    "US\u0000D",
    "ÜSD",
    "ＵSD",
    "US1",
    "U-D",
    "@AB",
    "AB[",
    "ΑΒΓ",
    "UŚD",
  ])("rejects %j", (v) => {
    expect(isUpperAlpha3(v)).toBe(false);
    expect(matchesStringPattern("upper-alpha-3", v)).toBe(false);
  });
  it("rejects non-strings and fails closed on an unknown pattern", () => {
    for (const v of [123, null, undefined, ["USD"], { toString: () => "USD" }])
      expect(isUpperAlpha3(v)).toBe(false);
    expect(matchesStringPattern("other" as never, "USD")).toBe(false);
  });
});

describe("exact decimal fields — build / parse / round trip", () => {
  it.each(VALID)("preserves %j byte-for-byte through build, Turtle and parse", async (v) => {
    const store = price.build(DOC, { amount: v, currency: "USD" });
    const [term] = objects(store, "amount");
    expect(term?.value).toBe(v);
    expect((term as { datatype?: { value: string } }).datatype?.value).toBe(DEC);
    expect(price.parse(DOC, store)?.amount).toBe(v);
    const turtle = await price.serialize(DOC, { amount: v, currency: "USD" });
    const parsed = await price.parseDocument(DOC, turtle);
    expect(parsed?.amount).toBe(v);
  });

  it("keeps a 2^53+1 significand and scale that a JS number would lose", () => {
    const store = price.build(DOC, {
      amount: "9007199254740993.01",
      fee: "10.50",
      currency: "EUR",
    });
    expect(price.parse(DOC, store)).toMatchObject({
      amount: "9007199254740993.01",
      fee: "10.50",
      currency: "EUR",
    });
  });

  it.each(INVALID)("build drops the invalid optional value %j", (v) => {
    const store = price.build(DOC, { amount: "1", fee: v, currency: "USD" });
    expect(objects(store, "fee")).toHaveLength(0);
  });

  it.each(INVALID)("build never writes an invalid required value %j", (v) => {
    const store = price.build(DOC, { amount: v, currency: "USD" });
    expect(objects(store, "amount")).toHaveLength(0);
    // The required field is absent, so the record does not parse back.
    expect(price.parse(DOC, store)).toBeUndefined();
  });

  it.each([
    ['"1e3"^^xsd:decimal', "exponent"],
    ['".5"^^xsd:decimal', "no integer digits"],
    ['"5."^^xsd:decimal', "no fraction digits"],
    ['" 1"^^xsd:decimal', "whitespace"],
    ['"١"^^xsd:decimal', "unicode digit"],
    ['"10.50"^^xsd:integer', "wrong datatype"],
    ['"10.50"^^xsd:double', "wrong datatype"],
    ['"10.50"', "plain string"],
    ['"10.50"@en', "language string"],
    ["ex:x", "IRI"],
    [`"${"1".repeat(EXACT_DECIMAL_MAX_LENGTH + 1)}"^^xsd:decimal`, "too long"],
  ])("parse rejects a required %s (%s)", (lexical) => {
    const store = doc(`ex:amount ${lexical} ; ex:currency "USD"`);
    expect(price.parse(DOC, store)).toBeUndefined();
  });

  it("parse drops an invalid optional value and keeps the record", () => {
    const store = doc('ex:amount 1.00 ; ex:fee "1e3"^^xsd:decimal ; ex:currency "USD"');
    const data = price.parse(DOC, store);
    expect(data).toMatchObject({ amount: "1.00", currency: "USD" });
    expect(data).not.toHaveProperty("fee");
  });

  it("parse rejects an ambiguous required singleton", () => {
    const store = doc('ex:amount 1.0, 1.00 ; ex:currency "USD"');
    expect(price.parse(DOC, store)).toBeUndefined();
  });

  it("Turtle numeric shorthand reads as its exact lexical", () => {
    const store = doc('ex:amount 007.50 ; ex:fee -0.0 ; ex:currency "USD"');
    expect(price.parse(DOC, store)).toMatchObject({ amount: "007.50", fee: "-0.0" });
  });

  it("set members are validated on build, add and read", () => {
    const store = price.build(DOC, {
      amount: "1",
      currency: "USD",
      parts: ["1.10", "1.1", "1e3", ".5", 2, "0.00"],
    });
    expect(
      objects(store, "part")
        .map((t) => t.value)
        .sort(),
    ).toEqual(["0.00", "1.1", "1.10"]);
    const w = new price.Wrapper(DOC, store, DataFactory) as unknown as {
      parts: Set<unknown>;
    };
    w.parts.add("5.");
    w.parts.add(3.5);
    w.parts.add("-2.500");
    expect([...w.parts].sort()).toEqual(["-2.500", "0.00", "1.1", "1.10"]);
    const hostile = doc('ex:amount 1.0 ; ex:currency "USD" ; ex:part 2.0, "2e1"^^xsd:decimal');
    expect(price.parse(DOC, hostile)?.parts).toEqual(["2.0"]);
  });

  it("wrapper accessors read and write the exact string; invalid writes clear", () => {
    const store = price.build(DOC, { amount: "1", currency: "USD" });
    const w = new price.Wrapper(DOC, store, DataFactory) as unknown as { fee?: unknown };
    w.fee = "007.50";
    expect(w.fee).toBe("007.50");
    w.fee = 7.5;
    expect(w.fee).toBeUndefined();
    expect(objects(store, "fee")).toHaveLength(0);
    w.fee = "7.5e0";
    expect(objects(store, "fee")).toHaveLength(0);
  });

  it("does not sanitize-repair a value before validation", () => {
    const store = price.build(DOC, { amount: "1.0\u0000", currency: "USD" });
    expect(objects(store, "amount")).toHaveLength(0);
  });

  it("leaves the default number mapping byte-for-byte unchanged", () => {
    const store = doc('ex:amount 1.0 ; ex:currency "USD" ; ex:legacy "10.50"^^xsd:decimal');
    expect(price.parse(DOC, store)?.legacy).toBe(10.5);
    const built = price.build(DOC, { amount: "1", currency: "USD", legacy: 10.5 });
    expect(objects(built, "legacy")[0]?.value).toBe("10.5");
    const lossy = doc(
      'ex:amount 1.0 ; ex:currency "USD" ; ex:legacy "9007199254740993.01"^^xsd:decimal',
    );
    expect(price.parse(DOC, lossy)).not.toHaveProperty("legacy");
    const asString = price.build(DOC, { amount: "1", currency: "USD", legacy: "10.50" });
    expect(objects(asString, "legacy")).toHaveLength(0);
  });
});

describe("upper-alpha-3 string pattern fields — build / parse", () => {
  it("round trips a valid code", async () => {
    const turtle = await price.serialize(DOC, { amount: "1", currency: "GBP" });
    expect((await price.parseDocument(DOC, turtle))?.currency).toBe("GBP");
  });

  it.each([
    "usd",
    "Usd",
    "US",
    "USDX",
    "ÜSD",
    "ＵSD",
    " USD",
    "USD\n",
    "US\u0000D",
    "",
    5,
  ])("build drops %j and the required record no longer parses", (v) => {
    const store = price.build(DOC, { amount: "1", currency: v });
    expect(objects(store, "currency")).toHaveLength(0);
    expect(price.parse(DOC, store)).toBeUndefined();
    const opt = price.build(DOC, { amount: "1", currency: "USD", altCurrency: v });
    expect(objects(opt, "altCurrency")).toHaveLength(0);
  });

  it.each([
    '"usd"',
    '"USDX"',
    '"ÜSD"',
    '"USD "',
    '"USD"@en',
    '"USD"^^xsd:token',
    "ex:USD",
  ])("parse rejects the required currency %s", (term) => {
    expect(price.parse(DOC, doc(`ex:amount 1.0 ; ex:currency ${term}`))).toBeUndefined();
  });

  it("parse drops an invalid optional code and filters set members", () => {
    const data = price.parse(
      DOC,
      doc('ex:amount 1.0 ; ex:currency "USD" ; ex:altCurrency "eur" ; ex:currencies "EUR", "jpy"'),
    );
    expect(data).toMatchObject({ currency: "USD", currencies: ["EUR"] });
    expect(data).not.toHaveProperty("altCurrency");
  });

  it("a live set rejects invalid adds", () => {
    const store = price.build(DOC, { amount: "1", currency: "USD", currencies: ["EUR", "eur"] });
    const w = new price.Wrapper(DOC, store, DataFactory) as unknown as {
      currencies: Set<unknown>;
    };
    w.currencies.add("CHF");
    w.currencies.add("CHFX");
    w.currencies.add("chf");
    expect([...w.currencies].sort()).toEqual(["CHF", "EUR"]);
  });
});

describe("manifest validation fails closed", () => {
  const literal = (extra: Partial<ManifestField>): ManifestField => ({
    name: "x",
    predicate: `${EX}x`,
    kind: "literal",
    datatype: DEC,
    maxCount: 1,
    ...extra,
  });
  const check = (field: ManifestField) => () => validateManifest(manifest([field]));

  it("accepts the supported shapes", () => {
    expect(check(literal({ decimal: "exact" }))).not.toThrow();
    expect(check(literal({ decimal: "exact", default: "0.00" }))).not.toThrow();
    expect(
      check(literal({ decimal: "exact", collection: "set", maxCount: undefined })),
    ).not.toThrow();
    expect(
      check(literal({ datatype: "xsd:string", guards: { stringPattern: "upper-alpha-3" } })),
    ).not.toThrow();
  });

  it.each([
    ["decimal value", literal({ decimal: "loose" as never }), /must be "exact"/],
    ["decimal true", literal({ decimal: true as never }), /must be "exact"/],
    [
      "decimal on integer",
      literal({ datatype: `${XSD}integer`, decimal: "exact" }),
      /xsd:decimal literal/,
    ],
    [
      "decimal on positiveInteger",
      literal({ datatype: `${XSD}positiveInteger`, decimal: "exact" }),
      /xsd:decimal literal/,
    ],
    [
      "decimal on double",
      literal({ datatype: `${XSD}double`, decimal: "exact" }),
      /xsd:decimal literal/,
    ],
    [
      "decimal on string",
      literal({ datatype: `${XSD}string`, decimal: "exact" }),
      /xsd:decimal literal/,
    ],
    [
      "decimal on IRI",
      { name: "x", predicate: `${EX}x`, kind: "iri", decimal: "exact" } as ManifestField,
      /xsd:decimal literal/,
    ],
    ["decimal with in", literal({ decimal: "exact", in: ["1.0"] }), /field.in/],
    ["decimal with numeric in", literal({ decimal: "exact", in: [1] }), /field.in/],
    [
      "decimal with minInclusive",
      literal({ decimal: "exact", guards: { minInclusive: 0 } }),
      /numeric/,
    ],
    [
      "decimal with maxInclusive",
      literal({ decimal: "exact", guards: { maxInclusive: 0 } }),
      /numeric/,
    ],
    ["decimal with minLength", literal({ decimal: "exact", guards: { minLength: 1 } }), /exact/],
    ["decimal with nonBlank", literal({ decimal: "exact", guards: { nonBlank: true } }), /exact/],
    [
      "decimal with emptyStringDrop",
      literal({ decimal: "exact", guards: { emptyStringDrop: true } }),
      /exact|strict/,
    ],
    [
      "decimal with sanitizeText",
      literal({ decimal: "exact", guards: { sanitizeText: false } }),
      /exact|strict/,
    ],
    ["decimal with numeric default", literal({ decimal: "exact", default: 1.5 }), /default/],
    ["decimal with bad default", literal({ decimal: "exact", default: "1e3" }), /default/],
    [
      "decimal with stringPattern",
      literal({ decimal: "exact", guards: { stringPattern: "upper-alpha-3" } }),
      /stringPattern/,
    ],
    [
      "unknown stringPattern",
      literal({ datatype: STR, guards: { stringPattern: "lower-alpha-3" as never } }),
      /upper-alpha-3/,
    ],
    [
      "regex source as stringPattern",
      literal({ datatype: STR, guards: { stringPattern: "^[A-Z]{3}$" as never } }),
      /upper-alpha-3/,
    ],
    [
      "stringPattern on decimal",
      literal({ guards: { stringPattern: "upper-alpha-3" } }),
      /stringPattern/,
    ],
    [
      "stringPattern on token",
      literal({ datatype: `${XSD}token`, guards: { stringPattern: "upper-alpha-3" } }),
      /stringPattern/,
    ],
    [
      "stringPattern on IRI",
      {
        name: "x",
        predicate: `${EX}x`,
        kind: "iri",
        guards: { stringPattern: "upper-alpha-3" },
      } as ManifestField,
      /stringPattern/,
    ],
  ])("rejects %s", (_label, field, message) => {
    expect(check(field)).toThrow(ManifestError);
    expect(check(field)).toThrow(message);
  });

  it.each([
    "trim",
    "dropBlank",
    "sanitizeText",
  ] as const)("rejects stringPattern combined with %s (the pattern sees the raw value)", (key) => {
    const field = literal({
      datatype: STR,
      collection: "set",
      maxCount: undefined,
      guards: { stringPattern: "upper-alpha-3", [key]: true },
    });
    expect(check(field)).toThrow(new RegExp(`stringPattern cannot be combined with ${key}`));
  });

  it("rejects decimal on a nested composite link", () => {
    const entity = {
      name: "C",
      kind: "composite",
      root: "r",
      nodes: [
        {
          name: "r",
          typeIris: [`${EX}R`],
          fragment: "it",
          fields: [{ name: "n", predicate: `${EX}n`, kind: "nested", node: "c", decimal: "exact" }],
        },
        { name: "c", typeIris: [`${EX}C`], fragment: "c", fields: [] },
      ],
    };
    expect(() =>
      validateManifest({ ...manifest([]), entities: [entity] } as unknown as ModelManifest),
    ).toThrow(/decimal/);
  });

  it("an exact default is applied as the exact string on read", () => {
    const m = defineModel(
      manifest([
        literal({ name: "fee", predicate: `${EX}fee`, decimal: "exact", default: "0.00" }),
      ] as ManifestField[]),
    );
    const e = m.entities.Price as NonNullable<(typeof m.entities)["Price"]>;
    expect(e.parse(DOC, doc('ex:other "x"'))?.fee).toBe("0.00");
  });
});

// Type-level: the manifest entity type accepts the new keys.
const _typed: ManifestEntity = {
  name: "T",
  typeIris: [`${EX}T`],
  subject: { convention: "self" },
  fields: [FIELDS[0] as ManifestField],
};
void _typed;
