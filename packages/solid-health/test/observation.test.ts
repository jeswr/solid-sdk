// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Parser, type Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildObservation,
  code,
  HEALTH,
  HealthObservation,
  loincCode,
  MAX_OBSERVATION_QUADS,
  monthlyDocumentPath,
  parseObservations,
  UNITS,
} from "../src/index.js";

const id = "https://pod.test/health/observations/steps/2026-06.ttl#garmin-steps-2026-06-01";
const data = {
  ...loincCode("55423-8", "Steps"),
  type: HEALTH.Steps,
  measuredValue: 12,
  unitCode: "1",
  dateTime: "2026-06-01T00:00:00Z",
} as const;
const nn = DataFactory.namedNode;
const health = "https://jeswr.org/ns/sectors/health#";
const time = "http://www.w3.org/2006/time#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
function replace(store: Store, subject: string, predicate: string, object: string) {
  store.removeQuads(store.getQuads(nn(subject), nn(predicate), null, null));
  store.addQuads(new Parser().parse(`<${subject}> <${predicate}> ${object} .`));
}
describe("generated health observations", () => {
  it("retains explicit IDs, generated codes, typed local patient and timezone-bearing instants; writes decimal values", () => {
    const store = buildObservation(id, data);
    expect(parseObservations(store)).toEqual([
      {
        id,
        ...loincCode("55423-8", "Steps"),
        measuredValue: 12,
        unitCode: "1",
        unit: UNITS.count,
        dateTime: new Date(data.dateTime),
      },
    ]);
    const value = [...store.match(nn(id), nn(`${health}value`))][0]?.object;
    expect(value).toMatchObject({
      termType: "Literal",
      value: "12",
      datatype: nn("http://www.w3.org/2001/XMLSchema#decimal"),
    });
    const observation = new HealthObservation(id, store, DataFactory);
    expect(observation.code).toBe(`${id}-code`);
    expect(observation.time).toBe(`${id}-time`);
    expect(observation.patient).toBe(`${id.split("#")[0]}#subject`);
    expect(
      [...store.match(nn(observation.patient ?? ""), nn(`${rdf}type`))].map((q) => q.object.value),
    ).toEqual([HEALTH.Person]);
  });
  it.each([
    HEALTH.HeartRate,
    HEALTH.Sleep,
    HEALTH.Observation,
  ] as const)("builds the sector subtype %s using generated accessors", (type) => {
    const store = buildObservation(id, { ...data, type });
    expect(parseObservations(store)).toHaveLength(1);
    expect(new HealthObservation(id, store, DataFactory).types.has(type)).toBe(true);
  });
  it("keeps source field codes scheme-free and accepts positive and negative timezone offsets", () => {
    for (const dateTime of ["2026-06-01T01:00:00+01:00", "2026-05-31T23:00:00-01:00"]) {
      const [parsed] = parseObservations(
        buildObservation(id, { ...data, ...code("source-field"), dateTime }),
      );
      expect(parsed?.scheme).toBeUndefined();
      expect(parsed?.dateTime.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    }
  });
  it.each([
    "2026-06-01T00:00:00",
    "2026-06-01T00:00:00+0100",
    "2026-02-30T00:00:00Z",
    "garbageZ",
  ])("refuses invalid timestamp input %s before publishing a graph", (dateTime) => {
    expect(() => buildObservation(id, { ...data, dateTime })).toThrow();
  });
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("refuses a nonfinite measured value %s", (measuredValue) => {
    expect(() => buildObservation(id, { ...data, measuredValue })).toThrow();
  });
  it("enforces required code/value/UCUM fields and subtype unit policies on writes", () => {
    for (const patch of [
      { codeValue: " " },
      { unitCode: "" },
      { measuredValue: undefined },
      { unit: UNITS.metres },
    ])
      expect(() => buildObservation(id, { ...data, ...patch } as never)).toThrow();
    expect(() => code("x", undefined, "source-field" as never)).toThrow(/scheme/);
  });
  it.each([
    "hasCode",
    "patient",
    "effectiveTime",
    "value",
    "unitCode",
  ])("fails closed on a missing required %s", (property) => {
    const store = buildObservation(id, data);
    store.removeQuads(store.getQuads(nn(id), nn(health + property), null, null));
    expect(parseObservations(store)).toEqual([]);
  });
  it("rejects a second raw code link, even a blank node, without sanitizing the original RDF", () => {
    const store = buildObservation(id, data);
    store.addQuads(new Parser().parse(`<${id}> <${health}hasCode> [] .`));
    expect(parseObservations(store)).toEqual([]);
  });
  it.each([
    "2026-06-01T00:00:00",
    "2026-06-01T00:00:00+0100",
    "2026-02-30T00:00:00Z",
  ])("rejects untrusted timestamp lexical form %s", (lexical) => {
    const store = buildObservation(id, data);
    replace(
      store,
      `${id}-time`,
      `${time}inXSDDateTimeStamp`,
      `"${lexical}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
    );
    expect(parseObservations(store)).toEqual([]);
  });
  it("rejects untyped or remote patients and invalid linked code schemes", () => {
    const store = buildObservation(id, data);
    store.removeQuads(store.getQuads(nn(`${id.split("#")[0]}#subject`), null, null, null));
    expect(parseObservations(store)).toEqual([]);
    const remote = buildObservation(id, data);
    replace(remote, id, `${health}patient`, "<https://elsewhere.test/patient>");
    expect(parseObservations(remote)).toEqual([]);
    const scheme = buildObservation(id, data);
    replace(
      scheme,
      `${id}-code`,
      "https://jeswr.org/ns/core#inScheme",
      "<https://invented.test/scheme>",
    );
    expect(parseObservations(scheme)).toEqual([]);
  });
  it("rejects legacy double values and incorrect units through the generated write profile", () => {
    const legacy = buildObservation(id, data);
    replace(legacy, id, `${health}value`, '"12"^^<http://www.w3.org/2001/XMLSchema#double>');
    expect(parseObservations(legacy)).toEqual([]);
    expect(new HealthObservation(id, legacy, DataFactory).measuredValue).toBeUndefined();
    const units = buildObservation(id, data);
    replace(units, id, `${health}hasUnit`, `<${UNITS.metres}>`);
    expect(parseObservations(units)).toEqual([]);
  });
  it("keeps the observation record distinct from its document-local patient", () => {
    expect(() => buildObservation(`${id.split("#")[0]}#subject`, data)).toThrow(
      /Invalid health observation/,
    );
  });
  it("bounds candidates and total quads and preserves its input", () => {
    const store = buildObservation(id, data);
    for (const quad of buildObservation(id.replace("2026-06-01", "2026-06-02"), data))
      store.add(quad);
    const before = [...store];
    expect(() => parseObservations(store, 1)).toThrow(/budget/);
    expect([...store]).toEqual(before);
    expect(() => parseObservations({ size: MAX_OBSERVATION_QUADS + 1 } as never)).toThrow(
      /quad budget/,
    );
    expect(() => parseObservations(store, 0)).toThrow(/limit/);
  });
  it("uses the existing metric/month path and rejects path injection or invalid dates", () => {
    expect(monthlyDocumentPath("resting-heart-rate", new Date(data.dateTime))).toBe(
      "health/observations/resting-heart-rate/2026-06.ttl",
    );
    for (const metric of ["../steps", "x/y", "", "x%2fy"])
      expect(() => monthlyDocumentPath(metric, new Date(data.dateTime))).toThrow();
    expect(() => monthlyDocumentPath("steps", new Date(Number.NaN))).toThrow();
  });
});
