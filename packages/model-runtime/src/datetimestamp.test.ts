// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  isKnownDatatype,
  isXsdDateTime,
  isXsdDateTimeStamp,
  literalMapper,
  type ManifestField,
  type ModelManifest,
  readLiteral,
  VALIDATED_DATATYPES,
  validateManifest,
  XSD,
} from "./index.js";

const EX = "https://example.org/";
const RES = `${EX}event`;
const STAMP = `${XSD}dateTimeStamp`;
const LEXICAL = "2026-11-11T10:20:30.125Z";
const WHEN = new Date(LEXICAL);

function manifest(requiredSet = false): ModelManifest {
  const field = (name: string, extra: Partial<ManifestField> = {}): ManifestField => ({
    name,
    predicate: EX + name,
    kind: "literal",
    datatype: "xsd:dateTimeStamp",
    maxCount: 1,
    ...extra,
  });
  return {
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: { ex: EX, xsd: XSD },
    entities: [
      {
        name: "Event",
        typeIris: [`${EX}Event`],
        subject: { convention: "self" },
        fields: [
          field("when", { minCount: 1, guards: { requiredFailClosed: true } }),
          field("seen"),
          field("plain", { datatype: "xsd:dateTime" }),
          field("occurrences", {
            collection: "set",
            minCount: requiredSet ? 1 : 0,
            maxCount: 4,
            guards: { requiredFailClosed: requiredSet },
          }),
        ],
      },
    ],
  };
}

function event(requiredSet = false) {
  const entity = defineModel(manifest(requiredSet)).entities.Event;
  if (!entity) throw new Error("Event missing");
  return entity;
}

// Untrusted fixtures enter through a parser; production writes use the runtime.
function storeWith(when = LEXICAL, extra = "", datatype = "dateTimeStamp"): Store {
  return new Store(
    new Parser().parse(`
    @prefix ex: <${EX}> . @prefix xsd: <${XSD}> .
    <${RES}> a ex:Event; ex:when ${JSON.stringify(when)}^^xsd:${datatype} .
    ${extra}
  `),
  );
}

function term(lexical: string, datatype = STAMP) {
  return DataFactory.literal(lexical, DataFactory.namedNode(datatype));
}

const VALID: [string, string][] = [
  [LEXICAL, LEXICAL],
  ["2026-11-11T10:20:30Z", "2026-11-11T10:20:30.000Z"],
  ["2026-11-11T10:20:30+14:00", "2026-11-10T20:20:30.000Z"],
  ["2026-11-11T10:20:30-14:00", "2026-11-12T00:20:30.000Z"],
  ["2026-11-11T10:20:30.1+05:30", "2026-11-11T04:50:30.100Z"],
  ["2026-11-11T10:20:30.123456-05:45", "2026-11-11T16:05:30.123Z"],
  ["2026-11-11T10:20:30+00:00", "2026-11-11T10:20:30.000Z"],
  ["2026-11-11T10:20:30-00:00", "2026-11-11T10:20:30.000Z"],
  ["2024-02-29T24:00:00Z", "2024-03-01T00:00:00.000Z"],
  ["2026-12-31T24:00:00.000+14:00", "2026-12-31T10:00:00.000Z"],
  ["100000-01-01T12:30:05.250Z", "+100000-01-01T12:30:05.250Z"],
  ["12026-01-01T00:00:00-14:00", "+012026-01-01T14:00:00.000Z"],
  ["-0001-06-01T12:00:00Z", "-000001-06-01T12:00:00.000Z"],
  ["-12345-01-01T00:00:00+14:00", "-012346-12-31T10:00:00.000Z"],
  ["0000-02-29T00:00:00Z", "0000-02-29T00:00:00.000Z"],
  ["275760-09-13T00:00:00Z", "+275760-09-13T00:00:00.000Z"],
  ["-271821-04-20T00:00:00Z", "-271821-04-20T00:00:00.000Z"],
];

const MALFORMED = [
  "2026-11-11T10:20:30", // timezone is mandatory, unlike dateTime
  "2026-11-11T10:20:30.125",
  "100000-01-01T00:00:00",
  "-0001-01-01T00:00:00",
  "2026-11-11T10:20:30+14:01",
  "2026-11-11T10:20:30-14:01",
  "2026-11-11T10:20:30+15:00",
  "2026-11-11T10:20:30-15:00",
  "2026-11-11T10:20:30+13:60",
  "2026-11-11T10:20:30+5:30",
  "2026-11-11T10:20:30+0530",
  "2026-11-11T10:20:30Z+01:00",
  "2026-11-11T10:20:30z",
  "2026-11-11t10:20:30Z",
  "2026-11-11 10:20:30Z",
  "2026-11-11T10:20Z",
  "2026-11-11T10:20:30.Z",
  "2026-11-11T10:20:60Z",
  "2026-11-11T10:60:00Z",
  "2026-11-11T25:00:00Z",
  "2026-11-11T24:00:01Z",
  "2026-11-11T24:01:00Z",
  "2026-11-11T24:00:00.001Z",
  "2026-02-29T00:00:00Z",
  "1900-02-29T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-00-01T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-01-00T00:00:00Z",
  "+012026-01-01T00:00:00Z",
  "2026-11-11Z",
  "January 1 2026",
  "",
  ` ${LEXICAL}`,
  `${LEXICAL} `,
  `${LEXICAL}\n`,
  `${LEXICAL}\r`,
];

describe("xsd:dateTimeStamp strict reads and severity grading", () => {
  it.each(VALID)("reads and round-trips %s", (lexical, instant) => {
    const entity = event();
    const expected = new Date(instant);
    expect(isXsdDateTime(lexical)).toBe(true);
    expect(isXsdDateTimeStamp(lexical)).toBe(true);
    expect(readLiteral(term(lexical))).toEqual(expected);
    expect(entity.parse(RES, storeWith(lexical))).toEqual({ when: expected });
    const built = entity.build(RES, { when: expected, plain: expected });
    const written = built.getObjects(RES, `${EX}when`, null);
    expect(written).toHaveLength(1);
    expect(written[0]?.termType).toBe("Literal");
    expect((written[0] as ReturnType<typeof term>).datatype.value).toBe(STAMP);
    expect(isXsdDateTimeStamp(written[0]?.value ?? "")).toBe(true);
    expect(written[0]?.value.endsWith("Z")).toBe(true);
    expect(written[0]?.value).toBe(built.getObjects(RES, `${EX}plain`, null)[0]?.value);
    expect(entity.parse(RES, built)).toEqual({ when: expected, plain: expected });
  });

  it.each(MALFORMED)("rejects malformed %j at both severity grades", (lexical) => {
    const entity = event();
    expect(isXsdDateTimeStamp(lexical)).toBe(false);
    expect(() => readLiteral(term(lexical))).toThrow();
    expect(entity.parse(RES, storeWith(lexical))).toBeUndefined();
    const ds = storeWith(
      LEXICAL,
      `<${RES}> ex:seen ${JSON.stringify(lexical)}^^xsd:dateTimeStamp .`,
    );
    expect(entity.parse(RES, ds)).toEqual({ when: WHEN });
    const wrapper = new entity.Wrapper(RES, ds, DataFactory) as unknown as { seen?: Date };
    expect(wrapper.seen).toBeUndefined();
  });

  it.each([
    "275760-09-13T00:00:00.001Z",
    "275760-09-13T00:00:00-00:01",
    "-271821-04-20T00:00:00+00:01",
    "275761-01-01T00:00:00Z",
    "9007199254740992-01-01T00:00:00Z",
    "-0000-01-01T00:00:00Z",
  ])("drops lexically valid but unrepresentable %s", (lexical) => {
    expect(isXsdDateTimeStamp(lexical)).toBe(true);
    expect(() => readLiteral(term(lexical))).toThrow();
    const entity = event();
    expect(entity.parse(RES, storeWith(lexical))).toBeUndefined();
    expect(
      entity.parse(RES, storeWith(LEXICAL, `<${RES}> ex:seen "${lexical}"^^xsd:dateTimeStamp .`)),
    ).toEqual({ when: WHEN });
  });

  it.each([
    "dateTime",
    "date",
    "string",
  ])("rejects an xsd:%s literal on a stamp field", (datatype) => {
    const entity = event();
    expect(entity.parse(RES, storeWith(LEXICAL, "", datatype))).toBeUndefined();
    expect(
      entity.parse(RES, storeWith(LEXICAL, `<${RES}> ex:seen "${LEXICAL}"^^xsd:${datatype} .`)),
    ).toEqual({ when: WHEN });
  });

  it("rejects a stamp literal on a dateTime field while dateTime still accepts zoneless values", () => {
    const entity = event();
    expect(
      entity.parse(RES, storeWith(LEXICAL, `<${RES}> ex:plain "${LEXICAL}"^^xsd:dateTimeStamp .`)),
    ).toEqual({ when: WHEN });
    expect(
      entity.parse(
        RES,
        storeWith(LEXICAL, `<${RES}> ex:plain "2026-11-11T10:20:30.125"^^xsd:dateTime .`),
      ),
    ).toEqual({ when: WHEN, plain: WHEN });
    const input = manifest();
    const first = input.entities[0];
    if (!first || first.kind === "composite" || !first.fields[0]) throw new Error("field missing");
    first.fields[0].datatype = "xsd:dateTime";
    const plain = defineModel(input).entities.Event;
    if (!plain) throw new Error("Event missing");
    expect(plain.parse(RES, storeWith())).toBeUndefined();
    expect(plain.parse(RES, storeWith(LEXICAL, "", "dateTime"))).toEqual({ when: WHEN });
  });

  it.each([
    `<${EX}date>`,
    "[]",
    `"${LEXICAL}"@en`,
  ])("drops a non-datatyped-literal term %s", (object) => {
    const entity = event();
    expect(entity.parse(RES, storeWith(LEXICAL, `<${RES}> ex:seen ${object} .`))).toEqual({
      when: WHEN,
    });
    const invalidRequired = new Store(
      new Parser().parse(`
      @prefix ex: <${EX}> . <${RES}> a ex:Event; ex:when ${object} .`),
    );
    expect(entity.parse(RES, invalidRequired)).toBeUndefined();
  });
});

describe("xsd:dateTimeStamp writes and manifest admission", () => {
  it("exports only the reviewed mapping, accepting shorthand and full-IRI manifests", () => {
    for (const datatype of ["xsd:dateTimeStamp", STAMP]) {
      const input = manifest();
      const entity = input.entities[0];
      if (!entity || entity.kind === "composite" || !entity.fields[0])
        throw new Error("field missing");
      entity.fields[0].datatype = datatype;
      expect(validateManifest(input)).toBeDefined();
      expect(isKnownDatatype(datatype)).toBe(true);
      expect(literalMapper(datatype).jsType).toBe("date");
    }
    expect(Object.isFrozen(VALIDATED_DATATYPES)).toBe(true);
    expect(VALIDATED_DATATYPES).toContain(STAMP);
    for (const local of ["time", "gYear", "dateTimestamp", "DateTimeStamp"]) {
      expect(isKnownDatatype(XSD + local)).toBe(false);
      expect(() => literalMapper(XSD + local)).toThrow(/unsupported datatype/);
    }
  });

  it.each([
    new Date(Number.NaN),
    LEXICAL,
  ])("drops invalid write %s in build and setters", (invalid) => {
    const entity = event();
    const ds = entity.build(RES, { when: WHEN, seen: invalid });
    expect(ds.getObjects(RES, `${EX}seen`, null)).toEqual([]);
    const wrapper = new entity.Wrapper(RES, ds, DataFactory) as unknown as { seen?: unknown };
    wrapper.seen = WHEN;
    expect(ds.getObjects(RES, `${EX}seen`, null)).toEqual([term(LEXICAL)]);
    wrapper.seen = invalid;
    expect(ds.getObjects(RES, `${EX}seen`, null)).toEqual([]);
    expect(entity.parse(RES, entity.build(RES, { when: invalid }))).toBeUndefined();
  });

  it("round-trips serialized Turtle through parseDocument", async () => {
    const entity = event();
    const ttl = await entity.serialize(RES, { when: WHEN });
    expect(new Store(new Parser().parse(ttl)).getObjects(RES, `${EX}when`, null)).toEqual([
      term(LEXICAL),
    ]);
    expect(await entity.parseDocument(RES, ttl, "text/turtle")).toEqual({ when: WHEN });
  });
});

describe("xsd:dateTimeStamp sets", () => {
  const validMembers = `<${RES}> ex:occurrences "${LEXICAL}"^^xsd:dateTimeStamp,
    "2026-11-11T11:20:30.125+01:00"^^xsd:dateTimeStamp .`;
  const invalidMembers = [
    '"2026-11-11T10:20:30"^^xsd:dateTimeStamp',
    '"2026-11-11T10:20:30+14:01"^^xsd:dateTimeStamp',
    `"${LEXICAL}"^^xsd:dateTime`,
  ];
  it.each(
    invalidMembers,
  )("filters optional set member %s and rejects it in a required set", (invalid) => {
    const ds = storeWith(LEXICAL, `${validMembers} <${RES}> ex:occurrences ${invalid} .`);
    expect(event().parse(RES, ds)).toEqual({ when: WHEN, occurrences: [WHEN] });
    expect(event(true).parse(RES, ds)).toBeUndefined();
  });

  it("deduplicates by instant and enforces required set cardinality", () => {
    expect(event(true).parse(RES, storeWith(LEXICAL, validMembers))).toEqual({
      when: WHEN,
      occurrences: [WHEN],
    });
    expect(event(true).parse(RES, storeWith())).toBeUndefined();
    const ds = storeWith(
      LEXICAL,
      `<${RES}> ex:occurrences ${Array.from(
        { length: 5 },
        (_, i) => `"2026-11-11T10:20:3${i}Z"^^xsd:dateTimeStamp`,
      ).join(", ")} .`,
    );
    expect(event(true).parse(RES, ds)).toBeUndefined();
  });

  it("builds sets and guards live adds, has and delete by instant", () => {
    const entity = event();
    const later = new Date(WHEN.getTime() + 1);
    const ds = entity.build(RES, { when: WHEN, occurrences: [WHEN, new Date(Number.NaN), later] });
    expect(entity.parse(RES, ds)).toEqual({ when: WHEN, occurrences: [WHEN, later] });
    const wrapper = new entity.Wrapper(RES, ds, DataFactory) as unknown as {
      occurrences: Set<Date>;
    };
    const set = wrapper.occurrences;
    set.add(new Date(Number.NaN));
    set.add(new Date(WHEN.getTime()));
    expect(set.size).toBe(2);
    expect(set.has(new Date(WHEN.getTime()))).toBe(true);
    expect(set.delete(new Date(WHEN.getTime()))).toBe(true);
    expect(set.has(WHEN)).toBe(false);
    set.add(WHEN);
    expect(ds.getObjects(RES, `${EX}occurrences`, null)).toContainEqual(term(LEXICAL));
    set.clear();
    expect(ds.getObjects(RES, `${EX}occurrences`, null)).toEqual([]);
  });
});
