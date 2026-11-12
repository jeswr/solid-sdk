// AUTHORED-BY Codex (GPT-6.1 Sol)
import { defineModel, VALIDATED_DATATYPES, XSD } from "@jeswr/model-runtime";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { build, compileForm, formToShapes, parse, serialize, validate } from "../src/index.js";
import { EX, form, graph, plain, required, SHAPE, SUBJECT } from "./helpers.js";

const date = new Date("2026-11-11T00:00:00.000Z");
const samples: Record<string, string | number | boolean | Date> = {
  string: "hello",
  normalizedString: "hello",
  token: "hello world",
  language: "en-GB",
  NMTOKEN: "abc-1",
  Name: "abc",
  NCName: "abc",
  ID: "abc",
  IDREF: "abc",
  ENTITY: "abc",
  NMTOKENS: "abc def",
  IDREFS: "abc def",
  ENTITIES: "abc def",
  anyURI: "https://example.org/a",
  duration: "P1DT2H",
  boolean: false,
  date,
  dateTime: date,
  decimal: 1.25,
  float: 1.25,
  double: 1.25,
  integer: 1,
  int: 1,
  long: 1,
  short: 1,
  byte: 1,
  nonNegativeInteger: 0,
  positiveInteger: 1,
  nonPositiveInteger: 0,
  negativeInteger: -1,
  unsignedLong: 1,
  unsignedInt: 1,
  unsignedShort: 1,
  unsignedByte: 1,
};
describe("RDF value boundaries", () => {
  it.each(VALIDATED_DATATYPES)("build/parse preserves reviewed datatype %s", (datatype) => {
    const model = form(`sh:datatype <${datatype}>; sh:maxCount 1`);
    const value = samples[datatype.slice(XSD.length)];
    expect(value).toBeDefined();
    const store = build(model, SUBJECT, { value: required(value) });
    expect([...store][0]?.object.termType).toBe("Literal");
    expect(parse(model, SUBJECT, store)).toEqual({ value });
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
  });
  it.each([
    ["sh:datatype xsd:string; dash:singleLine false", "a\nb"],
    ["sh:nodeKind sh:IRI", "https://example.org/a"],
    ['sh:datatype xsd:string; sh:in ("a" "b")', "a"],
    ["sh:datatype xsd:integer; sh:in (1 2)", 2],
    ["sh:datatype xsd:boolean; sh:in (true false)", false],
    ["sh:nodeKind sh:IRI; sh:in (ex:a ex:b)", `${EX}b`],
  ] as const)("round trips UI kind %s", (constraint, value) => {
    const model = form(`${constraint}; sh:maxCount 1`);
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value }))).toEqual({ value });
  });
  it.each([
    ["sh:datatype xsd:boolean", "true"],
    ["sh:datatype xsd:boolean", 1],
    ["sh:datatype xsd:string", true],
    ["sh:datatype xsd:string", 1],
    ["sh:datatype xsd:date", "2026-01-01"],
    ["sh:datatype xsd:dateTime", new Date(NaN)],
    ["sh:nodeKind sh:IRI", 123],
    ["sh:datatype xsd:decimal", "1.25"],
  ] as const)("rejects wrong JS types for %s", (constraint, value) => {
    const model = form(constraint);
    expect(validate(model, { value }).valid).toBe(false);
    expect(() => build(model, SUBJECT, { value })).toThrow();
  });
  it("enforces all boundaries and messages", () => {
    const numeric = form(
      'sh:datatype xsd:integer; sh:minInclusive -1; sh:maxInclusive 1; sh:minCount 1; sh:maxCount 2; sh:message "Choose a bounded integer"',
    );
    expect(validate(numeric, { value: [-1, 1] })).toEqual({ valid: true, issues: [] });
    for (const value of [-2, 2, 0.5, NaN, Infinity, "1"])
      expect(validate(numeric, { value }).valid).toBe(false);
    expect(validate(numeric, {}).issues[0]?.message).toBe("Choose a bounded integer");
    expect(validate(numeric, { value: [-1, 0, 1] }).valid).toBe(false);
    expect(validate(numeric, { value: [0, 0] }).valid).toBe(true);
    const text = form('sh:datatype xsd:string; sh:minLength 2; sh:pattern "\\\\S"; sh:maxCount 1');
    expect(validate(text, { value: "ab" }).valid).toBe(true);
    expect(validate(text, { value: "😀" }).valid).toBe(false);
    expect(validate(text, { value: "😀a" }).valid).toBe(true);
    expect(validate(text, { value: "  " }).valid).toBe(false);
    const zero = form("sh:datatype xsd:string; sh:maxCount 0");
    expect(validate(zero, {}).valid).toBe(true);
    expect(validate(zero, { value: "" }).valid).toBe(false);
    const empty = form("sh:datatype xsd:string; sh:minLength 0; sh:maxCount 1");
    expect(parse(empty, SUBJECT, build(empty, SUBJECT, { value: "" }))).toEqual({ value: "" });
  });
  it.each(["Warning", "Info"])("reports %s without blocking the response", (severity) => {
    const model = form(`sh:datatype xsd:string; sh:minCount 1; sh:severity sh:${severity}`);
    expect(validate(model, {})).toMatchObject({
      valid: true,
      issues: [{ severity: severity.toLowerCase() }],
    });
    expect(() => build(model, SUBJECT, {})).not.toThrow();
  });
  it("never emits an invalid advisory value", () => {
    const model = form("sh:datatype xsd:integer; sh:severity sh:Warning; sh:maxCount 1");
    const store = build(model, SUBJECT, { value: "wrong" });
    expect(store.size).toBe(0);
  });
  it("sanitizes control characters before checking the stored text", () => {
    const model = form("sh:datatype xsd:string; sh:maxCount 1");
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value: "a\u0000b\u0085\t\n\r" }))).toEqual(
      { value: "ab\t\n\r" },
    );
    const required = form("sh:datatype xsd:string; sh:minLength 1");
    expect(validate(required, { value: "\u0000" }).valid).toBe(false);
    const token = form("sh:datatype xsd:token");
    expect(validate(token, { value: " a " }).valid).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/plain,x",
    "ftp://example.org/a",
    "/relative",
    "_:blank",
  ])("rejects hostile subjects and IRI values %s", (value) => {
    const model = form("sh:nodeKind sh:IRI; sh:maxCount 1");
    expect(validate(model, { value }).valid).toBe(false);
    expect(() => build(model, value, {})).toThrow(TypeError);
    expect(parse(model, value, new Store())).toEqual({});
    expect(
      parse(
        model,
        SUBJECT,
        graph(
          `<${SUBJECT}> ex:value ${value.startsWith("_:") ? value : `<${value.replace("<bad>", "%3Cbad%3E")}>`}.`,
        ),
      ),
    ).toEqual({});
  });
  it.each(["^https?://", "^https://"])("checks original IRI spelling for %s", (pattern) => {
    const model = form(`sh:nodeKind sh:IRI; sh:pattern "${pattern}"; sh:maxCount 1`);
    expect(validate(model, { value: " https://example.org/a" }).valid).toBe(false);
    expect(validate(model, { value: "https://example.org/a" }).valid).toBe(true);
    expect(validate(model, { value: "http://example.org/a" }).valid).toBe(pattern !== "^https://");
  });
  it("retains exact IRI enum identity and rejects normalized lookalikes", () => {
    const model = form("sh:nodeKind sh:IRI; sh:in (<https://EXAMPLE.org:443/a>); sh:maxCount 1");
    expect(
      parse(model, SUBJECT, build(model, SUBJECT, { value: "https://EXAMPLE.org:443/a" })),
    ).toEqual({ value: "https://EXAMPLE.org:443/a" });
    expect(validate(model, { value: "https://example.org/a" }).valid).toBe(false);
  });
  it.each([
    ["sh:nodeKind sh:IRI", '"https://example.org/a"'],
    ["sh:datatype xsd:integer", '"1"'],
    ["sh:datatype xsd:integer", '"1.5"^^xsd:integer'],
    ["sh:datatype xsd:decimal", '"1.0000000000000001"^^xsd:decimal'],
    ["sh:datatype xsd:boolean", '"yes"^^xsd:boolean'],
    ["sh:datatype xsd:date", '"2026-02-30Z"^^xsd:date'],
    ["sh:datatype xsd:dateTime", '"2026-01-01"^^xsd:dateTime'],
    ["sh:datatype xsd:unsignedByte", "256"],
    ["sh:datatype xsd:string", "ex:node"],
    ["sh:datatype xsd:duration", '"P1W"^^xsd:duration'],
    ["sh:datatype xsd:integer; sh:in (1 2)", '"01"^^xsd:integer'],
  ])("drops malformed RDF values: %s / %s", (constraint, object) => {
    const model = form(`${constraint}; sh:maxCount 1`);
    expect(parse(model, SUBJECT, graph(`<${SUBJECT}> ex:value ${object}.`))).toEqual({});
  });
  it("drops bad set members while retaining valid values and sibling fields", () => {
    const model = compileForm(
      graph(
        "ex:Form a sh:NodeShape; sh:property [sh:path ex:value; sh:datatype xsd:integer], [sh:path ex:ok; sh:datatype xsd:string; sh:maxCount 1].",
      ),
      SHAPE,
    );
    expect(parse(model, SUBJECT, graph(`<${SUBJECT}> ex:value 1, "wrong"; ex:ok "kept".`))).toEqual(
      { value: [1], ok: "kept" },
    );
    expect(
      parse(
        form("sh:datatype xsd:integer; sh:minCount 2"),
        SUBJECT,
        graph(`<${SUBJECT}> ex:value 1, "wrong".`),
      ),
    ).toEqual({});
    expect(
      parse(
        form("sh:datatype xsd:string; sh:maxCount 1"),
        SUBJECT,
        graph(`<${SUBJECT}> ex:value "a", "b".`),
      ),
    ).toEqual({});
  });
  it("bounds huge strings, 10k-value reads/writes, and malformed values objects", () => {
    const model = form("sh:datatype xsd:string");
    expect(validate(model, { value: "x".repeat(65537) }).valid).toBe(false);
    expect(parse(model, SUBJECT, graph(`<${SUBJECT}> ex:value "${"x".repeat(65537)}".`))).toEqual(
      {},
    );
    const values = Array.from({ length: 10000 }, (_, i) => String(i));
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value: values }))).toEqual({
      value: values,
    });
    expect(validate(model, { value: [...values, "overflow"] }).valid).toBe(false);
    expect(() => build(model, SUBJECT, { value: [...values, "overflow"] })).toThrow();
    const hostile = graph(
      `<${SUBJECT}> ex:value ${values.map((v) => `"${v}"`).join(",")}, "overflow".`,
    );
    expect(parse(model, SUBJECT, hostile)).toEqual({});
    const broken = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile");
        },
      },
    );
    expect(validate(model, broken).valid).toBe(false);
  });
  it("uses subclass membership in the data graph for class constraints", () => {
    const model = form("sh:class ex:Person; sh:maxCount 1");
    expect(
      parse(
        model,
        SUBJECT,
        graph(
          `<${SUBJECT}> ex:value ex:alice. ex:alice a ex:Employee. ex:Employee rdfs:subClassOf ex:Person.`,
        ),
      ),
    ).toEqual({ value: `${EX}alice` });
    expect(
      parse(
        model,
        SUBJECT,
        graph(
          `<${SUBJECT}> ex:value ex:alice. ex:alice a ex:Employee. ex:Employee rdfs:subClassOf ex:Employee.`,
        ),
      ),
    ).toEqual({});
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value: `${EX}alice` }))).toEqual({
      value: `${EX}alice`,
    });
  });
  it("readmits untrusted/mutated designer models at every write boundary", () => {
    const model = plain(form("sh:datatype xsd:string"));
    required(model.fields[0]).path = "javascript:alert(1)";
    // Predicate IRIs are RDF identifiers; response values and subjects remain http(s)-only.
    expect(() => build(model, "javascript:alert(1)", {})).toThrow();
    required(model.fields[0]).datatype = `${EX}unreviewed`;
    expect(() => build(model, SUBJECT, {})).toThrow();
    expect(parse(model, SUBJECT, new Store())).toEqual({});
  });
  it("matches generated runtime acceptance for scalar constraints", () => {
    const model = form(
      "sh:datatype xsd:integer; sh:minInclusive 1; sh:maxInclusive 3; sh:maxCount 1",
    );
    const generated = defineModel({
      manifestVersion: 1,
      runtime: { name: "@jeswr/model-runtime", major: 0 },
      prefixes: {},
      entities: [
        {
          name: "Sample",
          typeIris: [`${EX}Sample`],
          subject: { convention: "self" },
          fields: [
            {
              name: "amount",
              predicate: `${EX}value`,
              kind: "literal",
              datatype: `${XSD}integer`,
              guards: { minInclusive: 1, maxInclusive: 3 },
            },
          ],
        },
      ],
    });
    const entity = required(generated.entities.Sample);
    for (const value of [0, 1, 2, 3, 4, 1.5, "2", Infinity, NaN]) {
      const store = entity.build(`${EX}data`, { amount: value });
      const accepted = entity.parse(`${EX}data`, store)?.amount !== undefined;
      expect(validate(model, { value }).valid).toBe(accepted);
    }
  });
  it("validates serialization and keeps shapes-graph prefixes", async () => {
    const model = compileForm(
      graph(
        'ex:Form a sh:NodeShape; sh:declare [sh:prefix "ex"; sh:namespace "https://example.org/"^^xsd:anyURI]; sh:property [sh:path ex:value; sh:datatype xsd:string; sh:maxCount 1].',
      ),
      SHAPE,
    );
    const store = build(model, SUBJECT, { value: 'quotes " and \\ and\nlines' });
    const ttl = await serialize(store);
    expect(ttl).toContain("@prefix ex:");
    expect(parse(model, SUBJECT, graph(ttl))).toEqual({ value: 'quotes " and \\ and\nlines' });
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
    const bad = new Store([
      DataFactory.quad(
        DataFactory.namedNode("https://example.org/<bad>"),
        DataFactory.namedNode(`${EX}p`),
        DataFactory.literal("x"),
      ),
    ]);
    await expect(serialize(bad)).rejects.toThrow(TypeError);
  });
});
