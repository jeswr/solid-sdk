// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import type { Term } from "@rdfjs/types";
import { SetFrom, TermWrapper } from "@rdfjs/wrapper";
import env from "@zazuko/env-node";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  buildObservation,
  buildObservationDay,
  buildRoom,
  buildSensor,
  DEFAULT_MAX_OBSERVATIONS,
  ENVR,
  type ObservationInput,
  observationDocPath,
  PROPERTY,
  PROPERTY_UNITS,
  parseObservations,
  parseObservationsTurtle,
  parseSensor,
  QUANTITY_KIND,
  QUDT,
  RDF_TYPE,
  SOSA,
  SOSA_OBSERVATION,
  sensorDocPath,
  storeToTurtle,
  UNITS,
  XSD,
} from "../src/index.js";

const DOC = "https://pod.example/environment/monitor/2026/11/11.ttl";
const SENSOR = "https://pod.example/environment/monitor/sensor.ttl#sensor";
const ROOM = "https://pod.example/rooms.ttl#office";
const ROOT = `${DOC}#one`;
const base: ObservationInput = {
  sensor: SENSOR,
  property: PROPERTY.CO2Concentration,
  featureOfInterest: ROOM,
  resultTime: "2026-11-11T15:00:00Z",
  value: 650.5,
  unit: UNITS.PPM,
};
const terms = (store: Store, iri: string, predicate: string) =>
  SetFrom.subjectPredicate(
    new TermWrapper(iri, store, DataFactory),
    predicate,
    (term) => term as unknown as Term,
    (term: Term) => term,
  );
function replace(
  store: Store,
  iri: string,
  predicate: string,
  ...values: ReturnType<typeof DataFactory.literal>[]
) {
  const set = terms(store, iri, predicate);
  set.clear();
  for (const value of values) set.add(value);
}
function moveResult(store: Store, iri: string, resultIri: string) {
  const result = [...terms(store, iri, `${SOSA}hasResult`)][0];
  if (result?.termType !== "NamedNode") throw new Error("Missing result fixture");
  const quads = store.getQuads(result, null, null, null);
  store.removeQuads(quads);
  store.addQuads(
    quads.map(({ predicate, object, graph }) =>
      DataFactory.quad(DataFactory.namedNode(resultIri), predicate, object, graph),
    ),
  );
  const links = terms(store, iri, `${SOSA}hasResult`);
  links.clear();
  links.add(DataFactory.namedNode(resultIri));
}
const shapes = env.dataset(
  new Parser().parse(
    readFileSync(
      new URL(
        "../../solid-federation-vocab/sectors/environment/environment.shacl.ttl",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
async function validate(store: Store) {
  return new SHACLValidator(shapes, { factory: env }).validate(env.dataset([...store]));
}

describe("generated models and the environment sector", () => {
  it("round-trips an observation whose subject is the document IRI itself", async () => {
    const store = buildObservation(DOC, base);
    expect(await parseObservationsTurtle(DOC, await storeToTurtle(store))).toEqual([
      { ...base, iri: DOC, resultTime: "2026-11-11T15:00:00.000Z" },
    ]);
  });
  it("preserves every sector constraint and exactly the authorized observable-property inventory", () => {
    const sector = readFileSync(
      new URL(
        "../../solid-federation-vocab/sectors/environment/environment.shacl.ttl",
        import.meta.url,
      ),
      "utf8",
    );
    const profile = readFileSync(
      new URL("../codegen/environment.shapes.ttl", import.meta.url),
      "utf8",
    );
    expect(profile.slice(profile.indexOf("@prefix"))).toBe(sector.slice(sector.indexOf("@prefix")));
    const ontology = new Store(
      new Parser().parse(
        readFileSync(
          new URL(
            "../../solid-federation-vocab/sectors/environment/environment.ttl",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const properties = ontology.getSubjects(RDF_TYPE, `${SOSA}ObservableProperty`, null);
    expect(properties.map(({ value }) => value).sort()).toEqual(Object.values(PROPERTY).sort());
    for (const property of properties) {
      expect(property.value.startsWith(ENVR)).toBe(true);
      expect([
        ...terms(ontology, property.value, "http://www.w3.org/2000/01/rdf-schema#label"),
      ]).toHaveLength(1);
      expect([
        ...terms(ontology, property.value, "http://www.w3.org/2000/01/rdf-schema#comment"),
      ]).toHaveLength(1);
      const kinds = [...terms(ontology, property.value, `${QUDT}hasQuantityKind`)];
      expect(kinds).toHaveLength(1);
      expect(kinds[0]?.value.startsWith(QUANTITY_KIND)).toBe(true);
    }
  });
  it.each(
    Object.entries(PROPERTY_UNITS),
  )("round-trips %s and conforms to the sector", async (property, unit) => {
    const input = {
      ...base,
      property: property as ObservationInput["property"],
      unit,
      value: 21.25,
    };
    const store = buildObservation(ROOT, input);
    expect((await validate(store)).conforms).toBe(true);
    const result = await parseObservationsTurtle(DOC, await storeToTurtle(store));
    expect(result).toEqual([{ ...input, iri: ROOT, resultTime: "2026-11-11T15:00:00.000Z" }]);
    // The generated composite parser independently validates the same graph and exact result link.
    const conventional = entities.Observation.build(DOC, {
      madeBySensor: SENSOR,
      observedProperty: input.property,
      hasFeatureOfInterest: ROOM,
      resultTime: new Date(base.resultTime),
      numericValue: input.value,
      unit,
    });
    expect(parseObservations(DOC, conventional)).toHaveLength(1);
    expect(entities.Observation.parse(DOC, conventional)?.numericValue).toBe(input.value);
  });
  it("round-trips sensor metadata and room data through guarded generated accessors", async () => {
    const data = {
      label: 'Office "monitor"',
      manufacturer: "IKEA",
      model: "ALPSTUGA",
      isHostedBy: "https://pod.example/devices.ttl#shelf",
    };
    const sensor = buildSensor(SENSOR, data);
    expect(parseSensor(SENSOR, new Store(new Parser().parse(await storeToTurtle(sensor))))).toEqual(
      data,
    );
    const store = new Store([...sensor, ...buildRoom(ROOM, { label: "Office" })]);
    expect((await validate(store)).results).toHaveLength(0);
  });
  it("rejects missing labels and malformed optional sensor input", () => {
    expect(() => buildRoom(ROOM, { label: " " })).toThrow();
    expect(() => buildSensor(SENSOR, { label: "" })).toThrow();
    expect(() => buildSensor(SENSOR, { label: "M", model: 42 as unknown as string })).toThrow();
    expect(() => buildSensor(SENSOR, { label: "M", isHostedBy: "/relative" })).toThrow();
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite numeric values (%s)", (value) => {
    expect(() => buildObservation(ROOT, { ...base, value })).toThrow(/finite/);
  });
  it.each([
    [1e21, "1000000000000000000000"],
    [1e-7, "0.0000001"],
  ] as const)("writes %s as the plain decimal %s", async (value, lexical) => {
    const store = buildObservation(ROOT, { ...base, value });
    const [term] = [...terms(store, `${ROOT}--result`, `${QUDT}numericValue`)];
    expect(term?.equals(DataFactory.literal(lexical, DataFactory.namedNode(`${XSD}decimal`)))).toBe(
      true,
    );
    expect((await validate(store)).conforms).toBe(true);
    const turtle = await storeToTurtle(store);
    expect(turtle).toContain(lexical);
    const result = await parseObservationsTurtle(DOC, turtle);
    expect(result[0]?.value).toBe(value);
    expect(result.skipped).toBe(0);
  });
  it.each([
    "1e21",
    "1e+21",
    "1e-7",
    "1E-7",
  ])("skips exponent-form xsd:decimal %s", async (lexical) => {
    const store = buildObservation(ROOT, base);
    replace(
      store,
      `${ROOT}--result`,
      `${QUDT}numericValue`,
      DataFactory.literal(lexical, DataFactory.namedNode(`${XSD}decimal`)),
    );
    expect(parseObservations(DOC, store).skipped).toBe(1);
    const result = await parseObservationsTurtle(DOC, await storeToTurtle(store));
    expect(result).toEqual([]);
    expect(result.skipped).toBe(1);
  });
  it.each([
    [PROPERTY.CO2Concentration, [0, 1e21], [-0.01]],
    [PROPERTY.PM2_5MassConcentration, [0, 1e21], [-0.01]],
    [PROPERTY.PM10MassConcentration, [0, 1e21], [-0.01]],
    [PROPERTY.VOCIndex, [0, 1e21], [-0.01]],
    [PROPERTY.AirQualityIndex, [0, 1e21], [-0.01]],
    [PROPERTY.FanSpeedLevel, [0, 1e21], [-0.01]],
    [PROPERTY.AirTemperature, [-60, 0, 100], [-60.01, 100.01]],
    [PROPERTY.RelativeHumidity, [0, 100], [-0.01, 100.01]],
    [PROPERTY.FilterLifeRemaining, [0, 100], [-0.01, 100.01]],
  ] as const)("enforces plausible values for %s on write and read", (property, valid, invalid) => {
    const input = { ...base, property, unit: PROPERTY_UNITS[property] };
    for (const value of valid) {
      const result = parseObservations(DOC, buildObservation(ROOT, { ...input, value }));
      expect(result[0]?.value).toBe(value);
      expect(result.skipped).toBe(0);
    }
    for (const value of invalid) {
      expect(() => buildObservation(ROOT, { ...input, value })).toThrow(RangeError);
      expect(() =>
        buildObservationDay(DOC, SENSOR, "2026-11-11", [{ ...input, value, id: "a" }]),
      ).toThrow(RangeError);
      const store = buildObservation(ROOT, { ...input, value: valid[0] });
      replace(
        store,
        `${ROOT}--result`,
        `${QUDT}numericValue`,
        DataFactory.literal(String(value), DataFactory.namedNode(`${XSD}decimal`)),
      );
      const result = parseObservations(DOC, store);
      expect(result).toEqual([]);
      expect(result.skipped).toBe(1);
    }
  });
  it("rejects unknown properties, units and property/unit mismatches on write and read", async () => {
    expect(() => buildObservation(ROOT, { ...base, unit: UNITS.DEG_C })).toThrow(/match/);
    expect(() =>
      buildObservation(ROOT, {
        ...base,
        property: "https://example.org/unknown" as ObservationInput["property"],
      }),
    ).toThrow(/match/);
    const store = buildObservation(ROOT, base);
    const unit = terms(store, `${ROOT}--result`, `${QUDT}unit`);
    unit.clear();
    unit.add(DataFactory.namedNode(UNITS.DEG_C));
    expect(parseObservations(DOC, store)).toEqual([]);
    // Pairing is facade policy: SHACL alone admits two individually valid enum members.
    expect((await validate(store)).conforms).toBe(true);
    unit.clear();
    unit.add(DataFactory.namedNode("https://example.org/unknown-unit"));
    expect((await validate(store)).conforms).toBe(false);
    expect(parseObservations(DOC, store)).toEqual([]);
  });
  it.each([
    "2026-02-30T10:00:00Z",
    "2026-11-11",
    "2026-11-11T10:00:00",
    "bad",
    new Date(NaN),
  ])("rejects invalid or timezone-less times (%s)", (resultTime) => {
    expect(() => buildObservation(ROOT, { ...base, resultTime })).toThrow();
  });
  it("normalizes offsets into UTC and rejects timezone-less RDF on read", () => {
    expect(
      parseObservations(
        DOC,
        buildObservation(ROOT, { ...base, resultTime: "2026-11-11T17:00:00+02:00" }),
      )[0]?.resultTime,
    ).toBe("2026-11-11T15:00:00.000Z");
    const store = buildObservation(ROOT, base);
    replace(
      store,
      ROOT,
      `${SOSA}resultTime`,
      DataFactory.literal("2026-11-11T15:00:00", DataFactory.namedNode(`${XSD}dateTime`)),
    );
    expect(parseObservations(DOC, store)).toEqual([]);
  });
  it("rejects wrong datatypes, missing required fields and several results", async () => {
    const store = buildObservation(ROOT, base);
    replace(
      store,
      `${ROOT}--result`,
      `${QUDT}numericValue`,
      DataFactory.literal("650.5", DataFactory.namedNode(`${XSD}double`)),
    );
    expect(parseObservations(DOC, store)).toEqual([]);
    expect((await validate(store)).conforms).toBe(false);
    const ambiguous = buildObservation(ROOT, base);
    terms(ambiguous, ROOT, `${SOSA}hasResult`).add(DataFactory.namedNode(`${DOC}#another`));
    expect(parseObservations(DOC, ambiguous)).toEqual([]);
    expect((await validate(ambiguous)).conforms).toBe(false);
    const missing = buildObservation(ROOT, base);
    terms(missing, ROOT, `${SOSA}madeBySensor`).clear();
    expect(parseObservations(DOC, missing)).toEqual([]);
    expect((await validate(missing)).conforms).toBe(false);
  });
  it("rejects a literal result, untyped quantity, malformed result unit and ambiguous values", () => {
    const literal = buildObservation(ROOT, base);
    terms(literal, ROOT, `${SOSA}hasResult`).clear();
    terms(literal, ROOT, `${SOSA}hasResult`).add(DataFactory.literal("result"));
    expect(parseObservations(DOC, literal)).toEqual([]);
    const untyped = buildObservation(ROOT, base);
    terms(untyped, `${ROOT}--result`, RDF_TYPE).clear();
    expect(parseObservations(DOC, untyped)).toEqual([]);
    const two = buildObservation(ROOT, base);
    terms(two, `${ROOT}--result`, `${QUDT}numericValue`).add(
      DataFactory.literal("20", DataFactory.namedNode(`${XSD}decimal`)),
    );
    expect(parseObservations(DOC, two)).toEqual([]);
  });
});

describe("day documents and bounded parsing", () => {
  const entry = (id: string, resultTime: string = String(base.resultTime)) => ({
    ...base,
    id,
    resultTime,
  });
  it("keeps array behavior and reports skipped roots, including malformed and foreign roots", () => {
    const store = new Store([
      ...buildObservation(ROOT, base),
      ...buildObservation("https://other.example/doc#foreign", base),
    ]);
    terms(store, `${DOC}#malformed`, RDF_TYPE).add(DataFactory.namedNode(SOSA_OBSERVATION));
    store.addQuad(
      DataFactory.blankNode(),
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(SOSA_OBSERVATION),
    );
    const result = parseObservations(DOC, store);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ ...base, iri: ROOT, resultTime: "2026-11-11T15:00:00.000Z" }]);
    expect(result.skipped).toBe(3);
    expect(Object.keys(result)).toEqual(["0"]);
    expect(JSON.parse(JSON.stringify(result))).toEqual([...result]);
    expect(parseObservations(DOC, new Store()).skipped).toBe(0);
  });
  it("filters exact sensors and UTC days independently or together, with one skip per root", async () => {
    const otherSensor = `${SENSOR}-other`;
    const store = new Store([
      ...buildObservation(ROOT, base),
      ...buildObservation(`${DOC}#foreign-sensor`, { ...base, sensor: otherSensor }),
      ...buildObservation(`${DOC}#previous-day`, {
        ...base,
        resultTime: "2026-11-11T00:30:00+02:00",
      }),
      ...buildObservation(`${DOC}#both`, {
        ...base,
        sensor: otherSensor,
        resultTime: "2026-11-12T00:00:00Z",
      }),
      ...buildObservation(`${DOC}#offset`, {
        ...base,
        resultTime: "2026-11-12T00:30:00+02:00",
      }),
    ]);
    expect(parseObservations(DOC, store)).toHaveLength(5);
    for (const options of [
      { expectedSensor: SENSOR },
      { expectedDay: "2026-11-11" },
      { expectedSensor: SENSOR, expectedDay: "2026-11-11" },
    ]) {
      const result = parseObservations(DOC, store, options);
      expect(result.skipped).toBe(options.expectedSensor && options.expectedDay ? 3 : 2);
      expect(result.length + result.skipped).toBe(5);
      const turtleResult = await parseObservationsTurtle(DOC, await storeToTurtle(store), options);
      expect(turtleResult).toEqual(result);
      expect(turtleResult.skipped).toBe(result.skipped);
    }
    const filtered = parseObservations(DOC, store, {
      expectedSensor: SENSOR,
      expectedDay: "2026-11-11",
    });
    expect(filtered.map(({ iri }) => iri)).toEqual([ROOT, `${DOC}#offset`]);
    expect(parseObservations(DOC, store, { expectedDay: "2026-11-13" }).skipped).toBe(5);
    expect(() =>
      parseObservations(DOC, store, { expectedDay: "2026-11-13", maxObservations: 1 }),
    ).toThrow(RangeError);
  });
  it.each([
    "2026-02-30",
    "2026-1-01",
    "2026-11-11T00:00:00Z",
    "bad",
    "",
  ])("rejects invalid expected day %s", async (expectedDay) => {
    expect(() => parseObservations(DOC, new Store(), { expectedDay })).toThrow(TypeError);
    await expect(parseObservationsTurtle(DOC, "", { expectedDay })).rejects.toThrow(TypeError);
  });
  it("rejects invalid expected sensor IRIs", async () => {
    expect(() =>
      parseObservations(DOC, new Store(), { expectedSensor: "relative#sensor" }),
    ).toThrow(TypeError);
    await expect(
      parseObservationsTurtle(DOC, "", { expectedSensor: "relative#sensor" }),
    ).rejects.toThrow(TypeError);
  });
  it.each([
    "https://elsewhere.example/doc#quantity",
    `${DOC}-other#quantity`,
    `${DOC}?query#quantity`,
    `${DOC}/child#quantity`,
  ])("drops an otherwise valid out-of-document result %s", async (resultIri) => {
    const store = buildObservation(ROOT, base);
    moveResult(store, ROOT, resultIri);
    expect(parseObservations(DOC, store).skipped).toBe(1);
    const result = await parseObservationsTurtle(DOC, await storeToTurtle(store));
    expect(result).toEqual([]);
    expect(result.skipped).toBe(1);
  });
  it("accepts a result at the document URL or in its fragment namespace", () => {
    for (const resultIri of [DOC, `${DOC}#quantity`]) {
      const store = buildObservation(ROOT, base);
      moveResult(store, ROOT, resultIri);
      expect(parseObservations(DOC, store)).toHaveLength(1);
    }
  });
  it.each([
    `${DOC}#two`,
    "https://elsewhere.example/doc#two",
  ])("drops both owners of a shared result, including foreign observations (%s)", async (otherIri) => {
    const store = new Store([
      ...buildObservation(ROOT, base),
      ...buildObservation(otherIri, base),
      ...buildObservation(`${DOC}#independent`, base),
    ]);
    const resultLink = terms(store, otherIri, `${SOSA}hasResult`);
    resultLink.clear();
    resultLink.add(DataFactory.namedNode(`${ROOT}--result`));
    const result = await parseObservationsTurtle(DOC, await storeToTurtle(store));
    expect(result.map(({ iri }) => iri)).toEqual([`${DOC}#independent`]);
    expect(result.skipped).toBe(2);
  });
  it("counts sharing by malformed observations before expected sensor/day filtering", () => {
    const store = buildObservation(ROOT, base);
    const other = `${DOC}#malformed`;
    terms(store, other, RDF_TYPE).add(DataFactory.namedNode(SOSA_OBSERVATION));
    terms(store, other, `${SOSA}hasResult`).add(DataFactory.namedNode(`${ROOT}--result`));
    const result = parseObservations(DOC, store, {
      expectedSensor: SENSOR,
      expectedDay: "2026-11-11",
    });
    expect(result).toEqual([]);
    expect(result.skipped).toBe(2);
  });
  it("rejects named graphs even when the graph is unrelated to valid observations", () => {
    const store = buildObservation(ROOT, base);
    store.addQuad(
      DataFactory.namedNode("https://other.example/subject"),
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(SOSA_OBSERVATION),
      DataFactory.namedNode("https://other.example/graph"),
    );
    expect(() => parseObservations(DOC, store)).toThrow(TypeError);
    expect(() => parseObservations(DOC, store)).toThrow(/default graph/);
  });
  it("requires the sensor's canonical day document path relative to any base", () => {
    const day = "2026-11-11";
    for (const documentUrl of [
      DOC.replace("/monitor/", "/other/"),
      DOC.replace("/11.ttl", "/12.ttl"),
      DOC.replace("/2026/", "/2025/"),
      DOC.replace("/environment/", "/xenvironment/"),
      `${DOC}?query`,
    ]) {
      expect(() => buildObservationDay(documentUrl, SENSOR, day, [])).toThrow(TypeError);
      expect(() => buildObservationDay(documentUrl, SENSOR, day, [])).toThrow(/day path/);
    }
    expect(() =>
      buildObservationDay(DOC, "https://pod.example/unpartitioned#sensor", day, []),
    ).toThrow(TypeError);
    for (const prefix of ["", "/nested/base"]) {
      const documentUrl = DOC.replace("/environment/", `${prefix}/environment/`);
      const sensor = SENSOR.replace("/environment/", `${prefix}/environment/`);
      expect(() => buildObservationDay(documentUrl, sensor, day, [])).not.toThrow();
      expect(() => buildObservationDay(documentUrl, SENSOR, day, [])).not.toThrow();
      expect(() =>
        buildObservationDay(documentUrl, sensor, "2026-11-12T00:30:00+02:00", []),
      ).not.toThrow();
    }
    expect(() =>
      buildObservationDay(DOC.replace("pod.example", "other.example"), SENSOR, day, []),
    ).not.toThrow();
  });
  it("stores many roots and quantities in one document, preserving stable ids", async () => {
    const store = buildObservationDay(
      DOC,
      SENSOR,
      "2026-11-11",
      Array.from({ length: 64 }, (_, i) => entry(`reading-${i}`)),
    );
    expect(store.getSubjects(RDF_TYPE, SOSA_OBSERVATION, null)).toHaveLength(64);
    expect(parseObservations(DOC, store).map(({ iri }) => iri)).toEqual(
      Array.from({ length: 64 }, (_, i) => `${DOC}#observation-reading-${i}`),
    );
    expect(await parseObservationsTurtle(DOC, await storeToTurtle(store))).toHaveLength(64);
    expect((await validate(store)).conforms).toBe(true);
  });
  it("supports the default 2000 roots and configurable higher/lower limits", () => {
    const inputs = Array.from({ length: DEFAULT_MAX_OBSERVATIONS + 1 }, (_, i) =>
      entry(`reading-${i}`),
    );
    const store = buildObservationDay(DOC, SENSOR, "2026-11-11", inputs.slice(0, 3));
    // Malformed roots still consume the budget; do not build thousands of unrelated quantities.
    for (let i = 3; i < inputs.length; i++) {
      terms(store, `${DOC}#malformed-${i}`, RDF_TYPE).add(DataFactory.namedNode(SOSA_OBSERVATION));
    }
    expect(() => parseObservations(DOC, store)).toThrow(/Observation cap/);
    expect(parseObservations(DOC, store, { maxObservations: 2001 })).toHaveLength(3);
    expect(() => buildObservationDay(DOC, SENSOR, "2026-11-11", inputs)).toThrow(/Observation cap/);
    expect(() => parseObservations(DOC, store, { maxObservations: 2 })).toThrow(/Observation cap/);
    expect(() =>
      buildObservationDay(DOC, SENSOR, "2026-11-11", inputs.slice(0, 3), { maxObservations: 2 }),
    ).toThrow(/Observation cap/);
  }, 15000);
  it("counts malformed and off-document roots against the budget before validation", () => {
    const store = buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a"), entry("b")]);
    terms(store, `${DOC}#observation-a`, `${SOSA}madeBySensor`).clear();
    expect(() => parseObservations(DOC, store, { maxObservations: 1 })).toThrow(/Observation cap/);
    expect(() =>
      parseObservations("https://elsewhere.example/doc", store, { maxObservations: 1 }),
    ).toThrow(/Observation cap/);
  });
  it("enforces UTC day, unique ids, valid options and quad/byte caps", async () => {
    expect(() =>
      buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a", "2026-11-12T01:00:00Z")]),
    ).toThrow(/UTC day/);
    expect(() =>
      buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a", "2026-11-12T00:30:00+02:00")]),
    ).not.toThrow();
    expect(() => buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a"), entry("a")])).toThrow(
      /Duplicate/,
    );
    for (const maxObservations of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => parseObservations(DOC, new Store(), { maxObservations })).toThrow(RangeError);
    }
    const store = buildObservation(ROOT, base);
    expect(() => parseObservations(DOC, store, { maxQuads: 1 })).toThrow(/quad cap/);
    await expect(
      parseObservationsTurtle(DOC, await storeToTurtle(store), { maxQuads: 1 }),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
    expect(() =>
      buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a")], { maxQuads: 1 }),
    ).toThrow(/quad cap/);
    await expect(
      parseObservationsTurtle(DOC, await storeToTurtle(store), { maxBytes: 10 }),
    ).rejects.toThrow(/byte cap/);
    expect(() => parseObservations(`${DOC}#fragment`, store)).toThrow(/fragment/);
  });
  it("keeps root/result names distinct for ids ending in result", () => {
    expect(
      parseObservations(
        DOC,
        buildObservationDay(DOC, SENSOR, "2026-11-11", [entry("a"), entry("a-result")]),
      ),
    ).toHaveLength(2);
  });
});

describe("pod paths", () => {
  it("uses UTC year/month/day paths and adjacent sensor documents", () => {
    expect(observationDocPath("office-monitor", "2026-11-11")).toBe(
      "environment/office-monitor/2026/11/11.ttl",
    );
    expect(observationDocPath("office", "2026-11-12T00:30:00+02:00")).toBe(
      "environment/office/2026/11/11.ttl",
    );
    expect(sensorDocPath("office-monitor")).toBe("environment/office-monitor/sensor.ttl");
  });
  it.each([
    "",
    "..",
    "../outside",
    "two/slugs",
    "a%2fb",
    "Monitor",
    "a?b",
    "a#b",
    "x".repeat(129),
  ])("rejects unsafe slug %s", (value) => {
    expect(() => sensorDocPath(value)).toThrow();
    expect(() => observationDocPath(value, "2026-11-11")).toThrow();
  });
  it("rejects impossible dates", () => {
    expect(() => observationDocPath("office", "2026-02-30")).toThrow();
    expect(() => observationDocPath("office", new Date(NaN))).toThrow();
  });
});
